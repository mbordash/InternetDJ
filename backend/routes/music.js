const express = require('express');
const pool = require('../config/database');
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const authenticateOptional = require('../middleware/authenticateOptional');
const logger = require('../utils/logger');
const { normalizeGenre, aliasSourcesFor, expandGenreString, isLikelyJunkGenre } = require('../utils/genres');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const tmp = require('tmp');
const { buildPublicFileUrl, extractObjectKey } = require('../utils/storage');
const { createNotification, NOTIFICATION_TYPES } = require('../utils/notifications');

// Get client IP, handling proxies
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
};

// Normalize a boolean flag arriving from JSON or multipart form data
const parseBooleanFlag = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
};

// Build a safe download filename from a song title
const buildDownloadFilename = (title) => {
    const base = String(title || 'song')
        .replace(/[^\w\s.-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'song';
    return `${base}.mp3`;
};

const { getRunningJobs, incrementRunningJobs, decrementRunningJobs } = require('../utils/concurrency');
const { randomUUID } = require('crypto');
const { getQueue, estimateWait, ACTIVE_STATUSES } = require('../utils/masteringQueue');
const { enqueueSongAnalysis } = require('../utils/analysisQueue');
const { parseEditableBpm, parseEditableKey, compatibleKeys, camelotOf, isMusicalKey } = require('../utils/musicalKeys');
const { rankCandidates, TEMPO_LOOSE } = require('../utils/trackMatching');

router.get('/user-songs', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch the user's profile_id
        const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [userId]);
        if (!profiles || profiles.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        const profileId = Number(profiles[0].id);

        // Fetch songs uploaded by this profile_id
        const rows = await pool.query(`
            SELECT s.*, p.name AS profile_name, p.slug AS profile_slug,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.profile_id = ?
            ORDER BY s.created_at DESC
        `, [profileId]);

        const sanitizedRows = rows.map((row) => ({
            ...row,
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            plays: Number(row.plays) || 0,
            profile_name: row.profile_name || 'Unknown',
            profile_slug: row.profile_slug || null,
            likes_count: Number(row.likes_count) || 0,
            allow_download: Boolean(row.allow_download),
        }));

        res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
    } catch (err) {
        logger.error('Error in GET /music/user-songs:', err);
        res.status(500).json({ error: 'Failed to fetch user songs' });
    }
});

