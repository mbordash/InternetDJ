/**
 * A job queue that runs on the MariaDB instance the app already pays for.
 *
 * This replaces BullMQ and the managed Redis it needed. Redis was only ever
 * doing dispatch here: every queue's real state (loops.status,
 * mastering_jobs.status, songs.analysis_status) was already a row in MariaDB,
 * so the only thing lost by dropping it is Redis' blocking pop, and these jobs
 * take seconds to minutes - a poll every second or two is invisible next to a
 * three-pass ffmpeg master.
 *
 * Design notes worth not rediscovering:
 *
 * - Claiming is a conditional UPDATE (`WHERE id = ? AND status = 'waiting'`),
 *   not SELECT ... FOR UPDATE. A single UPDATE is already atomic, so two
 *   workers racing for the same row cannot both win, and nothing here has to
 *   pin a pool connection for the length of a transaction.
 *
 * - Jobs are leased rather than simply marked active. A worker that dies
 *   mid-render leaves an 'active' row that no one would ever revisit, so the
 *   lease expires and the next tick puts the job back in line. A running
 *   worker extends its own lease on a heartbeat, which is why the lease can be
 *   short (minutes) even though a mastering job is long.
 *
 * - Completed jobs are deleted, matching BullMQ's removeOnComplete. Failed
 *   jobs are kept so `--status` can show why, and pruned after FAILED_TTL_DAYS.
 */
const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('./logger');

const TABLE = 'job_queue';

// Lower number wins, matching BullMQ's priority ordering so the existing
// PRIORITY_UPLOAD / PRIORITY_BACKFILL constants keep their meaning.
const DEFAULT_PRIORITY = 100;

const DEFAULT_POLL_MS = 1500;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const RECLAIM_EVERY_MS = 30 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const FAILED_TTL_DAYS = 14;

// How many candidate rows a claim attempt looks at before giving up for this
// tick. Only matters when several workers share one queue and collide; with
// the usual one worker per queue the first row always wins.
const CLAIM_CANDIDATES = 5;

const workerId = `${process.env.FLY_MACHINE_ID || require('os').hostname()}:${process.pid}`;

const toMillis = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Add a job. Returns the new job id.
 *
 * `attempts` counts total tries, not retries, matching BullMQ: attempts 2 means
 * one retry. `backoffMs` is the exponential base, so try 2 waits backoffMs,
 * try 3 waits twice that, and so on.
 */
async function addJob(queue, payload, options = {}) {
    const {
        priority = DEFAULT_PRIORITY,
        attempts = 1,
        backoffMs = 0,
        delayMs = 0,
    } = options;

    const result = await pool.query(
        `INSERT INTO ${TABLE} (queue, payload, priority, max_attempts, backoff_ms, run_at)
         VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL ? SECOND)`,
        [
            queue,
            JSON.stringify(payload ?? {}),
            Math.round(priority),
            Math.max(1, Math.round(attempts)),
            Math.max(0, Math.round(backoffMs)),
            Math.ceil(Math.max(0, delayMs) / 1000),
        ]
    );
    return Number(result.insertId);
}

/**
 * Put back any job whose worker died holding it. Scoped to one queue so a
 * stalled mastering render is never disturbed by the analysis worker's tick.
 */
async function reclaimStalled(queue) {
    const result = await pool.query(
        `UPDATE ${TABLE}
         SET status = 'waiting', locked_by = NULL, lease_expires_at = NULL,
             last_error = 'worker stopped holding this job; returned to the queue'
         WHERE queue = ? AND status = 'active'
           AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()`,
        [queue]
    );
    const reclaimed = Number(result.affectedRows) || 0;
    if (reclaimed) {
        logger.info('Returned stalled jobs to the queue', { queue, reclaimed });
    }
    return reclaimed;
}

