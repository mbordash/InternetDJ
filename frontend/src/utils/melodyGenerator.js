// Music-theory-based MIDI generator.
// Outputs notes in the piano roll's format: { note: 'F#3', start_time, duration }
// (times in timeline units — musical time, quantized to 1/16 notes).
import { Scale, Note } from 'tonal';

// Piano roll range is C2..C5
const MIN_MIDI = 36; // C2
const MAX_MIDI = 72; // C5

export const STYLES = ['lead', 'arpeggio', 'bassline', 'pad'];
export const MODES = ['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'major pentatonic', 'minor pentatonic', 'blues'];
export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Deterministic PRNG so a seed reproduces the same melody
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Chord progressions expressed as scale degrees (0-indexed)
const PROGRESSIONS = {
    majorish: [
        [0, 5, 3, 4], // I vi IV V
        [0, 3, 4, 4], // I IV V V
        [0, 4, 5, 3], // I V vi IV
        [0, 3, 0, 4], // I IV I V
    ],
    minorish: [
        [0, 5, 2, 6], // i VI III VII
        [0, 3, 5, 6], // i iv VI VII
        [0, 6, 5, 6], // i VII VI VII
        [0, 3, 0, 6], // i iv i VII
    ],
};

function isMinorish(mode) {
    return /minor|dorian|phrygian|blues/.test(mode);
}

// Build the pitch pool: scale notes across the roll range, with MIDI numbers
function buildScalePool(key, mode) {
    const scale = Scale.get(`${key} ${mode}`);
    if (!scale.notes || scale.notes.length === 0) return [];
    const pcs = scale.notes.map(n => Note.chroma(n));
    const pool = [];
    for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
        const idx = pcs.indexOf(midi % 12);
        if (idx !== -1) {
            // Use sharps to match the piano roll's note naming (C#3, F#2, ...)
            pool.push({ midi, degree: idx, name: Note.fromMidiSharps(midi) });
        }
    }
    return pool;
}

