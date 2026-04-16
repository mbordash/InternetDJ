const express = require('express');
const pool = require('../config/database');
const logger = require('../utils/logger');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const { buildPublicFileUrl } = require('../utils/storage');
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
          s.genre, s.plays, p.user_id, p.name as profile_name,
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
          AND s.mp3_url IS NOT NULL
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
          s.genre, s.plays, p.user_id, p.name as profile_name,
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
          AND s.mp3_url IS NOT NULL
        ORDER BY RAND()
          LIMIT 10
      `, [userId]);
    }

    // If no unrated songs, fetch any random song
    if (songs.length === 0) {
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.mp3_url IS NOT NULL
        ORDER BY RAND()
          LIMIT 10
      `);
    }

    const sanitizedSongs = songs.map(song => ({
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      title: song.title || 'Untitled',
      mp3_url: song.mp3_url || null,
      image_url: song.image_url || null,
      description: song.description || null,
      genre: song.genre || null,
      plays: Number(song.plays) || 0,
      likes_count: Number(song.likes_count) || 0,
      user_id: song.user_id ? Number(song.user_id) : null,
      profile_name: song.profile_name || 'Unknown Artist',
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
        s.genre, s.plays, p.user_id, p.name as profile_name,
        (SELECT COUNT(*)
         FROM playlist_songs ps2
                JOIN playlists pl2 ON ps2.playlist_id = pl2.id
         WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
      FROM playlist_songs ps
             JOIN playlists pl ON ps.playlist_id = pl.id
             JOIN songs s ON ps.song_id = s.id
             JOIN profiles p ON pl.profile_id = p.id
      WHERE p.user_id = ? AND pl.name = 'Likes' AND s.mp3_url IS NOT NULL
      ORDER BY RAND()
        LIMIT 1
    `, [userId]);

    // If no liked songs, fetch a random unrated song
    if (songs.length === 0) {
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name,
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
          AND s.mp3_url IS NOT NULL
        ORDER BY RAND()
          LIMIT 1
      `, [userId]);
    }

    // If still no songs, fetch any random song
    if (songs.length === 0) {
      songs = await pool.query(`
        SELECT
          s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description,
          s.genre, s.plays, p.user_id, p.name as profile_name,
          (SELECT COUNT(*)
           FROM playlist_songs ps2
                  JOIN playlists pl2 ON ps2.playlist_id = pl2.id
           WHERE pl2.name = 'Likes' AND ps2.song_id = s.id) AS likes_count
        FROM songs s
               LEFT JOIN profiles p ON s.profile_id = p.id
        WHERE s.mp3_url IS NOT NULL
        ORDER BY RAND()
          LIMIT 1
      `);
    }

    const sanitizedSongs = songs.map(song => ({
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      title: song.title || 'Untitled',
      mp3_url: song.mp3_url || null,
      image_url: song.image_url || null,
      description: song.description || null,
      genre: song.genre || null,
      plays: Number(song.plays) || 0,
      likes_count: Number(song.likes_count) || 0,
      user_id: song.user_id ? Number(song.user_id) : null,
      profile_name: song.profile_name || 'Unknown Artist',
    }));

    res.status(200).json(sanitizedSongs);
  } catch (err) {
    logger.error('Error in GET /profile/:userId/liked-songs:', err);
    res.status(500).json({ error: 'Failed to fetch liked songs: ' + err.message });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { name, genre, description, background, donation_link, solana_address } = req.body;
  const picture = req.files?.picture;
  const backgroundImage = req.files?.backgroundImage;
  try {
    let pictureUrl = null;
    let backgroundValue = background || null;

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

    // Fetch existing profile data
    const existingProfiles = await pool.query(
        'SELECT picture_url, background, donation_link, solana_address FROM profiles WHERE user_id = ?',
        [req.user.id]
    );
    const currentPictureUrl = existingProfiles.length > 0 ? existingProfiles[0].picture_url : null;
    const currentBackground = existingProfiles.length > 0 ? existingProfiles[0].background : null;
    const currentDonationLink = existingProfiles.length > 0 ? existingProfiles[0].donation_link : null;
    const currentSolanaAddress = existingProfiles.length > 0 ? existingProfiles[0].solana_address : null;

    // Validate Solana address (optional, basic check for 44-character Base58)
    if (solana_address && !/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(solana_address)) {
      return res.status(400).json({ error: 'Invalid Solana address format' });
    }

    // Update or insert profile
    await pool.query(
        'INSERT INTO profiles (user_id, name, genre, picture_url, description, background, donation_link, solana_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, genre = ?, picture_url = COALESCE(?, picture_url), description = ?, background = ?, donation_link = ?, solana_address = ?',
        [
          req.user.id,
          name,
          genre,
          pictureUrl || currentPictureUrl,
          description,
          backgroundValue || currentBackground,
          donation_link || currentDonationLink,
          solana_address || currentSolanaAddress,
          name,
          genre,
          pictureUrl,
          description,
          backgroundValue,
          donation_link,
          solana_address,
        ]
    );

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
      SELECT id, user_id, name, created_at, picture_url
      FROM profiles
      ORDER BY created_at DESC
        LIMIT 5
    `);
    const sanitizedRows = rows.map((row) => ({
      user_id: Number(row.user_id),
      profile_id: Number(row.id),
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
      SELECT p.id, p.user_id, p.name, COALESCE(SUM(s.plays), 0) as total_plays, p.picture_url
      FROM profiles p
             LEFT JOIN songs s ON p.id = s.profile_id
      GROUP BY p.id, p.user_id, p.name, p.picture_url
      ORDER BY total_plays DESC
        LIMIT 5
    `);
    const sanitizedRows = rows.map((row) => ({
      user_id: Number(row.user_id),
      profile_id: Number(row.id),
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

router.get('/:profileId', async (req, res) => {
  try {
    const profileId = parseInt(req.params.profileId);
    if (isNaN(profileId)) {
      return res.status(400).json({ error: 'Invalid profile ID' });
    }
    const profiles = await pool.query('SELECT * FROM profiles WHERE id = ?', [profileId]);
    if (!Array.isArray(profiles) || profiles.length === 0) {
      logger.debug(`No profile found for profile_id: ${profileId}`);
      return res.status(404).json({ error: 'Profile not found' });
    }
    const profile = profiles[0];
    if (!profile || typeof profile !== 'object') {
      logger.error('Invalid profile data for profile_id:', profileId, profile);
      return res.status(500).json({ error: 'Invalid profile data' });
    }
    const songs = await pool.query(`
      SELECT s.id, s.profile_id, s.title, s.mp3_url, s.image_url, s.description, s.genre, s.plays, p.user_id, p.name as profile_name,
             (SELECT COUNT(*)
              FROM playlist_songs ps
                     JOIN playlists pl ON ps.playlist_id = pl.id
              WHERE pl.name = 'Likes' AND ps.song_id = s.id) AS likes_count
      FROM songs s
             LEFT JOIN profiles p ON s.profile_id = p.id
      WHERE s.profile_id = ?
    `, [profile.id]);
    const sanitizedSongs = songs.map((song) => ({
      ...song,
      id: Number(song.id),
      profile_id: Number(song.profile_id),
      plays: Number(song.plays) || 0,
      user_id: song.user_id ? Number(song.user_id) : null,
      profile_name: song.profile_name || 'Unknown Artist',
      likes_count: Number(song.likes_count) || 0,
    }));

    // Calculate total IDJC earned
    const earnings = await pool.query('SELECT SUM(coins_earned) as total_earned FROM profile_earnings WHERE profile_id = ?', [profileId]);
    const total_idjc_earned = Number(earnings[0].total_earned) || 0;

    // Calculate total paid
    const paid = await pool.query('SELECT SUM(amount) as total_paid FROM idjc_payments WHERE profile_id = ?', [profileId]);
    const total_paid = Number(paid[0].total_paid) || 0;

    // Calculate unpaid
    const unpaid = total_idjc_earned - total_paid;

    res.json({ profile: { ...profile, total_idjc_earned, total_paid, unpaid }, songs: sanitizedSongs });
  } catch (err) {
    logger.error('Error in GET /profile/:profileId:', {
      message: err.message,
      stack: err.stack,
      profileId: req.params.profileId,
    });
    res.status(500).json({ error: 'Failed to fetch profile: ' + err.message });
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

// Follow a profile
router.post('/:userId/follow', authenticate, async (req, res) => {
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
        p.name as profile_name
      FROM follows f
             JOIN profiles p ON f.followed_profile_id = p.id
             JOIN songs s ON p.id = s.profile_id
      WHERE f.follower_id = ? AND p.user_id IS NOT NULL
      ORDER BY s.created_at DESC
        LIMIT 5
    `, [parsedUserId]);

    const sanitizedSongs = songs.map((song) => ({
      id: Number(song.id),
      profile_id: Number(song.profile_id),
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

router.post('/calculate-daily-earnings', async (req, res) => {
  logger.debug('Hit /profile/calculate-daily-earnings'); // Debug log
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const profiles = await pool.query('SELECT id FROM profiles');

    for (const profile of profiles) {
      const profileId = profile.id;

      // Skip if already calculated for this date
      const existing = await pool.query(
          'SELECT id FROM profile_earnings WHERE profile_id = ? AND earnings_date = ?',
          [profileId, yesterdayStr]
      );
      if (existing.length > 0) continue;

      // Count listens for the day
      const result = await pool.query(`
        SELECT COUNT(*) as listens_count
        FROM song_plays sp
               JOIN songs s ON sp.song_id = s.id
        WHERE s.profile_id = ?
          AND DATE(sp.played_at) = ?
      `, [profileId, yesterdayStr]);

      const listens_count = Number(result[0].listens_count) || 0;
      let coins_earned = Math.floor(listens_count / 10);
      coins_earned = Math.min(coins_earned, 10);

      // Insert if there were listens
      if (listens_count > 0) {
        await pool.query(`
          INSERT INTO profile_earnings (profile_id, earnings_date, listens_count, coins_earned)
          VALUES (?, ?, ?, ?)
        `, [profileId, yesterdayStr, listens_count, coins_earned]);
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
      SELECT p.id, p.user_id, p.name, p.picture_url, COALESCE(SUM(pe.coins_earned), 0) as total_earned
      FROM profiles p
      LEFT JOIN profile_earnings pe ON p.id = pe.profile_id
      GROUP BY p.id, p.user_id, p.name, p.picture_url
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