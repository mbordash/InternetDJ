const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../config/database');
const logger = require('../utils/logger');
const authenticate = require('../middleware/authenticate');
const { createNotification, NOTIFICATION_TYPES } = require('../utils/notifications');

// The auto-created likes crate lives in this same table but is surfaced
// separately as "Liked Songs", so it must never appear as a member playlist.
const LIKES_PLAYLIST_NAME = 'likes';
const EXCLUDE_LIKES_SQL = "LOWER(p.name) <> 'likes'";

// Resolve the caller's profile id from a bearer token when one is present.
// Public crate routes must work for signed-out visitors, so a missing or
// invalid token is a guest rather than an error.
async function viewerProfileId(req) {
    const header = req.headers.authorization || req.headers.Authorization;
    if (!header || !header.startsWith('Bearer ') || !process.env.JWT_SECRET) return null;
    try {
        const { id } = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
        const rows = await pool.query('SELECT id FROM profiles WHERE user_id = ? LIMIT 1', [id]);
        return rows.length ? Number(rows[0].id) : null;
    } catch {
        return null;
    }
}

// A crate is visible if it is public, if you own it, or if it is a mixtape
// somebody made for you - that last case is what lets a private mixtape work
// as a personal gift rather than a broadcast.
function canView(playlist, viewer) {
    if (playlist.is_public) return true;
    if (viewer == null) return false;
    return Number(playlist.profile_id) === viewer
        || Number(playlist.dedicated_to_profile_id) === viewer;
}

// Cover art is built from the first four songs rather than uploaded, so a
// crate looks like an object without anyone having to make artwork.
async function coverArtFor(playlistId) {
    const rows = await pool.query(`
        SELECT s.image_url
        FROM playlist_songs ps
        JOIN songs s ON s.id = ps.song_id
        WHERE ps.playlist_id = ? AND s.image_url IS NOT NULL AND s.image_url <> ''
        ORDER BY ps.added_at ASC
        LIMIT 4
    `, [playlistId]);
    return rows.map((r) => r.image_url);
}

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
            SELECT p.id, p.name, p.created_at, p.is_public,
                   p.dedicated_to_profile_id, p.dedication_note,
                   dp.name AS dedicated_to_name, dp.slug AS dedicated_to_slug,
                   COUNT(ps.song_id) as song_count
            FROM playlists p
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            LEFT JOIN profiles dp ON dp.id = p.dedicated_to_profile_id
            WHERE p.profile_id = ?
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `, [profileId]);

        const playlists = rows.map(row => ({
            id: Number(row.id),
            name: row.name,
            created_at: row.created_at,
            is_public: Boolean(row.is_public),
            // The auto-created Likes crate can never be shared, so the UI
            // hides its controls rather than offering a button that 400s.
            is_likes: String(row.name).toLowerCase() === LIKES_PLAYLIST_NAME,
            dedicated_to_profile_id: row.dedicated_to_profile_id ? Number(row.dedicated_to_profile_id) : null,
            dedicated_to_name: row.dedicated_to_name || null,
            dedicated_to_slug: row.dedicated_to_slug || null,
            dedication_note: row.dedication_note || null,
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
    const { name, is_public = false, dedicated_to_profile_id = null, dedication_note = null } = req.body;
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

        // A dedication only counts if it names a real profile that is not you.
        let dedicatedTo = null;
        if (dedicated_to_profile_id != null && dedicated_to_profile_id !== '') {
            const target = Number(dedicated_to_profile_id);
            if (!Number.isInteger(target)) {
                return res.status(400).json({ error: 'Invalid recipient' });
            }
            if (target === Number(profileId)) {
                return res.status(400).json({ error: 'You cannot dedicate a mixtape to yourself' });
            }
            const exists = await pool.query('SELECT id FROM profiles WHERE id = ? LIMIT 1', [target]);
            if (!exists.length) {
                return res.status(404).json({ error: 'Recipient profile not found' });
            }
            dedicatedTo = target;
        }
        const note = dedication_note ? String(dedication_note).slice(0, 280) : null;

        const result = await pool.query(
            `INSERT INTO playlists (profile_id, name, is_public, dedicated_to_profile_id, dedication_note, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [profileId, name, is_public ? 1 : 0, dedicatedTo, dedicatedTo ? note : null]
        );

        if (dedicatedTo) {
            // createNotification addresses users, not profiles, so map across.
            try {
                const recipient = await pool.query(
                    'SELECT user_id FROM profiles WHERE id = ? LIMIT 1', [dedicatedTo]
                );
                if (recipient.length) {
                    await createNotification({
                        recipientUserId: Number(recipient[0].user_id),
                        actorUserId: userId,
                        type: NOTIFICATION_TYPES.PLAYLIST_DEDICATION,
                        message: `made you a mixtape: ${name}`,
                        entityType: 'playlist',
                        entityId: Number(result.insertId),
                    });
                }
            } catch (notifyErr) {
                // A failed notification must not fail the mixtape itself.
                logger.error('Mixtape dedication notification failed:', notifyErr);
            }
        }

        res.status(201).json({
            playlist: {
                id: Number(result.insertId),
                profile_id: Number(profileId),
                name,
                is_public: Boolean(is_public),
                dedicated_to_profile_id: dedicatedTo,
                dedication_note: dedicatedTo ? note : null,
                song_count: 0,
            },
        });
    } catch (err) {
        logger.error('Error creating playlist:', err);
        res.status(500).json({ error: 'Failed to create playlist: ' + err.message });
    }
});

