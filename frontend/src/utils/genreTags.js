/**
 * Genre tagging is free-form by design: a song's `genre` field is one string
 * that may hold several comma-separated tags. Anywhere tags render as links
 * they have to be split, or the whole string becomes a single link pointing at
 * a tag page that does not exist.
 *
 * Keeping the rule here rather than inline means the pages cannot drift apart
 * on how they trim, filter, or de-duplicate.
 *
 * Returns trimmed, non-empty tags with case-insensitive duplicates removed, so
 * a value like "House, house , breaks" renders two links rather than three
 * (and gives React stable unique keys).
 */
const genreTags = (genre) => {
    if (typeof genre !== 'string') {
        return [];
    }

    const seen = new Set();
    const tags = [];

    for (const part of genre.split(',')) {
        const tag = part.trim();
        if (!tag) {
            continue;
        }

        const key = tag.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        tags.push(tag);
    }

    return tags;
};

/**
 * The URL for a tag page.
 *
 * Genres are free-form, so the same genre reaches these links spelled several
 * ways — "Techno", "techno", " TECHNO ". Left alone, each spelling becomes its
 * own /tag/ URL serving identical content, which splits a page's ranking across
 * duplicates and spends crawl budget three times to index one page.
 *
 * Lowercasing and trimming here collapses that. It is deliberately not the
 * backend's full normalizeGenre(): that resolves genuine abbreviations via an
 * alias table ("dnb" -> "drum bass"), and duplicating a 200-line table across
 * the stack would drift. Those alias-level variants are consolidated instead by
 * the canonical URL the tag page declares, which comes from the server and so
 * cannot disagree with it.
 *
 * The displayed text stays the spelling the artist typed — the taxonomy is
 * theirs. Only the href is normalised.
 */
const tagHref = (tag) => `/tag/${encodeURIComponent(String(tag ?? '').trim().toLowerCase())}`;

export default genreTags;
export { tagHref };
