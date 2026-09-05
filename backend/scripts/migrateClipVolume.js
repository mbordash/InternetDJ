/**
 * Gives a clip its own level:
 *     node backend/scripts/migrateClipVolume.js
 *
 * The sampler has read `sample.volume` for a long time, in the timeline, in the
 * mix and in the export, always falling back to 1 because `project_samples` has
 * no such column. Nothing was broken by that, since no control ever offered to
 * set it, but the engine was carrying a feature with no storage behind it: the
 * arithmetic for per-clip level was written, tested and multiplied into every
 * gain, and the answer was always one.
 *
 * A clip level is worth having on its own terms. Track volume balances parts
 * against each other; clip volume is for the single hit that came in hotter
 * than the rest of the take, and riding the track fader to fix one clip moves
 * everything else with it.
 *
 * Existing rows default to 1, which is exactly what the code has been assuming,
 * so this changes nothing about how any current project sounds.
 *
 * Safe to re-run: the ALTER is IF NOT EXISTS, and the column is read back out
 * of information_schema afterwards rather than inferred, because IF NOT EXISTS
 * makes a no-op and a success look identical.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

(async () => {
    try {
        out('Adding per-clip volume to `project_samples`...');

        await pool.query(`ALTER TABLE project_samples
            ADD COLUMN IF NOT EXISTS volume FLOAT NOT NULL DEFAULT 1`);
        out('  ok  volume column');

        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS defaultValue,
                    IS_NULLABLE AS nullable
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_samples'
                AND COLUMN_NAME = 'volume'`
        );

        out('');
        out('Columns now present on `project_samples`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 12)} ${pad(column.type, 10)} default=${column.defaultValue ?? 'NULL'} null=${column.nullable}`);
        }

        if (!columns.length) {
            errOut('');
            errOut('MISSING: volume - the migration did not apply.');
            await finish(1);
            return;
        }

        out('');
        out('Done. Every existing clip is at 1, which is what the code already assumed.');
        await finish(0);
    } catch (err) {
        errOut(`Migration failed: ${err.message}`);
        errOut(err.stack);
        await finish(1);
    }
})();
