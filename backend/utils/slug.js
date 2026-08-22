/**
 * Vanity profile slugs.
 *
 * Profiles are reachable as /profile/18 and, once a slug is set, also as
 * /profile/dj-subspace. The numeric URL never stops working, so no link that
 * has ever been shared can die — which in turn means a released slug is safe to
 * hand to somebody else.
 */

// Words that would read as an action rather than an artist if they ever became
// a path segment under /profile/.
const RESERVED_SLUGS = new Set([
    'new', 'edit', 'settings', 'admin', 'api', 'me', 'you', 'null', 'undefined',
    'songs-manager', 'collaborations', 'collabs', 'playlists', 'followers',
    'following', 'search', 'browse', 'discover', 'login', 'logout', 'register',
    'profile', 'song', 'songs', 'tag', 'tags', 'stems', 'projects', 'forum',
    'support', 'help', 'about', 'terms', 'privacy', 'internetdj',
    // Sibling routes under /api/profile/. Those declared after the slug
    // handler would otherwise be hijacked by a user claiming the name, and
    // the ones declared before it would leave that profile unreachable.
    'latest', 'most-popular', 'top-reviewers', 'top-earners', 'slug-available',
    'recommended-songs', 'liked-songs', 'followed-songs',
    'crate', 'crates', 'mixtape', 'mixtapes', 'playlist', 'playlists',
]);

const MIN_LENGTH = 3;
const MAX_LENGTH = 40;
const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Turn arbitrary text into slug shape. Used for suggestions, not validation. */
function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')       // strip accents
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_LENGTH)
        .replace(/-+$/g, '');
}

/**
 * Check a user-supplied slug.
 * Returns { ok: true, slug } or { ok: false, error } with a message written for
 * the person typing it, not for a log file.
 */
function validateSlug(input) {
    const slug = String(input || '').trim().toLowerCase();

    if (!slug) return { ok: false, error: 'Enter a profile address.' };
    if (slug.length < MIN_LENGTH) return { ok: false, error: `Use at least ${MIN_LENGTH} characters.` };
    if (slug.length > MAX_LENGTH) return { ok: false, error: `Use at most ${MAX_LENGTH} characters.` };
    if (!SHAPE.test(slug)) {
        return { ok: false, error: 'Use lowercase letters, numbers and hyphens, starting and ending with a letter or number.' };
    }
    // A digits-only slug would be indistinguishable from a profile id, so
    // /profile/18 could mean two different artists.
    if (/^\d+$/.test(slug)) return { ok: false, error: 'Include at least one letter, so it is not mistaken for a profile number.' };
    if (RESERVED_SLUGS.has(slug)) return { ok: false, error: 'That address is reserved. Try another.' };

    return { ok: true, slug };
}

module.exports = { slugify, validateSlug, RESERVED_SLUGS, MIN_LENGTH, MAX_LENGTH };
