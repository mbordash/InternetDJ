/**
 * Lets a loop record its real length:
 *     node backend/scripts/migrateLoopDurationPrecision.js
 *
 * Loop length is chosen in bars now rather than seconds, because a loop trimmed
 * to a round number of seconds is a musical length only by accident: four
 * seconds at 128 BPM is 2.13 bars, and butt-joining two copies of that lands off
 * the beat every time.
 *
 * Bars against a tempo give fractional seconds. Two bars at 128 BPM is 3.75, and
 * `duration` was an INT, so the row recorded 4 while ffmpeg trimmed to 3.75. The
 * audio was right and the record was wrong, which is the sort of quiet
 * disagreement that costs an hour to find later.
 *
 * FLOAT rather than DECIMAL: this is a length in seconds for a clip under ten
 * seconds long, not money.
 *
 * Existing rows keep their whole-second values, which were accurate for the
 * loops they describe.
 *
 * Safe to re-run: MODIFY COLUMN to the type it already has is a no-op, and the
 * column is read back out of information_schema afterwards rather than assumed.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

(async () => {
    try {
        out('Widening `loops`.`duration` so a bar-exact length survives...');

        await pool.query('ALTER TABLE loops MODIFY COLUMN duration FLOAT DEFAULT 30');
        out('  ok  duration is FLOAT');

        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS defaultValue
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loops'
                AND COLUMN_NAME = 'duration'`
        );

        out('');
        for (const column of columns) {
            out(`  ${pad(column.name, 12)} ${pad(column.type, 12)} default=${column.defaultValue ?? 'NULL'}`);
        }

        if (!columns.length || !/float|double|decimal/i.test(columns[0].type)) {
            errOut('');
            errOut('MISSING: duration is not a floating point column - the migration did not apply.');
            await finish(1);
            return;
        }

        out('');
        out('Done. A two bar loop at 128 BPM now records 3.75 rather than 4.');
        await finish(0);
    } catch (err) {
        errOut(`Migration failed: ${err.message}`);
        errOut(err.stack);
        await finish(1);
    }
})();
