const { Queue } = require('bullmq');
const Redis = require('ioredis');
const logger = require('./logger');

const ANALYSIS_QUEUE_NAME = 'audio-analysis';

// A fresh upload is someone waiting to see their own song page fill in; the
// backfill is a one-off sweep of tracks that have sat there for months. Lower
// number wins in BullMQ, so a sweep of the whole catalogue never delays the
// track someone just uploaded.
const PRIORITY_UPLOAD = 1;
const PRIORITY_BACKFILL = 10;

let queue = null;
let connection = null;

function getQueue() {
    if (!queue) {
        connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
        });
        queue = new Queue(ANALYSIS_QUEUE_NAME, { connection });
    }
    return queue;
}

/**
 * Queue a song for tempo/key analysis. Never throws: analysis is a nice-to-have
 * on top of an upload that has already succeeded, and a Redis hiccup must not
 * fail the upload. A song left at 'pending' is picked up by the next backfill
 * sweep, so dropping one here is recoverable rather than permanent.
 */
async function enqueueSongAnalysis(songId, { backfill = false } = {}) {
    try {
        await getQueue().add(
            'analyze-song',
            { songId: Number(songId) },
            {
                priority: backfill ? PRIORITY_BACKFILL : PRIORITY_UPLOAD,
                attempts: 2,
                backoff: { type: 'exponential', delay: 10000 },
                removeOnComplete: true,
                removeOnFail: 200,
            }
        );
        return true;
    } catch (err) {
        logger.error('Failed to queue audio analysis', { songId, err: err.message });
        return false;
    }
}

/**
 * Close the queue and the redis connection it owns. BullMQ does not close a
 * connection it was handed, so a script that only called queue.close() would
 * hang with the event loop still held open.
 */
async function closeQueue() {
    if (queue) {
        await queue.close();
        queue = null;
    }
    if (connection) {
        await connection.quit().catch(() => connection.disconnect());
        connection = null;
    }
}

module.exports = {
    getQueue,
    closeQueue,
    enqueueSongAnalysis,
    ANALYSIS_QUEUE_NAME,
    PRIORITY_UPLOAD,
    PRIORITY_BACKFILL,
};
