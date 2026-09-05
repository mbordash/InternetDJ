const express = require('express');
const pool = require('../config/database');
const logger = require('../utils/logger');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const authenticateOptional = require('../middleware/authenticateOptional');
const { buildPublicFileUrl } = require('../utils/storage');
const { createNotification, NOTIFICATION_TYPES, sendIdjcTipEmail } = require('../utils/notifications');
const { slugify, validateSlug } = require('../utils/slug');
const { ACTIVITY, listenCoinsToAward } = require('../config/coinRewards');
const { awardCoins, getEarnedForActivityByProfile } = require('../utils/coins');
const router = express.Router();

// Get recommended songs
router.get('/:userId/recommended-songs', authenticate, async (req, res) => {
  const { userId } = req.params;
  const authenticatedUserId = Number(req.user.id);

  try {
    if (isNaN(parseInt(userId)) || parseInt(userId) !== authenticatedUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get user's liked genres and artists from Likes playlist
    const userPreferences = await pool.query(`
      SELECT s.genre, s.profile_id
      FROM playlist_songs ps
             JOIN playlists pl ON ps.playlist_id = pl.id
             JOIN songs s ON ps.song_id = s.id
             JOIN profiles p ON pl.profile_id = p.id
      WHERE p.user_id = ? AND pl.name = 'Likes'
    `, [userId]);

    const preferredGenres = [...new Set(userPreferences.map(p => p.genre).filter(g => g))];
    const preferredArtists = [...new Set(userPreferences.map(p => p.profile_id).filter(id => id))];

    let songs;
    // Fetch unrated songs based on preferences if available, otherwise fetch random unrated songs
    if (preferredGenres.length > 0 || preferredArtists.length > 0) {
      // Construct the query only with non-empty preference arrays
      let query = `
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name, p.slug as profile_slug,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.id NOT IN (
          SELECT ps.song_id
          FROM playlist_songs ps
                 JOIN playlists pl ON ps.playlist_id = pl.id
                 JOIN profiles p2 ON pl.profile_id = p2.id
          WHERE p2.user_id = ? AND pl.name = 'Likes'
        )
          AND s.mp3_url IS NOT NULL AND s.visibility = 'public'
        ORDER BY
          CASE
      `;
      const params = [userId];

      // Add genre preference if available
      if (preferredGenres.length > 0) {
        query += `WHEN s.genre IN (${preferredGenres.map(() => '?').join(',')}) THEN 1 `;
        params.push(...preferredGenres);
      }

      // Add artist preference if available
      if (preferredArtists.length > 0) {
        query += `WHEN s.profile_id IN (${preferredArtists.map(() => '?').join(',')}) THEN 2 `;
        params.push(...preferredArtists);
      }

      query += `
          ELSE 3
          END,
          RAND()
        LIMIT 10
      `;
      songs = await pool.query(query, params);
    } else {
      // Fetch random unrated songs if no preferences
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name, p.slug as profile_slug,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.id NOT IN (
          SELECT ps.song_id
          FROM playlist_songs ps
                 JOIN playlists pl ON ps.playlist_id = pl.id
                 JOIN profiles p2 ON pl.profile_id = p2.id
          WHERE p2.user_id = ? AND pl.name = 'Likes'
        )
          AND s.mp3_url IS NOT NULL AND s.visibility = 'public'
        ORDER BY RAND()
          LIMIT 10
      `, [userId]);
    }

    // If no unrated songs, fetch any random song
    if (songs.length === 0) {
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name, p.slug as profile_slug,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.mp3_url IS NOT NULL AND s.visibility = 'public'
        ORDER BY RAND()
          LIMIT 10
      `);
    }

    const sanitizedSongs = songs.map(song => ({
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      profile_slug: song.profile_slug || null,
      title: song.title || 'Untitled',
      mp3_url: song.mp3_url || null,
      image_url: song.image_url || null,
      description: song.description || null,
      genre: song.genre || null,
      plays: Number(song.plays) || 0,
      likes_count: Number(song.likes_count) || 0,
      user_id: song.user_id ? Number(song.user_id) : null,
      profile_name: song.profile_name || 'Unknown Artist',
      profile_slug: song.profile_slug || null,
    }));

    res.status(200).json(sanitizedSongs);
  } catch (err) {
    logger.error('Error in GET /profile/:userId/recommended-songs:', err);
    res.status(500).json({ error: 'Failed to fetch recommended songs: ' + err.message });
  }
});

// Get a random liked song (secondary fallback)
router.get('/:userId/liked-songs', authenticate, async (req, res) => {
  const { userId } = req.params;
  const authenticatedUserId = Number(req.user.id);

  try {
    if (isNaN(parseInt(userId)) || parseInt(userId) !== authenticatedUserId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Fetch a random liked song from the Likes playlist
    let songs = await pool.query(`
      SELECT
        s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
        s.genre, s.plays, p.user_id, p.name as profile_name, p.slug as profile_slug,
        (SELECT COUNT(*)
         FROM playlist_songs ps2
                JOIN playlists pl2 ON ps2.playlist_id = pl2.id
         WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
      FROM playlist_songs ps
             JOIN playlists pl ON ps.playlist_id = pl.id
             JOIN songs s ON ps.song_id = s.id
             JOIN profiles p ON pl.profile_id = p.id
      WHERE p.user_id = ? AND pl.name = 'Likes' AND s.mp3_url IS NOT NULL AND s.visibility = 'public'
      ORDER BY RAND()
        LIMIT 1
    `, [userId]);

    // If no liked songs, fetch a random unrated song
    if (songs.length === 0) {
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name, p.slug as profile_slug,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.id NOT IN (
          SELECT ps.song_id
          FROM playlist_songs ps
                 JOIN playlists pl ON ps.playlist_id = pl.id
                 JOIN profiles p2 ON pl.profile_id = p2.id
          WHERE p2.user_id = ? AND pl.name = 'Likes'
        )
          AND s.mp3_url IS NOT NULL AND s.visibility = 'public'
        ORDER BY RAND()
          LIMIT 1
      `, [userId]);
    }

    // If still no songs, fetch any random song
    if (songs.length === 0) {
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name, p.slug as profile_slug,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.mp3_url IS NOT NULL AND s.visibility = 'public'
        ORDER BY RAND()
          LIMIT 1
      `);
    }

    const sanitizedSongs = songs.map(song => ({
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      profile_slug: song.profile_slug || null,
      title: song.title || 'Untitled',
      mp3_url: song.mp3_url || null,
      image_url: song.image_url || null,
      description: song.description || null,
      genre: song.genre || null,
      plays: Number(song.plays) || 0,
      likes_count: Number(song.likes_count) || 0,
      user_id: song.user_id ? Number(song.user_id) : null,
      profile_name: song.profile_name || 'Unknown Artist',
      profile_slug: song.profile_slug || null,
    }));

    res.status(200).json(sanitizedSongs);
  } catch (err) {
    logger.error('Error in GET /profile/:userId/liked-songs:', err);
    res.status(500).json({ error: 'Failed to fetch liked songs: ' + err.message });
  }
});

