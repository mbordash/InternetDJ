/**
 * Artist releases: albums, EPs and singles.
 *
 * A release is not a playlist. A playlist - a mixtape or crate, in this UI - is
 * a listener collecting other people's tracks, and the order is a convenience.
 * A release is the artist saying these tracks are one body of work, in this
 * order, under this cover. They differ in owner, in whether the sequence means
 * anything, and in where they appear, which is why they are separate tables and
 * separate routes rather than a type flag on playlists that every existing
 * playlist query would then have to remember to exclude.
 *
 * Grouping is a pointer, never a move. Adding a track to a release does not
 * take it off the artist's profile, out of anyone's crate, or away from its
 * own page and its own reviews. Deleting a release deletes the grouping and
 * nothing else - the tracks are untouched, which is the behaviour an artist
 * expects from something that was only ever a sleeve around them.
 */
const express = require('express');
const pool = require('../config/database');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const authenticateOptional = require('../middleware/authenticateOptional');
const logger = require('../utils/logger');
const { buildPublicFileUrl } = require('../utils/storage');

const router = express.Router();

const RELEASE_TYPES = ['album', 'ep', 'single'];
const MAX_TITLE = 255;
const MAX_DESCRIPTION = 2000;

/** The caller's own profile, or null when they have not made one yet. */
const profileForUser = async (userId) => {
    const rows = await pool.query('SELECT id, name, slug FROM profiles WHERE user_id = ?', [userId]);
    return rows && rows.length ? rows[0] : null;
};

/**
 * A release plus who owns it. Returns null when there is no such release, so
 * the caller can tell "not there" from "not yours" and answer accordingly.
 */
const findReleaseWithOwner = async (releaseId) => {
    const rows = await pool.query(
        `SELECT r.*, p.user_id AS owner_user_id, p.name AS profile_name, p.slug AS profile_slug
           FROM releases r
           JOIN profiles p ON p.id = r.profile_id
          WHERE r.id = ?`,
        [releaseId]
    );
    return rows && rows.length ? rows[0] : null;
};

/**
 * An empty release date is not the same as today's date.
 *
 * An artist filling in a sleeve for a record they put out in 2003 needs the
 * field to accept that date; one who has not decided yet needs to be able to
 * leave it blank. Anything that is not a plain YYYY-MM-DD is refused rather
 * than coerced, so a typo becomes a message instead of a silently wrong year.
 */
const parseReleaseDate = (value) => {
    if (value === undefined) return { ok: true, value: undefined };
    if (value === null || value === '') return { ok: true, value: null };
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        return { ok: false, error: 'Release date must be a date like 2026-09-04' };
    }
    const trimmed = value.trim();
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: 'That is not a real date' };
    }
    return { ok: true, value: trimmed };
};