/** Take one job off the queue, or null if there is nothing due. */
async function claimJob(queue, leaseMs) {
    const leaseSeconds = Math.ceil(leaseMs / 1000);
    const candidates = await pool.query(
        `SELECT id FROM ${TABLE}
         WHERE queue = ? AND status = 'waiting' AND run_at <= NOW()
         ORDER BY priority ASC, id ASC
         LIMIT ${CLAIM_CANDIDATES}`,
        [queue]
    );

    for (const candidate of candidates) {
        const claimed = await pool.query(
            `UPDATE ${TABLE}
             SET status = 'active', attempts = attempts + 1, locked_by = ?,
                 started_at = NOW(), lease_expires_at = NOW() + INTERVAL ? SECOND
             WHERE id = ? AND status = 'waiting'`,
            [workerId, leaseSeconds, candidate.id]
        );
        if (Number(claimed.affectedRows) > 0) {
            const rows = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [candidate.id]);
            if (rows.length) return rows[0];
        }
        // Another worker got there first. Try the next candidate.
    }
    return null;
}

async function extendLease(jobId, leaseMs) {
    await pool.query(
        `UPDATE ${TABLE} SET lease_expires_at = NOW() + INTERVAL ? SECOND
         WHERE id = ? AND status = 'active'`,
        [Math.ceil(leaseMs / 1000), jobId]
    );
}

async function completeJob(jobId) {
    await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [jobId]);
}

/**
 * Record a failure, and either put the job back with a backoff or park it as
 * failed. Mirrors BullMQ's exponential backoff so the analysis queue keeps the
 * ten-second-then-twenty retry it had.
 */
async function failJob(job, err) {
    const message = String(err?.message || err || 'Unknown error').slice(0, 2000);
    const attempts = Number(job.attempts);
    const maxAttempts = Number(job.max_attempts);

    if (attempts < maxAttempts) {
        const base = Number(job.backoff_ms) || 0;
        const delaySeconds = Math.ceil((base * Math.pow(2, attempts - 1)) / 1000);
        await pool.query(
            `UPDATE ${TABLE}
             SET status = 'waiting', locked_by = NULL, lease_expires_at = NULL,
                 last_error = ?, run_at = NOW() + INTERVAL ? SECOND
             WHERE id = ?`,
            [message, delaySeconds, job.id]
        );
        return { retrying: true, delaySeconds };
    }

    await pool.query(
        `UPDATE ${TABLE}
         SET status = 'failed', locked_by = NULL, lease_expires_at = NULL,
             last_error = ?, finished_at = NOW()
         WHERE id = ?`,
        [message, job.id]
    );
    return { retrying: false };
}

async function pruneFailed() {
    const result = await pool.query(
        `DELETE FROM ${TABLE}
         WHERE status = 'failed' AND finished_at < NOW() - INTERVAL ? DAY`,
        [FAILED_TTL_DAYS]
    );
    return Number(result.affectedRows) || 0;
}

/** Counts by status, for the maintenance scripts' status reports. */
async function getJobCounts(queue) {
    const rows = await pool.query(
        `SELECT status, COUNT(*) AS count FROM ${TABLE} WHERE queue = ? GROUP BY status`,
        [queue]
    );
    const counts = { waiting: 0, active: 0, failed: 0 };
    for (const row of rows) {
        counts[row.status] = Number(row.count);
    }
    // Delayed retries are 'waiting' rows that are not due yet. Reported apart
    // from waiting so "nothing is draining this queue" stays an honest read.
    const [delayed] = await pool.query(
        `SELECT COUNT(*) AS count FROM ${TABLE}
         WHERE queue = ? AND status = 'waiting' AND run_at > NOW()`,
        [queue]
    );
    counts.delayed = Number(delayed.count) || 0;
    counts.waiting -= counts.delayed;
    return counts;
}

