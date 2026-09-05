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

/**
 * An overall score for a track: 0.5 to 10 in half steps, or nothing at all.
 *
 * Optional on purpose. The page asks for a comment first because that is what
 * an artist can actually act on, and a listener who does not want to put a
 * number on someone's work should be able to say nothing by leaving it alone —
 * which is not the same as scoring it zero.
 *
 * The bounds mirror the CHECK constraint on reviews.rating, so a bad value is
 * refused with a message the reviewer can read rather than a 500 out of the
 * database.
 */
const parseOptionalRating = (value) => {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const rating = Number(value);
  if (!Number.isFinite(rating)) {
    return { ok: false, error: 'Rating must be a number' };
  }
  if (rating < 0.5 || rating > 10) {
    return { ok: false, error: 'Rating must be between 0.5 and 10' };
  }
  if (Math.round(rating * 2) !== rating * 2) {
    return { ok: false, error: 'Rating must be in steps of 0.5' };
  }
  return { ok: true, value: rating };
};

const router = express.Router();

router.post('/', authenticate, async (req, res) => {
  const { song_id, review, feedback, rating } = req.body;
  try {
    if (!song_id) {
      return res.status(400).json({ error: 'Song ID is required' });
    }

    // Verify song exists and get its owner
    const songs = await pool.query(
        'SELECT s.id, s.profile_id, s.title, p.user_id AS owner_user_id FROM songs s JOIN profiles p ON p.id = s.profile_id WHERE s.id = ?',
        [song_id]
    );
    if (!songs.length) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Get the reviewer's profile_id
    const profiles = await pool.query('SELECT id, name, picture_url FROM profiles WHERE user_id = ?', [req.user.id]);
    if (!profiles.length) {
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
    // An object with nothing in it is not detailed feedback. Storing `{}` made
    // the song page offer a "View Detailed Feedback" panel for comments whose
    // author never scored anything.
    const feedbackValue = feedback && Object.keys(feedback).length > 0 ? feedback : null;

    const ratingField = parseOptionalRating(rating);
    if (!ratingField.ok) {
      return res.status(400).json({ error: ratingField.error });
    }

    // Insert review.
    //
    // insertId is read straight off the result. An INSERT returns an OkPacket
    // rather than a row array, so the old `Array.isArray(r) ? r : r[0] || {}`
    // unwrapping fell all the way through to `{}` and this id was
    // Number(undefined) - NaN, which JSON.stringify writes as null. Every
    // review posted came back to the page with `id: null`, so the comment the
    // reviewer had just written could not be reacted to, replied to or deleted
    // until they reloaded. The row itself was always written correctly.
    const insertResult = await pool.query(
        'INSERT INTO reviews (song_id, profile_id, review, feedback, rating) VALUES (?, ?, ?, ?, ?)',
        [song_id, profileId, normalizedReview, feedbackValue ? JSON.stringify(feedbackValue) : null, ratingField.value]
    );

    const newReview = {
      id: Number(insertResult.insertId),
      song_id: Number(song_id),
      profile_id: Number(profileId),
      review: normalizedReview,
      feedback: feedbackValue,
      rating: ratingField.value,
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
        review_id: Number(insertResult.insertId),
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
    // Top-level comments only. Replies live in the same table and would
    // otherwise render as standalone reviews with nothing to reply to, and
    // with no rating, which would read as an empty score rather than an answer.
    const reviews = await pool.query(`
      SELECT r.id, r.song_id, r.profile_id, r.review, r.feedback, r.rating, r.created_at,
             p.name AS user_name, p.slug AS profile_slug, p.picture_url
      FROM reviews r
      JOIN profiles p ON r.profile_id = p.id
      WHERE r.song_id = ? AND r.parent_review_id IS NULL
      ORDER BY r.created_at DESC
    `, [songId]);
    const reviewIds = reviews.map((r) => Number(r.id));

    // Replies, oldest first, so a thread reads top to bottom even though the
    // comments above it are newest first.
    const repliesByParent = new Map();
    if (reviewIds.length) {
      const replyRows = await pool.query(
        `SELECT r.id, r.parent_review_id, r.profile_id, r.review, r.created_at,
                p.name AS user_name, p.slug AS profile_slug, p.picture_url,
                (sp.user_id = p.user_id) AS is_artist
           FROM reviews r
           JOIN profiles p ON r.profile_id = p.id
           JOIN songs s ON s.id = r.song_id
           LEFT JOIN profiles sp ON sp.id = s.profile_id
          WHERE r.parent_review_id IN (${reviewIds.map(() => '?').join(',')})
          ORDER BY r.created_at ASC`,
        reviewIds
      );
      for (const row of replyRows) {
        const parentId = Number(row.parent_review_id);
        if (!repliesByParent.has(parentId)) repliesByParent.set(parentId, []);
        repliesByParent.get(parentId).push({
          id: Number(row.id),
          parent_review_id: parentId,
          profile_id: Number(row.profile_id),
          profile_slug: row.profile_slug || null,
          review: row.review || '',
          created_at: row.created_at,
          user_name: row.user_name || 'Unknown',
          picture_url: row.picture_url || null,
          // Lets the page badge the artist's own answer, which is the reply
          // everyone scrolling a comment thread is actually looking for.
          is_artist: !!row.is_artist,
        });
      }
    }

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
      // DECIMAL comes back as a string from the driver; the UI averages these.
      rating: review.rating == null ? null : Number(review.rating),
      created_at: review.created_at,
      user_name: review.user_name || 'Unknown',
      picture_url: review.picture_url || null,
      reactions: counts.get(Number(review.id)) || { thumbs_up: 0, thumbs_down: 0, clown: 0 },
      my_reaction: mine.get(Number(review.id)) || null,
      replies: repliesByParent.get(Number(review.id)) || [],
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

    // Tell the comment's author somebody responded to it, but only when a
    // reaction was actually set. Clearing one is a retraction, and nobody needs
    // to be told their comment was un-liked.
    if (myReaction) {
      try {
        const [owner] = await pool.query(
          `SELECT p.user_id AS author_user_id, r.song_id, s.title AS song_title
             FROM reviews r
             JOIN profiles p ON p.id = r.profile_id
             LEFT JOIN songs s ON s.id = r.song_id
            WHERE r.id = ?`,
          [reviewId]
        );
        if (owner?.author_user_id) {
          await createNotification({
            recipientUserId: Number(owner.author_user_id),
            actorUserId: userId,
            type: NOTIFICATION_TYPES.REVIEW_REACTION,
            message: 'Someone reacted to your comment.',
            entityType: 'song',
            entityId: Number(owner.song_id),
            metadata: {
              review_id: reviewId,
              reaction: myReaction,
              song_title: owner.song_title || null,
            },
          });
        }
      } catch (notifyErr) {
        // A reaction is the smallest thing on the page. It must never fail
        // because the notification behind it did.
        logger.warn('Failed to notify review author of a reaction:', notifyErr.message);
      }
    }

    res.json({ reactions, my_reaction: myReaction });
  } catch (err) {
    logger.error('Error in POST /reviews/:reviewId/reactions:', err);
    res.status(500).json({ error: 'Failed to save reaction' });
  }
});

/**
 * Reply to a comment on a song.
 *
 * Written for the artist answering feedback, which is the whole point of the
 * comment being there, but open to anyone signed in: a thread where only one
 * person may speak is not a thread.
 *
 * A reply is a row in `reviews` with parent_review_id set and no rating. That
 * keeps one author, one timestamp and one delete path for both kinds of row,
 * and it is why the reply body is read from `review` rather than some second
 * text column.
 *
 * Threads are one level deep. Replying to a reply attaches to the same parent
 * instead of nesting further, so a long exchange stays a readable column rather
 * than marching off the right edge of a phone.
 */
router.post('/:reviewId/replies', authenticate, async (req, res) => {
  const reviewId = parseInt(req.params.reviewId, 10);
  const { review } = req.body;

  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  const text = typeof review === 'string' ? review.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'Write something before posting your reply' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'Reply must be 5000 characters or fewer' });
  }

  try {
    const [parent] = await pool.query(
      `SELECT r.id, r.song_id, r.parent_review_id, r.profile_id,
              p.user_id AS author_user_id, s.title AS song_title
         FROM reviews r
         JOIN profiles p ON p.id = r.profile_id
         LEFT JOIN songs s ON s.id = r.song_id
        WHERE r.id = ?`,
      [reviewId]
    );
    if (!parent) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Flatten: a reply to a reply belongs to the comment that started it.
    const threadId = parent.parent_review_id ? Number(parent.parent_review_id) : Number(parent.id);

    const [profile] = await pool.query(
      'SELECT id, name, picture_url, slug FROM profiles WHERE user_id = ?',
      [req.user.id]
    );
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found for user' });
    }

    const [song] = await pool.query(
      `SELECT s.id, s.title, p.user_id AS owner_user_id
         FROM songs s
         JOIN profiles p ON p.id = s.profile_id
        WHERE s.id = ?`,
      [parent.song_id]
    );

    const insert = await pool.query(
      'INSERT INTO reviews (song_id, profile_id, review, rating, parent_review_id) VALUES (?, ?, ?, NULL, ?)',
      [parent.song_id, profile.id, text, threadId]
    );

    const reply = {
      id: Number(insert.insertId),
      parent_review_id: threadId,
      song_id: Number(parent.song_id),
      profile_id: Number(profile.id),
      profile_slug: profile.slug || null,
      review: text,
      created_at: new Date(),
      user_name: profile.name || req.user.name,
      picture_url: profile.picture_url || null,
      is_artist: !!song && Number(song.owner_user_id) === Number(req.user.id),
    };

    // The person being answered. createNotification already drops the case
    // where that is the replier themselves.
    await createNotification({
      recipientUserId: Number(parent.author_user_id),
      actorUserId: req.user.id,
      type: NOTIFICATION_TYPES.REVIEW_REPLIED,
      message: reply.is_artist
        ? 'The artist replied to your comment.'
        : 'Someone replied to your comment.',
      entityType: 'song',
      entityId: Number(parent.song_id),
      metadata: {
        review_id: threadId,
        reply_id: reply.id,
        song_title: parent.song_title || null,
      },
    });

    // The artist owns the conversation happening under their track, so they
    // hear about a third party joining it too. Skipped when they are the
    // author being replied to, which would otherwise be the same event twice.
    if (song && Number(song.owner_user_id) !== Number(parent.author_user_id)) {
      await createNotification({
        recipientUserId: Number(song.owner_user_id),
        actorUserId: req.user.id,
        type: NOTIFICATION_TYPES.REVIEW_REPLIED,
        message: 'Someone replied to a comment on your song.',
        entityType: 'song',
        entityId: Number(parent.song_id),
        metadata: {
          review_id: threadId,
          reply_id: reply.id,
          song_title: song.title || null,
        },
      });
    }

    res.status(201).json({ reply });
  } catch (err) {
    logger.error('Error in POST /reviews/:reviewId/replies:', err);
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

router.delete('/:reviewId', authenticate, async (req, res) => {
  const reviewId = parseInt(req.params.reviewId);
  try {
    if (isNaN(reviewId)) {
      return res.status(400).json({ error: 'Invalid review ID' });
    }
    // Read straight off the result. Both of these used to be unwrapped through
    // `Array.isArray(r) ? r : Array.isArray(r[0]) ? r[0] : []`, guarding against
    // the [rows, fields] pair that mysql2 returns - which this driver never
    // does, so the first branch always won and the rest was unreachable. That
    // dead branch was also wrong: the profile lookup fell back to
    // `reviewsResult[0]`, the review rows, so had it ever run it would have
    // compared the review's own profile_id against itself and let anybody
    // delete anybody's comment. Unreachable, but not a thing to leave sitting
    // in an authorization check.
    const reviews = await pool.query('SELECT profile_id, song_id FROM reviews WHERE id = ?', [reviewId]);
    if (!reviews.length) {
      return res.status(404).json({ error: 'Review not found' });
    }
    const review = reviews[0];

    const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [req.user.id]);
    if (!profiles.length) {
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