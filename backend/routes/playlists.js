const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const logger = require('../utils/logger');
const authenticate = require('../middleware/authenticate');
const { createNotification, NOTIFICATION_TYPES } = require('../utils/notifications');

// Helper function to convert BigInt to string for JSON serialization
const serializeBigInt = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
};

// Get user's playlists
router.get('/', authenticate, async (req, res) => {
    logger.debug('[DEBUG] GET /playlists called for userId:', req.user.id);
    try {
        const userId = req.user.id;
        const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [userId]);
        logger.debug('[DEBUG] Profile query result:', serializeBigInt(profiles));

        if (!profiles || profiles.length === 0) {
            logger.debug('[DEBUG] No profile found for user_id:', userId);
            return res.status(404).json({ error: 'Profile not found' });
        }
        const profileId = Number(profiles[0].id);
        logger.debug('[DEBUG] Found profile_id:', profileId);

        const rows = await pool.query(`
            SELECT p.id, p.name, p.created_at, COUNT(ps.song_id) as song_count
            FROM playlists p
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            WHERE p.profile_id = ?
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `, [profileId]);

        const playlists = rows.map(row => ({
            id: Number(row.id),
            name: row.name,
            created_at: row.created_at,
            song_count: Number(row.song_count) || 0
        }));
        logger.debug('[DEBUG] Playlists fetched:', serializeBigInt(playlists));

        res.json(playlists);
    } catch (err) {
        logger.error('[ERROR] Error in GET /playlists:', {
            message: err.message,
            stack: err.stack,
            userId: req.user.id
        });
        res.status(500).json({ error: 'Failed to fetch playlists' });
    }
});

// POST /playlists - Create a new playlist
router.post('/', authenticate, async (req, res) => {
    const { name } = req.body;
    const userId = Number(req.user.id);

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Playlist name is required and must be a string' });
    }

    try {
        // Get the profile ID for the user
        const profile = await pool.query(
            'SELECT id FROM profiles WHERE user_id = ? LIMIT 1',
            [userId]
        );

        if (profile.length === 0) {
            return res.status(404).json({ error: 'Profile not found for user' });
        }

        const profileId = profile[0].id;

        // Check for existing "Likes" playlist if name is "Likes" (case-insensitive)
        if (name.toLowerCase() === 'likes') {
            const existingLikes = await pool.query(
                'SELECT id, name FROM playlists WHERE profile_id = ? AND LOWER(name) = ? LIMIT 1',
                [profileId, 'likes']
            );

            if (existingLikes.length > 0) {
                // Return existing "Likes" playlist
                return res.status(200).json({
                    playlist: {
                        id: Number(existingLikes[0].id),
                        profile_id: Number(profileId),
                        name: existingLikes[0].name,
                        song_count: 0, // Will be updated by client if needed
                    },
                });
            }
        }

        // Create new playlist if no duplicate "Likes" exists
        const result = await pool.query(
            'INSERT INTO playlists (profile_id, name, created_at) VALUES (?, ?, NOW())',
            [profileId, name]
        );

        res.status(201).json({
            playlist: {
                id: Number(result.insertId),
                profile_id: Number(profileId),
                name,
                song_count: 0,
            },
        });
    } catch (err) {
        logger.error('Error creating playlist:', err);
        res.status(500).json({ error: 'Failed to create playlist: ' + err.message });
    }
});

