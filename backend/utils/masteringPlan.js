/**
 * Turns a measurement from audioAnalysis into a concrete ffmpeg chain plus a
 * plain-language explanation of what it decided and why.
 *
 * Everything here is deterministic - the same measurement always produces the
 * same plan. There is no model in the loop; the "intelligence" is that the
 * numbers come from the artist's actual audio rather than from a preset.
 */

// Band levels of pink noise measured through the exact filter graph in
// audioAnalysis.js, expressed relative to full-mix RMS. Pink noise is the
// classic reference for a spectrally balanced mix, so these are the neutral
// numbers a well-balanced track should sit near. They are measured, not
// invented - if the band splitter in audioAnalysis.js ever changes, re-measure
// pink noise through the new graph and update these.
const PINK_REFERENCE = {
    low: -3.57,
    lowMid: -8.05,
    mid: -6.50,
    high: -7.46,
};

// Loudness targets are well-established platform and genre norms. The tonal
// tilts are deliberate musical choices layered on top of pink-neutral, and are
// starting values - they want calibrating against real reference tracks before
// anyone treats them as authoritative.
const PROFILES = [
    {
        id: 'club',
        label: 'club/electronic',
        match: ['house', 'techno', 'edm', 'trance', 'dubstep', 'drum and bass', 'dnb', 'd&b',
            'bass', 'electro', 'garage', 'breakbeat', 'hardstyle', 'rave', 'club', 'dance'],
        targetLufs: -9,
        tilt: { low: 2.0, lowMid: -0.5, mid: -0.5, high: 0.5 },
    },
    {
        id: 'hiphop',
        label: 'hip-hop',
        match: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill', 'grime', 'boom bap'],
        targetLufs: -10,
        tilt: { low: 2.5, lowMid: -0.5, mid: -0.5, high: 0 },
    },
    {
        id: 'rock',
        label: 'rock',
        match: ['rock', 'metal', 'punk', 'grunge', 'hardcore', 'emo', 'shoegaze', 'alternative'],
        targetLufs: -11,
        tilt: { low: 0, lowMid: 0, mid: 0.5, high: 0.5 },
    },
    {
        id: 'pop',
        label: 'pop',
        match: ['pop', 'indie', 'synthwave', 'vaporwave', 'r&b', 'rnb', 'soul', 'funk', 'disco'],
        targetLufs: -11,
        tilt: { low: 1.0, lowMid: -0.5, mid: 0, high: 1.0 },
    },
    {
        id: 'acoustic',
        label: 'acoustic/dynamic',
        match: ['acoustic', 'folk', 'jazz', 'classical', 'orchestral', 'ambient', 'lofi',
            'lo-fi', 'singer-songwriter', 'piano', 'blues', 'country'],
        targetLufs: -16,
        tilt: { low: -0.5, lowMid: 0, mid: 0, high: 0.5 },
    },
];

// Streaming services normalise to roughly this, so it is the safe default when
// the genre tags say nothing useful.
const DEFAULT_PROFILE = {
    id: 'streaming',
    label: 'general streaming',
    targetLufs: -14,
    tilt: { low: 0, lowMid: 0, mid: 0, high: 0 },
};

const TARGET_TRUE_PEAK = -1;
const TARGET_LRA = 11;

// Leave anything inside this window alone. Band measurement is approximate
// (the crossovers bleed), so correcting small deviations would be acting on
// noise, and a mix that is already balanced should come back untouched.
const BAND_DEADZONE_DB = 2.5;
const MAX_BAND_CORRECTION_DB = 3.0;

// alimiter works on sample peak, not true peak, so inter-sample peaks can
// still poke above the ceiling. Aim below the target to leave room for them.
const TRUE_PEAK_SAFETY_DB = 0.3;

// Where each band's corrective filter is centred, and which filter shape suits
// it. The outer bands get shelves, the inner ones get wide bells.
const BAND_FILTERS = {
    low: (gain) => `bass=f=120:g=${gain}`,
    lowMid: (gain) => `equalizer=f=250:width_type=o:width=1.5:g=${gain}`,
    mid: (gain) => `equalizer=f=1500:width_type=o:width=2:g=${gain}`,
    high: (gain) => `treble=f=4000:g=${gain}`,
};

