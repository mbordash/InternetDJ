const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const tmp = require('tmp');
const logger = require('./logger');

// Wide bands on purpose. The crossovers are two-pole Butterworth, so energy
// bleeds across them - a 110Hz tone still shows up meaningfully in the
// 120-500Hz band. That is fine for judging "is this mix bass-heavy or thin",
// which is all these numbers are used for. Do not narrow them and start making
// surgical EQ decisions off the result.
const BANDS = [
    { key: 'low', filter: 'lowpass=f=120', label: 'low end' },
    { key: 'lowMid', filter: 'highpass=f=120,lowpass=f=500', label: 'low mids' },
    { key: 'mid', filter: 'highpass=f=500,lowpass=f=4000', label: 'mids' },
    { key: 'high', filter: 'highpass=f=4000', label: 'highs' },
];

// Full-mix astats values worth keeping. Every one of these is read back from
// its own file rather than scraped out of the log: the log prefixes each block
// with a filter index (Parsed_astats_7) that shifts whenever the graph changes,
// and with several astats instances running there is no reliable way to tell
// which block belongs to the full mix.
const OVERALL_METRICS = [
    { key: 'peakDb', metadata: 'Peak_level' },
    { key: 'rmsDb', metadata: 'RMS_level' },
    { key: 'rmsPeakDb', metadata: 'RMS_peak' },
    { key: 'rmsTroughDb', metadata: 'RMS_trough' },
    { key: 'flatFactor', metadata: 'Flat_factor' },
    { key: 'clippedSamples', metadata: 'Abs_Peak_count' },
    { key: 'noiseFloorDb', metadata: 'Noise_floor' },
    { key: 'sampleCount', metadata: 'Number_of_samples' },
];

// ffmpeg filter syntax uses : to separate options and , to separate filters, so
// any of these inside a path would split the graph.
function escapeFilterPath(p) {
    return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/'/g, "\\'");
}

function parseNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

// astats reports silence as -inf. Treat that as a very low but finite level so
// downstream arithmetic cannot produce NaN.
function parseLevel(value, floor = -120) {
    if (value === undefined || value === null) return floor;
    const raw = String(value).trim();
    if (raw === '-inf' || raw === '-Inf') return floor;
    const n = Number(raw);
    return Number.isFinite(n) ? n : floor;
}

// ametadata appends one line per frame; astats runs with reset=0 so the last
// line holds the value accumulated over the whole file.
function readLastMetadataValue(file) {
    try {
        const lines = fs.readFileSync(file, 'utf8')
            .split('\n')
            .filter(l => l.includes('='));
        if (!lines.length) return null;
        return lines[lines.length - 1].split('=').slice(1).join('=').trim();
    } catch (err) {
        return null;
    }
}

function metadataChain(metrics, dir, prefix) {
    return metrics
        .map((m, i) => {
            const file = path.join(dir, `${prefix}${i}.txt`);
            return {
                ...m,
                file,
                filter: `ametadata=mode=print:key=lavfi.astats.Overall.${m.metadata}:file=${escapeFilterPath(file)}`,
            };
        });
}

function probe(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
            if (err) return reject(err);
            const stream = (data.streams || []).find(s => s.codec_type === 'audio');
            resolve({
                durationSec: parseNumber(data.format?.duration) || 0,
                sampleRate: parseNumber(stream?.sample_rate) || 44100,
                channels: parseNumber(stream?.channels) || 2,
            });
        });
    });
}

/**
 * Measures a file in a single decode: EBU R128 loudness, full-mix statistics,
 * and per-band RMS.
 *
 * All three come off one asplit rather than separate ffmpeg runs. On a
 * shared-CPU box a second full decode of a five minute track is not free, and
 * the measurements are independent so there is no reason to pay for it twice.
 */
async function analyzeAudio(filePath, { targetLufs = -14, targetTruePeak = -1, targetLra = 11 } = {}) {
    const workDir = tmp.dirSync({ unsafeCleanup: true, tmpdir: os.tmpdir() });

    try {
        const overall = metadataChain(OVERALL_METRICS, workDir.name, 'overall');
        const bands = BANDS.map((band, i) => {
            const file = path.join(workDir.name, `band${i}.txt`);
            return {
                ...band,
                file,
                chain: `${band.filter},astats=metadata=1:reset=0,` +
                    `ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=${escapeFilterPath(file)}`,
            };
        });

        const outputs = ['[ln]', '[full]', ...bands.map((_, i) => `[b${i}]`)];
        const graph = [
            `[0:a]asplit=${outputs.length}${outputs.join('')}`,
            `[ln]loudnorm=I=${targetLufs}:TP=${targetTruePeak}:LRA=${targetLra}:print_format=json[lnout]`,
            `[full]astats=metadata=1:reset=0,${overall.map(m => m.filter).join(',')}[fullout]`,
            ...bands.map((band, i) => `[b${i}]${band.chain}[o${i}]`),
            `[lnout][fullout]${bands.map((_, i) => `[o${i}]`).join('')}amix=inputs=${outputs.length}`,
        ].join(';');

        const stderrLines = [];
        await new Promise((resolve, reject) => {
            ffmpeg(filePath)
                .complexFilter(graph)
                .outputOptions(['-f', 'null'])
                .output('-')
                .on('stderr', line => stderrLines.push(line))
                .on('end', resolve)
                .on('error', err => reject(new Error(`Analysis pass failed: ${err.message}`)))
                .run();
        });

        // Only one loudnorm runs in the graph, so its JSON block is unambiguous.
        const stderr = stderrLines.join('\n');
        const jsonBlocks = stderr.match(/\{[\s\S]*?\}/g);
        if (!jsonBlocks || !jsonBlocks.length) {
            throw new Error('Could not find loudnorm measurement block in ffmpeg output');
        }
        const loudness = JSON.parse(jsonBlocks[jsonBlocks.length - 1]);

        const stats = {};
        for (const metric of overall) {
            const raw = readLastMetadataValue(metric.file);
            // Counts are plain integers; levels are dB and may be -inf.
            stats[metric.key] = metric.key === 'clippedSamples' || metric.key === 'sampleCount'
                ? (parseNumber(raw) ?? 0)
                : parseLevel(raw);
        }

        const bandLevels = {};
        for (const band of bands) {
            bandLevels[band.key] = parseLevel(readLastMetadataValue(band.file));
        }

        const format = await probe(filePath);

        // Peak-to-RMS. A heavily limited master sits near 8-10 dB; an
        // untouched mix is usually 14 dB or more.
        const crestFactor = (stats.peakDb !== null && stats.rmsDb !== null)
            ? Number((stats.peakDb - stats.rmsDb).toFixed(2))
            : null;

        return {
            integratedLufs: parseNumber(loudness.input_i),
            truePeakDb: parseNumber(loudness.input_tp),
            lra: parseNumber(loudness.input_lra),
            threshold: parseNumber(loudness.input_thresh),
            targetOffset: parseNumber(loudness.target_offset),
            ...stats,
            crestFactor,
            bands: bandLevels,
            ...format,
            measuredAt: new Date().toISOString(),
        };
    } finally {
        try {
            workDir.removeCallback();
        } catch (err) {
            logger.error('Failed to clean up analysis work dir:', err.message);
        }
    }
}

module.exports = { analyzeAudio, BANDS };
