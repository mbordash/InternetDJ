/**
 * Real 404 status codes for a single page application.
 *
 * The catch-all in server.js answers every path with index.html and a hard
 * coded 200, because that is what a client routed app needs: the server cannot
 * know which paths React will recognise, so it says yes to all of them. The
 * cost is that a URL naming a song that was deleted, or a path that never
 * existed at all, is indistinguishable from a real page over HTTP. Google
 * fetches one, gets 200, renders an empty <div id="root">, and files it under
 * Soft 404. Enough of those and the crawler stops trusting the sitemap.
 *
 * This module answers the one question the catch-all cannot: should this path
 * be a 404? It deliberately returns three states rather than a boolean.
 *
 *   'ok'      the path routes somewhere and, where it names a database row,
 *             that row exists
 *   'missing' the path matches no route, or names a row that is definitively
 *             not there
 *   'unknown' the lookup could not be completed
 *
 * The third state is the important one, and the reason this is not built on
 * ogMetaTags.fetchMetadata. Every fetcher in that module ends in
 * `catch (err) { return null; }`, so a broken query and an absent row come back
 * identical. That has already bitten this codebase once: a stale `r.user_id`
 * in the reviews join threw 1054 on every song, was swallowed by that catch,
 * and silently stripped the Open Graph tags from the entire catalogue. The same
 * bug wired to a status code would have returned 404 for every song on the
 * site and asked Google to deindex all of it.
 *
 * So a failed lookup is 'unknown' and the caller serves 200. A database blip
 * should cost correct metadata, never the index.
 */

const pool = require('../config/database');
const logger = require('../utils/logger');
const { normalizeGenre, expandGenreString } = require('../utils/genres');

/**
 * Mirrors the <Route> table in frontend/src/App.js. It has to be kept in step
 * by hand, and the failure is asymmetric, so err towards listing a path here:
 * a route missing from this set makes a working page return 404, while a stale
 * extra entry only means a dead URL keeps answering 200, which is where the
 * site already is today.
 */
const STATIC_ROUTES = new Set([
    '/',
    '/about',
    '/promote',
    '/articles',
    '/articles/submit',
    '/articles/queue',
    '/privacy',
    '/terms',
    '/discover',
    '/browse',
    '/new',
    '/search',
    '/forum',
    '/collabs',
    '/settings',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/confirm-google-relink',
    '/projects',
    '/playlists',
    '/crates',
    '/idj-coin',
    '/loops',
    '/stems',
]);

const EXISTS_CACHE_TTL_MS = 5 * 60 * 1000;
const EXISTS_CACHE_MAX_ENTRIES = 5000;
const existsCache = new Map();

/**
 * Returns true, false, or null for "could not tell". Only settled answers are
 * cached; a thrown query is left out so the next request retries instead of
 * being handed a five minute old failure.
 */
const checkExists = async (cacheKey, sql, params) => {
    const hit = existsCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;

    let value;
    try {
        const rows = await pool.query(sql, params);
        value = Boolean(rows && rows.length);
    } catch (err) {
        logger.error(`404 existence check failed for ${cacheKey}, serving 200:`, err);
        return null;
    }

    existsCache.set(cacheKey, { value, expires: Date.now() + EXISTS_CACHE_TTL_MS });
    if (existsCache.size > EXISTS_CACHE_MAX_ENTRIES) {
        existsCache.delete(existsCache.keys().next().value);
    }
    return value;
};

/** Numeric ids and text slugs live in different columns; see fetchProfileMetadata. */
const checkProfile = (ref) => (
    /^\d+$/.test(ref)
        ? checkExists(`profile:id:${ref}`, 'SELECT 1 FROM profiles WHERE id = ? LIMIT 1', [ref])
        : checkExists(`profile:slug:${ref}`, 'SELECT 1 FROM profiles WHERE slug = ? LIMIT 1', [ref])
);

/**
 * Existence only, deliberately not `status = 'published'`. An unpublished
 * article is hidden rather than absent, and 404ing it would fight with the
 * editor tools at /articles/queue. Only a slug matching no row at all is a 404.
 */
const checkArticle = (slug) => checkExists(
    `article:${slug}`,
    'SELECT 1 FROM articles WHERE slug = ? LIMIT 1',
    [slug],
);

/**
 * Crates are rows in `playlists`. Existence only, for the same reason as
 * articles: a private crate still exists and its owner can open it.
 */
const checkCrate = (id) => checkExists(
    `crate:${id}`,
    'SELECT 1 FROM playlists WHERE id = ? LIMIT 1',
    [id],
);