const BAND_LABELS = {
    low: 'low end',
    lowMid: 'low mids',
    mid: 'mids',
    high: 'highs',
};

function round(n, places = 1) {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

/**
 * Genre tags on InternetDJ are free-form by design, so this matches keywords
 * inside whatever the artist typed rather than looking the string up in a
 * fixed taxonomy. First profile with a keyword hit wins; unmatched tags simply
 * fall through to the streaming default.
 */
function selectProfile(genre) {
    if (!genre) return DEFAULT_PROFILE;
    const haystack = String(genre).toLowerCase();
    for (const profile of PROFILES) {
        if (profile.match.some(keyword => haystack.includes(keyword))) {
            return profile;
        }
    }
    return DEFAULT_PROFILE;
}

function describeDelta(deltaDb) {
    const abs = Math.abs(deltaDb);
    if (abs >= 5) return deltaDb > 0 ? 'far too heavy' : 'very thin';
    if (abs >= 3) return deltaDb > 0 ? 'heavy' : 'light';
    return deltaDb > 0 ? 'slightly heavy' : 'slightly light';
}

/**
 * @param {object} analysis  output of analyzeAudio
 * @param {object} options   { genre }
 */
function buildMasteringPlan(analysis, { genre } = {}) {
    const profile = selectProfile(genre);
    const findings = [];

    // ---- Loudness -------------------------------------------------------
    const loudnessDelta = profile.targetLufs - analysis.integratedLufs;
    if (Math.abs(loudnessDelta) < 1) {
        findings.push({
            key: 'loudness',
            severity: 'ok',
            text: `Loudness is already about right for ${profile.label} at ${round(analysis.integratedLufs)} LUFS.`,
        });
    } else {
        findings.push({
            key: 'loudness',
            severity: 'info',
            text: `Your mix sits at ${round(analysis.integratedLufs)} LUFS, ` +
                `${round(Math.abs(loudnessDelta))} dB ${loudnessDelta > 0 ? 'quieter' : 'louder'} than the ` +
                `${profile.targetLufs} LUFS typical for ${profile.label}.`,
        });
    }

    // ---- Clipping in the source ----------------------------------------
    // Flat factor counts consecutive identical samples, which is what a
    // flat-topped clipped waveform looks like. Neither this nor the
    // full-scale sample count can be fixed by mastering, but the artist
    // should be told before they build on a damaged file.
    const clipped = Number(analysis.clippedSamples) || 0;
    const alreadyAtCeiling = analysis.truePeakDb !== null && analysis.truePeakDb >= -0.1;
    if (clipped > 100 || (analysis.flatFactor || 0) > 5) {
        findings.push({
            key: 'clipping',
            severity: 'warn',
            text: `There are ${clipped.toLocaleString()} samples at full scale in the source. ` +
                `That distortion is baked into the file and mastering cannot undo it — ` +
                `re-export from your DAW with a few dB of headroom for a cleaner result.`,
        });
    } else if (alreadyAtCeiling) {
        findings.push({
            key: 'clipping',
            severity: 'warn',
            text: `The source peaks at ${round(analysis.truePeakDb, 2)} dBTP, right at the ceiling. ` +
                `Leaving headroom on export gives mastering more room to work.`,
        });
    }

    // ---- Tonal balance --------------------------------------------------
    const bandAdjustments = {};
    const bandFindings = [];
    for (const band of Object.keys(PINK_REFERENCE)) {
        const measured = analysis.bands?.[band];
        if (measured === undefined || measured === null || analysis.rmsDb === null) {
            bandAdjustments[band] = 0;
            continue;
        }

        // Compare shapes, not absolute levels: how the band sits relative to
        // the whole mix, against how it would sit in a balanced one.
        const relative = measured - analysis.rmsDb;
        const target = PINK_REFERENCE[band] + (profile.tilt[band] || 0);
        const deviation = relative - target;

        if (Math.abs(deviation) <= BAND_DEADZONE_DB) {
            bandAdjustments[band] = 0;
            continue;
        }

        const correction = clamp(-deviation, -MAX_BAND_CORRECTION_DB, MAX_BAND_CORRECTION_DB);
        bandAdjustments[band] = round(correction);
        bandFindings.push({
            key: `band:${band}`,
            severity: 'info',
            text: `The ${BAND_LABELS[band]} are ${describeDelta(deviation)} for ${profile.label} ` +
                `(${round(Math.abs(deviation))} dB ${deviation > 0 ? 'above' : 'below'} balanced) — ` +
                `applying ${correction > 0 ? '+' : ''}${round(correction)} dB.`,
        });
    }

    if (!bandFindings.length) {
        findings.push({
            key: 'tonal',
            severity: 'ok',
            text: 'Tonal balance is already sitting well — no corrective EQ needed.',
        });
    } else {
        findings.push(...bandFindings);
    }

    // ---- Dynamics -------------------------------------------------------
    // Crest factor is peak-to-RMS; LRA is the EBU loudness range. A track that
    // is already squashed must not be compressed again - that is how automated
    // mastering ruins a finished master.
    const crest = analysis.crestFactor;
    const lra = analysis.lra;
    let compressor = null;

    const lowCrest = crest !== null && crest < 9;
    const lowRange = lra !== null && lra < 4;

    if (lowCrest || lowRange) {
        // Name whichever measure actually fired, so the readout does not blame
        // peak-to-RMS for a decision the loudness range drove.
        const evidence = lowCrest
            ? `${round(crest)} dB peak-to-RMS`
            : `${round(lra)} LU loudness range`;
        findings.push({
            key: 'dynamics',
            severity: 'ok',
            text: `This is already tightly controlled (${evidence}), so it is getting loudness ` +
                `and tone only — compressing it again would flatten it.`,
        });
    } else if (crest !== null && crest > 16) {
        compressor = { threshold: -18, ratio: 2, attack: 20, release: 250 };
        findings.push({
            key: 'dynamics',
            severity: 'info',
            text: `Very dynamic at ${round(crest)} dB peak-to-RMS — applying gentle 2:1 glue ` +
                `compression to even it out.`,
        });
    } else if (crest !== null) {
        compressor = { threshold: -16, ratio: 1.5, attack: 20, release: 250 };
        findings.push({
            key: 'dynamics',
            severity: 'info',
            text: `Dynamics are in a normal range (${round(crest)} dB peak-to-RMS) — ` +
                `applying light 1.5:1 compression.`,
        });
    }

    // ---- Build the chain ------------------------------------------------
    const filters = [];
    for (const [band, gain] of Object.entries(bandAdjustments)) {
        if (gain !== 0) filters.push(BAND_FILTERS[band](gain));
    }
    if (compressor) {
        filters.push(
            `acompressor=threshold=${compressor.threshold}dB:ratio=${compressor.ratio}` +
            `:attack=${compressor.attack}:release=${compressor.release}`
        );
    }

    const madeChanges = filters.length > 0 || Math.abs(loudnessDelta) >= 1;

    return {
        profile: { id: profile.id, label: profile.label, matchedGenre: genre || null },
        targetLufs: profile.targetLufs,
        targetTruePeak: TARGET_TRUE_PEAK,
        targetLra: TARGET_LRA,
        limiterCeilingDb: TARGET_TRUE_PEAK - TRUE_PEAK_SAFETY_DB,
        bandAdjustments,
        compressor,
        // EQ and compression only. Loudness is handled by the two-pass
        // loudnorm in the renderer, which needs its own measured values.
        preFilters: filters,
        findings,
        madeChanges,
        summary: madeChanges
            ? `Mastered for ${profile.label}: targeting ${profile.targetLufs} LUFS with ` +
              `${filters.length ? 'corrective EQ' : 'loudness adjustment'}` +
              `${compressor ? ' and light compression' : ''}.`
            : `This track is already well balanced and sitting at the right loudness for ` +
              `${profile.label}. Only a small loudness trim was applied.`,
    };
}

module.exports = {
    buildMasteringPlan,
    selectProfile,
    PINK_REFERENCE,
    PROFILES,
    DEFAULT_PROFILE,
};