// Rhythm templates per style: one bar of 16 sixteenth slots.
// Value = note length in sixteenths, 0 = rest, null = continue previous.
const RHYTHMS = {
    lead: [
        [2, null, 2, null, 1, 1, 2, null, 2, null, 2, null, 4, null, null, null],
        [1, 1, 2, null, 2, null, 1, 1, 2, null, 1, 1, 4, null, null, null],
        [4, null, null, null, 2, null, 2, null, 2, null, 1, 1, 2, null, 2, null],
        [2, null, 1, 1, 2, null, 2, null, 0, 0, 2, null, 4, null, null, null],
    ],
    arpeggio: [
        [2, null, 2, null, 2, null, 2, null, 2, null, 2, null, 2, null, 2, null],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
    bassline: [
        [4, null, null, null, 2, null, 2, null, 4, null, null, null, 2, null, 2, null],
        [2, null, 2, null, 2, null, 2, null, 2, null, 2, null, 2, null, 2, null],
        [4, null, null, null, 0, 0, 2, null, 4, null, null, null, 2, null, 1, 1],
    ],
    pad: [
        [16, ...Array(15).fill(null)],
        [8, ...Array(7).fill(null), 8, ...Array(7).fill(null)],
    ],
};

export function generateMelody({
    key = 'C',
    mode = 'minor',
    style = 'lead',
    bars = 4,
    density = 0.8, // 0..1, chance each rhythm slot is kept
    seed = Date.now(),
} = {}) {
    const rand = mulberry32(seed);
    const pool = buildScalePool(key, mode);
    if (pool.length === 0) return [];

    const sixteenth = 0.125; // musical units (1/16 note) — tempo-independent
    const scaleSize = 7 <= pool.length ? new Set(pool.map(p => p.degree)).size : pool.length;
    const progressions = PROGRESSIONS[isMinorish(mode) ? 'minorish' : 'majorish'];
    const progression = progressions[Math.floor(rand() * progressions.length)];

    // Notes of a degree's triad within the scale (degree, +2, +4 steps)
    const chordDegrees = (deg) => [deg % scaleSize, (deg + 2) % scaleSize, (deg + 4) % scaleSize];

    // Style register targets (MIDI centers)
    const center = { lead: 62, arpeggio: 57, bassline: 41, pad: 55 }[style] ?? 57;
    const spread = { lead: 10, arpeggio: 9, bassline: 5, pad: 8 }[style] ?? 9;
    const inRegister = pool.filter(p => Math.abs(p.midi - center) <= spread);
    const registerPool = inRegister.length >= 3 ? inRegister : pool;

    const notes = [];
    let prev = null;

    // Two-bar phrase (A) reused with variation (A A' A A')
    const rhythmChoices = RHYTHMS[style] || RHYTHMS.lead;
    const barRhythms = Array.from({ length: bars }, (_, b) =>
        rhythmChoices[b % 2 === 0 ? Math.floor(rand() * rhythmChoices.length) : Math.floor(rand() * rhythmChoices.length)]
    );

    for (let bar = 0; bar < bars; bar++) {
        const degree = progression[bar % progression.length];
        const chordSet = new Set(chordDegrees(degree));
        const chordTones = registerPool.filter(p => chordSet.has(p.degree));
        const rhythm = barRhythms[bar];
        let arpIdx = 0;

        for (let slot = 0; slot < 16; slot++) {
            const len = rhythm[slot];
            if (len === null || len === 0) continue;
            if (rand() > density && slot % 4 !== 0) continue; // thin out weak beats

            const strongBeat = slot % 4 === 0;
            const isLast = bar === bars - 1 && slot >= 12;
            let candidate;

            if (isLast) {
                // Resolve: end on the tonic nearest the register center
                const tonics = registerPool.filter(p => p.degree === 0);
                candidate = tonics.length
                    ? tonics.reduce((best, p) => (Math.abs(p.midi - center) < Math.abs(best.midi - center) ? p : best))
                    : registerPool[0];
            } else if (style === 'arpeggio') {
                const source = chordTones.length ? chordTones : registerPool;
                candidate = source[arpIdx % source.length];
                arpIdx += (rand() < 0.2 ? 2 : 1);
            } else if (style === 'pad') {
                // Stack a triad
                const source = chordTones.length ? chordTones : registerPool.slice(0, 3);
                source.slice(0, 3).forEach(p => {
                    notes.push({
                        note: p.name,
                        start_time: Number(((bar * 16 + slot) * sixteenth).toFixed(4)),
                        duration: Number((len * sixteenth).toFixed(4)),
                    });
                });
                continue;
            } else if (style === 'bassline') {
                // Root-heavy with occasional fifth
                const roots = registerPool.filter(p => p.degree === degree % scaleSize);
                const fifths = registerPool.filter(p => p.degree === (degree + 4) % scaleSize);
                const source = (rand() < 0.75 && roots.length) ? roots : (fifths.length ? fifths : registerPool);
                candidate = source.reduce((best, p) => (Math.abs(p.midi - center) < Math.abs(best.midi - center) ? p : best), source[0]);
            } else {
                // Lead: chord tone on strong beats, stepwise motion otherwise
                if (strongBeat || !prev || rand() < 0.35) {
                    const source = chordTones.length ? chordTones : registerPool;
                    const near = source.filter(p => !prev || Math.abs(p.midi - prev.midi) <= 7);
                    const picks = near.length ? near : source;
                    candidate = picks[Math.floor(rand() * picks.length)];
                } else {
                    const prevIdx = registerPool.findIndex(p => p.midi === prev.midi);
                    const step = rand() < 0.5 ? 1 : -1;
                    const leap = rand() < 0.12 ? step * (2 + Math.floor(rand() * 2)) : step;
                    const idx = Math.min(Math.max(prevIdx + leap, 0), registerPool.length - 1);
                    candidate = registerPool[idx] || prev;
                }
            }

            if (!candidate) continue;
            prev = candidate;
            notes.push({
                note: candidate.name,
                start_time: Number(((bar * 16 + slot) * sixteenth).toFixed(4)),
                duration: Number((len * sixteenth).toFixed(4)),
            });
        }
    }

    return notes;
}

// Parse a freeform prompt like "lead melody in F# minor" into generator params
export function parsePrompt(prompt) {
    const params = {};
    const text = (prompt || '').toLowerCase();

    // Key: prefer "<note> <mode>" (e.g. "f# minor"), then "in <note>"
    const modeWords = 'major|minor|dorian|mixolydian|lydian|phrygian|pentatonic|pent|blues';
    const keyMatch = text.match(new RegExp(`\\b([a-g])\\s?(#|sharp|b|flat)?\\s+(?:${modeWords})`, 'i'))
        || text.match(/\bin\s+([a-g])\s?(#|sharp|b|flat)?\b/i)
        || text.match(/\b(?:key\s+of\s+)([a-g])\s?(#|sharp|b|flat)?\b/i);
    if (keyMatch) {
        let k = keyMatch[1].toUpperCase();
        const acc = keyMatch[2];
        if (acc === '#' || acc === 'sharp') k += '#';
        if (acc === 'b' || acc === 'flat') {
            // Convert flats to the sharp equivalent used by the piano roll
            const flatToSharp = { Ab: 'G#', Bb: 'A#', Cb: 'B', Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#' };
            k = flatToSharp[k + 'b'] || k;
        }
        if (KEYS.includes(k)) params.key = k;
    }

    if (/minor pent/.test(text)) params.mode = 'minor pentatonic';
    else if (/major pent|pentatonic/.test(text)) params.mode = text.includes('minor') ? 'minor pentatonic' : 'major pentatonic';
    else if (/blues/.test(text)) params.mode = 'blues';
    else if (/dorian/.test(text)) params.mode = 'dorian';
    else if (/mixolydian/.test(text)) params.mode = 'mixolydian';
    else if (/lydian/.test(text)) params.mode = 'lydian';
    else if (/phrygian/.test(text)) params.mode = 'phrygian';
    else if (/minor/.test(text)) params.mode = 'minor';
    else if (/major/.test(text)) params.mode = 'major';

    if (/arp/.test(text)) params.style = 'arpeggio';
    else if (/bass/.test(text)) params.style = 'bassline';
    else if (/pad|chord/.test(text)) params.style = 'pad';
    else if (/lead|melody|riff|hook|solo/.test(text)) params.style = 'lead';

    const barsMatch = text.match(/(\d+)\s*bars?/);
    if (barsMatch) params.bars = Math.min(Math.max(parseInt(barsMatch[1], 10), 1), 16);

    if (/sparse|simple|minimal/.test(text)) params.density = 0.5;
    else if (/busy|dense|fast|complex/.test(text)) params.density = 1.0;

    return params;
}