/**
 * A tag page listing nothing is the textbook soft 404, so this has to be a
 * real check. What it must NOT do is invent its own idea of what a tag matches.
 *
 * The first version of this copied the LIKE prefilter out of fetchTagMetadata,
 * which was wrong in a way worth recording. That prefilter is a cheap guess
 * that narrows a scan before expandGenreString does the real work, and when it
 * guesses wrong the only cost is a generic share card. Wired to a status code
 * the same wrong guess returns 404 for a tag page that is sitting there full of
 * tracks, and asks Google to drop it.
 *
 * So this mirrors GET /music/by-tag/:tag in routes/music.js instead, which is
 * what actually fills the page: no prefilter at all, every non-empty genre
 * expanded, compared on the normalised key. If the endpoint would return songs
 * this returns true, by construction rather than by coincidence.
 *
 * Genres are read once per window rather than once per tag. The whole column is
 * a few hundred short strings, and caching the key set means a crawler walking
 * every tag in the sitemap costs one query rather than one per URL.
 */
let genreKeyCache = { keys: null, expires: 0 };

const loadGenreKeys = async () => {
    if (genreKeyCache.keys && genreKeyCache.expires > Date.now()) return genreKeyCache.keys;

    const rows = await pool.query(
        "SELECT genre FROM songs WHERE genre IS NOT NULL AND genre != ''",
    );

    const keys = new Set();
    for (const row of rows) {
        for (const entry of expandGenreString(row.genre)) {
            if (entry && entry.key) keys.add(entry.key);
        }
    }

    genreKeyCache = { keys, expires: Date.now() + EXISTS_CACHE_TTL_MS };
    return keys;
};

const checkTag = async (rawTag) => {
    const wanted = normalizeGenre(rawTag);
    if (!wanted) return false;

    try {
        return (await loadGenreKeys()).has(wanted);
    } catch (err) {
        logger.error(`404 tag check failed for ${wanted}, serving 200:`, err);
        return null;
    }
};

/**
 * Order matters only in that every pattern is anchored, so the single segment
 * /profile/:id cannot swallow /profile/:id/songs-manager.
 *
 * The entries returning true unconditionally are routes whose parameter is not
 * a public document: an invite token, and the sampler projects. The sampler is
 * disallowed in robots.txt and is not something to run speculative lookups
 * against, and an owner-only management view should not start 404ing because
 * this module guessed wrong about a slug.
 */
const DYNAMIC_ROUTES = [
    { re: /^\/song\/(\d+)$/, check: id => checkExists(`song:${id}`, 'SELECT 1 FROM songs WHERE id = ? LIMIT 1', [id]) },
    { re: /^\/crate\/(\d+)$/, check: checkCrate },
    { re: /^\/forum\/post\/(\d+)$/, check: id => checkExists(`post:${id}`, 'SELECT 1 FROM forum_posts WHERE id = ? LIMIT 1', [id]) },
    { re: /^\/profile\/([^/]+)\/(?:songs-manager|collaborations)$/, check: () => true },
    { re: /^\/profile\/([^/]+)$/, check: checkProfile },
    { re: /^\/articles\/([^/]+)$/, check: checkArticle },
    { re: /^\/tag\/([^/]+)$/, check: checkTag },
    { re: /^\/collabs\/invite\/([^/]+)$/, check: () => true },
    { re: /^\/projects\/([^/]+)$/, check: () => true },
    { re: /^\/public\/([^/]+)$/, check: () => true },
];

/**
 * Trailing slashes are the same page to React Router, and "/" itself must
 * survive the trim.
 */
const normalizePath = (urlPath) => {
    const trimmed = String(urlPath || '/').replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
};

const resolvePageStatus = async (urlPath) => {
    const path = normalizePath(urlPath);

    if (STATIC_ROUTES.has(path)) return 'ok';

    for (const { re, check } of DYNAMIC_ROUTES) {
        const match = path.match(re);
        if (!match) continue;

        let param;
        try {
            param = decodeURIComponent(match[1]);
        } catch {
            // A malformed percent escape cannot name anything real.
            return 'missing';
        }

        const found = await check(param);
        if (found === null) return 'unknown';
        return found ? 'ok' : 'missing';
    }

    // No route claims this path, and no query was needed to know it.
    return 'missing';
};

module.exports = { resolvePageStatus, STATIC_ROUTES, DYNAMIC_ROUTES, normalizePath };
