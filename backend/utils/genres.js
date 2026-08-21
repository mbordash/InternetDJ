/**
 * Genre normalisation.
 *
 * Genres are free-form text by design — artists can invent one nobody has used
 * before, and that long tail is the point. The cost is variant sprawl: a single
 * genre shows up as "drum and bass", "Drum 'n' Bass", "DnB" and half a dozen
 * other spellings.
 *
 * Two mechanisms handle that:
 *
 *   normalizeGenre()  collapses spelling variants — case, punctuation, spacing,
 *                     and the connector words people are inconsistent about
 *                     ('and', 'n', '&'). Purely mechanical, no curation.
 *
 *   GENRE_ALIASES     maps genuine abbreviations onto their long form. No
 *                     algorithm can infer that "dnb" means drum and bass, so
 *                     these are listed by hand. Keys and values are both given
 *                     in already-normalised form.
 *
 * The normalised string is only ever a grouping key. What gets displayed is the
 * spelling artists actually use most, so the taxonomy stays theirs.
 */

// Connector words that appear, disappear and change spelling between variants.
const CONNECTORS = new Set(['and', 'n']);

// Left side: what people type (normalised). Right side: the canonical key.
const GENRE_ALIASES = {
    'dnb': 'drum bass',
    'd b': 'drum bass',
    'drum bass': 'drum bass',
    'liquid dnb': 'liquid drum bass',
    'psy': 'psytrance',
    'psy trance': 'psytrance',
    'goa': 'psytrance',
    'dub step': 'dubstep',
    'brostep': 'dubstep',
    'uk g': 'uk garage',
    'ukg': 'uk garage',
    'two step': 'uk garage',
    '2 step': 'uk garage',
    'jungle dnb': 'jungle',
    'hip hop': 'hiphop',
    'hip': 'hiphop',
    'trip hop': 'triphop',
    'lo fi': 'lofi',
    'low fi': 'lofi',
    'nu disco': 'nudisco',
    'edm': 'edm',
    'idm': 'idm',
    'r b': 'rnb',
    'rnb': 'rnb',
    'rhythm blues': 'rnb',
    'deep hse': 'deep house',
    'tech hse': 'tech house',
    'electronica': 'electronic',
    'electro house': 'electro house',
    'dnb jungle': 'drum bass',
    'breakbeat': 'breaks',
    'break beat': 'breaks',
    'big beat': 'breaks',
};

/**
 * Reduce a raw genre string to a stable grouping key.
 * Returns '' for anything that normalises to nothing.
 */
