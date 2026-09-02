/**
 * Creates the `job_queue` table that replaced Redis/BullMQ as the dispatch
 * layer for the loop, analysis and mastering workers. schema.sql only runs when
 * the database container initialises from empty, so an existing deployment
 * needs this:
 *   node backend/scripts/migrateJobQueue.js
 *
 * This one is not optional on the release that drops Redis: the moment the new
 * code lands, every upload tries to INSERT into this table, and an upload whose
 * analysis enqueue throws is an upload that silently never gets a tempo or key.
 *
 * Safe to re-run - CREATE TABLE IF NOT EXISTS, and the columns are read back
 * from information_schema afterwards, because IF NOT EXISTS makes a no-op and a
 * success look identical.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

const CREATE = `
CREATE TABLE IF NOT EXISTS job_queue (
    id BIGINT NOT NULL AUTO_INCREMENT,
    queue VARCHAR(64) NOT NULL,
    payload TEXT NOT NULL,
    priority INT NOT NULL DEFAULT 100,
    status ENUM('waiting','active','failed') NOT NULL DEFAULT 'waiting',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 1,
    backoff_ms INT NOT NULL DEFAULT 0,
    run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_by VARCHAR(120) DEFAULT NULL,
    lease_expires_at TIMESTAMP NULL DEFAULT NULL,
    last_error TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL DEFAULT NULL,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY claim (queue, status, priority, run_at),
    KEY lease (status, lease_expires_at),
    KEY prune (status, finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;

const STATEMENTS = [
    ['job_queue table', CREATE],
    ['claim index', 'ALTER TABLE job_queue ADD INDEX IF NOT EXISTS claim (queue, status, priority, run_at)'],
    ['lease index', 'ALTER TABLE job_queue ADD INDEX IF NOT EXISTS lease (status, lease_expires_at)'],
    ['prune index', 'ALTER TABLE job_queue ADD INDEX IF NOT EXISTS prune (status, finished_at)'],
];

const EXPECTED = [
    'id', 'queue', 'payload', 'priority', 'status', 'attempts', 'max_attempts',
    'backoff_ms', 'run_at', 'locked_by', 'lease_expires_at', 'last_error',
    'created_at', 'started_at', 'finished_at',
];

(async () => {
    try {
        out('Applying job_queue migration...');
        for (const [label, sql] of STATEMENTS) {
            await pool.query(sql);
            out(`  ok  ${label}`);
        }

        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS defaultValue
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_queue'
             ORDER BY ORDINAL_POSITION`
        );

        out('');
        out('Columns now present on `job_queue`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 20)} ${pad(column.type, 42)} default=${column.defaultValue ?? 'NULL'}`);
        }

        const missing = EXPECTED.filter(name => !columns.some(c => c.name === name));
        if (missing.length) {
            errOut('');
            errOut(`MISSING: ${missing.join(', ')} - the migration did not fully apply.`);
            await finish(1);
            return;
        }

        const rows = await pool.query(
            'SELECT queue, status, COUNT(*) AS count FROM job_queue GROUP BY queue, status ORDER BY queue, status'
        );
        out('');
        if (!rows.length) {
            out('The queue is empty, which is what a fresh migration should look like.');
        } else {
            out('Jobs currently in the table:');
            for (const row of rows) {
                out(`  ${pad(row.queue, 20)} ${pad(row.status, 10)} ${Number(row.count)}`);
            }
        }
    } catch (err) {
        errOut(`Error creating job_queue table: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
