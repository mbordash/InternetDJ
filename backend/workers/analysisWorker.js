const logger = require('../utils/logger');
const { analyzeSong } = require('../utils/songAnalysis');
const { runWorker } = require('../utils/jobQueue');
const { ANALYSIS_QUEUE_NAME, LEASE_MS } = require('../utils/analysisQueue');

// Same reasoning as the mastering worker: one shared CPU, and a second
// concurrent job would only make both slower. Analysis is much cheaper than a
// master (a couple of seconds a track), so a backfill still moves quickly.
const CONCURRENCY = parseInt(process.env.ANALYSIS_CONCURRENCY, 10) || 1;

// Printed unconditionally rather than through the logger: this line is how you
// tell from `fly logs` whether this process is actually running, which is the
// first thing to check when analysis results never appear.
console.log(`[analysisWorker] starting; queue=${ANALYSIS_QUEUE_NAME} concurrency=${CONCURRENCY} store=mariadb`);

runWorker(ANALYSIS_QUEUE_NAME, async (job) => {
    const songId = Number(job.data.songId);
    logger.info('Analysis worker received job', { jobId: job.id, songId });

    const result = await analyzeSong(songId);
    if (result.skipped) {
        logger.info('Skipped analysis', { songId, reason: result.reason });
        return result;
    }

    logger.info('Analysis stored', {
        songId,
        bpm: result.storedBpm,
        key: result.storedKey,
        durationSec: result.durationSec,
    });
    return result;
}, {
    concurrency: CONCURRENCY,
    leaseMs: LEASE_MS,
    onReady: () => console.log('[analysisWorker] ready and listening for jobs'),
});
