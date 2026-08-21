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

module.exports = { normalizeGenre, aliasSourcesFor, GENRE_ALIASES };