router.post('/', authenticate, async (req, res) => {
  const {
    name,
    location,
    genre,
    description,
    background,
    donation_link,
    solana_address,
    website_url,
    x_url,
    facebook_url,
    youtube_url,
    instagram_url,
    slug,
  } = req.body;
  const picture = req.files?.picture;
  const backgroundImage = req.files?.backgroundImage;
  const heroBackgroundImage = req.files?.heroBackgroundImage;
  try {
    // Validate the vanity address before writing anything, so a bad address
    // can't half-save a profile. Deliberately kept out of the big upsert below:
    // that query is positional, and slotting another column into both value
    // arrays is a good way to silently shift every field by one.
    let slugToSave;              // undefined = leave alone, null = clear
    if (typeof slug !== 'undefined') {
      const wanted = String(slug || '').trim();
      if (wanted === '') {
        slugToSave = null;
      } else {
        const result = validateSlug(wanted);
        if (!result.ok) {
          return res.status(400).json({ error: result.error });
        }
        const clash = await pool.query(
          'SELECT id FROM profiles WHERE slug = ? AND user_id <> ?',
          [result.slug, req.user.id]
        );
        if (Array.isArray(clash) && clash.length > 0) {
          return res.status(409).json({ error: 'That profile address is already taken.' });
        }
        slugToSave = result.slug;
      }
    }

    let pictureUrl = null;
    let backgroundValue = background || null;
    let heroBackgroundUrl = null;

    // Handle picture upload
    if (picture) {
      const uploadParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: `pictures/${req.user.id}-${Date.now()}.jpg`,
        Body: picture.data,
      };
      await s3Client.send(new PutObjectCommand(uploadParams));
      pictureUrl = buildPublicFileUrl(uploadParams.Key);
      logger.debug('Generated pictureUrl:', pictureUrl);
    }

    // Handle background image upload
    if (backgroundImage) {
      const uploadParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: `backgrounds/${req.user.id}-${Date.now()}.jpg`,
        Body: backgroundImage.data,
      };
      await s3Client.send(new PutObjectCommand(uploadParams));
      backgroundValue = buildPublicFileUrl(uploadParams.Key);
      logger.debug('Generated backgroundValue:', backgroundValue);
    }

    if (heroBackgroundImage) {
      const uploadParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: `hero-backgrounds/${req.user.id}-${Date.now()}.jpg`,
        Body: heroBackgroundImage.data,
      };
      await s3Client.send(new PutObjectCommand(uploadParams));
      heroBackgroundUrl = buildPublicFileUrl(uploadParams.Key);
      logger.debug('Generated heroBackgroundUrl:', heroBackgroundUrl);
    }

    // Fetch existing profile data
    const existingProfiles = await pool.query(
        `SELECT picture_url, background, hero_background, donation_link, solana_address, location,
                website_url, x_url, facebook_url, youtube_url, instagram_url
         FROM profiles WHERE user_id = ?`,
        [req.user.id]
    );
    const currentPictureUrl = existingProfiles.length > 0 ? existingProfiles[0].picture_url : null;
    const currentBackground = existingProfiles.length > 0 ? existingProfiles[0].background : null;
    const currentHeroBackground = existingProfiles.length > 0 ? existingProfiles[0].hero_background : null;
    const currentDonationLink = existingProfiles.length > 0 ? existingProfiles[0].donation_link : null;
    const currentSolanaAddress = existingProfiles.length > 0 ? existingProfiles[0].solana_address : null;
    const currentLocation = existingProfiles.length > 0 ? existingProfiles[0].location : null;
    const currentWebsiteUrl = existingProfiles.length > 0 ? existingProfiles[0].website_url : null;
    const currentXUrl = existingProfiles.length > 0 ? existingProfiles[0].x_url : null;
    const currentFacebookUrl = existingProfiles.length > 0 ? existingProfiles[0].facebook_url : null;
    const currentYoutubeUrl = existingProfiles.length > 0 ? existingProfiles[0].youtube_url : null;
    const currentInstagramUrl = existingProfiles.length > 0 ? existingProfiles[0].instagram_url : null;

    // Validate Solana address (optional, basic check for 44-character Base58)
    if (solana_address && !/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(solana_address)) {
      return res.status(400).json({ error: 'Invalid Solana address format' });
    }

    // Update or insert profile
    await pool.query(
        `INSERT INTO profiles (
            user_id, name, location, genre, picture_url, description, background, hero_background, donation_link, solana_address,
            website_url, x_url, facebook_url, youtube_url, instagram_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            name = ?,
            location = ?,
            genre = ?,
            picture_url = COALESCE(?, picture_url),
            description = ?,
            background = ?,
            hero_background = ?,
            donation_link = ?,
            solana_address = ?,
            website_url = ?,
            x_url = ?,
            facebook_url = ?,
            youtube_url = ?,
            instagram_url = ?`,
        [
          req.user.id,
          name,
          location || currentLocation,
          genre,
          pictureUrl || currentPictureUrl,
          description,
          backgroundValue || currentBackground,
          heroBackgroundUrl || currentHeroBackground,
          donation_link || currentDonationLink,
          solana_address || currentSolanaAddress,
          website_url || currentWebsiteUrl,
          x_url || currentXUrl,
          facebook_url || currentFacebookUrl,
          youtube_url || currentYoutubeUrl,
          instagram_url || currentInstagramUrl,
          name,
          location,
          genre,
          pictureUrl,
          description,
          backgroundValue,
          heroBackgroundUrl || currentHeroBackground,
          donation_link,
          solana_address,
          website_url,
          x_url,
          facebook_url,
          youtube_url,
          instagram_url,
        ]
    );

    if (typeof slugToSave !== 'undefined') {
      try {
        await pool.query('UPDATE profiles SET slug = ? WHERE user_id = ?', [slugToSave, req.user.id]);
      } catch (slugErr) {
        // Two people can pass the availability check at the same moment; the
        // unique index is what actually decides, so report that honestly.
        if (slugErr && (slugErr.code === 'ER_DUP_ENTRY' || slugErr.errno === 1062)) {
          return res.status(409).json({ error: 'That profile address was just taken. Try another.' });
        }
        throw slugErr;
      }
    }

    // Fetch updated profile
    const profiles = await pool.query('SELECT * FROM profiles WHERE user_id = ?', [req.user.id]);
    if (!profiles || profiles.length === 0) {
      logger.error('No profile found after insert/update for user_id:', req.user.id);
      return res.status(500).json({ error: 'Failed to retrieve updated profile' });
    }

    const profile = profiles[0];
    res.status(200).json({ profile, pictureUrl, background: backgroundValue });
  } catch (err) {
    logger.error('Error in POST /profile:', {
      message: err.message,
      stack: err.stack,
      userId: req.user.id,
    });
    res.status(500).json({ error: 'Failed to update profile: ' + err.message });
  }
});

