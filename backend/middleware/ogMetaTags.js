/**
 * Server-rendered share cards and structured data.
 *
 * The frontend is a client-rendered SPA, so the HTML a crawler receives is an
 * empty <div id="root">. Social crawlers do not run JavaScript at all, which
 * means react-helmet-async can never reach them: without this middleware a
 * track shared to Discord or Bluesky renders as a bare URL with no artwork and
 * no title. Here we detect the crawler, look the entity up, and inject real
 * tags into the shell before it goes out.
 *
 * Two audiences, two formats:
 *   Open Graph / Twitter cards  -> chat apps and social networks
 *   JSON-LD                     -> search engines, for rich results
 *
 * Both are emitted for every entity type, because the same URL gets shared into
 * both kinds of place.
 */

const logger = require('../utils/logger');
const pool = require('../config/database');
const { normalizeGenre, expandGenreString } = require('../utils/genres');

const FALLBACK_IMAGE = '/idj-coin-200-nobg.png';

// List of known crawler user agents
const CRAWLER_AGENTS = [
    'facebookexternalhit',
    'meta-externalagent',
    'meta-externalfetcher',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegram',
    'discordbot',
    'pinterest',
    'slackbot',
    'slurp',
    'googlebot',
    'bingbot',
    'yandex',
    'baiduspider',
    'ia_archiver',
    'embedly',
    'redditbot',
    'mastodon',
    'bluesky',
    'applebot',
    'duckduckbot',
    'curl',
    'wget',
    'python-requests',
];

const isCrawler = (userAgent) => {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    return CRAWLER_AGENTS.some(agent => ua.includes(agent));
};

/**
 * Which entity, if any, a path refers to.
 *
 * Profiles are the fiddly one: /profile/18 and /profile/dj-subspace are both
 * valid, so the id captured here can be numeric or a slug, and the fetcher
 * decides which column to look in. Matching only \d+ — as this did before —
 * meant every shared vanity URL fell through to the generic site card.
 */
const extractMetadata = (urlPath) => {
    const songMatch = urlPath.match(/^\/song\/(\d+)\/?$/);
    if (songMatch) return { type: 'song', id: songMatch[1] };

    // Anchored and single-segment so the owner-only /profile/:id/songs-manager
    // and /profile/:id/collaborations views do not claim the artist card.
    const profileMatch = urlPath.match(/^\/profile\/([^/]+)\/?$/);
    if (profileMatch) return { type: 'profile', id: decodeURIComponent(profileMatch[1]) };

    const crateMatch = urlPath.match(/^\/crate\/(\d+)\/?$/);
    if (crateMatch) return { type: 'crate', id: crateMatch[1] };

    const postMatch = urlPath.match(/^\/forum\/post\/(\d+)\/?$/);
    if (postMatch) return { type: 'forumPost', id: postMatch[1] };

    const tagMatch = urlPath.match(/^\/tag\/([^/]+)\/?$/);
    if (tagMatch) return { type: 'tag', id: decodeURIComponent(tagMatch[1]) };

    return null;
};

