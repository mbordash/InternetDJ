/**
 * Adds the tempo/key/duration columns to songs. schema.sql only runs when the
 * database container initialises from empty, so an existing deployment needs
 * this run once by hand:  node backend/scripts/migrateAudioFeatures.js
 *
 * Safe to re-run - every statement is IF NOT EXISTS, and it prints the columns
 * it found afterwards so you can see the result rather than infer it.
 *
 * The column is `musical_key`, not `key`: KEY is reserved in MySQL/MariaDB and
 * would need backticking at every single call site.
 *
 * Existing rows land on analysis_status 'pending', which is exactly what
 * backfillAudioFeatures.js looks for.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

const STATEMENTS = [
    ['bpm column', `ALTER TABLE songs ADD COLUMN IF NOT EXISTS bpm DECIMAL(6,2) DEFAULT NULL`],
    ['musical_key column', `ALTER TABLE songs ADD COLUMN IF NOT EXISTS musical_key VARCHAR(20) DEFAULT NULL`],
    ['duration column', `ALTER TABLE songs ADD COLUMN IF NOT EXISTS duration FLOAT DEFAULT NULL`],
    ['analysis_status column', `ALTER TABLE songs ADD COLUMN IF NOT EXISTS analysis_status
        ENUM('pending','queued','analyzing','done','failed') NOT NULL DEFAULT 'pending'`],
    // The backfill sweep selects by status, and the catalogue only grows.
    ['analysis_status index', `ALTER TABLE songs ADD INDEX IF NOT EXISTS analysis_status_idx (analysis_status)`],
];

const EXPECTED = ['bpm', 'musical_key', 'duration', 'analysis_status'];

(async () => {
    try {
        out('Applying audio feature migration to `songs`...');
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
               AND COLUMN_NAME IN ('bpm','musical_key','duration','analysis_status')
             ORDER BY COLUMN_NAME`
        );

        out('');
        out('Columns now present on `songs`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 18)} ${pad(column.type, 48)} default=${column.defaultValue ?? 'NULL'}`);
        }

        const missing = EXPECTED.filter(name => !columns.some(c => c.name === name));
        if (missing.length) {
            errOut('');
            errOut(`MISSING: ${missing.join(', ')} — the migration did not fully apply.`);
            await finish(1);
            return;
        }

        const [counts] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(analysis_status = 'pending') AS pending
             FROM songs`
        );
        out('');
        out(`${Number(counts.total)} song(s) in the table, ${Number(counts.pending || 0)} awaiting analysis.`);
        out('');
        out('Next:');
        out('  node backend/scripts/backfillAudioFeatures.js --status');
        out('  node backend/scripts/backfillAudioFeatures.js --limit 20 --inline');
    } catch (err) {
        errOut(`Error adding audio feature columns: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
