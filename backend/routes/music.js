const express = require('express');
const pool = require('../config/database');
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const logger = require('../utils/logger');
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

const { getRunningJobs, incrementRunningJobs, decrementRunningJobs } = require('../utils/concurrency');

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
            SELECT s.*, p.name AS profile_name,
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
            likes_count: Number(row.likes_count) || 0,
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

    try {
        // Fetch the current song's genre and profile_id
        const songRows = await pool.query('SELECT genre, profile_id FROM songs WHERE id = ?', [songId]);
        if (!songRows || songRows.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const { genre, profile_id } = songRows[0];
        const tags = genre ? genre.split(',').map(t => t.trim()).filter(Boolean) : [];

        if (tags.length === 0) {
            // No genres – fall back to most-played songs by other artists
            const fallback = await pool.query(`
                SELECT s.id, s.title, s.image_url, s.plays, s.genre, s.profile_id,
                       p.name AS profile_name,
                       (SELECT COUNT(*) FROM playlist_songs ps JOIN playlists pl ON ps.playlist_id = pl.id
                        WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
                FROM songs s
                LEFT JOIN profiles p ON s.profile_id = p.id
                WHERE s.id != ? AND s.profile_id != ?
                ORDER BY s.plays DESC
                LIMIT 6
            `, [songId, profile_id]);

            return res.json({ songs: fallback.map(r => ({ ...r, id: Number(r.id), profile_id: Number(r.profile_id), plays: Number(r.plays) || 0, likes_count: Number(r.likes_count) || 0 })) });
        }

        // Build a LIKE condition per tag so partial genre strings still match
        const likeConditions = tags.map(() => 's.genre LIKE ?').join(' OR ');
        const likeParams = tags.map(t => `%${t}%`);

        const rows = await pool.query(`
            SELECT s.id, s.title, s.image_url, s.plays, s.genre, s.profile_id,
                   p.name AS profile_name,
                   (SELECT COUNT(*) FROM playlist_songs ps JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.id != ?
              AND s.profile_id != ?
              AND (${likeConditions})
            ORDER BY s.plays DESC, likes_count DESC
            LIMIT 8
        `, [songId, profile_id, ...likeParams]);

        res.json({
            songs: rows.map(r => ({
                id: Number(r.id),
                title: r.title,
                image_url: r.image_url,
                plays: Number(r.plays) || 0,
                genre: r.genre,
                profile_id: Number(r.profile_id),
                profile_name: r.profile_name || 'Unknown',
                likes_count: Number(r.likes_count) || 0,
            }))
        });
    } catch (err) {
        logger.error('Error in GET /music/:songId/similar:', err);
        res.status(500).json({ error: 'Failed to fetch similar songs' });
    }
});

// GET /music/:songId/activity – public activity feed for a song
router.get('/:songId/activity', async (req, res) => {
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

        // 2. Added to any non-Likes playlist
        const playlistAdds = await pool.query(`
            SELECT
                'playlist_add'  AS type,
                p.id            AS actor_profile_id,
                p.name          AS actor_name,
                p.picture_url   AS actor_picture,
                ps.added_at     AS created_at,
                pl.name         AS extra
            FROM playlist_songs ps
            JOIN playlists pl ON ps.playlist_id = pl.id
            JOIN profiles p   ON pl.profile_id  = p.id
            WHERE ps.song_id = ? AND LOWER(pl.name) != 'likes'
            ORDER BY ps.added_at DESC
            LIMIT 20
        `, [songId]);

        // 3. Reviews
        const reviews = await pool.query(`
            SELECT
                'song_reviewed' AS type,
                p.id            AS actor_profile_id,
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
                actor_name: row.actor_name || 'Someone',
                actor_picture: row.actor_picture || null,
                created_at: row.created_at,
                extra: row.extra || null,
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
                s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, s.genre, p.name AS profile_name,
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
                SELECT s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, s.genre, p.name AS profile_name,
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
        const query = req.query.q ? `%${req.query.q}%` : '%%';
        if (!req.query.q || req.query.q.trim() === '') {
            return res.json({ songs: [], profiles: [] });
        }

        // Search songs
        const songRows = await pool.query(`
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, s.genre, p.name AS profile_name,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.title LIKE ? OR s.description LIKE ? OR s.genre LIKE ?
            ORDER BY s.plays DESC
                LIMIT 20
        `, [query, query, query]);

        const songs = songRows.map((row) => ({
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            title: row.title,
            mp3_url: row.mp3_url,
            image_url: row.image_url,
            plays: Number(row.plays) || 0,
            genre: row.genre,
            profile_name: row.profile_name || 'Unknown',
            likes_count: Number(row.likes_count) || 0,
        }));

        // Search profiles
        const profileRows = await pool.query(`
            SELECT p.id, p.user_id, p.name, p.genre, p.picture_url, p.created_at,
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

        res.json({ songs, profiles });
    } catch (err) {
        logger.error('Error in GET /music/search:', err);
        res.status(500).json({ error: 'Failed to perform search' });
    }
});

