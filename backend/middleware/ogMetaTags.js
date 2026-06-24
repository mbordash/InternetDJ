const logger = require('../utils/logger');
const pool = require('../config/database');

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
    'curl',
    'wget',
    'python-requests',
];

const isCrawler = (userAgent) => {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    return CRAWLER_AGENTS.some(agent => ua.includes(agent));
};

const extractMetadata = (urlPath) => {
    const songMatch = urlPath.match(/\/song\/(\d+)/);
    if (songMatch) {
        return { type: 'song', id: songMatch[1] };
    }

    const profileMatch = urlPath.match(/\/profile\/(\d+)/);
    if (profileMatch) {
        return { type: 'profile', id: profileMatch[1] };
    }

    return null;
};

const fetchSongMetadata = async (songId) => {
    try {
        const songs = await pool.query(`
            SELECT s.id, s.title, s.description, s.image_url, p.name AS profile_name
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
        return {
            title: song.title ? `${song.title} by ${artist}` : 'InternetDJ',
            description: song.description || `Listen to ${song.title || 'this track'} on InternetDJ`,
            image: song.image_url || '/idj-coin-200-nobg.png',
            url: `/song/${song.id}`,
            type: 'music.song',
        };
    } catch (err) {
        logger.error('OG: error fetching song metadata:', err);
        return null;
    }
};

const fetchProfileMetadata = async (profileId) => {
    try {
        const profiles = await pool.query(`
            SELECT p.id, p.name, p.description, p.picture_url
            FROM profiles p
            WHERE p.id = ?
            LIMIT 1
        `, [profileId]);

        if (!profiles || profiles.length === 0) {
            logger.debug(`OG: no profile found for id ${profileId}`);
            return null;
        }

        const profile = profiles[0];
        return {
            title: profile.name || 'InternetDJ',
            description: profile.description || `Check out ${profile.name || 'this artist'} on InternetDJ`,
            image: profile.picture_url || '/idj-coin-200-nobg.png',
            url: `/profile/${profile.id}`,
            type: 'profile',
        };
    } catch (err) {
        logger.error('OG: error fetching profile metadata:', err);
        return null;
    }
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
    if (!value) return `${baseUrl}/idj-coin-200-nobg.png`;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/')) return `${baseUrl}${value}`;
    return `${baseUrl}/${value}`;
};

const injectOGMetaTags = (html, metadata, baseUrl) => {
    if (!metadata) return html;

    const imageUrl = toAbsoluteUrl(metadata.image, baseUrl);
    const pageUrl = toAbsoluteUrl(metadata.url, baseUrl);

    const ogTags = `
    <meta property="og:type" content="${escapeHtml(metadata.type)}" />
    <meta property="og:title" content="${escapeHtml(metadata.title)}" />
    <meta property="og:description" content="${escapeHtml(metadata.description)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:site_name" content="InternetDJ" />
    <meta property="fb:app_id" content="1551341333046509" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(metadata.title)}" />
    <meta name="twitter:description" content="${escapeHtml(metadata.description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    `;

    // Remove any pre-existing OG/Twitter tags so they don't conflict.
    const sanitizedHtml = html.replace(
        /\s*<meta\s+(?:property|name)=["'](?:og:[^"']+|twitter:[^"']+|fb:[^"']+)["'][^>]*>/gi,
        ''
    );

    // Inject dynamic tags at the very top of <head> for crawler reliability.
    if (/<head[^>]*>/i.test(sanitizedHtml)) {
        return sanitizedHtml.replace(/<head([^>]*)>/i, `<head$1>${ogTags}`);
    }

    return `${ogTags}${sanitizedHtml}`;
};

module.exports = {
    isCrawler,
    extractMetadata,
    fetchSongMetadata,
    fetchProfileMetadata,
    injectOGMetaTags,
};
