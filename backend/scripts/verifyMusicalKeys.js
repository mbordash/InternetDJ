/**
 * Checks the derived Camelot mapping in utils/musicalKeys.js against the real
 * wheel, and sanity-checks the harmonic-compatibility rules built on top:
 *
 *   node backend/scripts/verifyMusicalKeys.js
 *
 * No database, no network. Run it if you touch camelotOf or compatibleKeys.
 */
const { camelotOf, compatibleKeys, MUSICAL_KEYS } = require('../utils/musicalKeys');
const { out, errOut, finish, pad } = require('../utils/cli');

// The published Camelot wheel, written out by hand precisely so it is an
// independent check on the formula rather than a restatement of it.
const EXPECTED = {
    '1A': 'G# minor', '1B': 'B major',
    '2A': 'D# minor', '2B': 'F# major',
    '3A': 'A# minor', '3B': 'C# major',
    '4A': 'F minor', '4B': 'G# major',
    '5A': 'C minor', '5B': 'D# major',
    '6A': 'G minor', '6B': 'A# major',
    '7A': 'D minor', '7B': 'F major',
    '8A': 'A minor', '8B': 'C major',
    '9A': 'E minor', '9B': 'G major',
    '10A': 'B minor', '10B': 'D major',
    '11A': 'F# minor', '11B': 'A major',
    '12A': 'C# minor', '12B': 'E major',
};

let failures = 0;
const fail = (message) => { failures++; errOut(`FAIL  ${message}`); };

out('Camelot codes');
for (const [code, key] of Object.entries(EXPECTED)) {
    const actual = camelotOf(key);
    if (actual !== code) {
        fail(`${pad(key, 10)} expected ${code}, got ${actual}`);
    } else {
        out(`  ok  ${pad(key, 10)} ${code}`);
    }
}

// Every one of the 24 keys must produce a code, and no two may share one.
const codes = MUSICAL_KEYS.map(camelotOf);
if (codes.some(c => c === null)) {
    fail('some keys produced no Camelot code');
}
if (new Set(codes).size !== 24) {
    fail(`expected 24 distinct codes, got ${new Set(codes).size}`);
}

out('');
out('Harmonic compatibility');
for (const key of MUSICAL_KEYS) {
    const compatible = compatibleKeys(key);

    if (compatible.length !== 4) {
        fail(`${key} has ${compatible.length} compatible keys, expected 4`);
        continue;
    }
    if (!compatible.includes(key)) {
        fail(`${key} is not compatible with itself`);
        continue;
    }
    // Compatibility must be symmetric, or "find tracks that mix with this"
    // gives different answers depending on which track you start from.
    for (const other of compatible) {
        if (!compatibleKeys(other).includes(key)) {
            fail(`${key} -> ${other} is not symmetric`);
        }
    }
    // The relative shares the number and flips the letter.
    const number = camelotOf(key).slice(0, -1);
    const relative = compatible.find(k => camelotOf(k) === `${number}${camelotOf(key).endsWith('A') ? 'B' : 'A'}`);
    if (!relative) {
        fail(`${key} has no relative key in its compatible set`);
    }
}

if (!failures) {
    out(`  ok  all ${MUSICAL_KEYS.length} keys: 4 compatible each, symmetric, relative included`);
    out('');
    out('Examples:');
    for (const key of ['C minor', 'A minor', 'C major', 'F# minor']) {
        out(`  ${pad(key, 10)} ${pad(camelotOf(key), 4)} mixes with ` +
            compatibleKeys(key).filter(k => k !== key).map(k => `${k} (${camelotOf(k)})`).join(', '));
    }
}

out('');
out(failures ? `${failures} failure(s)` : 'All checks passed.');
finish(failures ? 1 : 0);