router.get('/by-genre', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT s.genre, s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, p.name AS profile_name,
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
        const rows = await pool.query(`
            SELECT s.genre, s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, p.name AS profile_name,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.genre IS NOT NULL AND s.genre != ''
            ORDER BY s.plays DESC
        `);

        // Group songs by unique tags
        const songsByTag = {};
        rows.forEach(row => {
            const genres = row.genre ? row.genre.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
            genres.forEach(tag => {
                if (!songsByTag[tag]) {
                    songsByTag[tag] = [];
                }
                songsByTag[tag].push({
                    id: Number(row.id),
                    profile_id: Number(row.profile_id),
                    title: row.title,
                    mp3_url: row.mp3_url,
                    image_url: row.image_url,
                    plays: Number(row.plays) || 0,
                    profile_name: row.profile_name || 'Unknown',
                    likes_count: Number(row.likes_count) || 0,
                });
            });
        });

        // Convert to array and sort
        const result = Object.keys(songsByTag)
            .map(tag => ({
                tag,
                songs: songsByTag[tag],
            }))
            .sort((a, b) => b.songs.length - a.songs.length);

        res.json(result);
    } catch (err) {
        logger.error('Error in GET /music/by-tags:', err);
        res.status(500).json({ error: 'Failed to fetch songs by tag' });
    }
});

