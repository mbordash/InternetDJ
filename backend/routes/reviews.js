const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const authenticate = require('../middleware/authenticate');
const logger = require('../utils/logger');
const { createNotification, NOTIFICATION_TYPES } = require('../utils/notifications');
const REACTIONS = ['thumbs_up', 'thumbs_down', 'clown'];

// This route is public, so a viewer may or may not be signed in. Read the
// token when it is there and stay anonymous when it is not, rather than
// gating the whole review list behind auth.
function readViewerId(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || !header.startsWith('Bearer ') || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET).id || null;
  } catch {
    return null;   // expired or bogus token: treat as a guest
  }
}

const router = express.Router();

router.post('/', authenticate, async (req, res) => {
  const { song_id, review, feedback } = req.body;
  try {
    if (!song_id) {
      return res.status(400).json({ error: 'Song ID is required' });
    }

    // Verify song exists and get its owner
    const songsResult = await pool.query(
        'SELECT s.id, s.profile_id, s.title, p.user_id AS owner_user_id FROM songs s JOIN profiles p ON p.id = s.profile_id WHERE s.id = ?',
        [song_id]
    );
    const songs = Array.isArray(songsResult) ? songsResult : songsResult[0] || [];
    if (!songs || songs.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Get the reviewer's profile_id
    const profilesResult = await pool.query('SELECT id, name, picture_url FROM profiles WHERE user_id = ?', [req.user.id]);
    const profiles = Array.isArray(profilesResult) ? profilesResult : profilesResult[0] || [];
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found for user' });
    }
    const profileId = profiles[0].id;

    const normalizedReview = review == null ? '' : review;
    if (typeof normalizedReview !== 'string') {
      return res.status(400).json({ error: 'Review must be a string' });
    }
    if (normalizedReview.length > 5000) {
      return res.status(400).json({ error: 'Review must be 5000 characters or fewer' });
    }

    // Validate feedback (optional)
    if (feedback && (typeof feedback !== 'object' || Array.isArray(feedback))) {
      return res.status(400).json({ error: 'Feedback must be an object' });
    }

    // Insert review
    const insertResult = await pool.query(
        'INSERT INTO reviews (song_id, profile_id, review, feedback) VALUES (?, ?, ?, ?)',
        [song_id, profileId, normalizedReview, feedback ? JSON.stringify(feedback) : null]
    );
    const result = Array.isArray(insertResult) ? insertResult : insertResult[0] || {};

    const newReview = {
      id: Number(result.insertId),
      song_id: Number(song_id),
      profile_id: Number(profileId),
      review: normalizedReview,
      feedback: feedback || null,
      created_at: new Date(),
      user_name: profiles[0].name || req.user.name,
      picture_url: profiles[0].picture_url || null,
    };

    logger.info('Created review:', newReview);

    await createNotification({
      recipientUserId: songs[0].owner_user_id,
      actorUserId: req.user.id,
      type: NOTIFICATION_TYPES.SONG_REVIEWED,
      message: 'Someone posted a review on your uploaded song.',
      entityType: 'song',
      entityId: Number(song_id),
      metadata: {
        review_id: Number(result.insertId),
        song_title: songs[0].title,
      },
    });

    res.status(200).json({ review: newReview });
  } catch (err) {
    logger.error('Error in POST /reviews:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.get('/:songId', async (req, res) => {
  try {
    const songId = parseInt(req.params.songId);
    if (isNaN(songId)) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }
    const reviews = await pool.query(`
      SELECT r.id, r.song_id, r.profile_id, r.review, r.feedback, r.created_at,
             p.name AS user_name, p.slug AS profile_slug, p.picture_url
      FROM reviews r
      JOIN profiles p ON r.profile_id = p.id
      WHERE r.song_id = ?
      ORDER BY r.created_at DESC
    `, [songId]);
    const reviewIds = reviews.map((r) => Number(r.id));

    // Reaction tallies for this page of reviews, plus whichever one the
    // signed-in viewer picked so the UI can show it as active. Counts are
    // display-only - nothing here feeds any ranking.
    const counts = new Map();
    const mine = new Map();
    if (reviewIds.length) {
      const placeholders = reviewIds.map(() => '?').join(',');
      const tallies = await pool.query(
        `SELECT review_id, reaction, COUNT(*) AS n
           FROM review_reactions
          WHERE review_id IN (${placeholders})
          GROUP BY review_id, reaction`,
        reviewIds
      );
      for (const row of tallies) {
        const id = Number(row.review_id);
        if (!counts.has(id)) counts.set(id, { thumbs_up: 0, thumbs_down: 0, clown: 0 });
        counts.get(id)[row.reaction] = Number(row.n) || 0;
      }

      const viewerId = readViewerId(req);
      if (viewerId) {
        const ownRows = await pool.query(
          `SELECT review_id, reaction FROM review_reactions
            WHERE user_id = ? AND review_id IN (${placeholders})`,
          [viewerId, ...reviewIds]
        );
        for (const row of ownRows) mine.set(Number(row.review_id), row.reaction);
      }
    }

    const sanitizedReviews = reviews.map((review) => ({
      id: Number(review.id),
      song_id: Number(review.song_id),
      profile_id: Number(review.profile_id),
      profile_slug: review.profile_slug || null,
      review: review.review || '',
      feedback: review.feedback ? review.feedback : null, // MariaDB returns JSON as object
      created_at: review.created_at,
      user_name: review.user_name || 'Unknown',
      picture_url: review.picture_url || null,
      reactions: counts.get(Number(review.id)) || { thumbs_up: 0, thumbs_down: 0, clown: 0 },
      my_reaction: mine.get(Number(review.id)) || null,
    }));
    res.json(sanitizedReviews);
  } catch (err) {
    logger.error('Error in GET /reviews/:songId:', err);
    res.status(500).json({ error: err.message });
  }
});


// Set, switch, or clear this user's reaction on a review. One per user per
// review: picking a different one replaces it, picking the same one clears it.
router.post('/:reviewId/reactions', authenticate, async (req, res) => {
  const reviewId = parseInt(req.params.reviewId, 10);
  const { reaction } = req.body;
  const userId = req.user.id;

  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }
  if (!REACTIONS.includes(reaction)) {
    return res.status(400).json({ error: 'Unknown reaction' });
  }

  try {
    const existing = await pool.query(
      'SELECT id, reaction FROM review_reactions WHERE review_id = ? AND user_id = ?',
      [reviewId, userId]
    );

    let myReaction = reaction;
    if (existing.length && existing[0].reaction === reaction) {
      await pool.query('DELETE FROM review_reactions WHERE id = ?', [existing[0].id]);
      myReaction = null;                       // clicking the active one clears it
    } else if (existing.length) {
      await pool.query('UPDATE review_reactions SET reaction = ? WHERE id = ?', [reaction, existing[0].id]);
    } else {
      await pool.query(
        'INSERT INTO review_reactions (review_id, user_id, reaction) VALUES (?, ?, ?)',
        [reviewId, userId, reaction]
      );
    }

    const tallies = await pool.query(
      'SELECT reaction, COUNT(*) AS n FROM review_reactions WHERE review_id = ? GROUP BY reaction',
      [reviewId]
    );
    const reactions = { thumbs_up: 0, thumbs_down: 0, clown: 0 };
    for (const row of tallies) reactions[row.reaction] = Number(row.n) || 0;

    res.json({ reactions, my_reaction: myReaction });
  } catch (err) {
    logger.error('Error in POST /reviews/:reviewId/reactions:', err);
    res.status(500).json({ error: 'Failed to save reaction' });
  }
});

router.delete('/:reviewId', authenticate, async (req, res) => {
  const reviewId = parseInt(req.params.reviewId);
  try {
    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }
    const reviewsResult = await pool.query('SELECT profile_id, song_id FROM reviews WHERE id = ?', [reviewId]);
    const reviews = Array.isArray(reviewsResult) ? reviewsResult : Array.isArray(reviewsResult[0]) ? reviewsResult[0] : [];
    if (!reviews || reviews.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    const review = reviews[0];
    const profilesResult = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [req.user.id]);
    const profiles = Array.isArray(profilesResult) ? profilesResult : Array.isArray(profilesResult[0]) ? reviewsResult[0] : [];
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Profile not found for user' });
    }
    const profileId = profiles[0].id;
    if (review.profile_id !== profileId) {
      return res.status(403).json({ error: 'You can only delete your own reviews' });
    }
    await pool.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
    res.status(200).json({ message: 'Review deleted successfully' });
  } catch (err) {
    logger.error('Error in DELETE /reviews/:reviewId:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;