const sanitizeRelease = (row, { isOwner = false, trackCount = 0, coverFallback = null } = {}) => ({
    id: Number(row.id),
    profile_id: Number(row.profile_id),
    profile_name: row.profile_name || 'Unknown Artist',
    profile_slug: row.profile_slug || null,
    title: row.title,
    release_type: row.release_type,
    description: row.description || '',
    // A release with no cover of its own borrows the artwork of its first
    // track, so a sleeve exists from the moment the release does.
    cover_url: row.cover_url || coverFallback || null,
    has_own_cover: !!row.cover_url,
    release_date: row.release_date || null,
    visibility: row.visibility || 'public',
    track_count: Number(trackCount) || 0,
    is_owner: isOwner,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

/**
 * The tracks on a release, in order.
 *
 * Delisted tracks are left out for everyone but the artist, the same way they
 * are everywhere else on the site. The artist sees them, flagged, because a
 * release quietly missing its third track with no explanation is worse than
 * one that says which track is hidden.
 */
const tracksForRelease = async (releaseId, { includeHidden = false } = {}) => {
    const rows = await pool.query(
        `SELECT rs.track_no, s.id, s.title, s.mp3_url, s.image_url, s.genre, s.plays,
                s.bpm, s.musical_key, s.duration, s.visibility, s.profile_id,
                p.name AS profile_name, p.slug AS profile_slug
           FROM release_songs rs
           JOIN songs s ON s.id = rs.song_id
           LEFT JOIN profiles p ON p.id = s.profile_id
          WHERE rs.release_id = ?
            ${includeHidden ? '' : "AND s.visibility = 'public'"}
          ORDER BY rs.track_no ASC, s.id ASC`,
        [releaseId]
    );

    return rows.map((row) => ({
        track_no: Number(row.track_no),
        id: Number(row.id),
        title: row.title || 'Untitled',
        mp3_url: row.mp3_url,
        image_url: row.image_url,
        genre: row.genre,
        plays: Number(row.plays) || 0,
        bpm: row.bpm == null ? null : Number(row.bpm),
        musical_key: row.musical_key || null,
        duration: row.duration == null ? null : Number(row.duration),
        visibility: row.visibility || 'public',
        profile_id: Number(row.profile_id),
        profile_name: row.profile_name || 'Unknown Artist',
        profile_slug: row.profile_slug || null,
    }));
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every release by one artist.
 *
 * Declared before /:releaseId so the literal path wins - by-profile is not a
 * release id, and Express matches in declaration order.
 */
router.get('/by-profile/:profileId', authenticateOptional, async (req, res) => {
    try {
        const identifier = String(req.params.profileId || '').trim();
        const isNumericId = /^\d+$/.test(identifier);

        // Profiles answer to a numeric id forever and to a slug once set, and
        // this route accepts both for the same reason the profile page does.
        const profiles = isNumericId
            ? await pool.query('SELECT id, user_id, name, slug FROM profiles WHERE id = ?', [parseInt(identifier, 10)])
            : await pool.query('SELECT id, user_id, name, slug FROM profiles WHERE slug = ?', [identifier.toLowerCase()]);

        if (!profiles || profiles.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        const profile = profiles[0];
        const isOwner = req.user && Number(profile.user_id) === Number(req.user.id);

        const rows = await pool.query(
            `SELECT r.*, p.name AS profile_name, p.slug AS profile_slug,
                    (SELECT COUNT(*)
                       FROM release_songs rs
                       JOIN songs s ON s.id = rs.song_id
                      WHERE rs.release_id = r.id
                        ${isOwner ? '' : "AND s.visibility = 'public'"}) AS track_count,
                    (SELECT s2.image_url
                       FROM release_songs rs2
                       JOIN songs s2 ON s2.id = rs2.song_id
                      WHERE rs2.release_id = r.id AND s2.image_url IS NOT NULL AND s2.image_url <> ''
                      ORDER BY rs2.track_no ASC
                      LIMIT 1) AS first_track_image
               FROM releases r
               JOIN profiles p ON p.id = r.profile_id
              WHERE r.profile_id = ?
                ${isOwner ? '' : "AND r.visibility = 'public'"}
              ORDER BY COALESCE(r.release_date, DATE(r.created_at)) DESC, r.id DESC`,
            [profile.id]
        );

        res.json({
            releases: rows.map((row) => sanitizeRelease(row, {
                isOwner,
                trackCount: row.track_count,
                coverFallback: row.first_track_image,
            })),
        });
    } catch (err) {
        logger.error('Error in GET /releases/by-profile/:profileId:', err);
        res.status(500).json({ error: 'Failed to load releases' });
    }
});

/**
 * Which releases a track appears on.
 *
 * A track may be on more than one - an EP and a later compilation is ordinary -
 * so this answers with a list and the song page says "appears on" rather than
 * picking one and pretending it is the only home.
 */
router.get('/for-song/:songId', authenticateOptional, async (req, res) => {
    try {
        const songId = parseInt(req.params.songId, 10);
        if (isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid song ID' });
        }

        const rows = await pool.query(
            `SELECT r.id, r.title, r.release_type, r.cover_url, r.release_date, r.visibility,
                    rs.track_no, p.user_id AS owner_user_id, p.name AS profile_name, p.slug AS profile_slug
               FROM release_songs rs
               JOIN releases r ON r.id = rs.release_id
               JOIN profiles p ON p.id = r.profile_id
              WHERE rs.song_id = ?
              ORDER BY COALESCE(r.release_date, DATE(r.created_at)) DESC, r.id DESC`,
            [songId]
        );

        const visible = rows.filter((row) =>
            row.visibility === 'public'
            || (req.user && Number(row.owner_user_id) === Number(req.user.id))
        );

        res.json({
            releases: visible.map((row) => ({
                id: Number(row.id),
                title: row.title,
                release_type: row.release_type,
                cover_url: row.cover_url || null,
                release_date: row.release_date || null,
                visibility: row.visibility,
                track_no: Number(row.track_no),
                profile_name: row.profile_name || 'Unknown Artist',
                profile_slug: row.profile_slug || null,
            })),
        });
    } catch (err) {
        logger.error('Error in GET /releases/for-song/:songId:', err);
        res.status(500).json({ error: 'Failed to load releases for this song' });
    }
});

// One release and its running order.
router.get('/:releaseId', authenticateOptional, async (req, res) => {
    try {
        const releaseId = parseInt(req.params.releaseId, 10);
        if (isNaN(releaseId)) {
            return res.status(400).json({ error: 'Invalid release ID' });
        }

        const release = await findReleaseWithOwner(releaseId);
        if (!release) {
            return res.status(404).json({ error: 'Release not found' });
        }

        const isOwner = req.user && Number(release.owner_user_id) === Number(req.user.id);
        // 404 rather than 403 for the same reason a delisted track does: 403
        // confirms it exists, and an unfinished record is nobody else's news.
        if (release.visibility === 'private' && !isOwner) {
            return res.status(404).json({ error: 'Release not found' });
        }

        const tracks = await tracksForRelease(releaseId, { includeHidden: isOwner });

        res.json({
            release: sanitizeRelease(release, {
                isOwner,
                trackCount: tracks.length,
                coverFallback: tracks.find((t) => t.image_url)?.image_url || null,
            }),
            tracks,
        });
    } catch (err) {
        logger.error('Error in GET /releases/:releaseId:', err);
        res.status(500).json({ error: 'Failed to load release' });
    }
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

router.post('/', authenticate, async (req, res) => {
    // req.body is undefined for a multipart request with no text fields, and
    // express-fileupload is the only multipart parser mounted. See the note on
    // POST /music/:songId/versions.
    const { title, release_type, description, release_date, visibility } = req.body || {};
    const cover = req.files?.cover;

    try {
        const cleanTitle = typeof title === 'string' ? title.trim() : '';
        if (!cleanTitle) {
            return res.status(400).json({ error: 'Give the release a title' });
        }
        if (cleanTitle.length > MAX_TITLE) {
            return res.status(400).json({ error: `Title must be ${MAX_TITLE} characters or fewer` });
        }

        const type = RELEASE_TYPES.includes(release_type) ? release_type : 'album';

        if (description && String(description).length > MAX_DESCRIPTION) {
            return res.status(400).json({ error: `Description must be ${MAX_DESCRIPTION} characters or fewer` });
        }

        const date = parseReleaseDate(release_date);
        if (!date.ok) {
            return res.status(400).json({ error: date.error });
        }

        if (cover && !['image/jpeg', 'image/png'].includes(cover.mimetype)) {
            return res.status(400).json({ error: 'Cover must be a JPEG or PNG' });
        }

        const profile = await profileForUser(req.user.id);
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        let coverUrl = null;
        if (cover) {
            const extension = cover.mimetype === 'image/png' ? '.png' : '.jpg';
            const key = `release-covers/${req.user.id}-${Date.now()}${extension}`;
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: key,
                Body: cover.data,
                ContentType: cover.mimetype,
            }));
            coverUrl = buildPublicFileUrl(key);
        }

        const result = await pool.query(
            `INSERT INTO releases (profile_id, title, release_type, description, cover_url, release_date, visibility)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                profile.id,
                cleanTitle,
                type,
                description ? String(description).trim() : null,
                coverUrl,
                date.value === undefined ? null : date.value,
                visibility === 'private' ? 'private' : 'public',
            ]
        );

        const release = await findReleaseWithOwner(Number(result.insertId));
        res.status(201).json({ release: sanitizeRelease(release, { isOwner: true, trackCount: 0 }) });
    } catch (err) {
        logger.error('Error in POST /releases:', err);
        res.status(500).json({ error: 'Failed to create release' });
    }
});

router.put('/:releaseId', authenticate, async (req, res) => {
    // A cover-only edit sends no text fields at all.
    const { title, release_type, description, release_date, visibility } = req.body || {};
    const cover = req.files?.cover;

    try {
        const releaseId = parseInt(req.params.releaseId, 10);
        if (isNaN(releaseId)) {
            return res.status(400).json({ error: 'Invalid release ID' });
        }

        const release = await findReleaseWithOwner(releaseId);
        if (!release) {
            return res.status(404).json({ error: 'Release not found' });
        }
        if (Number(release.owner_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to edit this release' });
        }

        // Built field by field so that leaving something out of the request
        // means "not part of this edit" rather than "clear it".
        const updates = [];
        const values = [];

        if (title !== undefined) {
            const cleanTitle = String(title).trim();
            if (!cleanTitle) {
                return res.status(400).json({ error: 'Give the release a title' });
            }
            if (cleanTitle.length > MAX_TITLE) {
                return res.status(400).json({ error: `Title must be ${MAX_TITLE} characters or fewer` });
            }
            updates.push('title = ?');
            values.push(cleanTitle);
        }

        if (release_type !== undefined) {
            if (!RELEASE_TYPES.includes(release_type)) {
                return res.status(400).json({ error: 'Release type must be album, ep or single' });
            }
            updates.push('release_type = ?');
            values.push(release_type);
        }

        if (description !== undefined) {
            if (description && String(description).length > MAX_DESCRIPTION) {
                return res.status(400).json({ error: `Description must be ${MAX_DESCRIPTION} characters or fewer` });
            }
            updates.push('description = ?');
            values.push(description ? String(description).trim() : null);
        }

        if (release_date !== undefined) {
            const date = parseReleaseDate(release_date);
            if (!date.ok) {
                return res.status(400).json({ error: date.error });
            }
            updates.push('release_date = ?');
            values.push(date.value);
        }

        if (visibility !== undefined) {
            if (!['public', 'private'].includes(visibility)) {
                return res.status(400).json({ error: "visibility must be 'public' or 'private'" });
            }
            updates.push('visibility = ?');
            values.push(visibility);
        }

        if (cover) {
            if (!['image/jpeg', 'image/png'].includes(cover.mimetype)) {
                return res.status(400).json({ error: 'Cover must be a JPEG or PNG' });
            }
            const extension = cover.mimetype === 'image/png' ? '.png' : '.jpg';
            const key = `release-covers/${req.user.id}-${Date.now()}${extension}`;
            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: key,
                Body: cover.data,
                ContentType: cover.mimetype,
            }));
            updates.push('cover_url = ?');
            values.push(buildPublicFileUrl(key));
        }

        if (!updates.length) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        values.push(releaseId);
        await pool.query(`UPDATE releases SET ${updates.join(', ')} WHERE id = ?`, values);

        const updated = await findReleaseWithOwner(releaseId);
        const tracks = await tracksForRelease(releaseId, { includeHidden: true });
        res.json({
            release: sanitizeRelease(updated, {
                isOwner: true,
                trackCount: tracks.length,
                coverFallback: tracks.find((t) => t.image_url)?.image_url || null,
            }),
        });
    } catch (err) {
        logger.error('Error in PUT /releases/:releaseId:', err);
        res.status(500).json({ error: 'Failed to update release' });
    }
});

/**
 * Delete a release.
 *
 * The grouping goes; the music stays. release_songs cascades, songs are not
 * touched, and every track is still on the artist's profile and still has its
 * own page and its own reviews. This is the one thing an artist most needs to
 * be sure of before they will try the feature at all.
 */
router.delete('/:releaseId', authenticate, async (req, res) => {
    try {
        const releaseId = parseInt(req.params.releaseId, 10);
        if (isNaN(releaseId)) {
            return res.status(400).json({ error: 'Invalid release ID' });
        }

        const release = await findReleaseWithOwner(releaseId);
        if (!release) {
            return res.status(404).json({ error: 'Release not found' });
        }
        if (Number(release.owner_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to delete this release' });
        }

        await pool.query('DELETE FROM releases WHERE id = ?', [releaseId]);
        res.json({ success: true, id: releaseId });
    } catch (err) {
        logger.error('Error in DELETE /releases/:releaseId:', err);
        res.status(500).json({ error: 'Failed to delete release' });
    }
});

/**
 * Put a track on a release.
 *
 * Only the artist's own tracks: a release is a claim of authorship, and being
 * able to attach somebody else's song to your album is a claim you should not
 * be able to make. Playlists are where anyone's music can be collected.
 */
router.post('/:releaseId/songs', authenticate, async (req, res) => {
    try {
        const releaseId = parseInt(req.params.releaseId, 10);
        const songId = parseInt(req.body.song_id, 10);
        if (isNaN(releaseId) || isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid release or song' });
        }

        const release = await findReleaseWithOwner(releaseId);
        if (!release) {
            return res.status(404).json({ error: 'Release not found' });
        }
        if (Number(release.owner_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to edit this release' });
        }

        const songs = await pool.query('SELECT id, profile_id, title FROM songs WHERE id = ?', [songId]);
        if (!songs || songs.length === 0) {
            return res.status(404).json({ error: 'Song not found' });
        }
        if (Number(songs[0].profile_id) !== Number(release.profile_id)) {
            return res.status(403).json({ error: 'You can only add your own tracks to a release' });
        }

        const [existing] = await pool.query(
            'SELECT COUNT(*) AS n FROM release_songs WHERE release_id = ? AND song_id = ?',
            [releaseId, songId]
        );
        if (Number(existing?.n) > 0) {
            return res.status(409).json({ error: 'That track is already on this release' });
        }

        // New tracks land at the end of the running order.
        const [last] = await pool.query(
            'SELECT COALESCE(MAX(track_no), 0) AS highest FROM release_songs WHERE release_id = ?',
            [releaseId]
        );
        const trackNo = Number(last?.highest || 0) + 1;

        await pool.query(
            'INSERT INTO release_songs (release_id, song_id, track_no) VALUES (?, ?, ?)',
            [releaseId, songId, trackNo]
        );

        res.status(201).json({ release_id: releaseId, song_id: songId, track_no: trackNo });
    } catch (err) {
        logger.error('Error in POST /releases/:releaseId/songs:', err);
        res.status(500).json({ error: 'Failed to add track to release' });
    }
});

// Take a track off a release. The song itself is untouched.
router.delete('/:releaseId/songs/:songId', authenticate, async (req, res) => {
    try {
        const releaseId = parseInt(req.params.releaseId, 10);
        const songId = parseInt(req.params.songId, 10);
        if (isNaN(releaseId) || isNaN(songId)) {
            return res.status(400).json({ error: 'Invalid release or song' });
        }

        const release = await findReleaseWithOwner(releaseId);
        if (!release) {
            return res.status(404).json({ error: 'Release not found' });
        }
        if (Number(release.owner_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to edit this release' });
        }

        const result = await pool.query(
            'DELETE FROM release_songs WHERE release_id = ? AND song_id = ?',
            [releaseId, songId]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ error: 'That track is not on this release' });
        }

        // Close the gap the removal left, so the running order stays 1..n and
        // the numbers on screen are the numbers on the record.
        const remaining = await pool.query(
            'SELECT song_id FROM release_songs WHERE release_id = ? ORDER BY track_no ASC, song_id ASC',
            [releaseId]
        );
        for (let i = 0; i < remaining.length; i += 1) {
            await pool.query(
                'UPDATE release_songs SET track_no = ? WHERE release_id = ? AND song_id = ?',
                [i + 1, releaseId, remaining[i].song_id]
            );
        }

        res.json({ success: true, release_id: releaseId, song_id: songId });
    } catch (err) {
        logger.error('Error in DELETE /releases/:releaseId/songs/:songId:', err);
        res.status(500).json({ error: 'Failed to remove track from release' });
    }
});

/**
 * Set the running order.
 *
 * Takes the full list of song ids in the order they should play, rather than a
 * single move, because that is what a drag-and-drop list already has in hand
 * and it cannot half-apply. Ids that are not on the release are ignored, and
 * any track the client left out keeps its place at the end rather than being
 * silently dropped from the record.
 */
router.put('/:releaseId/order', authenticate, async (req, res) => {
    try {
        const releaseId = parseInt(req.params.releaseId, 10);
        if (isNaN(releaseId)) {
            return res.status(400).json({ error: 'Invalid release ID' });
        }
        const { song_ids } = req.body;
        if (!Array.isArray(song_ids)) {
            return res.status(400).json({ error: 'song_ids must be an array of song ids' });
        }

        const release = await findReleaseWithOwner(releaseId);
        if (!release) {
            return res.status(404).json({ error: 'Release not found' });
        }
        if (Number(release.owner_user_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Unauthorized to edit this release' });
        }

        const current = await pool.query(
            'SELECT song_id FROM release_songs WHERE release_id = ? ORDER BY track_no ASC, song_id ASC',
            [releaseId]
        );
        const onRelease = current.map((row) => Number(row.song_id));

        const requested = song_ids.map(Number).filter((id) => onRelease.includes(id));
        const ordered = [...new Set(requested)];
        for (const id of onRelease) {
            if (!ordered.includes(id)) ordered.push(id);
        }

        for (let i = 0; i < ordered.length; i += 1) {
            await pool.query(
                'UPDATE release_songs SET track_no = ? WHERE release_id = ? AND song_id = ?',
                [i + 1, releaseId, ordered[i]]
            );
        }

        res.json({ release_id: releaseId, song_ids: ordered });
    } catch (err) {
        logger.error('Error in PUT /releases/:releaseId/order:', err);
        res.status(500).json({ error: 'Failed to reorder release' });
    }
});

module.exports = router;
