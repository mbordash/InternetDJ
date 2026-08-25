const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const mm = require('music-metadata');
const logger = require('./logger');

// Tempo and key detection, in plain JS on top of the ffmpeg we already ship.
// Deliberately dependency-free: an apt package or a native binding would be
// one more thing to install in the image and one more thing that cannot be
// exercised locally.
//
// 22.05 kHz is plenty. Everything that carries tempo or pitch class here lives
// well below 11 kHz, and halving the sample rate halves the analysis cost.
const SAMPLE_RATE = 22050;

// Analysing the middle of a track rather than all of it is both faster and
// more accurate: intros and outros are where the beat is sparse or absent.
const ANALYSIS_WINDOW_SEC = 120;
const WINDOW_START_FRACTION = 0.25;

// Onset detection wants time resolution, chroma wants frequency resolution,
// so they run as two passes with different frame sizes over the same audio.
const ONSET_FRAME = 1024;
const ONSET_HOP = 256;
const CHROMA_FRAME = 4096;
const CHROMA_HOP = 2048;

const MIN_BPM = 60;
const MAX_BPM = 200;

// Most dance music sits near here, and tempo autocorrelation is ambiguous
// between a tempo and its double or half. A log-normal prior over octaves
// breaks that tie the way a listener would, without hard-coding a range.
const TEMPO_PRIOR_BPM = 125;
const TEMPO_PRIOR_OCTAVES = 0.9;

// Chroma is only trustworthy where an FFT bin is narrower than a semitone.
// At 22.05 kHz with a 4096-point frame that holds from about C3 upward.
const CHROMA_MIN_HZ = 130.8;  // C3
const CHROMA_MAX_HZ = 2093.0; // C7

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Below these, we store nothing rather than a guess. Percussion-only or
// atonal material scores around 0.35 on key and drifts at random, which is
// exactly the case that must not end up captioned on a song page.
const KEY_CONFIDENCE_MIN = 0.55;
const BPM_CONFIDENCE_MIN = 0.15;

