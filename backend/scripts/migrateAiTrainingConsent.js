/**
 * Adds the AI-training consent columns to songs. schema.sql only runs when the
 * database container initialises from empty, so an existing deployment needs
 * this:  node backend/scripts/migrateAiTrainingConsent.js
 *
 * It also runs as part of the fly release_command, so a deploy cannot reach
 * traffic before the columns the new code selects and updates exist. Without
 * it, every song edit and every consent toggle answers 500.
 *
 * Safe to re-run - both statements are IF NOT EXISTS, and the columns are read
 * back afterwards so you can see the result rather than infer it.
 *
 * `allow_ai_training` is NOT NULL DEFAULT FALSE on purpose: every song that
 * already exists lands opted OUT, and stays that way until its artist says
 * otherwise. Consent is never granted by a migration.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

const STATEMENTS = [
    ['allow_ai_training column', `ALTER TABLE songs
        ADD COLUMN IF NOT EXISTS allow_ai_training BOOLEAN NOT NULL DEFAULT FALSE`],
    ['ai_training_opted_in_at column', `ALTER TABLE songs
        ADD COLUMN IF NOT EXISTS ai_training_opted_in_at DATETIME DEFAULT NULL`],
];

const EXPECTED = ['allow_ai_training', 'ai_training_opted_in_at'];

(async () => {
    try {
        out('Applying AI training consent migration to `songs`...');
        for (const [label, sql] of STATEMENTS) {
            await pool.query(sql);
            out(`  ok  ${label}`);
        }

        // Read the columns back rather than trusting that the ALTERs did what
        // they claim: IF NOT EXISTS makes a no-op and a success look identical.
        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                    COLUMN_DEFAULT AS defaultValue
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'songs'
               AND COLUMN_NAME IN ('allow_ai_training','ai_training_opted_in_at')
             ORDER BY COLUMN_NAME`
        );

        out('');
        out('Columns now present on `songs`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 26)} ${pad(column.type, 14)} default=${column.defaultValue ?? 'NULL'}`);
        }

        const missing = EXPECTED.filter(name => !columns.some(c => c.name === name));
        if (missing.length) {
            errOut('');
            errOut(`MISSING: ${missing.join(', ')} — the migration did not fully apply.`);
            await finish(1);
            return;
        }

        const [counts] = await pool.query(
            `SELECT COUNT(*) AS total, SUM(allow_ai_training = TRUE) AS opted_in FROM songs`
        );
        out('');
        out(`${Number(counts.total)} song(s) in the table, ${Number(counts.opted_in || 0)} opted in to AI training.`);
    } catch (err) {
        errOut(`Error adding AI training consent columns: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