router.get('/latest', async (req, res) => {
  try {
    logger.debug('Hit /profile/latest endpoint');
    const rows = await pool.query(`
      SELECT id, user_id, name, slug, created_at, picture_url
      FROM profiles
      ORDER BY created_at DESC
        LIMIT 5
    `);
    const sanitizedRows = rows.map((row) => ({
      user_id: Number(row.user_id),
      profile_id: Number(row.id),
      profile_slug: row.slug || null,
      name: row.name || 'Unknown',
      created_at: row.created_at,
      picture_url: row.picture_url || null,
    }));
    res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
  } catch (err) {
    logger.error('Error in GET /profile/latest:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/most-popular', async (req, res) => {
  try {
    logger.debug('Hit /profile/most-popular endpoint');
    const rows = await pool.query(`
      SELECT p.id, p.user_id, p.name, p.slug, COALESCE(SUM(s.plays), 0) as total_plays, p.picture_url
      FROM profiles p
             LEFT JOIN songs s ON p.id = s.profile_id AND s.visibility = 'public'
      GROUP BY p.id, p.user_id, p.name, p.slug, p.picture_url
      ORDER BY total_plays DESC
        LIMIT 5
    `);
    const sanitizedRows = rows.map((row) => ({
      user_id: Number(row.user_id),
      profile_id: Number(row.id),
      profile_slug: row.slug || null,
      name: row.name || 'Unknown',
      total_plays: Number(row.total_plays) || 0,
      picture_url: row.picture_url || null,
    }));
    logger.debug('Most Popular Profiles:', sanitizedRows);
    res.json(Array.isArray(sanitizedRows) ? sanitizedRows : []);
  } catch (err) {
    logger.error('Error in GET /profile/most-popular:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reviewers ranked by how many substantive reviews they have written.
// Counting every row would reward drive-by one-word reviews, so a review has
// to clear a minimum length to score - the leaderboard should reward effort,
// not volume. Ties break toward the most recent activity so the board moves.
const MIN_SCORING_REVIEW_CHARS = 40;

router.get('/top-reviewers', async (req, res) => {
  try {
    logger.debug('Hit /profile/top-reviewers endpoint');
    const rows = await pool.query(`
      SELECT p.id, p.user_id, p.name, p.slug, p.picture_url,
             COUNT(r.id) AS review_count,
             MAX(r.created_at) AS last_reviewed_at
      FROM reviews r
             JOIN profiles p ON p.id = r.profile_id
      WHERE r.review IS NOT NULL
        AND CHAR_LENGTH(TRIM(r.review)) >= ?
      GROUP BY p.id, p.user_id, p.name, p.slug, p.picture_url
      HAVING review_count > 0
      ORDER BY review_count DESC, last_reviewed_at DESC
      LIMIT 5
    `, [MIN_SCORING_REVIEW_CHARS]);

    const sanitizedRows = rows.map((row) => ({
      user_id: Number(row.user_id),
      profile_id: Number(row.id),
      profile_slug: row.slug || null,
      name: row.name || 'Unknown',
      review_count: Number(row.review_count) || 0,
      picture_url: row.picture_url || null,
    }));
    res.json(sanitizedRows);
  } catch (err) {
    logger.error('Error in GET /profile/top-reviewers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Is this profile address free? Used by the edit form as you type.
router.get('/slug-available/:slug', authenticate, async (req, res) => {
  try {
    const result = validateSlug(req.params.slug);
    if (!result.ok) {
      return res.json({ available: false, reason: result.error });
    }
    const rows = await pool.query(
      'SELECT p.id FROM profiles p WHERE p.slug = ? AND p.user_id <> ?',
      [result.slug, req.user.id]
    );
    const taken = Array.isArray(rows) && rows.length > 0;
    res.json({
      available: !taken,
      slug: result.slug,
      reason: taken ? 'That address is already taken.' : null,
    });
  } catch (err) {
    logger.error('Error in GET /profile/slug-available:', err);
    res.status(500).json({ error: 'Failed to check address' });
  }
});

// Optionally authenticated: the profile page is public, but the artist looking
// at their own page has to see the tracks they delisted. Manage Songs reads its
// list from this route too, and it would be empty of hidden tracks otherwise -
// which is exactly where the switch to unhide them lives.
router.get('/:profileId', authenticateOptional, async (req, res, next) => {
  try {
    // A profile answers to its numeric id forever, and to its slug once set.
    // Slugs can never be all digits, so the two can't be confused.
    const identifier = String(req.params.profileId || '').trim();
    const isNumericId = /^\d+$/.test(identifier);

    const profiles = isNumericId
      ? await pool.query('SELECT * FROM profiles WHERE id = ?', [parseInt(identifier, 10)])
      : await pool.query('SELECT * FROM profiles WHERE slug = ?', [identifier.toLowerCase()]);

    if (!Array.isArray(profiles) || profiles.length === 0) {
      logger.debug(`No profile found for identifier: ${identifier}`);
      // Non-numeric misses fall through, matching the previous behaviour.
      return isNumericId ? res.status(404).json({ error: 'Profile not found' }) : next();
    }
    const profile = profiles[0];
    // Everything below keys off the real numeric id, whichever address was used.
    const profileId = Number(profile.id);
    if (!profile || typeof profile !== 'object') {
      logger.error('Invalid profile data for profile_id:', profileId, profile);
      return res.status(500).json({ error: 'Invalid profile data' });
    }
    const isOwner = req.user && Number(profile.user_id) === Number(req.user.id);

    const songs = await pool.query(`
      SELECT s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description, s.genre, s.plays, s.created_at, s.is_featured, s.allow_download, s.allow_ai_training, s.bpm, s.musical_key, s.duration, s.visibility, s.share_token, s.current_version_no, p.user_id, p.name as profile_name, p.slug as profile_slug,
             (SELECT COUNT(*)
              FROM playlist_songs ps
                     JOIN playlists pl ON ps.playlist_id = pl.id
              WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count,
             -- Manage Songs has always rendered an avg_rating that nothing sent
             -- it, so every row read "N/A" however the song was reviewed. Only
             -- reviews that carried a score count: a comment without one is not
             -- a zero.
             (SELECT AVG(r.rating) FROM reviews r
               WHERE r.song_id = s.id AND r.rating IS NOT NULL) AS avg_rating,
             -- Which records this track sits on. Joined here rather than asked
             -- for per song, because the Songs Manager shows it on every row
             -- and a request per track would be an N+1 on page load. A hidden
             -- release is only named to the artist who owns it.
             (SELECT GROUP_CONCAT(rel.title ORDER BY rel.release_date DESC SEPARATOR '||')
                FROM release_songs rs
                JOIN releases rel ON rel.id = rs.release_id
               WHERE rs.song_id = s.id
                 ${isOwner ? '' : "AND rel.visibility = 'public'"}) AS release_titles
      FROM songs s
             LEFT JOIN profiles p ON s.profile_id = p.id
      WHERE s.profile_id = ?
        ${isOwner ? '' : "AND s.visibility = 'public'"}
      ORDER BY s.created_at DESC
    `, [profile.id]);
    const sanitizedSongs = songs.map((song) => ({
      ...song,
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      profile_slug: song.profile_slug || null,
      plays: Number(song.plays) || 0,
      is_featured: Boolean(song.is_featured),
      allow_download: Boolean(song.allow_download),
      // Manage Songs reads its list from here, so a permission missing from
      // this column list reads back as off however it was saved.
      allow_ai_training: Boolean(song.allow_ai_training),
      visibility: song.visibility || 'public',
      // Split here so the client gets a list rather than a delimited string.
      releases: song.release_titles ? String(song.release_titles).split('||') : [],
      current_version_no: Number(song.current_version_no) || 1,
      // The share token is a credential. It goes to the artist who owns the
      // track and to nobody else; every other viewer is told only whether the
      // field exists at all, and not even that.
      share_token: isOwner ? (song.share_token || null) : undefined,
      has_share_link: isOwner ? !!song.share_token : undefined,
      avg_rating: song.avg_rating == null ? null : Number(song.avg_rating),
      user_id: song.user_id ? Number(song.user_id) : null,
      profile_name: song.profile_name || 'Unknown Artist',
      profile_slug: song.profile_slug || null,
      likes_count: Number(song.likes_count) || 0,
    }));

    // Calculate total IDJC earned
    // Coin balances come from the ledger, not profile_earnings: the ledger is
    // where every activity records its awards, and listens are only the first.
    const earnings = await pool.query('SELECT COALESCE(SUM(coins), 0) as total_earned FROM coin_events WHERE profile_id = ?', [profileId]);
    const total_idjc_earned = Number(earnings[0].total_earned) || 0;

    // Calculate total paid
    const paid = await pool.query('SELECT SUM(amount) as total_paid FROM idjc_payments WHERE profile_id = ?', [profileId]);
    const total_paid = Number(paid[0].total_paid) || 0;

    // Calculate unpaid
    const unpaid = total_idjc_earned - total_paid;

    const followerCountResult = await pool.query(
      'SELECT COUNT(*) as follower_count FROM follows WHERE followed_profile_id = ?',
      [profileId]
    );
    const follower_count = Number(followerCountResult[0].follower_count) || 0;

    const followingCountResult = await pool.query(
      'SELECT COUNT(*) as following_count FROM follows WHERE follower_id = ?',
      [profile.user_id]
    );
    const following_count = Number(followingCountResult[0].following_count) || 0;

    res.json({
      profile: {
        ...profile,
        total_idjc_earned,
        total_paid,
        unpaid,
        follower_count,
        following_count,
      },
      songs: sanitizedSongs,
    });
  } catch (err) {
    logger.error('Error in GET /profile/:profileId:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
    });
    res.status(500).json({ error: 'Failed to fetch profile: ' + err.message });
  }
});

router.patch('/:profileId/featured-song', authenticate, async (req, res) => {
  const { profileId } = req.params;
  const { songId } = req.body;
  const parsedProfileId = Number(profileId);

  if (!Number.isInteger(parsedProfileId)) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  try {
    const profiles = await pool.query('SELECT id, user_id FROM profiles WHERE id = ?', [parsedProfileId]);
    if (!profiles.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const targetProfile = profiles[0];
    if (Number(targetProfile.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query('UPDATE songs SET is_featured = FALSE WHERE profile_id = ?', [parsedProfileId]);

    if (songId !== null && songId !== undefined && songId !== '') {
      const parsedSongId = Number(songId);
      if (!Number.isInteger(parsedSongId)) {
        return res.status(400).json({ error: 'Invalid song ID' });
      }

      const songs = await pool.query('SELECT id FROM songs WHERE id = ? AND profile_id = ?', [parsedSongId, parsedProfileId]);
      if (!songs.length) {
        return res.status(404).json({ error: 'Song not found for this profile' });
      }

      await pool.query('UPDATE songs SET is_featured = TRUE WHERE id = ? AND profile_id = ?', [parsedSongId, parsedProfileId]);
    }

    return res.status(200).json({ message: 'Featured song updated successfully' });
  } catch (err) {
    logger.error('Error in PATCH /profile/:profileId/featured-song:', {
      message: err.message,
      stack: err.stack,
      profileId,
      userId: req.user.id,
      songId,
    });
    return res.status(500).json({ error: 'Failed to update featured song: ' + err.message });
  }
});

// Record payment
router.post('/:profileId/record-payment', authenticate, async (req, res) => {
  const { profileId } = req.params;
  const { amount, signature } = req.body;
  const parsedProfileId = parseInt(profileId);

  if (isNaN(parsedProfileId) || !amount || !signature || amount <= 0) {
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  // Verify user is admin
  const user = await pool.query('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  if (!user.length || user[0].is_admin !== 1) {
    return res.status(403).json({ error: 'Unauthorized: Only admins can record payments' });
  }

  try {
    await pool.query(`
      INSERT INTO idjc_payments (profile_id, amount, transaction_signature)
      VALUES (?, ?, ?)
    `, [parsedProfileId, amount, signature]);

    res.status(200).json({ message: 'Payment recorded successfully' });
  } catch (err) {
    logger.error('Error in POST /profile/:profileId/record-payment:', err);
    res.status(500).json({ error: 'Failed to record payment: ' + err.message });
  }
});

router.post('/:profileId/idjc-tip-notify', authenticateOptional, async (req, res) => {
  const parsedProfileId = Number(req.params.profileId);
  const amount = Number(req.body.amount);
  const signature = typeof req.body.signature === 'string' ? req.body.signature.trim() : '';
  const senderWallet = typeof req.body.sender_wallet === 'string' ? req.body.sender_wallet.trim() : null;
  const recipientWallet = typeof req.body.recipient_wallet === 'string' ? req.body.recipient_wallet.trim() : null;
  const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{44}$/;

  if (!Number.isInteger(parsedProfileId) || !Number.isFinite(amount) || amount <= 0 || !signature) {
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  try {
    const profiles = await pool.query(
      'SELECT id, user_id, name, solana_address FROM profiles WHERE id = ? LIMIT 1',
      [parsedProfileId]
    );

    if (!profiles.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const recipientProfile = profiles[0];
    const recipientUserId = Number(recipientProfile.user_id);
    const actorUserId = req.user?.id ? Number(req.user.id) : null;

    if (!recipientUserId) {
      return res.status(400).json({ error: 'Invalid profile owner' });
    }

    if (actorUserId && recipientUserId === actorUserId) {
      return res.status(400).json({ error: 'You cannot send IDJC to your own profile' });
    }

    if (recipientWallet && recipientProfile.solana_address && recipientWallet !== recipientProfile.solana_address) {
      return res.status(400).json({ error: 'Recipient wallet does not match profile wallet address' });
    }

    if (senderWallet && !SOLANA_ADDRESS_REGEX.test(senderWallet)) {
      return res.status(400).json({ error: 'Invalid sender wallet address' });
    }

    if (recipientWallet && !SOLANA_ADDRESS_REGEX.test(recipientWallet)) {
      return res.status(400).json({ error: 'Invalid recipient wallet address' });
    }

    const formattedAmount = amount.toLocaleString('en-US', { maximumFractionDigits: 9 });

    if (actorUserId) {
      // Logged-in gifter: record an in-app notification plus email, attributed to their account.
      await createNotification({
        recipientUserId,
        actorUserId,
        type: NOTIFICATION_TYPES.IDJC_RECEIVED,
        message: `You received ${formattedAmount} IDJC.`,
        entityType: 'profile',
        entityId: parsedProfileId,
        metadata: {
          amount,
          signature,
          sender_wallet: senderWallet,
          recipient_wallet: recipientProfile.solana_address || recipientWallet || null,
        },
      });
    } else {
      // Anonymous gifter: there's no account to attribute an in-app notification to,
      // so just email the artist that they received a gift.
      await sendIdjcTipEmail({
        recipientUserId,
        amount,
        entityId: parsedProfileId,
        actorLabel: senderWallet ? `A supporter (${senderWallet.slice(0, 4)}...${senderWallet.slice(-4)})` : undefined,
      });
    }

    return res.status(200).json({ message: 'IDJC tip notification sent' });
  } catch (err) {
    logger.error('Error in POST /profile/:profileId/idjc-tip-notify:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
      userId: req.user?.id,
    });
    return res.status(500).json({ error: 'Failed to send IDJC tip notification' });
  }
});

// Follow a profile
router.post('/:userId/follow', authenticate, async (req, res) => {
  const { userId } = req.params;
  const followerId = req.user.id;

  try {
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const profiles = await pool.query('SELECT id, user_id, name FROM profiles WHERE id = ?', [userId]);
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const profileId = profiles[0].id;
    const profileOwnerUserId = Number(profiles[0].user_id);

    if (parseInt(userId) === followerId) {
      return res.status(400).json({ error: 'Cannot follow your own profile' });
    }

    const existingFollow = await pool.query(
        'SELECT id FROM follows WHERE follower_id = ? AND followed_profile_id = ?',
        [followerId, profileId]
    );

    if (existingFollow.length > 0) {
      return res.status(400).json({ error: 'Already following this profile' });
    }

    await pool.query(
        'INSERT INTO follows (follower_id, followed_profile_id) VALUES (?, ?)',
        [followerId, profileId]
    );

    await createNotification({
      recipientUserId: profileOwnerUserId,
      actorUserId: followerId,
      type: NOTIFICATION_TYPES.PROFILE_FOLLOWED,
      message: 'Someone started following your profile.',
      entityType: 'profile',
      entityId: Number(profileId),
      metadata: {
        profile_name: profiles[0].name || null,
      },
    });

    res.status(200).json({ message: 'Successfully followed profile' });
  } catch (err) {
    logger.error('Error in POST /profile/:userId/follow:', {
      message: err.message,
      stack: err.stack,
      userId,
      followerId,
    });
    res.status(500).json({ error: 'Failed to follow profile: ' + err.message });
  }
});

// Unfollow a profile
router.delete('/:userId/follow', authenticate, async (req, res) => {
  const { userId } = req.params;
  const followerId = req.user.id;

  try {
    if (isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const profiles = await pool.query('SELECT id FROM profiles WHERE id = ?', [userId]);
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const profileId = profiles[0].id;

    const existingFollow = await pool.query(
        'SELECT id FROM follows WHERE follower_id = ? AND followed_profile_id = ?',
        [followerId, profileId]
    );

    if (existingFollow.length === 0) {
      return res.status(400).json({ error: 'Not following this profile' });
    }

    await pool.query(
        'DELETE FROM follows WHERE follower_id = ? AND followed_profile_id = ?',
        [followerId, profileId]
    );

    res.status(200).json({ message: 'Successfully unfollowed profile' });
  } catch (err) {
    logger.error('Error in DELETE /profile/:userId/follow:', {
      message: err.message,
      stack: err.stack,
      userId,
      followerId,
    });
    res.status(500).json({ error: 'Failed to unfollow profile: ' + err.message });
  }
});

// Get follow status
router.get('/:profileId/follow-status', authenticate, async (req, res) => {
  const { profileId } = req.params;
  const followerId = req.user.id;

  try {
    if (isNaN(parseInt(profileId))) {
      return res.status(400).json({ error: 'Invalid profile ID' });
    }

    const profiles = await pool.query('SELECT id FROM profiles WHERE id = ?', [profileId]);
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const existingFollow = await pool.query(
        'SELECT id FROM follows WHERE follower_id = ? AND followed_profile_id = ?',
        [followerId, profileId]
    );

    res.status(200).json({ isFollowing: existingFollow.length > 0 });
  } catch (err) {
    logger.error('Error in GET /profile/:profileId/follow-status:', {
      message: err.message,
      stack: err.stack,
      profileId,
      followerId,
    });
    res.status(500).json({ error: 'Failed to fetch follow status: ' + err.message });
  }
});

// Get followers for a profile
router.get('/:profileId/followers', async (req, res) => {
  const parsedProfileId = Number(req.params.profileId);

  if (!Number.isInteger(parsedProfileId)) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  try {
    const rows = await pool.query(`
      SELECT
        p.id AS profile_id,
        p.user_id,
        p.name,
        p.slug AS profile_slug,
        p.picture_url,
        f.created_at
      FROM follows f
      JOIN profiles p ON p.user_id = f.follower_id
      WHERE f.followed_profile_id = ?
      ORDER BY f.created_at DESC
    `, [parsedProfileId]);

    const followers = rows.map((row) => ({
      profile_id: Number(row.profile_id),
      profile_slug: row.profile_slug || null,
      user_id: Number(row.user_id),
      name: row.name || 'Unknown',
      picture_url: row.picture_url || null,
      created_at: row.created_at,
    }));

    res.status(200).json(followers);
  } catch (err) {
    logger.error('Error in GET /profile/:profileId/followers:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
    });
    res.status(500).json({ error: 'Failed to fetch followers: ' + err.message });
  }
});

// Get profiles this artist is following
router.get('/:profileId/following', async (req, res) => {
  const parsedProfileId = Number(req.params.profileId);

  if (!Number.isInteger(parsedProfileId)) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  try {
    const profiles = await pool.query('SELECT user_id FROM profiles WHERE id = ?', [parsedProfileId]);
    if (!profiles.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const followerUserId = Number(profiles[0].user_id);
    const rows = await pool.query(`
      SELECT
        p.id AS profile_id,
        p.user_id,
        p.name,
        p.slug AS profile_slug,
        p.picture_url,
        f.created_at
      FROM follows f
      JOIN profiles p ON p.id = f.followed_profile_id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
    `, [followerUserId]);

    const following = rows.map((row) => ({
      profile_id: Number(row.profile_id),
      profile_slug: row.profile_slug || null,
      user_id: Number(row.user_id),
      name: row.name || 'Unknown',
      picture_url: row.picture_url || null,
      created_at: row.created_at,
    }));

    res.status(200).json(following);
  } catch (err) {
    logger.error('Error in GET /profile/:profileId/following:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
    });
    res.status(500).json({ error: 'Failed to fetch following: ' + err.message });
  }
});

// Get songs this artist liked from other artists
router.get('/:profileId/liked-songs-public', async (req, res) => {
  const parsedProfileId = Number(req.params.profileId);

  if (!Number.isInteger(parsedProfileId)) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  try {
    const rows = await pool.query(`
      SELECT
        s.id,
        s.title,
        s.mp3_url,
        s.image_url,
        s.profile_id,
        p.name AS profile_name, p.slug AS profile_slug,
        (
          SELECT COUNT(*)
          FROM playlist_songs ps2
          JOIN playlists pl2 ON ps2.playlist_id = pl2.id
          WHERE pl2.name = 'Likes' AND ps2.song_id = s.id
        ) AS likes_count,
        ps.added_at
      FROM playlists pl
      JOIN playlist_songs ps ON ps.playlist_id = pl.id
      JOIN songs s ON s.id = ps.song_id
      LEFT JOIN profiles p ON p.id = s.profile_id
      WHERE pl.profile_id = ?
        AND pl.name = 'Likes'
        AND s.profile_id <> ?
        AND s.visibility = 'public'
      ORDER BY RAND()
      LIMIT 3
    `, [parsedProfileId, parsedProfileId]);

    const likedSongs = rows.map((row) => ({
      id: Number(row.id),
      title: row.title || 'Untitled',
      mp3_url: row.mp3_url || null,
      image_url: row.image_url || null,
      profile_id: Number(row.profile_id),
      profile_slug: row.profile_slug || null,
      profile_name: row.profile_name || 'Unknown Artist',
      profile_slug: row.profile_slug || null,
      likes_count: Number(row.likes_count) || 0,
      added_at: row.added_at,
    }));

    res.status(200).json(likedSongs);
  } catch (err) {
    logger.error('Error in GET /profile/:profileId/liked-songs-public:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
    });
    res.status(500).json({ error: 'Failed to fetch liked songs: ' + err.message });
  }
});

// Get latest reviews this artist made on other artists' songs
router.get('/:profileId/recent-reviews', async (req, res) => {
  const parsedProfileId = Number(req.params.profileId);

  if (!Number.isInteger(parsedProfileId)) {
    return res.status(400).json({ error: 'Invalid profile ID' });
  }

  try {
    const rows = await pool.query(`
      SELECT
        r.id,
        r.review,
        r.created_at,
        s.id AS song_id,
        s.title AS song_title,
        s.profile_id AS song_profile_id,
        p.name AS song_artist_name
      FROM reviews r
      JOIN songs s ON s.id = r.song_id
      LEFT JOIN profiles p ON p.id = s.profile_id
      WHERE r.profile_id = ?
        AND s.profile_id <> ?
        AND s.visibility = 'public'
      ORDER BY r.created_at DESC
      LIMIT 6
    `, [parsedProfileId, parsedProfileId]);

    const reviews = rows.map((row) => ({
      id: Number(row.id),
      review: row.review || '',
      created_at: row.created_at,
      song_id: Number(row.song_id),
      song_title: row.song_title || 'Untitled',
      song_profile_id: Number(row.song_profile_id),
      song_artist_name: row.song_artist_name || 'Unknown Artist',
    }));

    res.status(200).json(reviews);
  } catch (err) {
    logger.error('Error in GET /profile/:profileId/recent-reviews:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
    });
    res.status(500).json({ error: 'Failed to fetch recent reviews: ' + err.message });
  }
});

// Get latest songs from followed profiles
router.get('/:userId/followed-songs', authenticate, async (req, res) => {
  const { userId } = req.params;
  const authenticatedUserId = Number(req.user.id);

  logger.debug('req.user.id:', req.user.id, 'Type:', typeof req.user.id, 'Converted:', authenticatedUserId);

  try {
    const parsedUserId = parseInt(userId);
    if (isNaN(parsedUserId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (isNaN(authenticatedUserId)) {
      logger.error('Invalid authenticatedUserId:', req.user.id);
      return res.status(500).json({ error: 'Internal server error: Invalid authenticated user ID' });
    }

    if (parsedUserId !== authenticatedUserId) {
      return res.status(403).json({ error: 'Unauthorized: You can only fetch your own followed songs' });
    }

    const songs = await pool.query(`
      SELECT
        s.id,
        s.profile_id,
        s.title,
        s.mp3_url,
        s.image_url,
        s.description,
        s.genre,
        s.plays,
        s.created_at,
        (SELECT COUNT(*)
         FROM playlist_songs ps
                JOIN playlists pl ON ps.playlist_id = pl.id
         WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count,
        p.user_id,
        p.name as profile_name, p.slug as profile_slug
      FROM follows f
             JOIN profiles p ON f.followed_profile_id = p.id
             JOIN songs s ON p.id = s.profile_id
      WHERE f.follower_id = ? AND p.user_id IS NOT NULL
        AND s.visibility = 'public'
      ORDER BY s.created_at DESC
        LIMIT 6
    `, [parsedUserId]);

    const sanitizedSongs = songs.map((song) => ({
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      profile_slug: song.profile_slug || null,
      title: song.title || 'Untitled',
      mp3_url: song.mp3_url || null,
      image_url: song.image_url || null,
      description: song.description || null,
      genre: song.genre || null,
      plays: Number(song.plays) || 0,
      created_at: song.created_at,
      likes_count: Number(song.likes_count) || 0,
      user_id: Number(song.user_id),
      profile_name: song.profile_name || 'Unknown',
      profile_slug: song.profile_slug || null,
    }));

    res.status(200).json(sanitizedSongs);
  } catch (err) {
    logger.error('Error in GET /profile/:userId/followed-songs:', {
      message: err.message,
      stack: err.stack,
      userId,
      authenticatedUserId,
    });
    res.status(500).json({ error: 'Failed to fetch followed songs: ' + err.message });
  }
});

// Get follower count for a profile
router.get('/:profileId/follower-count', async (req, res) => {
  const { profileId } = req.params;

  try {
    const parsedProfileId = parseInt(profileId);
    if (isNaN(parsedProfileId)) {
      return res.status(400).json({ error: 'Invalid profile ID' });
    }

    const profiles = await pool.query('SELECT id FROM profiles WHERE id = ?', [parsedProfileId]);
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    const foundProfileId = profiles[0].id;

    const followerCountResult = await pool.query(
        'SELECT COUNT(*) as follower_count FROM follows WHERE followed_profile_id = ?',
        [foundProfileId]
    );
    const followerCount = Number(followerCountResult[0].follower_count) || 0;

    res.status(200).json({ follower_count: followerCount });
  } catch (err) {
    logger.error('Error in GET /profile/:profileId/follower-count:', {
      message: err.message,
      stack: err.stack,
      profileId,
    });
    res.status(500).json({ error: 'Failed to fetch follower count: ' + err.message });
  }
});

// Remove profile background (revert to default)
router.post('/background/remove', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE profiles SET background = NULL WHERE user_id = ?', [req.user.id]);

    const profiles = await pool.query('SELECT * FROM profiles WHERE user_id = ?', [req.user.id]);
    if (!profiles || profiles.length === 0) {
      logger.error('No profile found after removing background for user_id:', req.user.id);
      return res.status(500).json({ error: 'Failed to retrieve updated profile' });
    }

    const profile = profiles[0];
    res.status(200).json({ profile, background: null });
  } catch (err) {
    logger.error('Error in POST /profile/background/remove:', {
      message: err.message,
      stack: err.stack,
      userId: req.user.id,
    });
    res.status(500).json({ error: 'Failed to remove background: ' + err.message });
  }
});

// Remove profile hero background (revert hero block to default)
router.post('/hero-background/remove', authenticate, async (req, res) => {
  try {
    await pool.query('UPDATE profiles SET hero_background = NULL WHERE user_id = ?', [req.user.id]);

    const profiles = await pool.query('SELECT * FROM profiles WHERE user_id = ?', [req.user.id]);
    if (!profiles || profiles.length === 0) {
      logger.error('No profile found after removing hero background for user_id:', req.user.id);
      return res.status(500).json({ error: 'Failed to retrieve updated profile' });
    }

    const profile = profiles[0];
    res.status(200).json({ profile, hero_background: null });
  } catch (err) {
    logger.error('Error in POST /profile/hero-background/remove:', {
      message: err.message,
      stack: err.stack,
      userId: req.user.id,
    });
    res.status(500).json({ error: 'Failed to remove hero background: ' + err.message });
  }
});

router.post('/calculate-daily-earnings', async (req, res) => {
  logger.debug('Hit /profile/calculate-daily-earnings'); // Debug log
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const profiles = await pool.query('SELECT id FROM profiles');

    // One query for what every profile has already been granted, rather than
    // one per profile inside the loop.
    const grantedByProfile = await getEarnedForActivityByProfile(ACTIVITY.DAILY_LISTENS);

    for (const profile of profiles) {
      const profileId = Number(profile.id);

      try {
        // Listens on the day itself, which is what the history row records.
        const dayResult = await pool.query(`
          SELECT COUNT(*) as listens_count
          FROM song_plays sp
                 JOIN songs s ON sp.song_id = s.id
          WHERE s.profile_id = ?
            AND DATE(sp.played_at) = ?
        `, [profileId, yesterdayStr]);

        const listens_count = Number(dayResult[0].listens_count) || 0;

        // Lifetime listens through that day, which is what coins accrue
        // against. Flooring a single day in isolation discarded the remainder
        // every night; at this site's traffic that meant nearly every profile
        // earned nothing nearly every day.
        const lifetimeResult = await pool.query(`
          SELECT COUNT(*) as lifetime_listens
          FROM song_plays sp
                 JOIN songs s ON sp.song_id = s.id
          WHERE s.profile_id = ?
            AND DATE(sp.played_at) <= ?
        `, [profileId, yesterdayStr]);

        const lifetime_listens = Number(lifetimeResult[0].lifetime_listens) || 0;
        const coins_earned = listenCoinsToAward(lifetime_listens, grantedByProfile.get(profileId) || 0);

        // No existence fast-path here on purpose. A profile_earnings row left
        // by the old daily-floor rule would have short-circuited the accrual
        // above and stranded the remainder it never granted. Idempotency comes
        // from the unique keys instead: replaying a date awards nothing twice.
        if (listens_count > 0 || coins_earned > 0) {
          await pool.query(`
            INSERT IGNORE INTO profile_earnings (profile_id, earnings_date, listens_count, coins_earned)
            VALUES (?, ?, ?, ?)
          `, [profileId, yesterdayStr, listens_count, coins_earned]);
        }

        await awardCoins({
          profileId,
          activityType: ACTIVITY.DAILY_LISTENS,
          sourceId: yesterdayStr,
          coins: coins_earned,
          metadata: { listens_count, lifetime_listens }
        });
      } catch (profileErr) {
        // One bad profile must not take the rest of the night with it. Profiles
        // iterate in id order, so a throw here used to abort the whole loop and
        // silently drop every profile after it.
        logger.error('Failed to calculate daily earnings for profile', {
          profileId,
          error: profileErr.message
        });
      }
    }

    res.status(200).json({ message: 'Daily IDJC earnings calculated successfully' });
  } catch (err) {
    logger.error('Error in POST /profile/calculate-daily-earnings:', err);
    res.status(500).json({ error: 'Failed to calculate daily earnings: ' + err.message });
  }
});

router.get('/top-earners', async (req, res) => {
  try {
    const rows = await pool.query(`
      SELECT p.id, p.user_id, p.name, p.picture_url, COALESCE(SUM(ce.coins), 0) as total_earned
      FROM profiles p
      LEFT JOIN coin_events ce ON p.id = ce.profile_id
      GROUP BY p.id, p.user_id, p.name, p.slug, p.picture_url
      ORDER BY total_earned DESC
      LIMIT 5
    `);
    const sanitizedRows = rows.map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      name: row.name || 'Unknown',
      picture_url: row.picture_url || null,
      total_earned: Number(row.total_earned) || 0,
    }));
    res.json(sanitizedRows);
  } catch (err) {
    logger.error('Error in GET /profile/top-earners:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;