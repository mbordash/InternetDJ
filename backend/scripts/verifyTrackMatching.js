/**
 * Checks the "tracks that go with this one" ranking in utils/trackMatching.js:
 *
 *   node backend/scripts/verifyTrackMatching.js
 *
 * No database, no network. The point is to pin down the behaviour that is easy
 * to get subtly wrong - half-time matching, missing tempo or key on either
 * side, and the order things come back in.
 */
const { scoreCandidate, rankCandidates, tempoMatch, keyMatch } = require('../utils/trackMatching');
const { out, errOut, finish, pad } = require('../utils/cli');

let failures = 0;
const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        errOut(`FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
    } else {
        out(`  ok  ${label}`);
    }
};
const checkTrue = (label, condition) => {
    if (!condition) { failures++; errOut(`FAIL  ${label}`); } else { out(`  ok  ${label}`); }
};

out('Tempo matching');
check('128 vs 128 is the same tempo', tempoMatch(128, 128).score, 3);
check('128 vs 130 is within tolerance', tempoMatch(128, 130).score, 3);
check('128 vs 134 is close', tempoMatch(128, 134).score, 2);
check('128 vs 150 does not match', tempoMatch(128, 150).score, 0);
check('174 vs 87 is half time', tempoMatch(174, 87).score, 1);
check('87 vs 174 is double time', tempoMatch(87, 174).score, 1);
checkTrue('half time says so', /half time/.test(tempoMatch(174, 87).reason || ''));
check('a missing tempo scores nothing', tempoMatch(null, 128).score, 0);
check('a zero tempo scores nothing', tempoMatch(0, 128).score, 0);

out('');
out('Key matching');
check('the same key scores highest', keyMatch('C minor', 'C minor').score, 3);
check('the relative major mixes', keyMatch('C minor', 'D# major').score, 2);
check('a neighbouring fifth mixes', keyMatch('C minor', 'G minor').score, 2);
check('an unrelated key does not', keyMatch('C minor', 'E major').score, 0);
check('a missing key scores nothing', keyMatch(null, 'C minor').score, 0);

out('');
out('Combined scoring');
const base = { bpm: 128, musical_key: 'C minor', genre: 'Techno, Acid' };

const perfect = scoreCandidate(base, { bpm: 128, musical_key: 'C minor', genre: 'Techno' });
check('same key, same tempo, shared genre', perfect.score, 3 + 3 + 1);
checkTrue('and explains all three', perfect.reasons.length === 3);

const keyOnly = scoreCandidate(base, { bpm: null, musical_key: 'G minor', genre: 'Ambient' });
check('key alone still counts', keyOnly.score, 2);

const nothing = scoreCandidate(base, { bpm: 200, musical_key: 'E major', genre: 'Folk' });
check('nothing in common scores zero', nothing.score, 0);

// A track with no analysis at all must not break ranking, just score low.
const unanalysed = scoreCandidate(base, { bpm: null, musical_key: null, genre: 'Techno' });
check('an unanalysed track can still match on genre', unanalysed.score, 1);
check('an unanalysed, untagged track scores zero',
    scoreCandidate(base, { bpm: null, musical_key: null, genre: null }).score, 0);

out('');
out('Ranking');
const candidates = [
    { id: 1, title: 'unrelated',       bpm: 200, musical_key: 'E major', genre: 'Folk',   plays: 9999 },
    { id: 2, title: 'genre only',      bpm: null, musical_key: null,     genre: 'Techno', plays: 500 },
    { id: 3, title: 'key + tempo',     bpm: 129, musical_key: 'G minor', genre: 'House',  plays: 10 },
    { id: 4, title: 'perfect match',   bpm: 128, musical_key: 'C minor', genre: 'Techno', plays: 1 },
    { id: 5, title: 'perfect, popular', bpm: 128, musical_key: 'C minor', genre: 'Techno', plays: 800 },
];
const ranked = rankCandidates(base, candidates);

check('the unrelated track is dropped despite huge play count',
    ranked.some(r => r.candidate.id === 1), false);
check('best matches come first, popularity breaking ties',
    ranked.map(r => r.candidate.id), [5, 4, 3, 2]);
checkTrue('every result carries a reason', ranked.every(r => r.reasons.length > 0));

out('');
out('Example output for a 128 BPM track in C minor:');
for (const entry of ranked) {
    out(`  ${pad(entry.candidate.title, 18)} score ${entry.score}  ${entry.reasons.join(', ')}`);
}

out('');
out(failures ? `${failures} failure(s)` : 'All checks passed.');
finish(failures ? 1 : 0);
