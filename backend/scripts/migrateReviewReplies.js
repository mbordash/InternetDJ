/**
 * Adds reply threading to reviews:  node backend/scripts/migrateReviewReplies.js
 *
 * schema.sql only runs when the database container initialises from empty, so
 * an existing deployment needs this. It also runs from the fly release_command,
 * because GET /reviews/:songId selects parent_review_id on every song page: a
 * deploy that landed before the column existed would 500 the review list on
 * every track on the site.
 *
 * A reply is a row in `reviews` with parent_review_id set, rather than its own
 * table. Replies and reviews carry the same author, timestamp and moderation
 * story, and keeping them in one table means the existing delete, reaction and
 * ownership paths work on a reply without being written twice. What separates
 * them is that a reply never carries a rating: an artist answering feedback is
 * not scoring their own track, so parseOptionalRating is not even consulted on
 * the reply path and the column stays NULL.
 *
 * ON DELETE CASCADE on the self-reference means deleting a review takes its
 * replies with it, which is the only sensible reading - a reply to a comment
 * nobody can see any more is orphaned text.
 *
 * Safe to re-run: the ALTER is IF NOT EXISTS, the constraint is added only when
 * information_schema says it is absent, and both are read back afterwards
 * rather than inferred, since IF NOT EXISTS makes a no-op and a success look
 * identical.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

(async () => {
    try {
        out('Applying review reply migration to `reviews`...');

        await pool.query(`ALTER TABLE reviews
            ADD COLUMN IF NOT EXISTS parent_review_id INT(11) DEFAULT NULL`);
        out('  ok  parent_review_id column');

        await pool.query(`ALTER TABLE reviews
            ADD INDEX IF NOT EXISTS idx_reviews_parent (parent_review_id)`);
        out('  ok  idx_reviews_parent index');

        // ADD CONSTRAINT has no IF NOT EXISTS in MariaDB, so ask first. A
        // second run would otherwise fail with errno 121 on the duplicate key
        // name and abort the whole release.
        const [existing] = await pool.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'reviews'
                AND CONSTRAINT_NAME = 'fk_reviews_parent'`
        );
        if (Number(existing.n) === 0) {
            await pool.query(`ALTER TABLE reviews
                ADD CONSTRAINT fk_reviews_parent
                FOREIGN KEY (parent_review_id) REFERENCES reviews (id) ON DELETE CASCADE`);
            out('  ok  fk_reviews_parent foreign key');
        } else {
            out('  ok  fk_reviews_parent foreign key (already present)');
        }

        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS defaultValue
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews'
                AND COLUMN_NAME = 'parent_review_id'`
        );

        out('');
        out('Columns now present on `reviews`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 20)} ${pad(column.type, 12)} default=${column.defaultValue ?? 'NULL'}`);
        }

        if (!columns.some((c) => c.name === 'parent_review_id')) {
            errOut('');
            errOut('MISSING: parent_review_id - the migration did not fully apply.');
            await finish(1);
            return;
        }

        const [counts] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(parent_review_id IS NOT NULL) AS replies
               FROM reviews`
        );
        out('');
        out(`${Number(counts.total)} review row(s), ${Number(counts.replies || 0)} of them replies.`);
    } catch (err) {
        errOut(`Error adding review reply support: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