// Add song to playlist
router.post('/:playlistId/songs', authenticate, async (req, res) => {
    const { playlistId } = req.params;
    const { songId } = req.body;
    const userId = req.user.id;

    logger.debug('[DEBUG] POST /playlists/:playlistId/songs called:', { playlistId, songId, userId });

    try {
        const parsedPlaylistId = parseInt(playlistId);
        const parsedSongId = parseInt(songId);
        if (isNaN(parsedPlaylistId) || isNaN(parsedSongId)) {
            logger.debug('[DEBUG] Invalid playlist or song ID:', { playlistId, songId });
            return res.status(400).json({ error: 'Invalid playlist or song ID' });
        }

        logger.debug('[DEBUG] Verifying playlist ownership for playlistId:', parsedPlaylistId);
        const playlists = await pool.query(
            'SELECT p.id, p.name FROM playlists p JOIN profiles pr ON p.profile_id = pr.id WHERE p.id = ? AND pr.user_id = ?',
            [parsedPlaylistId, userId]
        );
        logger.debug('[DEBUG] Playlist ownership query result:', serializeBigInt(playlists));

        if (!playlists || playlists.length === 0) {
            logger.debug('[DEBUG] Unauthorized or playlist not found:', { playlistId: parsedPlaylistId, userId });
            return res.status(403).json({ error: 'Unauthorized or playlist not found' });
        }

        logger.debug('[DEBUG] Verifying song existence for songId:', parsedSongId);
        const songs = await pool.query('SELECT id FROM songs WHERE id = ?', [parsedSongId]);
        logger.debug('[DEBUG] Song query result:', serializeBigInt(songs));

        if (!songs || songs.length === 0) {
            logger.debug('[DEBUG] Song not found:', parsedSongId);
            return res.status(404).json({ error: 'Song not found' });
        }

        logger.debug('[DEBUG] Checking if song is already in playlist:', { playlistId: parsedPlaylistId, songId: parsedSongId });
        const existing = await pool.query(
            'SELECT 1 FROM playlist_songs WHERE playlist_id = ? AND song_id = ?',
            [parsedPlaylistId, parsedSongId]
        );
        logger.debug('[DEBUG] Existing song check result:', serializeBigInt(existing));

        if (existing.length > 0) {
            logger.debug('[DEBUG] Song already in playlist');
            return res.status(400).json({ error: 'Song already exists in playlist' });
        }

        logger.debug('[DEBUG] Adding song to playlist:', { playlistId: parsedPlaylistId, songId: parsedSongId });
        await pool.query(
            'INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)',
            [parsedPlaylistId, parsedSongId]
        );

        const isLikesPlaylist = (playlists[0].name || '').toLowerCase() === 'likes';
        if (isLikesPlaylist) {
            const songOwners = await pool.query(
                `
                    SELECT s.title, p.id AS owner_profile_id, p.user_id AS owner_user_id
                    FROM songs s
                    JOIN profiles p ON p.id = s.profile_id
                    WHERE s.id = ?
                    LIMIT 1
                `,
                [parsedSongId]
            );

            if (songOwners.length > 0) {
                const owner = songOwners[0];
                await createNotification({
                    recipientUserId: owner.owner_user_id,
                    actorUserId: userId,
                    type: NOTIFICATION_TYPES.SONG_LIKED,
                    message: 'Someone liked your uploaded song.',
                    entityType: 'song',
                    entityId: parsedSongId,
                    metadata: {
                        song_title: owner.title,
                        owner_profile_id: Number(owner.owner_profile_id),
                    },
                });
            }
        }

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error('[ERROR] Error in POST /playlists/:playlistId/songs:', {
            message: err.message,
            stack: err.stack,
            playlistId,
            songId,
            userId
        });
        res.status(500).json({ error: 'Failed to add song to playlist' });
    }
});

// Get songs in a playlist
router.get('/:playlistId/songs', authenticate, async (req, res) => {
    const { playlistId } = req.params;
    const userId = req.user.id;

    logger.debug('[DEBUG] GET /playlists/:playlistId/songs called:', { playlistId, userId });

    try {
        const parsedPlaylistId = parseInt(playlistId);
        if (isNaN(parsedPlaylistId)) {
            logger.debug('[DEBUG] Invalid playlist ID:', playlistId);
            return res.status(400).json({ error: 'Invalid playlist ID' });
        }

        logger.debug('[DEBUG] Verifying playlist ownership for playlistId:', parsedPlaylistId);
        const playlists = await pool.query(
            'SELECT p.id FROM playlists p JOIN profiles pr ON p.profile_id = pr.id WHERE p.id = ? AND pr.user_id = ?',
            [parsedPlaylistId, userId]
        );
        logger.debug('[DEBUG] Playlist ownership query result:', serializeBigInt(playlists));

        if (!playlists || playlists.length === 0) {
            logger.debug('[DEBUG] Unauthorized or playlist not found:', { playlistId: parsedPlaylistId, userId });
            return res.status(403).json({ error: 'Unauthorized or playlist not found' });
        }

        logger.debug('[DEBUG] Fetching songs for playlistId:', parsedPlaylistId);
        const rows = await pool.query(`
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.profile_id, pr.name as profile_name
            FROM playlist_songs ps
                     JOIN songs s ON ps.song_id = s.id
                     JOIN profiles pr ON s.profile_id = pr.id
            WHERE ps.playlist_id = ?
            ORDER BY ps.added_at
        `, [parsedPlaylistId]);

        const songs = rows.map(row => ({
            id: Number(row.id),
            title: row.title,
            mp3_url: row.mp3_url,
            image_url: row.image_url,
            profile_id: Number(row.profile_id),
            profile_name: row.profile_name
        }));
        logger.debug('[DEBUG] Songs fetched:', serializeBigInt(songs));

        res.json({ songs });
    } catch (err) {
        logger.error('[ERROR] Error in GET /playlists/:playlistId/songs:', {
            message: err.message,
            stack: err.stack,
            playlistId,
            userId
        });
        res.status(500).json({ error: 'Failed to fetch playlist songs' });
    }
});