router.get('/by-tag/:tag', async (req, res) => {
    try {
        const { tag } = req.params;
        const { limit = 20, offset = 0, sort = 'random' } = req.query;

        // Validate query parameters
        const limitNum = parseInt(limit) || 20;
        const offsetNum = parseInt(offset) || 0;

        // Sanitize sort parameter
        let orderBy;
        switch (sort) {
            case 'alpha':
                orderBy = 's.title ASC';
                break;
            case 'listens':
                orderBy = 's.plays DESC';
                break;
            case 'likes': // Replace 'rating' with 'likes'
                orderBy = 'likes_count DESC, s.id ASC';
                break;
            case 'random':
            default:
                orderBy = 'RAND()';
                break;
        }

        // Query songs by tag
        const query = `
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.plays, s.profile_id, p.name AS profile_name,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.genre LIKE ? OR s.genre LIKE ? OR s.genre LIKE ? OR s.genre LIKE ?
            ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
        `;

        const values = [
            `%${tag}%`,
            `%,${tag}`,
            `${tag},%`,
            `%,${tag},%`,
            limitNum,
            offsetNum,
        ];

        const rows = await pool.query(query, values);

        const songs = rows.map(row => ({
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            title: row.title,
            mp3_url: row.mp3_url,
            image_url: row.image_url,
            plays: Number(row.plays) || 0,
            profile_name: row.profile_name || 'Unknown',
            likes_count: Number(row.likes_count) || 0,
        }));

        res.json({ songs });
    } catch (err) {
        logger.error(`Error in GET /music/by-tag/${req.params.tag}:`, err);
        res.status(500).json({ error: 'Failed to fetch songs for tag' });
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

        // Response
        const song = {
            id: Number(result.insertId),
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
                         p.name AS profile_name,
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
                p.name AS profile_name,
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
                         p.name AS profile_name,
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
            SELECT s.*, p.name AS profile_name,
                   (SELECT COUNT(*)
                    FROM playlist_songs ps
                             JOIN playlists pl ON ps.playlist_id = pl.id
                    WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
            FROM songs s
                     LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
            ORDER BY s.created_at DESC
            LIMIT 20
        `);
        const sanitizedRows = rows.map((row) => ({
            ...row,
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            plays: Number(row.plays) || 0,
            genre: row.genre || 'Unknown',
            profile_name: row.profile_name || 'Unknown',
            likes_count: Number(row.likes_count) || 0,
        }));
        res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
    } catch (err) {
        logger.error('Error in GET /music/this-month:', err);
        res.status(500).json({ error: 'Failed to fetch songs from this month' });
    }
});

router.get('/:songId', async (req, res) => {
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }
        const songs = await pool.query(`
            SELECT s.*, p.name as profile_name, p.background,
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
            plays: Number(songs[0].plays) || 0,
            profile_name: songs[0].profile_name || 'Unknown Artist',
            background: songs[0].background || null,
            likes_count: Number(songs[0].likes_count) || 0,
        };
        res.json({ song });
    } catch (err) {
        logger.error('Error in GET /music/:songId:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/:songId', authenticate, async (req, res) => {
    const { title, description, genre, stems_url } = req.body;
    const mp3 = req.files?.mp3;
    const image = req.files?.image;
    try {
        const songId = parseInt(req.params.songId);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        const songs = await pool.query(`
            SELECT s.id, s.profile_id, s.mp3_url, s.image_url, s.stems_url
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
            SET title = ?, description = ?, genre = ?, mp3_url = ?, image_url = ?, stems_url = ?
            WHERE id = ?
        `, [
            title || songs[0].title,
            description || '',
            genre || '',
            mp3Url,
            imageUrl,
            stems_url !== undefined ? stems_url : songs[0].stems_url,
            songId
        ]);

        const updatedSongs = await pool.query('SELECT * FROM songs WHERE id = ?', [songId]);
        const song = {
            ...updatedSongs[0],
            id: Number(updatedSongs[0].id),
            profile_id: Number(updatedSongs[0].profile_id),
            plays: Number(updatedSongs[0].plays) || 0,
            stems_url: updatedSongs[0].stems_url,
            likes_count: 0,
        };

        res.status(200).json({ song });
    } catch (err) {
        logger.error('Error in PUT /music/:songId:', err);
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

router.post('/peaks/:songId', authenticate, async (req, res) => {
    const { songId } = req.params;
    const { peaks } = req.body;
    const userId = req.user.id;

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

        logger.debug(`Fetching song with ID: ${parsedSongId} for user ID: ${userId}`);
        const songs = await pool.query(
            'SELECT s.id, s.profile_id, p.user_id FROM songs s JOIN profiles p ON s.profile_id = p.id WHERE s.id = ?',
            [parsedSongId]
        );
        logger.debug('Song query result:', songs);

        if (!songs || songs.length === 0) {
            logger.debug(`Song ID ${parsedSongId} not found`);
            return res.status(404).json({ error: 'Song not found' });
        }

        const song = songs[0];
        const songUserId = Number(song.user_id);
        const requestingUserId = Number(userId);
        if (songUserId !== requestingUserId) {
            logger.debug('Ownership check failed:', { songUserId, requestingUserId });
            return res.status(403).json({ error: 'Unauthorized to save peaks for this song' });
        }

        logger.debug(`Saving peaks for song ID: ${parsedSongId}`);
        await pool.query('UPDATE songs SET peaks = ? WHERE id = ?', [peaks, parsedSongId]);
        logger.debug(`Peaks saved successfully for song ID: ${parsedSongId}`);

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

router.post('/master/:songId', authenticate, async (req, res) => {
    const { songId } = req.params;
    const { masteringType } = req.body;
    const userId = req.user.id;
    const CONCURRENCY_LIMIT = parseInt(process.env.FFMPEG_CONCURRENCY_LIMIT, 10) || 1;

    try {
        if (getRunningJobs() >= CONCURRENCY_LIMIT) {
            logger.debug(`Concurrency limit (${CONCURRENCY_LIMIT}) reached, rejecting job for song ID: ${songId}`);
            return res.status(429).json({ error: 'Too many mastering jobs running. Please try again later.' });
        }

        if (!['light', 'middle', 'heavy'].includes(masteringType)) {
            return res.status(400).json({ error: 'Invalid mastering type' });
        }

        const parsedSongId = parseInt(songId, 10);
        if (isNaN(parsedSongId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        logger.debug(`Processing mastering job for song ID: ${parsedSongId}, user ID: ${userId}`);
        const songs = await pool.query('SELECT mp3_url FROM songs WHERE id = ?', [parsedSongId]);
        if (!songs.length) {
            return res.status(404).json({ error: 'Song not found' });
        }

        const mp3Url = songs[0].mp3_url;
        const s3Key = extractObjectKey(mp3Url);
        if (!s3Key) {
            return res.status(400).json({ error: 'Invalid S3 URL format' });
        }

        incrementRunningJobs();
        logger.debug(`Starting FFmpeg job, running jobs: ${getRunningJobs()}`);

        const getObjectCommand = new GetObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: s3Key,
        });
        const { Body } = await s3Client.send(getObjectCommand);

        const inputFile = tmp.fileSync({ postfix: '.mp3' });
        const outputFile = tmp.fileSync({ postfix: '.mp3' });

        const inputStream = fs.createWriteStream(inputFile.name);
        await new Promise((resolve, reject) => {
            Body.pipe(inputStream)
                .on('finish', resolve)
                .on('error', reject);
        });

        const masteringParams = {
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

        await new Promise((resolve, reject) => {
            const filters = [
                ...masteringParams[masteringType].equalizer,
                masteringParams[masteringType].compressor,
                masteringParams[masteringType].volume,
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

        const masteredKey = `music/mastered-${userId}-${Date.now()}.mp3`;
        const uploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: masteredKey,
            Body: fs.createReadStream(outputFile.name),
            ContentType: 'audio/mpeg',
        };
        await s3Client.send(new PutObjectCommand(uploadParams));

        inputFile.removeCallback();
        outputFile.removeCallback();

        logger.debug(`Mastering job completed for song ID: ${parsedSongId}`);
        res.status(200).json({
            masteredUrl: buildPublicFileUrl(masteredKey),
        });
    } catch (err) {
        logger.error('Error in POST /music/master:', err);
        res.status(500).json({ error: 'Failed to master audio' });
    } finally {
        decrementRunningJobs();
        logger.debug(`Finished FFmpeg job, running jobs: ${getRunningJobs()}`);
    }
});

module.exports = router;