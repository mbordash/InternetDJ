const ffmpeg = require('fluent-ffmpeg');
const logger = require('./logger');

// How far the verify pass may drift from target before a corrective re-render
// is worth paying for.
const LUFS_TOLERANCE_DB = 1.0;

// Ceiling on how hard the track may be driven into the limiter. Past roughly
// this much the limiter is audibly eating transients, and a quieter honest
// master beats a loud damaged one. When the target still cannot be reached the
// renderer reports the shortfall instead of pushing further.
const MAX_LIMITER_DRIVE_DB = 4.0;

// Measured, not assumed: driving the limiter yields about 0.63 dB of
// integrated loudness per dB of drive, because the limiter is spending the
// rest on crest factor. Used to size the second attempt so it usually lands in
// one correction rather than several.
const DRIVE_EFFICIENCY = 0.63;

// Within this much of the ceiling the output is peak-limited, so more gain
// alone cannot make it louder - only limiter drive can.
const PEAK_LIMITED_MARGIN_DB = 0.5;

function dbToLinear(db) {
    return Number((10 ** (db / 20)).toFixed(6));
}

/**
 * Builds the render chain.
 *
 * Order matters: corrective EQ and compression run first so loudnorm measures
 * and normalises the audio as it will actually sound; loudnorm then does the
 * bulk of the level change; drive and the limiter close whatever gap is left.
 *
 * Two loudnorm details worth not rediscovering the hard way:
 *
 *  - It needs measured_* values from a prior analysis pass. Given them it
 *    behaves as a predictable gain stage; without them it guesses from a
 *    single pass and lands wide of the target.
 *
 *  - alimiter's `level` option defaults to true, which auto-levels the output
 *    and silently undoes the limiting - output measured +0.05 dBTP against a
 *    -1 dBTP ceiling no matter what `limit` was set to. `level=disabled` is
 *    what makes the ceiling real. alimiter also works on sample peak rather
 *    than true peak, which is why the plan's ceiling already sits a little
 *    below the true-peak target.
 */
function buildRenderFilters(plan, measured, driveDb = 0) {
    const loudnorm = [
        `loudnorm=I=${plan.targetLufs}`,
        `TP=${plan.targetTruePeak}`,
        `LRA=${plan.targetLra}`,
        `measured_I=${measured.integratedLufs}`,
        `measured_TP=${measured.truePeakDb}`,
        `measured_LRA=${measured.lra}`,
        `measured_thresh=${measured.threshold}`,
        `offset=${measured.targetOffset}`,
        'linear=true',
    ].join(':');

    const filters = [...plan.preFilters, loudnorm];
    if (driveDb > 0) filters.push(`volume=${Number(driveDb.toFixed(2))}dB`);
    filters.push(`alimiter=level=disabled:limit=${dbToLinear(plan.limiterCeilingDb)}`);
    return filters;
}

function runFfmpeg(inputPath, outputPath, filters, { bitrate = '320k' } = {}) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioFilters(filters)
            .audioBitrate(bitrate)
            .output(outputPath)
            .on('end', resolve)
            .on('error', err => reject(new Error(`Render failed: ${err.message}`)))
            .run();
    });
}

/**
 * Renders the plan, measures the result, and corrects once if it missed.
 *
 * The correction is chosen by what the measurement says went wrong rather than
 * by prediction, because predicting loudnorm's peak-constrained gain from the
 * input numbers is unreliable:
 *
 *  - Output sitting at the ceiling but under target: the track is peak-limited
 *    and only limiter drive can make it louder.
 *  - Output under target with headroom to spare: loudnorm's offset was off, so
 *    nudge the offset by the miss.
 *
 * The verify pass is not ceremony. It is what caught the alimiter auto-level
 * bug during development, and it is the only thing standing between a bad
 * measurement and an over-limit master reaching listeners.
 *
 * @param {function} analyze  injected analyzeAudio, so this module does not
 *                            depend on how measurement is performed
 */
async function renderMaster({ inputPath, outputPath, plan, measured, analyze }) {
    const targets = {
        targetLufs: plan.targetLufs,
        targetTruePeak: plan.targetTruePeak,
        targetLra: plan.targetLra,
    };

    let driveDb = 0;
    let filters = buildRenderFilters(plan, measured, driveDb);
    await runFfmpeg(inputPath, outputPath, filters);
    let verification = await analyze(outputPath, targets);

    const shortfall = plan.targetLufs - verification.integratedLufs;
    let corrected = false;

    if (Math.abs(shortfall) > LUFS_TOLERANCE_DB) {
        const peakLimited = verification.truePeakDb !== null
            && verification.truePeakDb >= plan.limiterCeilingDb - PEAK_LIMITED_MARGIN_DB;

        if (shortfall > 0 && peakLimited) {
            driveDb = Math.min(shortfall / DRIVE_EFFICIENCY, MAX_LIMITER_DRIVE_DB);
            logger.info(
                `Master is peak-limited ${shortfall.toFixed(2)} dB below target; ` +
                `re-rendering with ${driveDb.toFixed(2)} dB of limiter drive`
            );
            filters = buildRenderFilters(plan, measured, driveDb);
        } else {
            logger.info(
                `Master missed loudness target by ${shortfall.toFixed(2)} dB; ` +
                `re-rendering with corrected offset`
            );
            const adjusted = {
                ...measured,
                targetOffset: Number(measured.targetOffset) + shortfall,
            };
            filters = buildRenderFilters(plan, adjusted, driveDb);
        }

        await runFfmpeg(inputPath, outputPath, filters);
        verification = await analyze(outputPath, targets);
        corrected = true;
    }

    const finalMiss = plan.targetLufs - verification.integratedLufs;
    const onTarget = Math.abs(finalMiss) <= LUFS_TOLERANCE_DB;

    // A track too dynamic to reach its genre's loudness without damage is a
    // real result the artist should hear about, not a failure to hide.
    const notes = [];
    if (!onTarget && finalMiss > 0) {
        notes.push({
            key: 'loudness-shortfall',
            severity: 'info',
            text: `This mix is too dynamic to reach ${plan.targetLufs} LUFS without heavy ` +
                `limiting that would flatten it, so it was mastered to ` +
                `${verification.integratedLufs.toFixed(1)} LUFS instead. ` +
                `Tightening the dynamics in your mix would let it go louder cleanly.`,
        });
    }
    if (verification.truePeakDb !== null && verification.truePeakDb > plan.targetTruePeak + 0.2) {
        notes.push({
            key: 'peak-overshoot',
            severity: 'warn',
            text: `Output true peak came in at ${verification.truePeakDb.toFixed(2)} dBTP, ` +
                `above the ${plan.targetTruePeak} dBTP target.`,
        });
    }

    return { filters, verification, corrected, driveDb, onTarget, notes };
}

module.exports = {
    renderMaster,
    buildRenderFilters,
    LUFS_TOLERANCE_DB,
    MAX_LIMITER_DRIVE_DB,
};
