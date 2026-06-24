const logger = require('../utils/logger');
const pool = require('../config/database');

// List of known crawler user agents
const CRAWLER_AGENTS = [
    'facebookexternalhit',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegram',
    'pinterest',
    'slurp',
    'googlebot',
    'bingbot',
    'yandex',
    'baiduspider',
    'ia_archiver',
    'curl',
    'wget',
    'python-requests',
];

const isCrawler = (userAgent) => {
    if (!userAgent) return false;
    return CRAWLER_AGENTS.some(agent => userAgent.toLowerCase().includes(agent));
};

const extractMetadata = (urlPath) => {
    const songMatch = urlPath.match(/\/song\/(\d+)/);
    if (songMatch) {
        return { type: 'song', id: songMatch[1] };
    }

    const profileMatch = urlPath.match(/\/profile\/([^/?]+)/);
    if (profileMatch) {
        return { type: 'profile', id: profileMatch[1] };
    }

    return null;
};

const fetchSongMetadata = async (songId) => {
    try {
        const [songs] = await pool.query(`
            SELECT 
                s.id,
                s.title,
                s.description,
                s.image_url,
                s.created_at,
                p.user_id,
                u.username
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            LEFT JOIN users u ON p.user_id = u.id
            WHERE s.id = ?
            LIMIT 1
        `, [songId]);

        if (!songs || songs.length === 0) {
            return null;
        }

        const song = songs[0];
        return {
            title: song.title,
            description: song.description || 'Check out this song on InternetDJ',
            image: song.image_url || '/default-song-image.jpg',
            url: `/song/${song.id}`,
            type: 'music.song',
        };
    } catch (err) {
        logger.error('Error fetching song metadata:', err);
        return null;
    }
};

const fetchProfileMetadata = async (username) => {
    try {
        const [users] = await pool.query(`
            SELECT 
                u.id,
                u.username,
                u.avatar_url,
                p.bio
            FROM users u
            LEFT JOIN profiles p ON u.id = p.user_id
            WHERE u.username = ?
            LIMIT 1
        `, [username]);

        if (!users || users.length === 0) {
            return null;
        }

        const user = users[0];
        return {
            title: user.username,
            description: user.bio || `Check out ${user.username}'s profile on InternetDJ`,
            image: user.avatar_url || '/default-profile-image.jpg',
            url: `/profile/${user.username}`,
            type: 'profile',
        };
    } catch (err) {
        logger.error('Error fetching profile metadata:', err);
        return null;
    }
};

const injectOGMetaTags = (html, metadata, baseUrl) => {
    if (!metadata) return html;

    const ogTags = `
    <meta property="og:type" content="${metadata.type}" />
    <meta property="og:title" content="${escapeHtml(metadata.title)}" />
    <meta property="og:description" content="${escapeHtml(metadata.description)}" />
    <meta property="og:image" content="${metadata.image}" />
    <meta property="og:url" content="${baseUrl}${metadata.url}" />
    <meta property="og:site_name" content="InternetDJ" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(metadata.title)}" />
    <meta name="twitter:description" content="${escapeHtml(metadata.description)}" />
    <meta name="twitter:image" content="${metadata.image}" />
    `;

    // Insert OG tags before closing </head> tag
    return html.replace('</head>', `${ogTags}</head>`);
};

const escapeHtml = (text) => {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

module.exports = {
    isCrawler,
    extractMetadata,
    fetchSongMetadata,
    fetchProfileMetadata,
    injectOGMetaTags,
};