router.get('/:songId/stats', authenticate, async (req, res) => {
    const songId = parseInt(req.params.songId);
    const userId = req.user.id;
    const { start_date, end_date } = req.query;

    try {
        // Verify ownership
        const songResult = await pool.query(
            'SELECT profile_id FROM songs WHERE id = ?',
            [songId]
        );
        if (!songResult || songResult.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }
        const songProfileId = Number(songResult[0].profile_id);
        const profileResult = await pool.query('SELECT user_id FROM profiles WHERE id = ?', [songProfileId]);
        if (!profileResult || profileResult.length === 0 || Number(profileResult[0].user_id) !== Number(userId)) {
            return res.status(403).json({ error: 'Unauthorized to view stats for this song' });
        }

        // Validate date parameters
        let queryParams = [songId];
        let playsQuery = `
            SELECT DATE(played_at) as date,
                SUM(COUNT(*)) OVER (ORDER BY DATE(played_at)) as cumulative_count
            FROM song_plays
            WHERE song_id = ?
        `;
        let reviewsQuery = `
            SELECT DATE(created_at) as date,
                SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) as cumulative_count
            FROM reviews
            WHERE song_id = ?
        `;

        if (start_date && end_date) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
            }
            playsQuery += ' AND DATE(played_at) BETWEEN ? AND ?';
            reviewsQuery += ' AND DATE(created_at) BETWEEN ? AND ?';
            queryParams.push(start_date, end_date);
        }

        playsQuery += ' GROUP BY DATE(played_at) ORDER BY date ASC';
        reviewsQuery += ' GROUP BY DATE(created_at) ORDER BY date ASC';

        // Fetch cumulative plays and reviews
        const plays = await pool.query(playsQuery, queryParams);
        const reviews = await pool.query(reviewsQuery, queryParams);

        res.json({
            plays: plays
                .filter(row => row.date && row.date instanceof Date && !isNaN(row.date.getTime()))
                .map(row => ({
                    date: row.date.toISOString().split('T')[0],
                    count: Number(row.cumulative_count) || 0
                })),
            reviews: reviews
                .filter(row => row.date && row.date instanceof Date && !isNaN(row.date.getTime()))
                .map(row => ({
                    date: row.date.toISOString().split('T')[0],
                    count: Number(row.cumulative_count) || 0
                }))
        });
    } catch (err) {
        logger.error('Error in GET /music/:songId/stats:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// GET /music/:songId/similar – "You might also like" based on shared genre tags
router.get('/:songId/similar', async (req, res) => {
    const songId = parseInt(req.params.songId);
    if (!songId) return res.status(400).json({ error: 'Invalid song ID' });

    // Wide enough that ranking, not SQL, decides what is actually close.
    const CANDIDATE_POOL = 200;

    const shape = (row, reasons = []) => ({
        id: Number(row.id),
        title: row.title,
        image_url: row.image_url,
        plays: Number(row.plays) || 0,
        genre: row.genre,
        bpm: row.bpm == null ? null : Number(row.bpm),
        musical_key: row.musical_key || null,
        camelot: row.musical_key ? camelotOf(row.musical_key) : null,
        profile_id: Number(row.profile_id),
        profile_name: row.profile_name || 'Unknown',
        profile_slug: row.profile_slug || null,
        likes_count: Number(row.likes_count) || 0,
        // Why this track is here, in the order it should be read.
        match_reasons: reasons,
    });

    const SELECT_FIELDS = `
        s.id, s.title, s.image_url, s.plays, s.genre, s.profile_id,
        s.bpm, s.musical_key,
        p.name AS profile_name, p.slug AS profile_slug,
        (SELECT COUNT(*) FROM playlist_songs ps JOIN playlists pl ON ps.playlist_id = pl.id
         WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count`;

    try {
        const songRows = await pool.query(
            'SELECT genre, profile_id, bpm, musical_key FROM songs WHERE id = ?',
            [songId]
        );
        if (!songRows || songRows.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const base = songRows[0];
        const profile_id = base.profile_id;
        const baseBpm = base.bpm == null ? null : Number(base.bpm);
        const baseKey = base.musical_key || null;
        const tags = base.genre ? base.genre.split(',').map(t => t.trim()).filter(Boolean) : [];

        // Gather anything that shares a genre, a compatible key, or a mixable
        // tempo, then let rankCandidates decide the order. Pulling a wide pool
        // and ranking in JS keeps the scoring rules in one readable place
        // instead of spread across a CASE expression.
        const orClauses = [];
        const orParams = [];

        if (tags.length) {
            orClauses.push(`(${tags.map(() => 's.genre LIKE ?').join(' OR ')})`);
            orParams.push(...tags.map(t => `%${t}%`));
        }
        if (baseKey) {
            const keys = compatibleKeys(baseKey);
            if (keys.length) {
                orClauses.push(`s.musical_key IN (${keys.map(() => '?').join(', ')})`);
                orParams.push(...keys);
            }
        }
        if (baseBpm) {
            // The tempo itself plus half and double time, each with tolerance.
            for (const target of [baseBpm, baseBpm * 2, baseBpm / 2]) {
                orClauses.push('s.bpm BETWEEN ? AND ?');
                orParams.push(target * (1 - TEMPO_LOOSE), target * (1 + TEMPO_LOOSE));
            }
        }

        let ranked = [];
        if (orClauses.length) {
            const rows = await pool.query(`
                SELECT ${SELECT_FIELDS}
                FROM songs s
                LEFT JOIN profiles p ON s.profile_id = p.id
                WHERE s.id != ?
                  AND s.profile_id != ?
                  AND (${orClauses.join(' OR ')})
                ORDER BY s.plays DESC
                LIMIT ${CANDIDATE_POOL}
            `, [songId, profile_id, ...orParams]);

            ranked = rankCandidates(base, rows, 8);
        }

        if (ranked.length) {
            return res.json({
                songs: ranked.map(entry => shape(entry.candidate, entry.reasons)),
                // What the ranking had to work with, so the page can say why -
                // and so a wheel drawn later has its anchor.
                basis: {
                    bpm: baseBpm,
                    musical_key: baseKey,
                    camelot: baseKey ? camelotOf(baseKey) : null,
                    compatible_keys: baseKey ? compatibleKeys(baseKey) : [],
                    tags,
                },
            });
        }

        // Nothing in common with anything: fall back to most-played by other
        // artists, which is what this endpoint always did for untagged songs.
        const fallback = await pool.query(`
            SELECT ${SELECT_FIELDS}
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.id != ? AND s.profile_id != ?
            ORDER BY s.plays DESC
            LIMIT 6
        `, [songId, profile_id]);

        res.json({
            songs: fallback.map(row => shape(row)),
            basis: {
                bpm: baseBpm,
                musical_key: baseKey,
                camelot: baseKey ? camelotOf(baseKey) : null,
                compatible_keys: baseKey ? compatibleKeys(baseKey) : [],
                tags,
            },
        });
    } catch (err) {
        logger.error('Error in GET /music/:songId/similar:', err);
        res.status(500).json({ error: 'Failed to fetch similar songs' });
    }
});

// Resolve the caller's profile id when a valid token came along. The activity
// feed is public, so an anonymous viewer is a normal case rather than an error.
const viewerProfileIdFor = async (req) => {
    if (!req.user?.id) return null;
    const rows = await pool.query('SELECT id FROM profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
    return rows.length ? Number(rows[0].id) : null;
};

// GET /music/:songId/activity – public activity feed for a song
router.get('/:songId/activity', authenticateOptional, async (req, res) => {
    const songId = parseInt(req.params.songId);
    if (!songId) return res.status(400).json({ error: 'Invalid song ID' });

    try {
        // Look up the song's profile_id so we can also include artist-follow events
        const songRows = await pool.query('SELECT profile_id FROM songs WHERE id = ?', [songId]);
        if (!songRows || songRows.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }
        const profileId = Number(songRows[0].profile_id);

        // 1. Likes – playlist_songs in a "Likes" playlist
        const likes = await pool.query(`
            SELECT
                'song_liked' AS type,
                p.id          AS actor_profile_id,
                p.slug        AS actor_profile_slug,
                p.name        AS actor_name,
                p.picture_url AS actor_picture,
                ps.added_at   AS created_at,
                NULL          AS extra
            FROM playlist_songs ps
            JOIN playlists pl ON ps.playlist_id = pl.id
            JOIN profiles p   ON pl.profile_id  = p.id
            WHERE ps.song_id = ? AND LOWER(pl.name) = 'likes'
            ORDER BY ps.added_at DESC
            LIMIT 20
        `, [songId]);

        // 2. Added to any non-Likes crate. The crate's id comes back so the feed
        // can link to it, and its visibility comes back so a private crate - a
        // surprise mixtape, say - never announces itself on a public song page.
        const playlistAddRows = await pool.query(`
            SELECT
                'playlist_add'  AS type,
                p.id            AS actor_profile_id,
                p.slug        AS actor_profile_slug,
                p.name          AS actor_name,
                p.picture_url   AS actor_picture,
                ps.added_at     AS created_at,
                pl.name         AS extra,
                pl.id           AS extra_id,
                pl.is_public    AS crate_is_public,
                pl.profile_id   AS crate_owner_profile_id,
                pl.dedicated_to_profile_id AS crate_dedicated_to_profile_id
            FROM playlist_songs ps
            JOIN playlists pl ON ps.playlist_id = pl.id
            JOIN profiles p   ON pl.profile_id  = p.id
            WHERE ps.song_id = ? AND LOWER(pl.name) != 'likes'
            ORDER BY ps.added_at DESC
            LIMIT 20
        `, [songId]);

        // Same visibility rule the crate page itself enforces: public, yours, or
        // dedicated to you.
        const viewerProfileId = await viewerProfileIdFor(req);
        const playlistAdds = playlistAddRows.filter((row) => (
            row.crate_is_public
            || (viewerProfileId != null && (
                Number(row.crate_owner_profile_id) === viewerProfileId
                || Number(row.crate_dedicated_to_profile_id) === viewerProfileId
            ))
        ));

        // 3. Reviews
        const reviews = await pool.query(`
            SELECT
                'song_reviewed' AS type,
                p.id            AS actor_profile_id,
                p.slug        AS actor_profile_slug,
                p.name          AS actor_name,
                p.picture_url   AS actor_picture,
                r.created_at    AS created_at,
                NULL            AS extra
            FROM reviews r
            JOIN profiles p ON r.profile_id = p.id
            WHERE r.song_id = ?
            ORDER BY r.created_at DESC
            LIMIT 20
        `, [songId]);

        // 4. Artist follows (people who followed this song's artist)
        const follows = await pool.query(`
            SELECT
                'profile_followed' AS type,
                follower_p.id      AS actor_profile_id,
                follower_p.slug    AS actor_profile_slug,
                follower_p.name    AS actor_name,
                follower_p.picture_url AS actor_picture,
                f.created_at       AS created_at,
                NULL               AS extra
            FROM follows f
            JOIN profiles follower_p ON follower_p.user_id = f.follower_id
            WHERE f.followed_profile_id = ?
            ORDER BY f.created_at DESC
            LIMIT 20
        `, [profileId]);

        // Merge, sort by date desc, cap at 30
        const all = [...likes, ...playlistAdds, ...reviews, ...follows]
            .map(row => ({
                type: row.type,
                actor_profile_id: row.actor_profile_id != null ? Number(row.actor_profile_id) : null,
                actor_profile_slug: row.actor_profile_slug || null,
                actor_name: row.actor_name || 'Someone',
                actor_picture: row.actor_picture || null,
                created_at: row.created_at,
                extra: row.extra || null,
                extra_id: row.extra_id != null ? Number(row.extra_id) : null,
            }))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 30);

        res.json({ activity: all });
    } catch (err) {
        logger.error('Error in GET /music/:songId/activity:', err);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

router.get('/featured', async (req, res) => {
    try {
        // Pick a random song with listens and at least one positive review signal.
        const rows = await pool.query(
            `
            SELECT
                s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, s.genre, p.name AS profile_name, p.slug AS profile_slug,
                (SELECT COUNT(*)
                 FROM playlist_songs ps
                          JOIN playlists pl ON ps.playlist_id = pl.id
                 WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.mp3_url IS NOT NULL
              AND COALESCE(s.plays, 0) > 0
              AND EXISTS (
                SELECT 1
                FROM reviews r
                WHERE r.song_id = s.id
                  AND (
                    (r.feedback IS NOT NULL AND (
                      JSON_SEARCH(r.feedback, 'one', 'Good') IS NOT NULL
                      OR JSON_SEARCH(r.feedback, 'one', 'Perfect') IS NOT NULL
                    ))
                    OR LOWER(COALESCE(r.review, '')) REGEXP '(^|[^a-z])(good|great|excellent|perfect|awesome)([^a-z]|$)'
                  )
              )
            ORDER BY RAND()
            LIMIT 1
        `
        );

        if (!rows.length) {
            // Nothing meets minLikes; keep behavior predictable
            return res.json([]);
        }

        const song = {
            id: Number(rows[0].id),
            profile_id: Number(rows[0].profile_id),
            title: rows[0].title,
            mp3_url: rows[0].mp3_url,
            image_url: rows[0].image_url,
            plays: Number(rows[0].plays) || 0,
            genre: rows[0].genre,
            profile_name: rows[0].profile_name || 'Unknown',
            profile_slug: rows[0].profile_slug || null,
            likes_count: Number(rows[0].likes_count) || 0,
        };


        return res.json([song]);
    } catch (err) {
        logger.error('Error in GET /music/featured:', err);
        res.status(500).json({ error: 'Failed to fetch featured song' });
    }
});


router.get('/unreviewed', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;

        const rows = await pool.query(`
            WITH RankedSongs AS (
                SELECT s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, s.genre, p.name AS profile_name, p.slug AS profile_slug,
                       (SELECT COUNT(*)
                        FROM playlist_songs ps
                                 JOIN playlists pl ON ps.playlist_id = pl.id
                        WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count,
                       ROW_NUMBER() OVER (PARTITION BY s.profile_id ORDER BY RAND()) AS rn
                FROM songs s
                         LEFT JOIN profiles p ON s.profile_id = p.id
                         LEFT JOIN reviews r ON s.id = r.song_id
                WHERE r.id IS NULL
            )
            SELECT id, title, mp3_url, image_url, plays, profile_id, genre, profile_name, likes_count
            FROM RankedSongs
            WHERE rn = 1
            ORDER BY RAND()
                LIMIT ?
        `, [limit]);

        const songs = rows.map((row) => ({
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            title: row.title,
            mp3_url: row.mp3_url,
            image_url: row.image_url,
            plays: Number(row.plays) || 0,
            genre: row.genre,
            profile_name: row.profile_name || 'Unknown',
            profile_slug: row.profile_slug || null,
            likes_count: Number(row.likes_count) || 0,
        }));

        res.json(songs);
    } catch (err) {
        logger.error('Error in GET /music/unreviewed:', err);
        res.status(500).json({ error: 'Failed to fetch unreviewed songs' });
    }
});

router.get('/search', async (req, res) => {
    try {
        const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const query = `%${term}%`;

        // Tempo and key filters, usable on their own so the browse page can
        // ask "what mixes with this" without any search term at all.
        const bpmMin = parseEditableBpm(req.query.bpmMin);
        const bpmMax = parseEditableBpm(req.query.bpmMax);
        if (!bpmMin.ok || !bpmMax.ok) {
            return res.status(400).json({ error: (bpmMin.ok ? bpmMax : bpmMin).error });
        }
        const hasBpmFilter = bpmMin.value != null || bpmMax.value != null;

        const keyFilter = typeof req.query.key === 'string' && isMusicalKey(req.query.key.trim())
            ? req.query.key.trim()
            : null;
        // Harmonic by default: a track read as the relative of the key you
        // asked for still mixes with it, and detection confuses exactly those
        // two. Exact is available for when you mean one key and only that one.
        const exactKey = req.query.keyMode === 'exact';
        const keySet = keyFilter ? (exactKey ? [keyFilter] : compatibleKeys(keyFilter)) : [];

        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

        if (!term && !hasBpmFilter && !keyFilter) {
            return res.json({ songs: [], profiles: [], missing: { bpm: 0, key: 0 }, matchedKeys: [] });
        }

        // Assembled in pieces because any combination of the three may be absent.
        const termClause = term ? '(s.title LIKE ? OR s.description LIKE ? OR s.genre LIKE ?)' : null;
        const termParams = term ? [query, query, query] : [];

        const bpmClauses = [];
        const bpmParams = [];
        if (bpmMin.value != null) { bpmClauses.push('s.bpm >= ?'); bpmParams.push(bpmMin.value); }
        if (bpmMax.value != null) { bpmClauses.push('s.bpm <= ?'); bpmParams.push(bpmMax.value); }
        const bpmClause = bpmClauses.length ? bpmClauses.join(' AND ') : null;

        // One placeholder per key: the mariadb driver does not expand arrays.
        const keyClause = keySet.length
            ? `s.musical_key IN (${keySet.map(() => '?').join(', ')})`
            : null;
        const keyParams = keySet;

        const where = [termClause, bpmClause, keyClause].filter(Boolean).join(' AND ');
        const params = [...termParams, ...bpmParams, ...keyParams];

        // Search songs
        const songRows = await pool.query(`
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, s.genre,
                   s.bpm, s.musical_key, s.duration,
                   p.name AS profile_name, p.slug AS profile_slug,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE ${where}
            ORDER BY s.plays DESC
                LIMIT ${limit}
        `, params);

        // How many tracks the filter had to leave out because nothing has been
        // detected for them yet. Without this the catalogue looks smaller than
        // it is, and the honest answer is "not analysed", not "no match".
        const countMissing = async (column, otherClause, otherParams) => {
            const clauses = [termClause, otherClause, `s.${column} IS NULL`].filter(Boolean);
            const rows = await pool.query(
                `SELECT COUNT(*) AS count FROM songs s WHERE ${clauses.join(' AND ')}`,
                [...termParams, ...otherParams]
            );
            return Number(rows[0].count) || 0;
        };
        const missing = {
            bpm: hasBpmFilter ? await countMissing('bpm', keyClause, keyParams) : 0,
            key: keyFilter ? await countMissing('musical_key', bpmClause, bpmParams) : 0,
        };

        const songs = songRows.map((row) => ({
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            title: row.title,
            mp3_url: row.mp3_url,
            image_url: row.image_url,
            plays: Number(row.plays) || 0,
            genre: row.genre,
            bpm: row.bpm == null ? null : Number(row.bpm),
            musical_key: row.musical_key || null,
            camelot: row.musical_key ? camelotOf(row.musical_key) : null,
            duration: row.duration == null ? null : Number(row.duration),
            profile_name: row.profile_name || 'Unknown',
            profile_slug: row.profile_slug || null,
            likes_count: Number(row.likes_count) || 0,
        }));

        // Search profiles. Only meaningful for a text term - a profile has no
        // tempo or key of its own to filter on.
        const profileRows = !term ? [] : await pool.query(`
            SELECT p.id, p.user_id, p.name, p.slug, p.genre, p.picture_url, p.created_at,
                   COALESCE(SUM(s.plays), 0) AS total_plays
            FROM profiles p
                     LEFT JOIN songs s ON s.profile_id = p.id
            WHERE p.name LIKE ? OR p.description LIKE ?
            GROUP BY p.id
            ORDER BY total_plays DESC
                LIMIT 20
        `, [query, query]);

        const profiles = profileRows.map((row) => ({
            id: Number(row.id),
            user_id: Number(row.user_id),
            name: row.name || 'Unknown',
            genre: row.genre,
            picture_url: row.picture_url,
            created_at: row.created_at,
            total_plays: Number(row.total_plays) || 0,
        }));

        res.json({
            songs,
            profiles,
            missing,
            // What "compatible" expanded to, so the UI can show its working.
            matchedKeys: keySet,
            camelot: keyFilter ? camelotOf(keyFilter) : null,
        });
    } catch (err) {
        logger.error('Error in GET /music/search:', err);
        res.status(500).json({ error: 'Failed to perform search' });
    }
});

router.get('/by-genre', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT s.genre, s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, p.name AS profile_name, p.slug AS profile_slug,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.genre IS NOT NULL AND s.genre != ''
            ORDER BY s.genre ASC, s.plays DESC
        `);

        // Group songs by genre
        const songsByGenre = rows.reduce((acc, row) => {
            const genre = row.genre || 'Unknown';
            if (!acc[genre]) {
                acc[genre] = [];
            }
            acc[genre].push({
                id: Number(row.id),
                profile_id: Number(row.profile_id),
                title: row.title,
                mp3_url: row.mp3_url,
                image_url: row.image_url,
                plays: Number(row.plays) || 0,
                profile_name: row.profile_name || 'Unknown',
                profile_slug: row.profile_slug || null,
                likes_count: Number(row.likes_count) || 0,
            });
            return acc;
        }, {});

        // Convert to array
        const result = Object.keys(songsByGenre).map((genre) => ({
            genre,
            songs: songsByGenre[genre],
        }));

        res.json(result);
    } catch (err) {
        logger.error('Error in GET /music/by-genre:', err);
        res.status(500).json({ error: 'Failed to fetch songs by genre' });
    }
});

router.get('/by-tags', async (req, res) => {
    try {
        // The Browse page is a genre directory: it needs a name, a count and a
        // few covers per genre, not the whole tagged catalogue. Genres are
        // comma-separated free text in a VARCHAR, so they can't be grouped in
        // SQL — but we only need two tiny columns per row to do it in JS, and
        // dropping the per-row likes subquery and the profiles join removes the
        // expensive part of the old query.
        const THUMBS_PER_TAG = 3;

        const rows = await pool.query(`
            SELECT s.genre, s.image_url
            FROM songs s
            WHERE s.genre IS NOT NULL AND s.genre != ''
            ORDER BY s.plays DESC
        `);

        // Genres are free text, so one genre arrives spelled a dozen ways.
        // normalizeGenre() collapses case, punctuation and connector words (and
        // maps known abbreviations like 'dnb'), while we remember how often each
        // spelling was used so the label shown is the one artists actually type.
        const buckets = {};
        rows.forEach(row => {
            // expandGenreString also rescues run-on strings like
            // "Trance Analog Trance Tech House" into their real genres.
            expandGenreString(row.genre).forEach(({ key: tag, raw: rawTag }) => {
                if (!tag) return;
                const bucket = buckets[tag] || (buckets[tag] = { count: 0, thumbs: [], labels: {} });
                bucket.count += 1;
                bucket.labels[rawTag] = (bucket.labels[rawTag] || 0) + 1;
                // Rows arrive most-played first, so the first covers we see are
                // the genre's best-known tracks.
                if (row.image_url && bucket.thumbs.length < THUMBS_PER_TAG) {
                    bucket.thumbs.push(row.image_url);
                }
            });
        });

        // `tag` stays lowercase so it round-trips through /tag/:tag links;
        // `label` is the most-used spelling, for display.
        const result = Object.keys(buckets)
            .filter(tag => !isLikelyJunkGenre(tag, buckets[tag].count))
            .map(tag => {
                const { count, thumbs, labels } = buckets[tag];
                const label = Object.keys(labels)
                    .sort((a, b) => labels[b] - labels[a] || b.length - a.length || a.localeCompare(b))[0] || tag;
                return { tag, label, count, thumbs };
            })
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

        res.json(result);
    } catch (err) {
        logger.error('Error in GET /music/by-tags:', err);
        res.status(500).json({ error: 'Failed to fetch songs by tag' });
    }
});

// Existing genres, for the upload form's typeahead. Suggesting what artists
// already use is what stops new spelling variants being created; free text is
// still accepted, so a brand-new genre can always be typed.
router.get('/genres', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT s.genre
            FROM songs s
            WHERE s.genre IS NOT NULL AND s.genre != ''
        `);

        const buckets = {};
        rows.forEach(row => {
            expandGenreString(row.genre).forEach(({ key, raw }) => {
                if (!key) return;
                const bucket = buckets[key] || (buckets[key] = { count: 0, labels: {} });
                bucket.count += 1;
                bucket.labels[raw] = (bucket.labels[raw] || 0) + 1;
            });
        });

        const genres = Object.keys(buckets)
            .filter(key => !isLikelyJunkGenre(key, buckets[key].count))
            .map(key => {
                const { count, labels } = buckets[key];
                // Most-used spelling wins. On a tie prefer the longer, more
                // explicit form, so a genre reads 'Drum and Bass' not 'D&B'.
                const label = Object.keys(labels)
                    .sort((a, b) => labels[b] - labels[a] || b.length - a.length || a.localeCompare(b))[0] || key;
                // Ship the typed forms that map here (dnb, d&b, goa...) so the
                // client can match an abbreviation without re-implementing the
                // normaliser and drifting from it.
                const aliases = [...new Set([
                    ...aliasSourcesFor(key),
                    ...Object.keys(labels).map(l => l.toLowerCase()),
                ])];
                return { key, label, count, aliases };
            })
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        res.json(genres);
    } catch (err) {
        logger.error('Error in GET /music/genres:', err);
        res.status(500).json({ error: 'Failed to fetch genres' });
    }
});

// Everything the genre page needs once, as opposed to per page of results:
// headline stats, the spellings that were merged into this genre, the genres it
// is most often tagged alongside, and its most active artists.
router.get('/tag/:tag/overview', async (req, res) => {
    try {
        const wanted = normalizeGenre(req.params.tag);
        if (!wanted) {
            return res.status(404).json({ error: 'Unknown genre' });
        }

        const rows = await pool.query(`
            SELECT s.genre, s.plays, s.created_at, s.profile_id, p.name AS profile_name, p.slug AS profile_slug, p.picture_url
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.genre IS NOT NULL AND s.genre != ''
        `);

        const spellings = {};
        const related = {};
        const artists = {};
        let total = 0;
        let totalPlays = 0;
        let newest = null;

        rows.forEach(row => {
            const keys = expandGenreString(row.genre);
            const hit = keys.find(entry => entry.key === wanted);
            if (!hit) return;

            total += 1;
            totalPlays += Number(row.plays) || 0;
            spellings[hit.raw] = (spellings[hit.raw] || 0) + 1;

            if (row.created_at && (!newest || new Date(row.created_at) > new Date(newest))) {
                newest = row.created_at;
            }

            // Genres tagged on the same song are this genre's neighbours.
            keys.forEach(entry => {
                if (!entry.key || entry.key === wanted) return;
                const neighbour = related[entry.key] || (related[entry.key] = { count: 0, labels: {} });
                neighbour.count += 1;
                neighbour.labels[entry.raw] = (neighbour.labels[entry.raw] || 0) + 1;
            });

            if (row.profile_id) {
                const id = Number(row.profile_id);
                const artist = artists[id] || (artists[id] = {
                    profile_id: id,
                    profile_slug: row.profile_slug || null,
                    name: row.profile_name || 'Unknown',
                    picture_url: row.picture_url || null,
                    tracks: 0,
                    plays: 0,
                });
                artist.tracks += 1;
                artist.plays += Number(row.plays) || 0;
            }
        });

        if (total === 0) {
            return res.json({
                tag: wanted, label: req.params.tag, total: 0, totalPlays: 0,
                artistCount: 0, newest: null, spellings: [], related: [], topArtists: [],
            });
        }

        const bestLabel = (counts) => Object.keys(counts)
            .sort((a, b) => counts[b] - counts[a] || b.length - a.length || a.localeCompare(b))[0];

        res.json({
            tag: wanted,
            label: bestLabel(spellings),
            total,
            totalPlays,
            artistCount: Object.keys(artists).length,
            newest,
            // Only worth showing when the genre actually arrived spelled several ways.
            spellings: Object.keys(spellings).sort((a, b) => spellings[b] - spellings[a]),
            related: Object.keys(related)
                .map(key => ({ tag: key, label: bestLabel(related[key].labels), count: related[key].count }))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
                .slice(0, 8),
            topArtists: Object.values(artists)
                .sort((a, b) => b.tracks - a.tracks || b.plays - a.plays)
                .slice(0, 5),
        });
    } catch (err) {
        logger.error(`Error in GET /music/tag/${req.params.tag}/overview:`, err);
        res.status(500).json({ error: 'Failed to fetch genre overview' });
    }
});

router.get('/by-tag/:tag', async (req, res) => {
    try {
        const { tag } = req.params;
        const { limit = 20, offset = 0, sort = 'random' } = req.query;

        const limitNum = parseInt(limit) || 20;
        const offsetNum = parseInt(offset) || 0;

        let orderBy;
        switch (sort) {
            case 'alpha':
                orderBy = 's.title ASC';
                break;
            case 'listens':
                orderBy = 's.plays DESC';
                break;
            case 'likes':
                orderBy = 'likes_count DESC, s.id ASC';
                break;
            case 'deep':
                // Deep cuts: tracks hardly anyone has heard that the few who did
                // liked. A smoothed like-to-play ratio, so a brand-new upload
                // with no history doesn't automatically beat a loved rarity.
                orderBy = '((likes_count + 1) / (s.plays + 10)) DESC, s.plays ASC, s.id DESC';
                break;
            case 'random':
            default:
                orderBy = 'RAND()';
                break;
        }

        // Matching has to normalise both sides: a link to "drum bass" must find
        // songs stored as "Drum 'n' Bass" or "DnB", which no SQL LIKE can do.
        // Step one is a cheap two-column scan to work out which songs match.
        const wanted = normalizeGenre(tag);
        if (!wanted) {
            return res.json({ songs: [] });
        }

        const candidates = await pool.query(`
            SELECT s.id, s.genre
            FROM songs s
            WHERE s.genre IS NOT NULL AND s.genre != ''
        `);

        const matchingIds = candidates
            .filter(row => expandGenreString(row.genre).some(entry => entry.key === wanted))
            .map(row => Number(row.id));

        if (matchingIds.length === 0) {
            return res.json({ songs: [] });
        }

        // Step two fetches the full records for just those songs, leaving the
        // sorting and pagination in SQL where they belong.
        const placeholders = matchingIds.map(() => '?').join(',');
        const query = `
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, p.name AS profile_name, p.slug AS profile_slug,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.id IN (${placeholders})
            ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
        `;

        const rows = await pool.query(query, [...matchingIds, limitNum, offsetNum]);

        const songs = rows.map(row => ({
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            title: row.title,
            mp3_url: row.mp3_url,
            image_url: row.image_url,
            plays: Number(row.plays) || 0,
            profile_name: row.profile_name || 'Unknown',
            profile_slug: row.profile_slug || null,
            likes_count: Number(row.likes_count) || 0,
        }));

        res.json({ songs, total: matchingIds.length });
    } catch (err) {
        logger.error(`Error in GET /music/by-tag/${req.params.tag}:`, err);
        res.status(500).json({ error: 'Failed to fetch songs by tag' });
    }
});

router.delete('/:songId', authenticate, async (req, res) => {
    const songId = parseInt(req.params.songId);
    const userId = req.user.id;

    try {
        const songResult = await pool.query(
            'SELECT mp3_url, image_url, profile_id FROM songs WHERE id = ?',
            [songId]
        );

        if (!songResult || !Array.isArray(songResult) || songResult.length === 0) {
            logger.debug('Song not found for songId:', songId);
            return res.status(404).json({ error: 'Song not found' });
        }

        const song = songResult[0];
        const profileResult = await pool.query('SELECT user_id FROM profiles WHERE id = ?', [song.profile_id]);
        if (!profileResult || profileResult.length === 0 || Number(profileResult[0].user_id) !== Number(userId)) {
            logger.debug('Unauthorized: profile_id', song.profile_id, 'userId', userId);
            return res.status(403).json({ error: 'Unauthorized to delete this song' });
        }

        await pool.query('START TRANSACTION');

        // Delete dependent records
        await pool.query('DELETE FROM song_plays WHERE song_id = ?', [songId]);
        await pool.query('DELETE FROM reviews WHERE song_id = ?', [songId]);
        await pool.query('DELETE FROM songs WHERE id = ?', [songId]);

        const deleteS3File = async (url) => {
            if (url) {
                const key = extractObjectKey(url);
                logger.debug('Deleting S3 file:', key);
                const command = new DeleteObjectCommand({
                    Bucket: process.env.BUCKET_NAME,
                    Key: key,
                });
                await s3Client.send(command);
            }
        };

        await Promise.all([
            deleteS3File(song.mp3_url),
            deleteS3File(song.image_url),
        ]);

        await pool.query('COMMIT');
        res.status(204).send();
    } catch (error) {
        await pool.query('ROLLBACK').catch(rollbackError => {
            logger.error('Rollback failed:', rollbackError);
        });
        logger.error('Error deleting song:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/upload', authenticate, async (req, res) => {
    const { title, description, genre, stems_url } = req.body;
    const mp3 = req.files?.mp3;
    const image = req.files?.image;

    try {
        // Validate required fields
        if (!title) {
            return res.status(400).json({ error: 'Song title is required' });
        }
        if (!mp3) {
            return res.status(400).json({ error: 'MP3 file is required' });
        }
        if (stems_url && !/^(https?:\/\/)/i.test(stems_url)) {
            return res.status(400).json({ error: 'Invalid stems URL format' });
        }

        // Validate file types
        if (mp3.mimetype !== 'audio/mpeg') {
            return res.status(400).json({ error: 'Invalid MP3 file format' });
        }
        if (image && !['image/jpeg', 'image/png'].includes(image.mimetype)) {
            return res.status(400).json({ error: 'Invalid image format. Only JPEG and PNG are supported' });
        }

        // Fetch profile
        const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [req.user.id]);
        if (!profiles || profiles.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        const profileId = Number(profiles[0].id);

        // Upload MP3 to S3
        const mp3UploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: `music/${req.user.id}-${Date.now()}.mp3`,
            Body: mp3.data,
            ContentType: 'audio/mpeg',
        };
        await s3Client.send(new PutObjectCommand(mp3UploadParams));
        const mp3Url = buildPublicFileUrl(mp3UploadParams.Key);

        // Upload image to S3 (if provided)
        let imageUrl = null;
        if (image) {
            const imageExtension = image.mimetype === 'image/png' ? '.png' : '.jpg';
            const imageUploadParams = {
                Bucket: process.env.BUCKET_NAME,
                Key: `song-images/${req.user.id}-${Date.now()}${imageExtension}`,
                Body: image.data,
                ContentType: image.mimetype,
            };
            await s3Client.send(new PutObjectCommand(imageUploadParams));
            imageUrl = buildPublicFileUrl(imageUploadParams.Key);
        }

        // Insert song
        const result = await pool.query(
            'INSERT INTO songs (profile_id, title, mp3_url, image_url, description, genre, stems_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [profileId, title, mp3Url, imageUrl, description || '', genre || '', stems_url || null]
        );
        const songId = Number(result.insertId);

        // Detect tempo and key in the background. The row stays 'pending' if
        // this fails, which is what the backfill sweep looks for, so a Redis
        // blip delays the reading rather than losing it.
        if (await enqueueSongAnalysis(songId)) {
            await pool.query(
                "UPDATE songs SET analysis_status = 'queued' WHERE id = ?",
                [songId]
            ).catch(() => {});
        }

        // Response
        const song = {
            id: songId,
            profile_id: profileId,
            title,
            mp3_url: mp3Url,
            image_url: imageUrl,
            description: description || '',
            genre: genre || '',
            stems_url: stems_url || null,
            plays: 0,
            likes_count: 0,
        };

        try {
            const followers = await pool.query(
                `
                    SELECT DISTINCT f.follower_id
                    FROM follows f
                    JOIN profiles p ON f.followed_profile_id = p.id
                    WHERE p.user_id = ?
                `,
                [req.user.id]
            );

            for (const follower of followers || []) {
                await createNotification({
                    recipientUserId: Number(follower.follower_id),
                    actorUserId: req.user.id,
                    type: NOTIFICATION_TYPES.ARTIST_SONG_UPLOADED,
                    message: 'An artist you follow uploaded a new song.',
                    entityType: 'song',
                    entityId: Number(result.insertId),
                    metadata: {
                        song_title: title,
                        profile_id: profileId,
                    },
                });
            }
        } catch (notificationErr) {
            logger.warn('Failed to send artist activity notifications:', notificationErr.message);
        }

        res.status(200).json({ song });
    } catch (err) {
        logger.error('Error in POST /music/upload:', err);
        res.status(500).json({ error: 'Failed to upload song. Please try again later.' });
    }
});

router.get('/most-played', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT ranked.*
            FROM (
                     SELECT
                         s.*,
                         p.name AS profile_name, p.slug AS profile_slug,
                         ROW_NUMBER() OVER (
                        PARTITION BY s.profile_id 
                        ORDER BY s.plays DESC, s.id DESC
                    ) AS rn,
                             (
                                 SELECT COUNT(*)
                                 FROM playlist_songs ps
                                          JOIN playlists pl ON ps.playlist_id = pl.id
                                 WHERE pl.name = 'Likes' AND ps.song_id = s.id
                             ) AS likes_count
                     FROM songs s
                              LEFT JOIN profiles p ON s.profile_id = p.id
                     WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 270 DAY)
                 ) ranked
            WHERE rn = 1
            ORDER BY ranked.plays DESC
                LIMIT 10
        `);

        const sanitizedRows = rows.map((row) => {
            const safeRow = Object.fromEntries(
                Object.entries(row).map(([k, v]) => [
                    k,
                    typeof v === 'bigint' ? Number(v) : v
                ])
            );

            delete safeRow.rn;

            return {
                ...safeRow,
                id: Number(safeRow.id),
                profile_id: Number(safeRow.profile_id),
                plays: Number(safeRow.plays) || 0,
                profile_name: safeRow.profile_name || 'Unknown',
                profile_slug: safeRow.profile_slug || null,
                likes_count: Number(safeRow.likes_count) || 0,
            };
        });

        res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
    } catch (err) {
        logger.error('Error in GET /music/most-played:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/highest-rated', async (req, res) => {
    const startedAt = Date.now();
    try {
        const rows = await pool.query(`
            SELECT
                s.*,
                p.name AS profile_name, p.slug AS profile_slug,
                COALESCE(l.likes_count, 0) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
                     LEFT JOIN (
                SELECT
                    ps.song_id,
                    COUNT(*) AS likes_count
                FROM playlist_songs ps
                         INNER JOIN playlists pl ON pl.id = ps.playlist_id
                WHERE pl.name = 'Likes'
                GROUP BY ps.song_id
            ) l ON l.song_id = s.id
            ORDER BY likes_count DESC, s.plays DESC
                LIMIT 10
        `);

        const sanitizedRows = rows.map((row) => ({
            ...row,
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            plays: Number(row.plays) || 0,
            profile_name: row.profile_name || 'Unknown',
            profile_slug: row.profile_slug || null,
            likes_count: Number(row.likes_count) || 0,
        }));

        logger.info(`GET /music/highest-rated completed in ${Date.now() - startedAt}ms`);
        res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
    } catch (err) {
        logger.error('Error in GET /music/highest-rated:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/latest', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT ranked.*
            FROM (
                     SELECT
                         s.*,
                         p.name AS profile_name, p.slug AS profile_slug,
                         ROW_NUMBER() OVER (PARTITION BY s.profile_id ORDER BY s.created_at DESC) AS row_num,
                             (
                                 SELECT COUNT(*)
                                 FROM playlist_songs ps
                                          JOIN playlists pl ON ps.playlist_id = pl.id
                                 WHERE pl.name = 'Likes' AND ps.song_id = s.id
                             ) AS likes_count
                     FROM songs s
                              LEFT JOIN profiles p ON s.profile_id = p.id
                 ) ranked
            WHERE row_num <= 2
            ORDER BY ranked.created_at DESC
                LIMIT 10
        `);

        const sanitizedRows = rows.map((row) => {
            // Convert ALL BigInt values to Number
            const safeRow = Object.fromEntries(
                Object.entries(row).map(([key, value]) => [
                    key,
                    typeof value === 'bigint' ? Number(value) : value
                ])
            );

            // Remove helper column
            delete safeRow.row_num;

            return {
                ...safeRow,
                id: Number(safeRow.id),
                profile_id: Number(safeRow.profile_id),
                plays: Number(safeRow.plays) || 0,
                profile_name: safeRow.profile_name || 'Unknown',
                profile_slug: safeRow.profile_slug || null,
                likes_count: Number(safeRow.likes_count) || 0,
            };
        });

        res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
    } catch (err) {
        logger.error('Error in GET /music/latest:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/this-month', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT s.*, p.name AS profile_name, p.slug AS profile_slug,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)
            ORDER BY s.created_at DESC
        `);
        const sanitizedRows = rows.map((row) => ({
            ...row,
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            plays: Number(row.plays) || 0,
            genre: row.genre || 'Unknown',
            profile_name: row.profile_name || 'Unknown',
            profile_slug: row.profile_slug || null,
            likes_count: Number(row.likes_count) || 0,
        }));
        res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
    } catch (err) {
        logger.error('Error in GET /music/this-month:', err);
        res.status(500).json({ error: 'Failed to fetch recently uploaded songs' });
    }
});

router.get('/:songId', async (req, res) => {
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }
        const songs = await pool.query(`
            SELECT s.*, p.name as profile_name, p.slug as profile_slug, p.background, p.user_id,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.id = ?
        `, [songId]);
        if (!songs || songs.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }
        const song = {
            ...songs[0],
            id: Number(songs[0].id),
            profile_id: Number(songs[0].profile_id),
            user_id: Number(songs[0].user_id),
            plays: Number(songs[0].plays) || 0,
            profile_name: songs[0].profile_name || 'Unknown Artist',
            profile_slug: songs[0].profile_slug || null,
            background: songs[0].background || null,
            likes_count: Number(songs[0].likes_count) || 0,
            allow_download: Boolean(songs[0].allow_download),
        };
        res.json({ song });
    } catch (err) {
        logger.error('Error in GET /music/:songId:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/:songId', authenticate, async (req, res) => {
    const { title, description, genre, stems_url, allow_download } = req.body;
    const mp3 = req.files?.mp3;
    const image = req.files?.image;
    try {
        // Artist corrections to the detected tempo and key. Undefined means
        // "not part of this edit", null means "clear it".
        const bpmField = parseEditableBpm(req.body.bpm);
        if (!bpmField.ok) {
            return res.status(400).json({ error: bpmField.error });
        }
        const keyField = parseEditableKey(req.body.musical_key);
        if (!keyField.ok) {
            return res.status(400).json({ error: keyField.error });
        }

        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        const songs = await pool.query(`
            SELECT s.id, s.profile_id, s.mp3_url, s.image_url, s.stems_url, s.allow_download
            FROM songs s
                     JOIN profiles p ON s.profile_id = p.id
            WHERE s.id = ?
        `, [songId]);
        if (!songs || songs.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const profileResult = await pool.query('SELECT user_id FROM profiles WHERE id = ?', [songs[0].profile_id]);
        if (!profileResult || profileResult.length === 0 || Number(profileResult[0].user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to edit this song' });
        }

        // Validate stems_url
        if (stems_url && !/^(https?:\/\/)/i.test(stems_url)) {
            return res.status(400).json({ error: 'Invalid stems URL format' });
        }

        let mp3Url = songs[0].mp3_url;
        if (mp3) {
            if (songs[0].mp3_url) {
                const oldKey = extractObjectKey(songs[0].mp3_url);
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.BUCKET_NAME,
                    Key: oldKey,
                }));
            }
            const mp3UploadParams = {
                Bucket: process.env.BUCKET_NAME,
                Key: `music/${req.user.id}-${Date.now()}.mp3`,
                Body: mp3.data,
            };
            await s3Client.send(new PutObjectCommand(mp3UploadParams));
            mp3Url = buildPublicFileUrl(mp3UploadParams.Key);
            await pool.query('UPDATE songs SET peaks = NULL WHERE id = ?', [songId]);
        }

        let imageUrl = songs[0].image_url;
        if (image) {
            if (songs[0].image_url) {
                const oldKey = extractObjectKey(songs[0].image_url);
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.BUCKET_NAME,
                    Key: oldKey,
                }));
            }
            const imageUploadParams = {
                Bucket: process.env.BUCKET_NAME,
                Key: `song-images/${req.user.id}-${Date.now()}.jpg`,
                Body: image.data,
            };
            await s3Client.send(new PutObjectCommand(imageUploadParams));
            imageUrl = buildPublicFileUrl(imageUploadParams.Key);
        }

        await pool.query(`
            UPDATE songs
            SET title = ?, description = ?, genre = ?, mp3_url = ?, image_url = ?, stems_url = ?, allow_download = ?
            WHERE id = ?
        `, [
            title || songs[0].title,
            description || '',
            genre || '',
            mp3Url,
            imageUrl,
            stems_url !== undefined ? stems_url : songs[0].stems_url,
            allow_download !== undefined ? parseBooleanFlag(allow_download) : Boolean(songs[0].allow_download),
            songId
        ]);

        if (mp3) {
            // New audio: the stored tempo, key and duration describe a file
            // that is no longer there. Clear them and re-detect rather than
            // leaving a confident reading of the wrong track. Any bpm/key sent
            // in this same request is ignored on purpose - the edit form
            // disables those inputs once a replacement file is chosen.
            await pool.query(
                `UPDATE songs
                 SET bpm = NULL, musical_key = NULL, duration = NULL,
                     analysis_status = 'pending'
                 WHERE id = ?`,
                [songId]
            );
            if (await enqueueSongAnalysis(songId)) {
                await pool.query(
                    "UPDATE songs SET analysis_status = 'queued' WHERE id = ?",
                    [songId]
                ).catch(() => {});
            }
        } else if (bpmField.value !== undefined || keyField.value !== undefined) {
            const fields = [];
            const values = [];
            if (bpmField.value !== undefined) {
                fields.push('bpm = ?');
                values.push(bpmField.value);
            }
            if (keyField.value !== undefined) {
                fields.push('musical_key = ?');
                values.push(keyField.value);
            }
            // Mark it settled so a later backfill sweep, which looks for
            // 'pending' and 'failed', cannot overwrite the artist's own answer.
            fields.push("analysis_status = 'done'");
            values.push(songId);
            await pool.query(`UPDATE songs SET ${fields.join(', ')} WHERE id = ?`, values);
        }

        const updatedSongs = await pool.query('SELECT * FROM songs WHERE id = ?', [songId]);
        const song = {
            ...updatedSongs[0],
            id: Number(updatedSongs[0].id),
            profile_id: Number(updatedSongs[0].profile_id),
            plays: Number(updatedSongs[0].plays) || 0,
            stems_url: updatedSongs[0].stems_url,
            allow_download: Boolean(updatedSongs[0].allow_download),
            likes_count: 0,
        };

        res.status(200).json({ song });
    } catch (err) {
        logger.error('Error in PUT /music/:songId:', err);
        res.status(500).json({ error: err.message });
    }
});

// Toggle public downloads for a single song (owner only)
router.patch('/:songId/allow-download', authenticate, async (req, res) => {
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        const { allow_download } = req.body;
        if (allow_download === undefined) {
            return res.status(400).json({ error: 'allow_download is required' });
        }
        const allowDownload = parseBooleanFlag(allow_download);

        const songs = await pool.query('SELECT id, profile_id FROM songs WHERE id = ?', [songId]);
        if (!songs || songs.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const profileResult = await pool.query('SELECT user_id FROM profiles WHERE id = ?', [songs[0].profile_id]);
        if (!profileResult || profileResult.length === 0 || Number(profileResult[0].user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to edit this song' });
        }

        await pool.query('UPDATE songs SET allow_download = ? WHERE id = ?', [allowDownload, songId]);

        res.status(200).json({ id: songId, allow_download: allowDownload });
    } catch (err) {
        logger.error('Error in PATCH /music/:songId/allow-download:', err);
        res.status(500).json({ error: err.message });
    }
});

// Public download of a song, only when the owner has enabled it
router.get('/:songId/download', async (req, res) => {
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        const songs = await pool.query('SELECT id, title, mp3_url, allow_download FROM songs WHERE id = ?', [songId]);
        if (!songs || songs.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const song = songs[0];
        if (!song.allow_download) {
            return res.status(403).json({ error: 'Downloads are not enabled for this song' });
        }
        if (!song.mp3_url) {
            return res.status(404).json({ error: 'Song file not found' });
        }

        const s3Key = extractObjectKey(song.mp3_url);
        if (!s3Key) {
            return res.status(400).json({ error: 'Invalid S3 URL format' });
        }

        const { Body, ContentLength } = await s3Client.send(new GetObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: s3Key,
        }));

        const filename = buildDownloadFilename(song.title);
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        });
        if (ContentLength) {
            res.set('Content-Length', String(ContentLength));
        }

        Body.on('error', (streamErr) => {
            logger.error('Error streaming download for song:', { songId, message: streamErr.message });
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to download song' });
            } else {
                res.destroy(streamErr);
            }
        });
        Body.pipe(res);
    } catch (err) {
        logger.error('Error in GET /music/:songId/download:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/peaks/:songId', async (req, res) => {
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }
        const rows = await pool.query('SELECT peaks FROM songs WHERE id = ?', [songId]);
        res.json({ peaks: rows.length > 0 ? rows[0].peaks : null });
    } catch (err) {
        logger.error('Error in GET /music/peaks/:songId:', err);
        res.status(500).json({ error: 'Failed to fetch peaks' });
    }
});

router.post('/peaks/:songId', async (req, res) => {
    const { songId } = req.params;
    const { peaks } = req.body;

    try {
        const parsedSongId = parseInt(songId, 10);
        if (isNaN(parsedSongId)) {
            logger.debug('Invalid song ID:', songId);
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        if (!peaks || typeof peaks !== 'string') {
            logger.debug('Invalid peaks data:', peaks);
            return res.status(400).json({ error: 'Valid peaks data is required' });
        }

        const songs = await pool.query('SELECT id, peaks FROM songs WHERE id = ?', [parsedSongId]);

        if (!songs || songs.length === 0) {
            logger.debug(`Song ID ${parsedSongId} not found`);
            return res.status(404).json({ error: 'Song not found' });
        }

        if (songs[0].peaks) {
            return res.status(200).json({ success: true, skipped: true, reason: 'Peaks already exist' });
        }

        const updateResult = await pool.query(
            'UPDATE songs SET peaks = ? WHERE id = ? AND (peaks IS NULL OR peaks = \'\')',
            [peaks, parsedSongId]
        );

        if (updateResult.affectedRows === 0) {
            return res.status(200).json({ success: true, skipped: true, reason: 'Peaks already saved by another client' });
        }

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error('Error in POST /music/peaks/:songId:', { message: err.message, stack: err.stack });
        res.status(500).json({ error: 'Failed to save peaks' });
    }
});

router.post('/play/:songId', async (req, res) => {
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        const ipAddress = getClientIp(req);

        const songs = await pool.query('SELECT id FROM songs WHERE id = ?', [songId]);
        if (!songs || songs.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const timeWindow = '24 HOUR';
        const recentPlays = await pool.query(
            'SELECT id FROM song_plays WHERE song_id = ? AND ip_address = ? AND played_at >= NOW() - INTERVAL ' + timeWindow,
            [songId, ipAddress]
        );

        if (recentPlays && recentPlays.length > 0) {
            return res.status(429).json({ error: 'Play already counted for this IP' });
        }

        const rateLimitWindow = '10 SECOND';
        const recentAttempts = await pool.query(
            'SELECT id FROM song_plays WHERE ip_address = ? AND played_at >= NOW() - INTERVAL ' + rateLimitWindow,
            [ipAddress]
        );

        if (recentAttempts && recentAttempts.length > 0) {
            return res.status(429).json({ error: 'Too many play attempts, please try again later' });
        }

        await pool.query(
            'INSERT INTO song_plays (song_id, ip_address) VALUES (?, ?)',
            [songId, ipAddress]
        );

        await pool.query('UPDATE songs SET plays = plays + 1 WHERE id = ?', [songId]);

        res.json({ success: true });
    } catch (err) {
        logger.error('Error in POST /music/play/:songId:', err);
        res.status(500).json({ error: 'Failed to record play' });
    }
});

// Static ffmpeg chains. These are presets, not analysis of the source, so the
// three levels differ only in how hard they push the same three stages.
const MASTERING_PARAMS = {
    light: {
        equalizer: ['bass=f=100:g=2', 'treble=f=8000:g=1'],
        compressor: 'acompressor=threshold=-10dB:ratio=2:attack=0.3:release=0.8',
        volume: 'volume=2dB',
    },
    middle: {
        equalizer: ['bass=f=100:g=3', 'treble=f=8000:g=2'],
        compressor: 'acompressor=threshold=-20dB:ratio=3:attack=0.3:release=0.8',
        volume: 'volume=3dB',
    },
    heavy: {
        equalizer: ['bass=f=100:g=4', 'treble=f=8000:g=3'],
        compressor: 'acompressor=threshold=-30dB:ratio=4:attack=0.3:release=0.8',
        volume: 'volume=4dB',
    },
};

// Returns the mastered audio as bytes rather than persisting it. Previews used
// to be written to the bucket on every run, which orphaned an object for every
// intensity the user auditioned and discarded. The client holds the result as a
// blob and only POSTs it to /music/upload if the user decides to keep it.
router.post('/master/:songId', authenticate, async (req, res) => {
    const { songId } = req.params;
    const { masteringType } = req.body;
    const userId = req.user.id;
    const CONCURRENCY_LIMIT = parseInt(process.env.FFMPEG_CONCURRENCY_LIMIT, 10) || 1;

    // Only the paths below that actually incremented the counter may decrement
    // it. The previous version decremented in a finally that every early return
    // also passed through, so a handful of rejected requests drove the count
    // negative and the concurrency limit stopped applying at all.
    let jobStarted = false;
    let inputFile = null;
    let outputFile = null;

    try {
        if (getRunningJobs() >= CONCURRENCY_LIMIT) {
            logger.debug(`Concurrency limit (${CONCURRENCY_LIMIT}) reached, rejecting job for song ID: ${songId}`);
            return res.status(429).json({ error: 'Too many mastering jobs running. Please try again later.' });
        }

        if (!MASTERING_PARAMS[masteringType]) {
            return res.status(400).json({ error: 'Invalid mastering type' });
        }

        const parsedSongId = parseInt(songId, 10);
        if (isNaN(parsedSongId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        logger.debug(`Processing mastering job for song ID: ${parsedSongId}, user ID: ${userId}`);

        // Ownership is enforced here, not just in the UI. Hiding the button for
        // non-owners left the endpoint open to mastering any song by id.
        const songs = await pool.query(`
            SELECT s.mp3_url, p.user_id
            FROM songs s
                     JOIN profiles p ON s.profile_id = p.id
            WHERE s.id = ?
        `, [parsedSongId]);
        if (!songs.length) {
            return res.status(404).json({ error: 'Song not found' });
        }
        if (Number(songs[0].user_id) !== Number(userId)) {
            logger.debug(`Unauthorized mastering attempt on song ${parsedSongId} by user ${userId}`);
            return res.status(403).json({ error: 'Unauthorized to master this song' });
        }

        const s3Key = extractObjectKey(songs[0].mp3_url);
        if (!s3Key) {
            return res.status(400).json({ error: 'Invalid S3 URL format' });
        }

        incrementRunningJobs();
        jobStarted = true;
        logger.debug(`Starting FFmpeg job, running jobs: ${getRunningJobs()}`);

        const getObjectCommand = new GetObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: s3Key,
        });
        const { Body } = await s3Client.send(getObjectCommand);

        // discardDescriptor keeps tmp from holding an fd open for the whole job;
        // both files are opened by name below.
        inputFile = tmp.fileSync({ postfix: '.mp3', discardDescriptor: true });
        outputFile = tmp.fileSync({ postfix: '.mp3', discardDescriptor: true });

        const inputStream = fs.createWriteStream(inputFile.name);
        await new Promise((resolve, reject) => {
            Body.pipe(inputStream)
                .on('finish', resolve)
                .on('error', reject);
        });

        await new Promise((resolve, reject) => {
            const filters = [
                ...MASTERING_PARAMS[masteringType].equalizer,
                MASTERING_PARAMS[masteringType].compressor,
                MASTERING_PARAMS[masteringType].volume,
            ];
            logger.debug(`FFmpeg filters for song ID ${parsedSongId}:`, filters);
            ffmpeg(inputFile.name)
                .audioFilters(filters)
                .output(outputFile.name)
                .on('end', () => {
                    logger.debug(`FFmpeg processing completed for song ID ${parsedSongId}`);
                    resolve();
                })
                .on('error', (err) => {
                    logger.error(`FFmpeg error for song ID ${parsedSongId}:`, err);
                    reject(err);
                })
                .run();
        });

        const mastered = fs.readFileSync(outputFile.name);

        logger.debug(`Mastering job completed for song ID: ${parsedSongId}`);
        res.set('Content-Type', 'audio/mpeg');
        res.set('Content-Length', String(mastered.length));
        res.status(200).send(mastered);
    } catch (err) {
        logger.error('Error in POST /music/master:', err);
        res.status(500).json({ error: 'Failed to master audio' });
    } finally {
        // Previously only the success path cleaned these up, so an ffmpeg
        // failure left both tmp files on disk.
        for (const file of [inputFile, outputFile]) {
            if (!file) continue;
            try {
                file.removeCallback();
            } catch (cleanupErr) {
                logger.error('Failed to remove mastering tmp file:', cleanupErr);
            }
        }
        if (jobStarted) {
            decrementRunningJobs();
            logger.debug(`Finished FFmpeg job, running jobs: ${getRunningJobs()}`);
        }
    }
});

/* ------------------------------------------------------------------------- *
 * Analyzed auto-mastering.
 *
 * The three presets above are a fixed chain and finish fast enough to answer
 * on the request. This path measures the track first and decides its own
 * settings, which is two or three full ffmpeg passes - far too long to hold a
 * connection open, so it goes through the queue and the client polls.
 * ------------------------------------------------------------------------- */

// Reuses the ownership shape the rest of this file uses: songs join profiles,
// and the profile's user_id is the owner.
const loadOwnedSong = async (songId, userId) => {
    const parsedSongId = parseInt(songId, 10);
    if (isNaN(parsedSongId)) return { error: { status: 400, message: 'Invalid song ID' } };

    const songs = await pool.query(`
        SELECT s.id, s.mp3_url, s.title, s.genre, p.user_id
        FROM songs s
                 JOIN profiles p ON s.profile_id = p.id
        WHERE s.id = ?
    `, [parsedSongId]);

    if (!songs.length) return { error: { status: 404, message: 'Song not found' } };
    if (Number(songs[0].user_id) !== Number(userId)) {
        return { error: { status: 403, message: 'Unauthorized to master this song' } };
    }
    return { song: songs[0], songId: parsedSongId };
};

const serializeJob = async (row) => {
    const job = {
        id: row.id,
        songId: row.song_id,
        status: row.status,
        resultUrl: row.result_url || null,
        error: row.error || null,
        createdAt: row.created_at,
    };

    if (row.analysis) {
        try { job.analysis = JSON.parse(row.analysis); } catch (err) { job.analysis = null; }
    }
    if (row.plan) {
        try { job.plan = JSON.parse(row.plan); } catch (err) { job.plan = null; }
    }

    if (ACTIVE_STATUSES.includes(row.status)) {
        Object.assign(job, await estimateWait(pool, row));
    }

    return job;
};

router.post('/master/analyze/:songId', authenticate, async (req, res) => {
    const userId = req.user.id;

    try {
        const { song, songId, error } = await loadOwnedSong(req.params.songId, userId);
        if (error) return res.status(error.status).json({ error: error.message });

        // One job per song at a time. Without this, impatient double-clicks
        // put the same track through the queue twice and the second render
        // wins for no reason.
        const existing = await pool.query(
            `SELECT * FROM mastering_jobs
             WHERE song_id = ? AND user_id = ? AND status IN (?, ?, ?)
             ORDER BY created_at DESC LIMIT 1`,
            [songId, userId, ...ACTIVE_STATUSES]
        );
        if (existing.length) {
            return res.status(200).json({ job: await serializeJob(existing[0]), reused: true });
        }

        const jobId = randomUUID();
        await pool.query(
            'INSERT INTO mastering_jobs (id, song_id, user_id, status) VALUES (?, ?, ?, ?)',
            [jobId, songId, userId, 'queued']
        );

        await getQueue().add('master-song', { jobId, songId, userId });
        logger.info('Queued analyzed mastering job', { jobId, songId, userId });

        const rows = await pool.query('SELECT * FROM mastering_jobs WHERE id = ?', [jobId]);
        res.status(202).json({ job: await serializeJob(rows[0]) });
    } catch (err) {
        logger.error('Error in POST /music/master/analyze:', err);
        res.status(500).json({ error: 'Failed to queue mastering job' });
    }
});

router.get('/master/job/:jobId', authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            'SELECT * FROM mastering_jobs WHERE id = ? AND user_id = ?',
            [req.params.jobId, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Mastering job not found' });
        res.json({ job: await serializeJob(rows[0]) });
    } catch (err) {
        logger.error('Error in GET /music/master/job:', err);
        res.status(500).json({ error: 'Failed to fetch mastering job' });
    }
});

// Lets the artist abandon a queued job rather than leaving it to occupy the
// single worker slot ahead of everyone else.
router.delete('/master/job/:jobId', authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            'SELECT * FROM mastering_jobs WHERE id = ? AND user_id = ?',
            [req.params.jobId, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Mastering job not found' });
        if (!ACTIVE_STATUSES.includes(rows[0].status)) {
            return res.status(409).json({ error: 'This job has already finished' });
        }

        await pool.query(
            `UPDATE mastering_jobs SET status = 'failed', error = 'Cancelled', finished_at = NOW()
             WHERE id = ?`,
            [req.params.jobId]
        );
        res.json({ cancelled: true });
    } catch (err) {
        logger.error('Error in DELETE /music/master/job:', err);
        res.status(500).json({ error: 'Failed to cancel mastering job' });
    }
});

module.exports = router;