async function getRecentFailures(queue, limit = 5) {
    const rows = await pool.query(
        `SELECT id, payload, attempts, last_error, finished_at
         FROM ${TABLE}
         WHERE queue = ? AND status = 'failed'
         ORDER BY finished_at DESC
         LIMIT ${Math.max(1, Math.round(limit))}`,
        [queue]
    );
    return rows.map(row => ({ ...row, data: parsePayload(row.payload) }));
}

function parsePayload(payload) {
    try {
        return JSON.parse(payload);
    } catch (err) {
        return {};
    }
}

/**
 * Run jobs from one queue until the process is stopped.
 *
 * `handler` is called with the decoded payload, exactly like a BullMQ
 * processor. Throwing marks the job failed (and retries it if attempts allow),
 * which is what the workers already rely on.
 *
 * Returns a stop() so a test or a script can shut a worker down; the long-lived
 * worker processes just let it run.
 */
function runWorker(queue, handler, options = {}) {
    const concurrency = Math.max(1, Math.round(Number(options.concurrency) || 1));
    const pollMs = toMillis(options.pollMs, DEFAULT_POLL_MS);
    const leaseMs = toMillis(options.leaseMs, DEFAULT_LEASE_MS);
    const heartbeatMs = Math.max(1000, Math.floor(leaseMs / 3));

    let stopping = false;
    let running = 0;
    let lastReclaim = 0;
    let lastPrune = 0;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function process(job) {
        const data = parsePayload(job.payload);
        const heartbeat = setInterval(() => {
            extendLease(job.id, leaseMs).catch(err =>
                logger.error('Could not extend job lease', { queue, jobId: String(job.id), err: err.message })
            );
        }, heartbeatMs);

        try {
            await handler({ id: String(job.id), name: queue, data, attempts: Number(job.attempts) });
            await completeJob(job.id);
        } catch (err) {
            const outcome = await failJob(job, err).catch(dbErr => {
                logger.error('Could not record job failure', { queue, jobId: String(job.id), err: dbErr.message });
                return { retrying: false };
            });
            if (outcome.retrying) {
                logger.error('Job failed; retrying', {
                    queue, jobId: String(job.id), inSeconds: outcome.delaySeconds, err: err.message,
                });
            } else {
                logger.error('Job failed', { queue, jobId: String(job.id), err: err.message });
            }
        } finally {
            clearInterval(heartbeat);
        }
    }

    async function tick() {
        const now = Date.now();

        if (now - lastReclaim > RECLAIM_EVERY_MS) {
            lastReclaim = now;
            await reclaimStalled(queue).catch(err =>
                logger.error('Could not reclaim stalled jobs', { queue, err: err.message })
            );
        }
        if (now - lastPrune > PRUNE_EVERY_MS) {
            lastPrune = now;
            await pruneFailed().catch(err =>
                logger.error('Could not prune failed jobs', { queue, err: err.message })
            );
        }

        let claimedAny = false;
        while (!stopping && running < concurrency) {
            const job = await claimJob(queue, leaseMs);
            if (!job) break;
            claimedAny = true;
            running++;
            // Deliberately not awaited: with concurrency > 1 the loop must be
            // free to claim the next job while this one runs.
            process(job).finally(() => { running--; });
        }
        return claimedAny;
    }

    (async () => {
        if (typeof options.onReady === 'function') options.onReady();
        while (!stopping) {
            let busy = false;
            try {
                busy = await tick();
            } catch (err) {
                // A database blip must not kill the worker process; back off
                // for a poll interval and try again.
                logger.error('Job queue poll failed', { queue, err: err.message });
            }
            // Only idle when there was nothing to take. A queue with a backlog
            // drains at full speed rather than one job per poll.
            if (!busy) await sleep(pollMs);
        }
    })();

    return async function stop() {
        stopping = true;
        while (running > 0) await sleep(50);
    };
}

module.exports = {
    addJob,
    runWorker,
    getJobCounts,
    getRecentFailures,
    reclaimStalled,
    pruneFailed,
    TABLE,
    DEFAULT_PRIORITY,
};
