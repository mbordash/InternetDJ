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

export default genreTags;