// ---- Public crate surfaces -------------------------------------------------
// Declared before the /:playlistId routes so the literal prefixes win.

// The public crate directory. Sorting is whitelisted rather than interpolated
// so the sort key can never reach the query as raw text.
const CRATE_SORTS = {
    recent:  'p.updated_at DESC, p.id DESC',
    newest:  'p.created_at DESC, p.id DESC',
    largest: 'song_count DESC, p.updated_at DESC',
};

router.get('/public', async (req, res) => {
    const sort = CRATE_SORTS[req.query.sort] ? req.query.sort : 'recent';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 60);
    const onlyMixtapes = req.query.mixtapes === '1';

    try {
        const rows = await pool.query(`
            SELECT p.id, p.name, p.created_at, p.updated_at,
                   p.dedicated_to_profile_id, p.dedication_note,
                   op.id AS owner_profile_id, op.name AS owner_name,
                   op.slug AS owner_slug, op.picture_url AS owner_picture,
                   dp.name AS dedicated_to_name, dp.slug AS dedicated_to_slug,
                   COUNT(ps.song_id) AS song_count
            FROM playlists p
            JOIN profiles op ON op.id = p.profile_id
            LEFT JOIN profiles dp ON dp.id = p.dedicated_to_profile_id
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            WHERE p.is_public = TRUE
              AND ${EXCLUDE_LIKES_SQL}
              ${onlyMixtapes ? 'AND p.dedicated_to_profile_id IS NOT NULL' : ''}
            GROUP BY p.id
            HAVING song_count > 0
            ORDER BY ${CRATE_SORTS[sort]}
            LIMIT ?
        `, [limit]);

        const crates = [];
        for (const row of rows) {
            crates.push({
                id: Number(row.id),
                name: row.name,
                song_count: Number(row.song_count) || 0,
                created_at: row.created_at,
                updated_at: row.updated_at,
                owner: {
                    profile_id: Number(row.owner_profile_id),
                    name: row.owner_name || 'Unknown',
                    profile_slug: row.owner_slug || null,
                    picture_url: row.owner_picture || null,
                },
                dedicated_to_name: row.dedicated_to_name || null,
                dedicated_to_slug: row.dedicated_to_slug || null,
                dedication_note: row.dedication_note || null,
                cover_art: await coverArtFor(Number(row.id)),
            });
        }
        res.json(crates);
    } catch (err) {
        logger.error('[ERROR] GET /playlists/public:', err);
        res.status(500).json({ error: 'Failed to fetch crates' });
    }
});

