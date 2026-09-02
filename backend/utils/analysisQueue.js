const { addJob, getJobCounts, getRecentFailures } = require('./jobQueue');
const logger = require('./logger');

const ANALYSIS_QUEUE_NAME = 'audio-analysis';

// A fresh upload is someone waiting to see their own song page fill in; the
// backfill is a one-off sweep of tracks that have sat there for months. Lower
// number wins, so a sweep of the whole catalogue never delays the track someone
// just uploaded.
const PRIORITY_UPLOAD = 1;
const PRIORITY_BACKFILL = 10;

// Analysis is a couple of seconds a track. The lease only has to outlast one
// job by enough margin that a slow download does not look like a dead worker.
const LEASE_MS = 5 * 60 * 1000;

/**
 * Queue a song for tempo/key analysis. Never throws: analysis is a nice-to-have
 * on top of an upload that has already succeeded, and a database hiccup must
 * not fail the upload. A song left at 'pending' is picked up by the next
 * backfill sweep, so dropping one here is recoverable rather than permanent.
 */
async function enqueueSongAnalysis(songId, { backfill = false } = {}) {
    try {
        await addJob(
            ANALYSIS_QUEUE_NAME,
            { songId: Number(songId) },
            {
                priority: backfill ? PRIORITY_BACKFILL : PRIORITY_UPLOAD,
                attempts: 2,
                backoffMs: 10000,
            }
        );
        return true;
    } catch (err) {
        logger.error('Failed to queue audio analysis', { songId, err: err.message });
        return false;
    }
}

const getAnalysisCounts = () => getJobCounts(ANALYSIS_QUEUE_NAME);
const getAnalysisFailures = (limit) => getRecentFailures(ANALYSIS_QUEUE_NAME, limit);

/**
 * Kept so the maintenance scripts' teardown lists stay unchanged. The queue now
 * runs on the shared MariaDB pool, which utils/cli.js closes on its own, so
 * there is nothing of its own left to shut down.
 */
async function closeQueue() {}

module.exports = {
    enqueueSongAnalysis,
    getAnalysisCounts,
    getAnalysisFailures,
    closeQueue,
    ANALYSIS_QUEUE_NAME,
    PRIORITY_UPLOAD,
    PRIORITY_BACKFILL,
    LEASE_MS,
};
