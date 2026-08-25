const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The 24 keys, written the same way everywhere: sharps, lower-case mode.
// Detection (utils/audioFeatures.js), the stem generator and the song editor
// all have to agree on this spelling or a detected key will not match an
// option in the editor's dropdown.
const MUSICAL_KEYS = PITCH_NAMES.flatMap(name => [`${name} major`, `${name} minor`]);

const isMusicalKey = (value) => typeof value === 'string' && MUSICAL_KEYS.includes(value);

// Wider than the 60-200 the detector searches: an artist correcting a reading
// knows better than we do, and ambient and speedcore both exist.
const MIN_EDITABLE_BPM = 20;
const MAX_EDITABLE_BPM = 300;

/**
 * Interpret a tempo submitted by an artist.
 *
 * Returns { ok: true, value } where value is a number or null (null meaning
 * "clear this field"), or { ok: false, error } for something unusable. Form
 * data arrives as strings, so '' is the clear signal and '120' is a tempo.
 */
function parseEditableBpm(raw) {
    if (raw === undefined || raw === null) return { ok: true, value: undefined };
    const trimmed = String(raw).trim();
    if (trimmed === '') return { ok: true, value: null };

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        return { ok: false, error: 'BPM must be a number' };
    }
    if (parsed < MIN_EDITABLE_BPM || parsed > MAX_EDITABLE_BPM) {
        return { ok: false, error: `BPM must be between ${MIN_EDITABLE_BPM} and ${MAX_EDITABLE_BPM}` };
    }
    return { ok: true, value: Math.round(parsed * 100) / 100 };
}

/** Same contract as parseEditableBpm, for the key field. */
function parseEditableKey(raw) {
    if (raw === undefined || raw === null) return { ok: true, value: undefined };
    const trimmed = String(raw).trim();
    if (trimmed === '') return { ok: true, value: null };
    if (!isMusicalKey(trimmed)) {
        return { ok: false, error: 'Unrecognised musical key' };
    }
    return { ok: true, value: trimmed };
}

// --- Camelot wheel ---------------------------------------------------------
// DJ notation for harmonic mixing: a number 1-12 for position on the circle of
// fifths, and a letter for the mode (A minor, B major). Relative keys share a
// number, so 8A and 8B are the same seven notes.
//
// Derived rather than typed out, then checked against the real wheel by
// scripts/verifyMusicalKeys.js - a table of 24 hand-entered codes is the kind
// of thing that is wrong in exactly one place and never noticed.
//
// C major is 8B by definition. Multiplying a pitch class by 7 walks the circle
// of fifths, and a minor key takes the number of the major key three semitones
// above it, which is its relative.
function camelotOf(key) {
    const [name, mode] = String(key).split(' ');
    const pitchClass = PITCH_NAMES.indexOf(name);
    if (pitchClass < 0 || (mode !== 'major' && mode !== 'minor')) return null;

    const majorRoot = mode === 'minor' ? (pitchClass + 3) % 12 : pitchClass;
    const number = (((majorRoot * 7) % 12) + 7) % 12 + 1;
    return `${number}${mode === 'minor' ? 'A' : 'B'}`;
}

/** The key whose Camelot code is `number` + `letter`, or null. */
function keyForCamelot(number, letter) {
    const wrapped = ((number - 1) % 12 + 12) % 12 + 1;
    return MUSICAL_KEYS.find(key => camelotOf(key) === `${wrapped}${letter}`) || null;
}

/**
 * The keys that mix with this one: itself, its relative major or minor, and
 * its two neighbours on the circle of fifths. Returns an empty array for an
 * unrecognised key.
 *
 * This is also what makes key filtering robust despite detection confusing a
 * key with its relative - the relative is already in this set, so the
 * ambiguity stops changing the answer.
 */
function compatibleKeys(key) {
    const camelot = camelotOf(key);
    if (!camelot) return [];

    const number = parseInt(camelot.slice(0, -1), 10);
    const letter = camelot.slice(-1);
    const otherLetter = letter === 'A' ? 'B' : 'A';

    return [
        keyForCamelot(number, letter),       // the key itself
        keyForCamelot(number, otherLetter),  // relative major/minor
        keyForCamelot(number + 1, letter),   // one fifth up
        keyForCamelot(number - 1, letter),   // one fifth down
    ].filter(Boolean);
}

module.exports = {
    camelotOf,
    keyForCamelot,
    compatibleKeys,
    PITCH_NAMES,
    MUSICAL_KEYS,
    isMusicalKey,
    parseEditableBpm,
    parseEditableKey,
    MIN_EDITABLE_BPM,
    MAX_EDITABLE_BPM,
};