// Public crates belonging to one profile. Used by the profile page.
router.get('/by-profile/:profileId', async (req, res) => {
    const profileId = Number(req.params.profileId);
    if (!Number.isInteger(profileId)) {
        return res.status(400).json({ error: 'Invalid profile ID' });
    }
    try {
        const viewer = await viewerProfileId(req);
        const isOwner = viewer === profileId ? 1 : 0;

        // Owners see their own private crates too; everyone else sees public
        // ones plus any mixtape addressed to them.
        const rows = await pool.query(`
            SELECT p.id, p.name, p.is_public, p.created_at, p.updated_at,
                   p.dedicated_to_profile_id, p.dedication_note,
                   dp.name AS dedicated_to_name, dp.slug AS dedicated_to_slug,
                   COUNT(ps.song_id) AS song_count
            FROM playlists p
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            LEFT JOIN profiles dp ON dp.id = p.dedicated_to_profile_id
            WHERE p.profile_id = ?
              AND ${EXCLUDE_LIKES_SQL}
              AND (p.is_public = TRUE OR ? = TRUE OR p.dedicated_to_profile_id = ?)
            GROUP BY p.id
            ORDER BY p.updated_at DESC, p.id DESC
        `, [profileId, isOwner, viewer]);

        const crates = [];
        for (const row of rows) {
            crates.push({
                id: Number(row.id),
                name: row.name,
                is_public: Boolean(row.is_public),
                song_count: Number(row.song_count) || 0,
                created_at: row.created_at,
                updated_at: row.updated_at,
                dedicated_to_profile_id: row.dedicated_to_profile_id ? Number(row.dedicated_to_profile_id) : null,
                dedicated_to_name: row.dedicated_to_name || null,
                dedicated_to_slug: row.dedicated_to_slug || null,
                dedication_note: row.dedication_note || null,
                cover_art: await coverArtFor(Number(row.id)),
            });
        }
        res.json(crates);
    } catch (err) {
        logger.error('[ERROR] GET /playlists/by-profile/:profileId:', err);
        res.status(500).json({ error: 'Failed to fetch crates' });
    }
});

// Mixtapes somebody made for the signed-in user.
router.get('/made-for-me', authenticate, async (req, res) => {
    try {
        const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
        if (!profiles.length) return res.json([]);
        const profileId = Number(profiles[0].id);

        const rows = await pool.query(`
            SELECT p.id, p.name, p.is_public, p.dedication_note, p.created_at,
                   op.id AS from_profile_id, op.name AS from_name, op.slug AS from_slug,
                   COUNT(ps.song_id) AS song_count
            FROM playlists p
            JOIN profiles op ON op.id = p.profile_id
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            WHERE p.dedicated_to_profile_id = ?
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `, [profileId]);

        res.json(rows.map((row) => ({
            id: Number(row.id),
            name: row.name,
            is_public: Boolean(row.is_public),
            dedication_note: row.dedication_note || null,
            song_count: Number(row.song_count) || 0,
            created_at: row.created_at,
            from_profile_id: Number(row.from_profile_id),
            from_name: row.from_name || 'Unknown',
            from_slug: row.from_slug || null,
        })));
    } catch (err) {
        logger.error('[ERROR] GET /playlists/made-for-me:', err);
        res.status(500).json({ error: 'Failed to fetch mixtapes' });
    }
});