// Key profiles: how strongly each scale degree is weighted in a major and a
// minor key. Albrecht & Shanahan (2013), derived from a corpus of scored music
// specifically to improve automatic key finding, rather than the older
// Krumhansl-Schmuckler probe-tone profiles.
const MAJOR_PROFILE = [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081];
const MINOR_PROFILE = [0.220, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052];

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` must be a power of
 * two long.
 */
function fft(re, im) {
    const n = re.length;

    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const stepRe = Math.cos(angle);
        const stepIm = Math.sin(angle);
        const half = len >> 1;
        for (let i = 0; i < n; i += len) {
            let wRe = 1;
            let wIm = 0;
            for (let j = 0; j < half; j++) {
                const aRe = re[i + j];
                const aIm = im[i + j];
                const bRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
                const bIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
                re[i + j] = aRe + bRe;
                im[i + j] = aIm + bIm;
                re[i + j + half] = aRe - bRe;
                im[i + j + half] = aIm - bIm;
                const nextRe = wRe * stepRe - wIm * stepIm;
                wIm = wRe * stepIm + wIm * stepRe;
                wRe = nextRe;
            }
        }
    }
}

function hannWindow(size) {
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
}

/** Peak of the parabola through three points, as an offset in [-1, 1]. */
function parabolicPeak(yPrev, yMid, yNext) {
    const denom = yPrev - 2 * yMid + yNext;
    if (denom === 0) return 0;
    const offset = (0.5 * (yPrev - yNext)) / denom;
    return Number.isFinite(offset) && Math.abs(offset) <= 1 ? offset : 0;
}

function pearson(a, b) {
    const n = a.length;
    let meanA = 0;
    let meanB = 0;
    for (let i = 0; i < n; i++) {
        meanA += a[i];
        meanB += b[i];
    }
    meanA /= n;
    meanB /= n;

    let num = 0;
    let devA = 0;
    let devB = 0;
    for (let i = 0; i < n; i++) {
        const da = a[i] - meanA;
        const db = b[i] - meanB;
        num += da * db;
        devA += da * da;
        devB += db * db;
    }
    const denom = Math.sqrt(devA * devB);
    return denom === 0 ? 0 : num / denom;
}

/**
 * Decode a window of the file to mono float samples at SAMPLE_RATE. Seeking
 * before -i keeps ffmpeg from decoding everything up to the start point.
 */
function decodeWindow(filePath, startSec, durationSec) {
    return new Promise((resolve, reject) => {
        const args = [
            '-hide_banner', '-loglevel', 'error',
            '-ss', String(Math.max(0, startSec)),
            '-t', String(durationSec),
            '-i', filePath,
            '-ac', '1',
            '-ar', String(SAMPLE_RATE),
            '-f', 'f32le',
            '-',
        ];
        const proc = spawn(ffmpegStatic, args);
        const chunks = [];
        let stderr = '';

        proc.stdout.on('data', (chunk) => chunks.push(chunk));
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
                return;
            }
            const buffer = Buffer.concat(chunks);
            // Buffer.concat gives no alignment guarantee, so copy into a
            // correctly aligned view rather than wrapping the bytes directly.
            const samples = new Float32Array(buffer.length >> 2);
            for (let i = 0; i < samples.length; i++) {
                samples[i] = buffer.readFloatLE(i * 4);
            }
            resolve(samples);
        });
    });
}

/**
 * Spectral flux onset envelope: how much energy appeared since the previous
 * frame, which peaks on every drum hit and note attack.
 */
function onsetEnvelope(samples) {
    const window = hannWindow(ONSET_FRAME);
    const bins = ONSET_FRAME >> 1;
    const frameCount = Math.max(0, Math.floor((samples.length - ONSET_FRAME) / ONSET_HOP) + 1);
    const envelope = new Float64Array(Math.max(0, frameCount - 1));

    let prevMag = new Float64Array(bins);
    const re = new Float64Array(ONSET_FRAME);
    const im = new Float64Array(ONSET_FRAME);
    let mag = new Float64Array(bins);

    for (let f = 0; f < frameCount; f++) {
        const offset = f * ONSET_HOP;
        for (let i = 0; i < ONSET_FRAME; i++) {
            re[i] = samples[offset + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);

        let flux = 0;
        for (let k = 0; k < bins; k++) {
            mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            const diff = mag[k] - prevMag[k];
            if (diff > 0) flux += diff;
        }
        if (f > 0) envelope[f - 1] = flux;

        const swap = prevMag;
        prevMag = mag;
        mag = swap;
    }

    return { envelope, frameRate: SAMPLE_RATE / ONSET_HOP };
}

/**
 * Subtract a local mean and half-wave rectify, so a loud passage does not
 * outvote a quiet one and only relative peaks survive.
 */
function whiten(envelope, frameRate) {
    const radius = Math.max(1, Math.round(frameRate * 0.4));
    const out = new Float64Array(envelope.length);
    let sum = 0;
    for (let i = 0; i < envelope.length; i++) sum += envelope[i];

    for (let i = 0; i < envelope.length; i++) {
        const from = Math.max(0, i - radius);
        const to = Math.min(envelope.length - 1, i + radius);
        let local = 0;
        for (let j = from; j <= to; j++) local += envelope[j];
        local /= (to - from + 1);
        const value = envelope[i] - local;
        out[i] = value > 0 ? value : 0;
    }
    return sum === 0 ? null : out;
}

function detectTempo(samples) {
    const { envelope, frameRate } = onsetEnvelope(samples);
    if (envelope.length < frameRate) return { bpm: null, confidence: 0 };

    const onsets = whiten(envelope, frameRate);
    if (!onsets) return { bpm: null, confidence: 0 };

    const minLag = Math.floor((60 * frameRate) / MAX_BPM);
    const maxLag = Math.ceil((60 * frameRate) / MIN_BPM);
    if (maxLag >= onsets.length) return { bpm: null, confidence: 0 };

    let energy = 0;
    for (let i = 0; i < onsets.length; i++) energy += onsets[i] * onsets[i];
    if (energy === 0) return { bpm: null, confidence: 0 };

    const scores = new Float64Array(maxLag + 1);
    let best = minLag;
    let bestScore = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i + lag < onsets.length; i++) {
            sum += onsets[i] * onsets[i + lag];
        }
        const correlation = sum / energy;

        // Weight by how plausible this tempo is, in octaves from the prior.
        const bpm = (60 * frameRate) / lag;
        const octaves = Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES;
        scores[lag] = correlation * Math.exp(-0.5 * octaves * octaves);

        if (scores[lag] > bestScore) {
            bestScore = scores[lag];
            best = lag;
        }
    }

    // Interpolate between lags: at fast tempos a whole lag step is several BPM.
    let refined = best;
    if (best > minLag && best < maxLag) {
        refined += parabolicPeak(scores[best - 1], scores[best], scores[best + 1]);
    }

    const bpm = (60 * frameRate) / refined;
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
        return { bpm: null, confidence: 0 };
    }

    return { bpm: Math.round(bpm * 100) / 100, confidence: Math.max(0, Math.min(1, bestScore)) };
}

function chromagram(samples) {
    const window = hannWindow(CHROMA_FRAME);
    const bins = CHROMA_FRAME >> 1;
    const binHz = SAMPLE_RATE / CHROMA_FRAME;

    // Pitch class per bin, precomputed once; -1 means outside the usable range.
    const binPitchClass = new Int8Array(bins);
    for (let k = 0; k < bins; k++) {
        const freq = k * binHz;
        if (freq < CHROMA_MIN_HZ || freq > CHROMA_MAX_HZ) {
            binPitchClass[k] = -1;
            continue;
        }
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        binPitchClass[k] = ((midi % 12) + 12) % 12;
    }

    const frameCount = Math.max(0, Math.floor((samples.length - CHROMA_FRAME) / CHROMA_HOP) + 1);
    const re = new Float64Array(CHROMA_FRAME);
    const im = new Float64Array(CHROMA_FRAME);
    const frames = [];

    for (let f = 0; f < frameCount; f++) {
        const offset = f * CHROMA_HOP;
        for (let i = 0; i < CHROMA_FRAME; i++) {
            re[i] = samples[offset + i] * window[i];
            im[i] = 0;
        }
        fft(re, im);

        const local = new Float64Array(12);
        let total = 0;
        for (let k = 0; k < bins; k++) {
            const pc = binPitchClass[k];
            if (pc < 0) continue;
            const magnitude = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            local[pc] += magnitude;
            total += magnitude;
        }
        if (total > 0) frames.push({ local, total });
    }

    if (!frames.length) return null;

    // Skip near-silent frames, then give every remaining frame equal weight so
    // a loud drop does not decide the key on its own.
    const totals = frames.map(f => f.total).sort((a, b) => a - b);
    const median = totals[totals.length >> 1];
    const floor = median * 0.1;

    const chroma = new Float64Array(12);
    let used = 0;
    for (const frame of frames) {
        if (frame.total < floor) continue;
        for (let pc = 0; pc < 12; pc++) chroma[pc] += frame.local[pc] / frame.total;
        used++;
    }
    if (!used) return null;

    for (let pc = 0; pc < 12; pc++) chroma[pc] /= used;
    return chroma;
}

/** Tonic of the relative key: minor sits three semitones below its major. */
function relativeOf(tonic, mode) {
    return mode === 'minor'
        ? { tonic: (tonic + 3) % 12, mode: 'major' }
        : { tonic: (tonic + 9) % 12, mode: 'minor' };
}

function detectKey(samples) {
    const chroma = chromagram(samples);
    if (!chroma) return { key: null, confidence: 0, alternative: null };

    const candidates = [];
    for (let tonic = 0; tonic < 12; tonic++) {
        const rotated = new Float64Array(12);
        for (let i = 0; i < 12; i++) rotated[i] = chroma[(tonic + i) % 12];
        for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
            candidates.push({ tonic, mode, score: pearson(rotated, profile) });
        }
    }
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || best.score <= 0) return { key: null, confidence: 0, alternative: null };

    // A key and its relative are built from the same seven pitch classes, so a
    // histogram of pitch classes cannot separate them -- what distinguishes
    // them is which chord a phrase begins and resolves on, which is temporal
    // information this analysis does not have. When the runner-up is the
    // relative, treat the pitch-class set as the confident part of the answer
    // and the major/minor label as the shaky part, rather than pretending the
    // near-tie was decisive.
    const relative = relativeOf(best.tonic, best.mode);
    const runnerUp = candidates[1];
    const isRelativeAmbiguity = runnerUp
        && runnerUp.tonic === relative.tonic
        && runnerUp.mode === relative.mode;

    // Measure separation against the best candidate that is NOT the relative:
    // that is the real question of whether we identified the right scale.
    const rival = candidates.find(c => !(c.tonic === best.tonic && c.mode === best.mode)
        && !(c.tonic === relative.tonic && c.mode === relative.mode));
    const margin = rival ? Math.max(0, best.score - rival.score) : best.score;

    let confidence = Math.max(0, Math.min(1, best.score))
        * (0.5 + 0.5 * Math.min(1, margin / 0.25));
    if (isRelativeAmbiguity) confidence *= 0.8;

    return {
        key: `${PITCH_NAMES[best.tonic]} ${best.mode}`,
        confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 1000) / 1000,
        // Worth surfacing: harmonically these two mix interchangeably, so a
        // member correcting one to the other is a one-click change.
        alternative: isRelativeAmbiguity
            ? `${PITCH_NAMES[relative.tonic]} ${relative.mode}`
            : null,
    };
}

/**
 * Tempo, key and duration for an audio file on disk.
 *
 * `bpm` and `key` are null when nothing convincing was found; both are
 * suggestions, not facts, and key in particular is wrong often enough that it
 * should always be presented as editable.
 */
async function analyzeAudioFeatures(filePath) {
    let durationSec = null;
    try {
        const metadata = await mm.parseFile(filePath, { duration: true });
        const parsed = metadata?.format?.duration;
        if (Number.isFinite(parsed) && parsed > 0) durationSec = parsed;
    } catch (err) {
        logger.warn?.('Could not read duration metadata', { err: err.message });
    }

    // Centre the window on the body of the track when there is enough of it.
    let startSec = 0;
    let windowSec = ANALYSIS_WINDOW_SEC;
    if (durationSec && durationSec > ANALYSIS_WINDOW_SEC * 1.25) {
        startSec = Math.min(
            durationSec * WINDOW_START_FRACTION,
            Math.max(0, durationSec - ANALYSIS_WINDOW_SEC)
        );
    } else if (durationSec) {
        windowSec = Math.ceil(durationSec);
    }

    const samples = await decodeWindow(filePath, startSec, windowSec);
    if (!samples.length) {
        throw new Error('Decoded no audio to analyse');
    }
    if (durationSec === null) {
        // Only exact when the whole file fit in the window, but better than
        // storing nothing.
        durationSec = samples.length / SAMPLE_RATE;
    }

    const tempo = detectTempo(samples);
    const key = detectKey(samples);

    return {
        durationSec: Math.round(durationSec * 100) / 100,
        bpm: tempo.bpm,
        bpmConfidence: Math.round(tempo.confidence * 1000) / 1000,
        key: key.key,
        keyConfidence: key.confidence,
        keyAlternative: key.alternative,
    };
}

module.exports = {
    analyzeAudioFeatures,
    KEY_CONFIDENCE_MIN,
    BPM_CONFIDENCE_MIN,
    // Exported for the test harness.
    detectTempo,
    detectKey,
    decodeWindow,
    SAMPLE_RATE,
};
