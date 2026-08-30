/**
 * Renames the `stems` table to `loops`.
 *
 * The AI generator writes brand-new musical segments from a prompt; it does not
 * separate an existing song into its parts. "Stem" said the opposite of what the
 * feature does, so the whole surface was renamed to "loop" — routes, API paths
 * and this table with them. Run it directly with:
 *
 *   node backend/scripts/migrateStemsToLoops.js
 *
 * It also runs as part of the fly release_command, so a deploy cannot reach
 * traffic before the table the new code queries exists. Without it, every
 * generate, poll and library copy answers 500, because schema.sql only runs
 * when the database container initialises from empty.
 *
 * Safe to re-run. RENAME TABLE has no IF EXISTS, so which action is correct is
 * decided by looking the two names up in information_schema first:
 *
 *   loops present, stems absent  -> already migrated, do nothing
 *   stems present, loops absent  -> rename it
 *   neither present              -> fresh database, create it
 *   both present                 -> stop and say so, rather than guess which
 *                                   one holds the real rows
 *
 * songs.stems_url is deliberately untouched. That column is an artist's link to
 * the genuine bounced submixes of their own track, which is what a stem is.
 */
const pool = require('../config/database');
const { out, errOut, finish } = require('../utils/cli');

const CREATE_LOOPS = `
    CREATE TABLE IF NOT EXISTS loops (
        id VARCHAR(36) PRIMARY KEY,
        type ENUM('bass', 'synth', 'effects', 'drums') NOT NULL,
        prompt TEXT NOT NULL,
        user_id INT NOT NULL,
        status ENUM('queued', 'generating', 'ready', 'failed') DEFAULT 'queued',
        bpm INT DEFAULT 128,
        \`key\` VARCHAR(20) DEFAULT 'C minor',
        duration INT DEFAULT 30,
        url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`;

const tableExists = async (name) => {
    const rows = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [name]
    );
    return Number(rows[0].n) > 0;
};

(async () => {
    try {
        out('Migrating the AI generator table `stems` -> `loops`...');

        const [hasStems, hasLoops] = await Promise.all([
            tableExists('stems'),
            tableExists('loops'),
        ]);

        if (hasStems && hasLoops) {
            errOut('');
            errOut('BOTH `stems` and `loops` exist. Refusing to guess which one holds');
            errOut('the live rows. Inspect them and drop or merge one by hand, then');
            errOut('re-run this script.');
            await finish(1);
            return;
        }

        if (hasLoops) {
            out('  ok  `loops` already exists and `stems` is gone — nothing to do.');
        } else if (hasStems) {
            await pool.query('RENAME TABLE stems TO loops');
            out('  ok  renamed `stems` to `loops`, rows and all.');
        } else {
            await pool.query(CREATE_LOOPS);
            out('  ok  neither table existed — created `loops` from scratch.');
        }

        // Read the result back rather than trusting the branch above: on a
        // re-run the no-op path and a genuine success look identical.
        if (!(await tableExists('loops'))) {
            errOut('');
            errOut('MISSING: `loops` does not exist — the migration did not apply.');
            await finish(1);
            return;
        }

        const [counts] = await pool.query('SELECT COUNT(*) AS total FROM loops');
        out('');
        out(`\`loops\` is present with ${Number(counts.total)} row(s).`);
    } catch (err) {
        errOut(`Error migrating stems to loops: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
