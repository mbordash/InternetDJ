const { compatibleKeys, camelotOf } = require('./musicalKeys');

// Scoring for "tracks that go with this one".
//
// Kept as pure functions so the ranking can be exercised without a database -
// see scripts/verifyTrackMatching.js. The route's job is to fetch a candidate
// pool; this decides the order.

// How close two tempos have to be to mix. A DJ can pull a few percent with the
// pitch fader without it sounding wrong; beyond that it starts to.
const TEMPO_TIGHT = 0.03;
const TEMPO_LOOSE = 0.06;

const SCORE = {
    keyExact: 3,
    keyCompatible: 2,
    tempoTight: 3,
    tempoLoose: 2,
    tempoHalfDouble: 1,
    genreTag: 1,
    genreTagCap: 2,
};

const parseTags = (genre) => (genre || '')
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);

/**
 * Tempo relationship between two BPMs, as a score plus a reason.
 *
 * Half and double time count, at a lower weight: 87 and 174 sit on the same
 * grid and DJs mix them deliberately, but it is a bigger leap than a nudge on
 * the pitch fader.
 */
function tempoMatch(baseBpm, otherBpm) {
    if (!Number.isFinite(baseBpm) || !Number.isFinite(otherBpm) || baseBpm <= 0 || otherBpm <= 0) {
        return { score: 0, reason: null };
    }

    const within = (target) => Math.abs(otherBpm - target) / target;

    const direct = within(baseBpm);
    if (direct <= TEMPO_TIGHT) {
        const delta = Math.round(Math.abs(otherBpm - baseBpm));
        return { score: SCORE.tempoTight, reason: delta === 0 ? 'same tempo' : `within ${delta} BPM` };
    }
    if (direct <= TEMPO_LOOSE) {
        return { score: SCORE.tempoLoose, reason: `close tempo (${Math.round(otherBpm)} BPM)` };
    }

    for (const [target, label] of [[baseBpm * 2, 'double time'], [baseBpm / 2, 'half time']]) {
        if (within(target) <= TEMPO_LOOSE) {
            return { score: SCORE.tempoHalfDouble, reason: `${label} (${Math.round(otherBpm)} BPM)` };
        }
    }

    return { score: 0, reason: null };
}

/** Key relationship: the same key scores above one that merely mixes with it. */
function keyMatch(baseKey, otherKey) {
    if (!baseKey || !otherKey) return { score: 0, reason: null };
    if (baseKey === otherKey) {
        return { score: SCORE.keyExact, reason: `same key (${camelotOf(baseKey) || baseKey})` };
    }
    if (compatibleKeys(baseKey).includes(otherKey)) {
        return { score: SCORE.keyCompatible, reason: `mixes with ${camelotOf(otherKey) || otherKey}` };
    }
    return { score: 0, reason: null };
}

/** Shared genre tags, capped so a track tagged with everything cannot win on that alone. */
function genreMatch(baseTags, otherGenre) {
    const otherTags = parseTags(otherGenre);
    const shared = baseTags.filter(tag => otherTags.includes(tag));
    if (!shared.length) return { score: 0, reason: null };

    return {
        score: Math.min(SCORE.genreTagCap, shared.length * SCORE.genreTag),
        reason: `also ${shared[0]}`,
    };
}

/**
 * Score one candidate against the song being viewed.
 *
 * `base` and `candidate` are rows carrying bpm, musical_key and genre. Any of
 * those may be null - roughly half our catalogue has no detected key - so each
 * signal contributes only when both sides have it, and a track with none of
 * them simply scores zero rather than breaking the ranking.
 */
function scoreCandidate(base, candidate) {
    const baseTags = parseTags(base.genre);

    const key = keyMatch(base.musical_key, candidate.musical_key);
    const tempo = tempoMatch(Number(base.bpm), Number(candidate.bpm));
    const genre = genreMatch(baseTags, candidate.genre);

    return {
        score: key.score + tempo.score + genre.score,
        // Ordered so the most specific reason reads first.
        reasons: [key.reason, tempo.reason, genre.reason].filter(Boolean),
    };
}

/**
 * Rank candidates, best first, dropping anything with nothing in common.
 * Plays break ties, so among equally good matches the more popular wins.
 */
function rankCandidates(base, candidates, limit = 8) {
    return candidates
        .map(candidate => ({ candidate, ...scoreCandidate(base, candidate) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) =>
            b.score - a.score
            || (Number(b.candidate.plays) || 0) - (Number(a.candidate.plays) || 0))
        .slice(0, limit);
}

module.exports = {
    scoreCandidate,
    rankCandidates,
    tempoMatch,
    keyMatch,
    genreMatch,
    TEMPO_TIGHT,
    TEMPO_LOOSE,
    SCORE,
};
