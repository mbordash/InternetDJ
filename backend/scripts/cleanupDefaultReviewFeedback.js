/**
 * Clears detailed feedback that nobody actually filled in.
 *
 * The song page used to seed the review form with all twenty criteria set to
 * the default score, so every comment posted a full feedback object even when
 * the reviewer never opened the detailed feedback modal. Those comments show a
 * "View Detailed Feedback" button whose sliders all sit in the middle. The form
 * now starts empty, but the rows already written still carry the defaults.
 *
 * This finds reviews whose feedback is nothing but the untouched default on
 * every criterion - the default score 60, or the legacy 'Good' label that
 * preceded the 0-100 scale - and sets feedback back to NULL. A review where the
 * reviewer moved even one slider is left alone, since that is real feedback.
 *
 * Dry run by default, so you can see what it would touch:
 *   node backend/scripts/cleanupDefaultReviewFeedback.js
 *   node backend/scripts/cleanupDefaultReviewFeedback.js --apply
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

// Kept in step with feedbackCriteria in frontend/src/pages/Song.js.
const FEEDBACK_CRITERIA = [
    'Melody', 'Harmony', 'Structure/Form', 'Lyrics', 'Vocal Technique',
    'Emotional Expression', 'Vocal Tone/Timbre', 'Instrumentation', 'Arrangement',
    'Mixing', 'Mastering', 'Sound Design', 'Originality', 'Innovation',
    'Emotional Impact', 'Audience Connection', 'Genre Fit', 'Marketability',
    'Consistency', 'Flow'
];

// What the form used to write when left untouched: the numeric default, and
// the label that meant the same thing before scores became numbers.
const DEFAULT_VALUES = new Set([60, '60', 'Good']);

const apply = process.argv.includes('--apply');

function parseFeedback(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * True when the object is exactly the untouched form default: every criterion
 * present, every one of them at the default, and nothing else in it.
 */
function isUntouchedDefault(feedback) {
    if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) return false;
    const keys = Object.keys(feedback);
    if (keys.length === 0) return true;   // an empty object is not feedback either
    if (keys.length !== FEEDBACK_CRITERIA.length) return false;
    return FEEDBACK_CRITERIA.every(criterion => DEFAULT_VALUES.has(feedback[criterion]));
}

(async () => {
    try {
        const reviews = await pool.query(
            'SELECT id, song_id, feedback FROM reviews WHERE feedback IS NOT NULL ORDER BY id'
        );

        const stale = [];
        for (const review of reviews) {
            if (isUntouchedDefault(parseFeedback(review.feedback))) {
                stale.push(review);
            }
        }

        out(`${reviews.length} review(s) carry detailed feedback.`);
        out(`${stale.length} of them hold nothing but the untouched defaults.`);

        if (stale.length) {
            out('');
            out(`  ${pad('review', 10)} song`);
            for (const review of stale) {
                out(`  ${pad(review.id, 10)} ${review.song_id}`);
            }
        }

        if (!stale.length) {
            out('');
            out('Nothing to clear.');
            await finish(0);
            return;
        }

        if (!apply) {
            out('');
            out('Dry run. Re-run with --apply to clear the feedback on these reviews.');
            await finish(0);
            return;
        }

        const ids = stale.map(review => review.id);
        await pool.query(
            `UPDATE reviews SET feedback = NULL WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
        );

        // Read it back rather than trusting the update: an UPDATE that matched
        // nothing and one that worked report the same way through this driver.
        const remaining = await pool.query(
            `SELECT COUNT(*) AS total FROM reviews
             WHERE feedback IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        const stillSet = Number(remaining[0]?.total || 0);

        out('');
        if (stillSet) {
            errOut(`${stillSet} of ${ids.length} review(s) still hold feedback - the update did not fully apply.`);
            await finish(1);
            return;
        }
        out(`Cleared detailed feedback on ${ids.length} review(s).`);
        await finish(0);
    } catch (err) {
        errOut(`Error clearing default review feedback: ${err.message}`);
        errOut(err.stack);
        await finish(1);
    }
})();