// Descriptions come from user-authored fields that may contain HTML, and a
// share card wants one line of plain text, not markup or a wall of prose.
const toPlainText = (value, maxLength = 200) => {
    if (!value) return '';
    const text = String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

const fetchSongMetadata = async (songId) => {
    try {
        const songs = await pool.query(`
            SELECT s.id, s.title, s.description, s.image_url, s.mp3_url, s.genre,
                   s.created_at, s.plays,
                   p.id AS profile_id, p.name AS profile_name, p.slug AS profile_slug
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.id = ?
            LIMIT 1
        `, [songId]);

        if (!songs || songs.length === 0) {
            logger.debug(`OG: no song found for id ${songId}`);
            return null;
        }

        const song = songs[0];
        const artist = song.profile_name || 'InternetDJ';
        const title = song.title || 'Untitled';
        const genres = song.genre ? expandGenreString(song.genre).map(g => g.raw) : [];
        const profilePath = song.profile_slug
            ? `/profile/${song.profile_slug}`
            : (song.profile_id ? `/profile/${song.profile_id}` : null);

        return {
            title: `${title} by ${artist}`,
            description: toPlainText(song.description)
                || `Listen to ${title} by ${artist} on InternetDJ${genres.length ? ` — ${genres.slice(0, 3).join(', ')}` : ''}.`,
            image: song.image_url || FALLBACK_IMAGE,
            url: `/song/${song.id}`,
            type: 'music.song',
            audio: song.mp3_url || null,
            // music:musician wants a profile URL, and Facebook resolves it, so
            // a shared track links back to the artist page as well.
            musician: profilePath,
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'MusicRecording',
                name: title,
                url: `${base}/song/${song.id}`,
                image: absolute(song.image_url, base),
                description: toPlainText(song.description) || undefined,
                genre: genres.length ? genres : undefined,
                datePublished: song.created_at ? new Date(song.created_at).toISOString().slice(0, 10) : undefined,
                interactionStatistic: song.plays ? {
                    '@type': 'InteractionCounter',
                    interactionType: 'https://schema.org/ListenAction',
                    userInteractionCount: Number(song.plays),
                } : undefined,
                byArtist: {
                    '@type': 'MusicGroup',
                    name: artist,
                    url: profilePath ? `${base}${profilePath}` : undefined,
                },
                audio: song.mp3_url ? {
                    '@type': 'AudioObject',
                    contentUrl: absolute(song.mp3_url, base),
                } : undefined,
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching song metadata:', err);
        return null;
    }
};

const fetchProfileMetadata = async (profileRef) => {
    try {
        // id is INT and slug is VARCHAR; letting one query handle both would
        // make the database cast a slug to a number and match profile 0.
        const isNumeric = /^\d+$/.test(profileRef);
        const profiles = await pool.query(
            isNumeric
                ? `SELECT p.id, p.name, p.slug, p.description, p.picture_url, p.location, p.genre
                   FROM profiles p WHERE p.id = ? LIMIT 1`
                : `SELECT p.id, p.name, p.slug, p.description, p.picture_url, p.location, p.genre
                   FROM profiles p WHERE p.slug = ? LIMIT 1`,
            [profileRef]
        );

        if (!profiles || profiles.length === 0) {
            logger.debug(`OG: no profile found for ref ${profileRef}`);
            return null;
        }

        const profile = profiles[0];
        const name = profile.name || 'InternetDJ artist';

        const counts = await pool.query(
            'SELECT COUNT(*) AS total FROM songs WHERE profile_id = ?',
            [profile.id]
        );
        const trackCount = counts && counts[0] ? Number(counts[0].total) : 0;

        // The slug URL is the canonical one when it exists, so the numeric and
        // vanity URLs do not compete as duplicates in search results.
        const canonicalPath = profile.slug ? `/profile/${profile.slug}` : `/profile/${profile.id}`;

        return {
            title: `${name} on InternetDJ`,
            description: toPlainText(profile.description)
                || `${name} on InternetDJ — ${trackCount} track${trackCount === 1 ? '' : 's'}${profile.genre ? `, ${profile.genre}` : ''}${profile.location ? `, ${profile.location}` : ''}.`,
            image: profile.picture_url || FALLBACK_IMAGE,
            url: canonicalPath,
            type: 'profile',
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'MusicGroup',
                name,
                url: `${base}${canonicalPath}`,
                image: absolute(profile.picture_url, base),
                description: toPlainText(profile.description) || undefined,
                genre: profile.genre || undefined,
                location: profile.location || undefined,
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching profile metadata:', err);
        return null;
    }
};

const fetchCrateMetadata = async (crateId) => {
    try {
        const crates = await pool.query(`
            SELECT pl.id, pl.name, pl.is_public, pl.updated_at, pl.dedication_note,
                   owner.name AS owner_name,
                   dedicated.name AS dedicated_to_name
            FROM playlists pl
            LEFT JOIN profiles owner ON pl.profile_id = owner.id
            LEFT JOIN profiles dedicated ON pl.dedicated_to_profile_id = dedicated.id
            WHERE pl.id = ?
            LIMIT 1
        `, [crateId]);

        if (!crates || crates.length === 0) return null;

        const crate = crates[0];

        // A private crate must not leak its name or artwork through a share
        // card. Returning null falls through to the generic site card.
        if (!crate.is_public) {
            logger.debug(`OG: crate ${crateId} is private, skipping metadata`);
            return null;
        }

        const tracks = await pool.query(`
            SELECT s.title, s.image_url, p.name AS artist
            FROM playlist_songs ps
            JOIN songs s ON s.id = ps.song_id
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE ps.playlist_id = ?
            ORDER BY ps.added_at ASC
        `, [crateId]);

        const name = crate.name || 'Untitled crate';
        const owner = crate.owner_name || 'an InternetDJ member';
        const cover = tracks.find(t => t.image_url);
        const isMixtape = Boolean(crate.dedicated_to_name);

        const summary = tracks.length
            ? `${tracks.length} track${tracks.length === 1 ? '' : 's'} — ${tracks.slice(0, 3).map(t => t.title).filter(Boolean).join(', ')}${tracks.length > 3 ? '…' : ''}`
            : 'An empty crate.';

        return {
            title: isMixtape
                ? `${name} — a mixtape for ${crate.dedicated_to_name}`
                : `${name} — a crate by ${owner}`,
            description: toPlainText(crate.dedication_note) || summary,
            image: cover ? cover.image_url : FALLBACK_IMAGE,
            url: `/crate/${crate.id}`,
            type: 'music.playlist',
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'MusicPlaylist',
                name,
                url: `${base}/crate/${crate.id}`,
                image: cover ? absolute(cover.image_url, base) : undefined,
                numTracks: tracks.length,
                track: tracks.slice(0, 25).map(t => ({
                    '@type': 'MusicRecording',
                    name: t.title || 'Untitled',
                    byArtist: t.artist ? { '@type': 'MusicGroup', name: t.artist } : undefined,
                })),
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching crate metadata:', err);
        return null;
    }
};

const fetchForumPostMetadata = async (postId) => {
    try {
        const posts = await pool.query(`
            SELECT fp.id, fp.title, fp.content, fp.created_at, fp.updated_at,
                   p.name AS author_name, p.picture_url AS author_image
            FROM forum_posts fp
            LEFT JOIN profiles p ON p.user_id = fp.user_id
            WHERE fp.id = ?
            LIMIT 1
        `, [postId]);

        if (!posts || posts.length === 0) return null;

        const post = posts[0];
        const author = post.author_name || 'an InternetDJ member';
        const title = post.title || 'Forum post';

        return {
            title,
            description: toPlainText(post.content) || `A discussion started by ${author} on InternetDJ.`,
            image: post.author_image || FALLBACK_IMAGE,
            url: `/forum/post/${post.id}`,
            type: 'article',
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'DiscussionForumPosting',
                headline: title,
                url: `${base}/forum/post/${post.id}`,
                text: toPlainText(post.content, 500) || undefined,
                datePublished: post.created_at ? new Date(post.created_at).toISOString() : undefined,
                dateModified: post.updated_at ? new Date(post.updated_at).toISOString() : undefined,
                author: { '@type': 'Person', name: author },
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching forum post metadata:', err);
        return null;
    }
};

const fetchTagMetadata = async (rawTag) => {
    try {
        const wanted = normalizeGenre(rawTag);
        if (!wanted) return null;

        // Genres are comma-separated free text, so an exact match is
        // impossible in SQL. LIKE narrows the scan cheaply and the normalised
        // comparison below does the real filtering — a crawler hit should not
        // cost a full table scan.
        const rows = await pool.query(`
            SELECT s.title, s.genre, s.image_url, p.name AS artist
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.genre LIKE ?
            ORDER BY s.plays DESC
            LIMIT 100
        `, [`%${rawTag}%`]);

        const matches = rows.filter(row =>
            expandGenreString(row.genre).some(({ key }) => key === wanted)
        );

        if (!matches.length) return null;

        // Show the spelling artists actually use rather than the grouping key.
        const label = matches
            .flatMap(row => expandGenreString(row.genre))
            .filter(({ key }) => key === wanted)
            .map(({ raw }) => raw)[0] || rawTag;

        const cover = matches.find(m => m.image_url);
        const artists = [...new Set(matches.map(m => m.artist).filter(Boolean))].slice(0, 3);

        return {
            title: `${label} on InternetDJ`,
            description: `${matches.length >= 100 ? '100+' : matches.length} ${label} track${matches.length === 1 ? '' : 's'} from independent producers${artists.length ? ` including ${artists.join(', ')}` : ''}. Listen and review on InternetDJ.`,
            image: cover ? cover.image_url : FALLBACK_IMAGE,
            url: `/tag/${encodeURIComponent(wanted)}`,
            type: 'website',
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: `${label} music on InternetDJ`,
                url: `${base}/tag/${encodeURIComponent(wanted)}`,
                about: { '@type': 'Thing', name: label },
                mainEntity: {
                    '@type': 'ItemList',
                    numberOfItems: matches.length,
                    itemListElement: matches.slice(0, 25).map((m, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        item: {
                            '@type': 'MusicRecording',
                            name: m.title || 'Untitled',
                            byArtist: m.artist ? { '@type': 'MusicGroup', name: m.artist } : undefined,
                        },
                    })),
                },
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching tag metadata:', err);
        return null;
    }
};

const FETCHERS = {
    song: fetchSongMetadata,
    profile: fetchProfileMetadata,
    crate: fetchCrateMetadata,
    forumPost: fetchForumPostMetadata,
    tag: fetchTagMetadata,
};

/** Single entry point, so server.js does not grow a branch per entity type. */
const fetchMetadata = async ({ type, id }) => {
    const fetcher = FETCHERS[type];
    if (!fetcher) return null;
    return fetcher(id);
};

const escapeHtml = (text) => {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const toAbsoluteUrl = (value, baseUrl) => {
    if (!value) return `${baseUrl}${FALLBACK_IMAGE}`;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/')) return `${baseUrl}${value}`;
    return `${baseUrl}/${value}`;
};

// Same resolution, but an absent value stays absent instead of becoming the
// fallback image — JSON-LD should omit a field rather than assert a wrong one.
const absolute = (value, baseUrl) => (value ? toAbsoluteUrl(value, baseUrl) : undefined);

// JSON-LD is injected inside a <script> block, where the danger is a user
// string closing the tag early. JSON.stringify handles quoting; this handles
// the one sequence it does not escape.
const safeJsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

const injectOGMetaTags = (html, metadata, baseUrl) => {
    if (!metadata) return html;

    const imageUrl = toAbsoluteUrl(metadata.image, baseUrl);
    const pageUrl = toAbsoluteUrl(metadata.url, baseUrl);

    const tags = [
        `<meta property="og:type" content="${escapeHtml(metadata.type)}" />`,
        `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
        `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
        `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />`,
        `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
        `<meta property="og:site_name" content="InternetDJ" />`,
        `<meta property="fb:app_id" content="1551341333046509" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:site" content="@internetdjco" />`,
        `<meta name="twitter:title" content="${escapeHtml(metadata.title)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`,
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    ];

    // Lets Discord, Telegram and Slack play the track inline instead of only
    // linking to it.
    if (metadata.audio) {
        const audioUrl = toAbsoluteUrl(metadata.audio, baseUrl);
        tags.push(`<meta property="og:audio" content="${escapeHtml(audioUrl)}" />`);
        tags.push(`<meta property="og:audio:secure_url" content="${escapeHtml(audioUrl)}" />`);
        tags.push(`<meta property="og:audio:type" content="audio/mpeg" />`);
    }
    if (metadata.musician) {
        tags.push(`<meta property="music:musician" content="${escapeHtml(toAbsoluteUrl(metadata.musician, baseUrl))}" />`);
    }

    // The crawler-visible description has to replace the static one from
    // index.html, not sit alongside it.
    tags.push(`<meta name="description" content="${escapeHtml(metadata.description)}" />`);
    tags.push(`<link rel="canonical" href="${escapeHtml(pageUrl)}" />`);
    tags.push(`<title>${escapeHtml(metadata.title)} | InternetDJ</title>`);

    if (typeof metadata.jsonLd === 'function') {
        tags.push(`<script type="application/ld+json">${safeJsonLd(metadata.jsonLd(baseUrl))}</script>`);
    }

    const ogTags = `\n    ${tags.join('\n    ')}\n    `;

    // Remove pre-existing tags that would conflict with the ones above. The
    // static <title> and <meta name="description"> in index.html are generic,
    // so leaving them in place would give the crawler two answers.
    const sanitizedHtml = html
        .replace(/\s*<meta\s+(?:property|name)=["'](?:og:[^"']+|twitter:[^"']+|fb:[^"']+|music:[^"']+)["'][^>]*>/gi, '')
        .replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, '')
        .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, '')
        .replace(/\s*<title>[\s\S]*?<\/title>/i, '');

    // Injected at the very top of <head>: some crawlers only read the first few
    // kilobytes before deciding what the page is.
    if (/<head[^>]*>/i.test(sanitizedHtml)) {
        return sanitizedHtml.replace(/<head([^>]*)>/i, `<head$1>${ogTags}`);
    }

    return `${ogTags}${sanitizedHtml}`;
};

module.exports = {
    isCrawler,
    extractMetadata,
    fetchMetadata,
    fetchSongMetadata,
    fetchProfileMetadata,
    fetchCrateMetadata,
    fetchForumPostMetadata,
    fetchTagMetadata,
    injectOGMetaTags,
};
