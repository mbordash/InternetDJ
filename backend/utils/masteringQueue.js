const { addJob } = require('./jobQueue');

const MASTER_QUEUE_NAME = 'auto-master';

// A master is several full ffmpeg passes over a track on a shared CPU. The
// lease has to be long enough that a slow one is never mistaken for a dead
// worker, but the worker heartbeats while it renders, so this is only the
// window after a crash before the job goes back in line.
const LEASE_MS = 30 * 60 * 1000;

// Preview renders live under their own prefix so the cleanup cron can sweep
// the ones nobody kept without ever touching published song audio.
const PREVIEW_PREFIX = 'mastering-previews/';

// Statuses that still occupy the queue ahead of a newly submitted job.
const ACTIVE_STATUSES = ['queued', 'analyzing', 'rendering'];

// Wall-clock seconds of work per second of audio, used only until the queue
// has real history to average. Measured locally at roughly 0.1; a shared-CPU
// production box is several times slower, so this starts deliberately
// pessimistic rather than promising a wait it cannot keep.
const FALLBACK_RATE = 0.4;

// Assumed track length when a job has not been measured yet - most uploads sit
// near this, and the estimate is replaced by the real duration as soon as the
// analysis pass reports it.
const ASSUMED_DURATION_SEC = 240;

const MIN_ESTIMATE_SEC = 20;

/**
 * Hand a mastering job to the worker. The mastering_jobs row is written first
 * by the caller and is the real record; this only puts it in line.
 */
async function enqueueMasteringJob({ jobId, songId, userId }) {
    return addJob(MASTER_QUEUE_NAME, { jobId, songId, userId });
}

/**
 * Seconds of processing per second of audio, averaged over recent completed
 * jobs so the estimate calibrates itself to whatever hardware is actually
 * running. Falls back to a fixed rate until enough jobs have finished.
 */
async function measureRate(db) {
    try {
        const rows = await db.query(
            `SELECT duration_ms, audio_duration_sec
             FROM mastering_jobs
             WHERE status = 'ready' AND duration_ms IS NOT NULL
               AND audio_duration_sec IS NOT NULL AND audio_duration_sec > 0
             ORDER BY finished_at DESC
             LIMIT 20`
        );
        if (!rows.length) return FALLBACK_RATE;

        const rates = rows.map(r => (Number(r.duration_ms) / 1000) / Number(r.audio_duration_sec));
        const usable = rates.filter(r => Number.isFinite(r) && r > 0);
        if (!usable.length) return FALLBACK_RATE;

        return usable.reduce((sum, r) => sum + r, 0) / usable.length;
    } catch (err) {
        return FALLBACK_RATE;
    }
}

/**
 * Position in line and an estimated wait, so the modal can tell the artist how
 * long this will take instead of spinning indefinitely.
 *
 * Position counts jobs created before this one that have not finished. With
 * concurrency 1 that is exactly how many tracks must be processed first, so
 * the wait is their processing time plus this job's own.
 */
async function estimateWait(db, job) {
    const rate = await measureRate(db);

    const ahead = await db.query(
        `SELECT audio_duration_sec
         FROM mastering_jobs
         WHERE status IN (?, ?, ?) AND created_at < ?`,
        [...ACTIVE_STATUSES, job.created_at]
    );

    const secondsFor = (audioDuration) =>
        Math.max(MIN_ESTIMATE_SEC, (Number(audioDuration) || ASSUMED_DURATION_SEC) * rate);

    const aheadSeconds = ahead.reduce((sum, row) => sum + secondsFor(row.audio_duration_sec), 0);

    // A job already being worked on has some of its own time behind it, but
    // there is no cheap way to know how much - counting it whole keeps the
    // estimate on the pessimistic side, which is the right way to be wrong.
    const ownSeconds = secondsFor(job.audio_duration_sec);
    const elapsedSeconds = job.started_at
        ? Math.max(0, (Date.now() - new Date(job.started_at).getTime()) / 1000)
        : 0;

    const remaining = job.status === 'queued'
        ? aheadSeconds + ownSeconds
        : Math.max(0, ownSeconds - elapsedSeconds);

    return {
        queuePosition: ahead.length,
        estimatedSecondsRemaining: Math.round(remaining),
    };
}

module.exports = {
    enqueueMasteringJob,
    estimateWait,
    MASTER_QUEUE_NAME,
    PREVIEW_PREFIX,
    ACTIVE_STATUSES,
    LEASE_MS,
};
