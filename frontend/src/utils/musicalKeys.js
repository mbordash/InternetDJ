export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The 24 keys, spelled exactly as the backend writes them (sharps, lower-case
// mode). Detection, the loop generator and the song editor all read from this
// one list so a detected key always matches an option in a dropdown - a value
// with no matching <option> silently renders as the first one, which is how a
// loop request once went out at a tempo nobody picked.
export const MUSICAL_KEYS = PITCH_NAMES.flatMap(name => [`${name} major`, `${name} minor`]);

// Camelot notation, mirroring backend/utils/musicalKeys.js. DJs read 5A/8B at
// a glance, but it is shown as an annotation next to the plain key name rather
// than instead of it, so it stays readable to everyone else.
// C major is 8B by definition; multiplying a pitch class by 7 walks the circle
// of fifths, and a minor key takes the number of its relative major.
export function camelotOf(key) {
    const [name, mode] = String(key || '').split(' ');
    const pitchClass = PITCH_NAMES.indexOf(name);
    if (pitchClass < 0 || (mode !== 'major' && mode !== 'minor')) return null;

    const majorRoot = mode === 'minor' ? (pitchClass + 3) % 12 : pitchClass;
    const number = (((majorRoot * 7) % 12) + 7) % 12 + 1;
    return `${number}${mode === 'minor' ? 'A' : 'B'}`;
}

function keyForCamelot(number, letter) {
    const wrapped = ((number - 1) % 12 + 12) % 12 + 1;
    return MUSICAL_KEYS.find(key => camelotOf(key) === `${wrapped}${letter}`) || null;
}

/** The key itself, its relative major/minor, and its two neighbouring fifths. */
export function compatibleKeys(key) {
    const camelot = camelotOf(key);
    if (!camelot) return [];

    const number = parseInt(camelot.slice(0, -1), 10);
    const letter = camelot.slice(-1);
    const otherLetter = letter === 'A' ? 'B' : 'A';

    return [
        keyForCamelot(number, letter),
        keyForCamelot(number, otherLetter),
        keyForCamelot(number + 1, letter),
        keyForCamelot(number - 1, letter),
    ].filter(Boolean);
}

export default MUSICAL_KEYS;