// One crate with its songs, honouring the visibility rule.
router.get('/crate/:playlistId', async (req, res) => {
    const playlistId = Number(req.params.playlistId);
    if (!Number.isInteger(playlistId)) {
        return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    try {
        const rows = await pool.query(`
            SELECT p.id, p.profile_id, p.name, p.is_public, p.created_at, p.updated_at,
                   p.dedicated_to_profile_id, p.dedication_note,
                   op.name AS owner_name, op.slug AS owner_slug, op.picture_url AS owner_picture,
                   dp.name AS dedicated_to_name, dp.slug AS dedicated_to_slug
            FROM playlists p
            JOIN profiles op ON op.id = p.profile_id
            LEFT JOIN profiles dp ON dp.id = p.dedicated_to_profile_id
            WHERE p.id = ?
        `, [playlistId]);

        if (!rows.length) {
            return res.status(404).json({ error: 'Crate not found' });
        }
        const row = rows[0];

        // Same 404 for "missing" and "not yours" so ids cannot be probed.
        const viewer = await viewerProfileId(req);
        if (!canView(row, viewer)) {
            return res.status(404).json({ error: 'Crate not found' });
        }
        if (String(row.name).toLowerCase() === LIKES_PLAYLIST_NAME) {
            return res.status(404).json({ error: 'Crate not found' });
        }

        const songs = await pool.query(`
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.profile_id,
                   sp.name AS profile_name, sp.slug AS profile_slug, ps.added_at
            FROM playlist_songs ps
            JOIN songs s ON s.id = ps.song_id
            LEFT JOIN profiles sp ON sp.id = s.profile_id
            WHERE ps.playlist_id = ?
            ORDER BY ps.added_at ASC
        `, [playlistId]);

        res.json({
            id: Number(row.id),
            name: row.name,
            is_public: Boolean(row.is_public),
            is_owner: viewer != null && Number(row.profile_id) === viewer,
            created_at: row.created_at,
            updated_at: row.updated_at,
            owner: {
                profile_id: Number(row.profile_id),
                name: row.owner_name || 'Unknown',
                profile_slug: row.owner_slug || null,
                picture_url: row.owner_picture || null,
            },
            dedicated_to: row.dedicated_to_profile_id ? {
                profile_id: Number(row.dedicated_to_profile_id),
                name: row.dedicated_to_name || 'Unknown',
                profile_slug: row.dedicated_to_slug || null,
            } : null,
            dedication_note: row.dedication_note || null,
            songs: songs.map((sg) => ({
                id: Number(sg.id),
                title: sg.title,
                mp3_url: sg.mp3_url,
                image_url: sg.image_url,
                profile_id: Number(sg.profile_id),
                profile_name: sg.profile_name || 'Unknown',
                profile_slug: sg.profile_slug || null,
            })),
        });
    } catch (err) {
        logger.error('[ERROR] GET /playlists/crate/:playlistId:', err);
        res.status(500).json({ error: 'Failed to fetch crate' });
    }
});

// Change visibility or dedication on a crate you own.
router.put('/:playlistId', authenticate, async (req, res) => {
    const playlistId = Number(req.params.playlistId);
    const { name, is_public, dedicated_to_profile_id, dedication_note } = req.body;
    if (!Number.isInteger(playlistId)) {
        return res.status(400).json({ error: 'Invalid playlist ID' });
    }
    try {
        const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
        if (!profiles.length) return res.status(404).json({ error: 'Profile not found' });
        const profileId = Number(profiles[0].id);

        const owned = await pool.query('SELECT id, name FROM playlists WHERE id = ? AND profile_id = ?', [playlistId, profileId]);
        if (!owned.length) return res.status(404).json({ error: 'Crate not found' });
        if (String(owned[0].name).toLowerCase() === LIKES_PLAYLIST_NAME) {
            return res.status(400).json({ error: 'The Likes crate cannot be shared or renamed' });
        }

        const sets = [];
        const params = [];
        if (typeof name === 'string' && name.trim()) { sets.push('name = ?'); params.push(name.trim()); }
        if (is_public !== undefined) { sets.push('is_public = ?'); params.push(is_public ? 1 : 0); }
        if (dedicated_to_profile_id !== undefined) {
            if (dedicated_to_profile_id === null || dedicated_to_profile_id === '') {
                sets.push('dedicated_to_profile_id = NULL', 'dedication_note = NULL');
            } else {
                const target = Number(dedicated_to_profile_id);
                if (!Number.isInteger(target) || target === profileId) {
                    return res.status(400).json({ error: 'Invalid recipient' });
                }
                sets.push('dedicated_to_profile_id = ?'); params.push(target);
                sets.push('dedication_note = ?'); params.push(dedication_note ? String(dedication_note).slice(0, 280) : null);
            }
        }
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

        params.push(playlistId);
        await pool.query(`UPDATE playlists SET ${sets.join(', ')} WHERE id = ?`, params);
        res.json({ success: true });
    } catch (err) {
        logger.error('[ERROR] PUT /playlists/:playlistId:', err);
        res.status(500).json({ error: 'Failed to update crate' });
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
            SELECT s.id, s.title, s.mp3_url, s.image_url, s.profile_id, pr.name as profile_name, pr.slug as profile_slug
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
            profile_slug: row.profile_slug || null,
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