// Remove song from playlist
router.delete('/:playlistId/songs/:songId', authenticate, async (req, res) => {
    const { playlistId, songId } = req.params;
    const userId = req.user.id;

    logger.debug('[DEBUG] DELETE /playlists/:playlistId/songs/:songId called:', { playlistId, songId, userId });

    try {
        const parsedPlaylistId = parseInt(playlistId);
        const parsedSongId = parseInt(songId);
        if (isNaN(parsedPlaylistId) || isNaN(parsedSongId)) {
            logger.debug('[DEBUG] Invalid playlist or song ID:', { playlistId, songId });
            return res.status(400).json({ error: 'Invalid playlist or song ID' });
        }

        logger.debug('[DEBUG] Verifying playlist ownership for playlistId:', parsedPlaylistId);
        const playlists = await pool.query(
            'SELECT p.id FROM playlists p JOIN profiles pr ON p.profile_id = pr.id WHERE p.id = ? AND pr.user_id = ?',
            [parsedPlaylistId, userId]
        );
        logger.debug('[DEBUG] Playlist ownership query result:', serializeBigInt(playlists));

        if (!playlists || playlists.length === 0) {
            logger.debug('[DEBUG] Unauthorized or playlist not found:', { playlistId: parsedPlaylistId, userId });
            return res.status(403).json({ error: 'Unauthorized or playlist not found' });
        }

        logger.debug('[DEBUG] Removing song from playlist:', { playlistId: parsedPlaylistId, songId: parsedSongId });
        const result = await pool.query(
            'DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?',
            [parsedPlaylistId, parsedSongId]
        );
        logger.debug('[DEBUG] Delete song result:', serializeBigInt(result));

        if (result.affectedRows === 0) {
            logger.debug('[DEBUG] Song not found in playlist:', { playlistId: parsedPlaylistId, songId: parsedSongId });
            return res.status(404).json({ error: 'Song not found in playlist' });
        }

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error('[ERROR] Error in DELETE /playlists/:playlistId/songs/:songId:', {
            message: err.message,
            stack: err.stack,
            playlistId,
            songId,
            userId
        });
        res.status(500).json({ error: 'Failed to remove song from playlist' });
    }
});

// Delete a playlist
router.delete('/:playlistId', authenticate, async (req, res) => {
    const { playlistId } = req.params;
    const userId = req.user.id;

    logger.debug('[DEBUG] DELETE /playlists/:playlistId called:', { playlistId, userId });

    try {
        const parsedPlaylistId = parseInt(playlistId);
        if (isNaN(parsedPlaylistId)) {
            logger.debug('[DEBUG] Invalid playlist ID:', playlistId);
            return res.status(400).json({ error: 'Invalid playlist ID' });
        }

        logger.debug('[DEBUG] Verifying playlist ownership for playlistId:', parsedPlaylistId);
        const playlists = await pool.query(
            'SELECT p.id FROM playlists p JOIN profiles pr ON p.profile_id = pr.id WHERE p.id = ? AND pr.user_id = ?',
            [parsedPlaylistId, userId]
        );
        logger.debug('[DEBUG] Playlist ownership query result:', serializeBigInt(playlists));

        if (!playlists || playlists.length === 0) {
            logger.debug('[DEBUG] Unauthorized or playlist not found:', { playlistId: parsedPlaylistId, userId });
            return res.status(403).json({ error: 'Unauthorized or playlist not found' });
        }

        logger.debug('[DEBUG] Deleting playlist:', parsedPlaylistId);
        await pool.query('DELETE FROM playlists WHERE id = ?', [parsedPlaylistId]);
        logger.debug('[DEBUG] Playlist deleted:', parsedPlaylistId);

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error('[ERROR] Error in DELETE /playlists/:playlistId:', {
            message: err.message,
            stack: err.stack,
            playlistId,
            userId
        });
        res.status(500).json({ error: 'Failed to delete playlist' });
    }
});

module.exports = router;