function normalizeGenre(raw) {
    if (raw === null || raw === undefined) return '';

    const base = String(raw)
        .toLowerCase()
        // Curly and straight quotes, dots, dashes, slashes and underscores all
        // become separators, so "Drum 'n'Bass" and "drum-n-bass" agree.
        .replace(/[`´'‘’.\-_/\\]+/g, ' ')
        .replace(/&/g, ' and ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!base) return '';

    const words = base.split(' ').filter(word => word && !CONNECTORS.has(word));
    // A genre made only of connectors ("n", "and") keeps its original words
    // rather than vanishing entirely.
    const key = (words.length ? words : base.split(' ')).join(' ');

    return GENRE_ALIASES[key] || key;
}

/**
 * Every raw spelling that could normalise to the given key, for building a
 * coarse SQL prefilter. Includes the key's own words plus any alias that maps
 * onto it, since "dnb" shares no substring with "drum bass".
 */
function aliasSourcesFor(key) {
    const sources = new Set([key]);
    Object.keys(GENRE_ALIASES).forEach(alias => {
        if (GENRE_ALIASES[alias] === key) sources.add(alias);
    });
    return [...sources];
}

/**
 * Genres people typed as one run-on string.
 *
 * The upload form only commits a tag when it sees a comma, so anything left in
 * the box at submit time becomes a single genre no matter how long it is. That
 * produces entries like "Trance Analog Trance Tech House", which then show up
 * as their own genre in the directory.
 *
 * GENRE_VOCAB is the set we're confident enough about to pull such a string
 * apart. Matching is longest-first so "tech house" wins over "tech" + "house",
 * and multi-word genres like "deep house" are never split into their parts.
 */
const GENRE_VOCAB = [
    'house', 'deep house', 'tech house', 'progressive house', 'electro house', 'acid house',
    'funky house', 'tribal house', 'afro house', 'disco house',
    'trance', 'tech trance', 'progressive trance', 'uplifting trance', 'psytrance', 'hard trance',
    'techno', 'minimal techno', 'detroit techno', 'acid techno', 'hard techno',
    'drum bass', 'jungle', 'breaks', 'dubstep', 'garage', 'uk garage', 'grime',
    'ambient', 'downtempo', 'chillout', 'electro', 'electronic', 'idm', 'edm',
    'disco', 'nudisco', 'funk', 'soul', 'jazz', 'blues', 'reggae', 'dub', 'ska',
    'hiphop', 'triphop', 'lofi', 'rnb', 'pop', 'rock', 'metal', 'punk', 'indie', 'folk',
    'acid', 'minimal', 'hardcore', 'gabber', 'hardstyle', 'synthwave', 'vaporwave',
    'experimental', 'industrial', 'ebm', 'darkwave', 'shoegaze', 'post rock',
].map(normalizeGenre);

const VOCAB_SET = new Set(GENRE_VOCAB);
const MAX_VOCAB_WORDS = GENRE_VOCAB.reduce((max, entry) => Math.max(max, entry.split(' ').length), 1);

/**
 * Try to pull a run-on genre string into its parts.
 * Returns an array of normalised keys, or null when the string should be left
 * exactly as it is — which is the answer for ordinary genres, for anything we
 * don't recognise, and for free-text nobody has used before.
 */
function splitGenreBlob(raw) {
    const words = normalizeGenre(raw).split(' ').filter(Boolean);
    if (words.length < 2) return null;

    const found = [];
    const gaps = [];
    let i = 0;
    while (i < words.length) {
        let matched = null;
        for (let n = Math.min(MAX_VOCAB_WORDS, words.length - i); n >= 1; n--) {
            const candidate = words.slice(i, i + n).join(' ');
            if (VOCAB_SET.has(candidate)) {
                matched = { candidate, n };
                break;
            }
        }
        if (matched) {
            found.push(matched.candidate);
            i += matched.n;
        } else {
            gaps.push(words[i]);
            i += 1;
        }
    }

    const unique = [...new Set(found)];
    // Only act when the string really does decompose into several known genres
    // and little is left over. One stray word ("analog") is tolerable; a
    // sentence of them means this was never a genre list at all.
    const tolerance = Math.max(1, Math.floor(words.length * 0.25));
    if (unique.length >= 2 && gaps.length <= tolerance) return unique;
    return null;
}

/**
 * Turn one raw genre field into the normalised keys it represents, splitting
 * commas first and then rescuing any run-on strings.
 */
function expandGenreString(rawField) {
    const keys = [];
    String(rawField || '').split(',').forEach(part => {
        const trimmed = part.trim();
        if (!trimmed) return;
        const split = splitGenreBlob(trimmed);
        if (split) {
            split.forEach(key => keys.push({ key, raw: key, fromBlob: true }));
        } else {
            const key = normalizeGenre(trimmed);
            if (key) keys.push({ key, raw: trimmed, fromBlob: false });
        }
    });
    return keys;
}

/**
 * A genre that is long AND used exactly once is almost certainly a mistake —
 * someone typed a sentence into the genre box. We never delete it: the song
 * keeps its tag and a direct link still works. It just doesn't earn a tile in
 * the Browse directory, where it would sit alongside real genres.
 *
 * Deliberately conservative. Three- and four-word genres are real
 * ("progressive psychedelic trance"), and anything used by two or more songs is
 * evidently meaningful to more than one person.
 */
function isLikelyJunkGenre(key, count) {
    return String(key || '').split(' ').filter(Boolean).length >= 5 && count <= 1;
}

module.exports = { normalizeGenre, aliasSourcesFor, splitGenreBlob, expandGenreString, isLikelyJunkGenre, GENRE_ALIASES, GENRE_VOCAB };
