/**
 * Regression test for tempo/key detection. Synthesises audio with a known
 * tempo and a known key, runs it through utils/audioFeatures.js, and checks
 * what comes back:
 *
 *   node backend/scripts/verifyAudioFeatures.js
 *
 * No database, no network, no test framework - just ffmpeg and arithmetic.
 * Run it after touching anything in audioFeatures.js.
 *
 * Note what the key assertions do and do not demand. A key and its relative
 * are built from the same seven pitch classes, so for a chord progression that
 * spreads its weight evenly, either answer is defensible and both are accepted.
 * Material that sits on its tonic has to be named exactly, and percussion has
 * to come back under the confidence bar so that nothing is stored at all.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzeAudioFeatures, KEY_CONFIDENCE_MIN } = require('../utils/audioFeatures');

const SR = 44100;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'idj-audiofeatures-'));

function writeWav(filePath, samples) {
    const data = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
        let v = Math.max(-1, Math.min(1, samples[i]));
        data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SR, 24);
    header.writeUInt32LE(SR * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

// --- tempo material: kick on every beat, hat on every eighth ---------------
function renderDrums(bpm, seconds) {
    const out = new Float32Array(SR * seconds);
    const beat = 60 / bpm;

    const addKick = (at) => {
        const start = Math.round(at * SR);
        const len = Math.round(0.12 * SR);
        for (let i = 0; i < len && start + i < out.length; i++) {
            const t = i / SR;
            const env = Math.exp(-t * 38);
            // Pitch-swept sine: the thump plus the click that marks the onset.
            const freq = 55 + 90 * Math.exp(-t * 55);
            out[start + i] += Math.sin(2 * Math.PI * freq * t) * env * 0.9;
        }
    };

    const addHat = (at) => {
        const start = Math.round(at * SR);
        const len = Math.round(0.03 * SR);
        for (let i = 0; i < len && start + i < out.length; i++) {
            const env = Math.exp(-(i / SR) * 220);
            out[start + i] += (Math.random() * 2 - 1) * env * 0.25;
        }
    };

    for (let t = 0; t < seconds; t += beat) addKick(t);
    for (let t = beat / 2; t < seconds; t += beat) addHat(t);
    return out;
}

// --- key material: a chord progression built from the scale ----------------
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function renderChords(tonicName, mode, seconds) {
    const tonic = NAMES.indexOf(tonicName);
    // Scale degrees of the triads in a common progression, in semitones from
    // the tonic: i - VI - III - VII for minor, I - vi - IV - V for major.
    const roots = mode === 'minor' ? [0, 8, 3, 10] : [0, 9, 5, 7];
    const quality = mode === 'minor' ? [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]
                                     : [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]];

    const out = new Float32Array(SR * seconds);
    const chordSec = 2;
    let chordIndex = 0;

    for (let start = 0; start < seconds; start += chordSec, chordIndex++) {
        const root = roots[chordIndex % roots.length];
        const intervals = quality[chordIndex % quality.length];
        // MIDI 48 is C3, the bottom of the usable chroma range.
        const base = 48 + tonic + root;
        const notes = intervals.map(i => base + i).concat(intervals.map(i => base + i + 12));

        const from = Math.round(start * SR);
        const len = Math.round(chordSec * SR);
        for (const note of notes) {
            const hz = midiHz(note);
            for (let i = 0; i < len && from + i < out.length; i++) {
                const t = i / SR;
                const env = Math.min(1, t * 20) * Math.exp(-t * 0.5);
                out[from + i] += Math.sin(2 * Math.PI * hz * t) * env * 0.12;
            }
        }
    }
    return out;
}

function renderVamp(tonicName, mode, seconds) {
    const tonic = NAMES.indexOf(tonicName);
    const triad = mode === 'minor' ? [0, 3, 7] : [0, 4, 7];
    const out = new Float32Array(SR * seconds);
    const base = 48 + tonic;

    // Sustained triad plus a bass note an octave down, the way a lot of
    // electronic music sits on one chord for bars at a time.
    for (const note of triad.map(i => base + i).concat(triad.map(i => base + i + 12), [base - 12])) {
        const hz = midiHz(note);
        for (let i = 0; i < out.length; i++) {
            const t = i / SR;
            const pulse = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t);
            out[i] += Math.sin(2 * Math.PI * hz * t) * 0.1 * pulse;
        }
    }
    return out;
}

function relativeKey(name) {
    const [tonic, mode] = name.split(' ');
    const i = NAMES.indexOf(tonic);
    return mode === 'minor'
        ? `${NAMES[(i + 3) % 12]} major`
        : `${NAMES[(i + 9) % 12]} minor`;
}

function mix(a, b) {
    const out = new Float32Array(Math.max(a.length, b.length));
    for (let i = 0; i < out.length; i++) out[i] = (a[i] || 0) + (b[i] || 0);
    return out;
}

(async () => {
    const cases = [];

    for (const bpm of [90, 120, 128, 140, 174]) {
        const file = path.join(OUT, `tempo-${bpm}.wav`);
        writeWav(file, renderDrums(bpm, 40));
        // Percussion has no key; the job of the confidence score is to say so.
        cases.push({ file, label: `drums @ ${bpm} BPM`, expectBpm: bpm, expectKey: null, expectNoKey: true });
    }

    // Progressions whose pitch-class histogram is genuinely shared with the
    // relative key: getting either one is correct, being smug about it is not.
    for (const [tonic, mode] of [['C', 'minor'], ['A', 'major'], ['F#', 'minor'], ['D', 'major']]) {
        const file = path.join(OUT, `key-${tonic.replace('#', 's')}-${mode}.wav`);
        writeWav(file, renderChords(tonic, mode, 40));
        cases.push({
            file, label: `chords in ${tonic} ${mode}`, expectBpm: null,
            expectKey: `${tonic} ${mode}`, relativeOk: true,
        });
    }

    // A track sitting on its tonic chord: this one has no excuse.
    for (const [tonic, mode] of [['C', 'minor'], ['A', 'minor'], ['G', 'major']]) {
        const file = path.join(OUT, `vamp-${tonic.replace('#', 's')}-${mode}.wav`);
        writeWav(file, renderVamp(tonic, mode, 40));
        cases.push({
            file, label: `tonic vamp in ${tonic} ${mode}`, expectBpm: null,
            expectKey: `${tonic} ${mode}`,
        });
    }

    // The realistic case: drums and harmony at once.
    for (const [bpm, tonic, mode] of [[128, 'C', 'minor'], [174, 'F#', 'minor']]) {
        const file = path.join(OUT, `full-${bpm}-${tonic.replace('#', 's')}.wav`);
        writeWav(file, mix(renderDrums(bpm, 40), renderChords(tonic, mode, 40)));
        cases.push({
            file, label: `drums+chords @ ${bpm} in ${tonic} ${mode}`,
            expectBpm: bpm, expectKey: `${tonic} ${mode}`, relativeOk: true,
        });
    }

    let failures = 0;
    for (const c of cases) {
        const t0 = Date.now();
        const r = await analyzeAudioFeatures(c.file);
        const ms = Date.now() - t0;

        const notes = [];
        let ok = true;

        if (c.expectBpm !== null) {
            const err = r.bpm === null ? Infinity : Math.abs(r.bpm - c.expectBpm);
            const halfOrDouble = r.bpm !== null &&
                (Math.abs(r.bpm * 2 - c.expectBpm) < 2 || Math.abs(r.bpm / 2 - c.expectBpm) < 2);
            if (err > 2) {
                ok = false;
                notes.push(halfOrDouble ? 'BPM OCTAVE ERROR' : 'BPM WRONG');
            }
        }
        if (c.expectNoKey) {
            // Storing a key here would caption a drum loop with a lie.
            if (r.keyConfidence >= KEY_CONFIDENCE_MIN) {
                ok = false;
                notes.push(`KEY OVERCONFIDENT (would store ${r.key})`);
            }
        } else if (c.expectKey !== null) {
            const accepted = [c.expectKey];
            if (c.relativeOk) accepted.push(relativeKey(c.expectKey));
            if (!accepted.includes(r.key)) {
                ok = false;
                notes.push(`KEY WRONG (wanted ${accepted.join(' or ')})`);
            } else if (r.keyConfidence < KEY_CONFIDENCE_MIN) {
                ok = false;
                notes.push('KEY UNDERCONFIDENT (would store nothing)');
            } else if (r.key !== c.expectKey) {
                notes.push(`relative (${r.key})`);
            }
        }
        if (!ok) failures++;

        console.log(
            `${ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(34)} ` +
            `bpm=${String(r.bpm).padStart(6)} (conf ${r.bpmConfidence})  ` +
            `key=${String(r.key).padEnd(9)} (conf ${r.keyConfidence})  ` +
            `dur=${r.durationSec}s  ${ms}ms  ${notes.join(' ')}`
        );
    }

    console.log(`\n${cases.length - failures}/${cases.length} passed`);
    fs.rmSync(OUT, { recursive: true, force: true });
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
