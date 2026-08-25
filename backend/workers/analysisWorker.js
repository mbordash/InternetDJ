const { Worker } = require('bullmq');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const { analyzeSong } = require('../utils/songAnalysis');
const { ANALYSIS_QUEUE_NAME } = require('../utils/analysisQueue');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,  // Required for BullMQ with ioredis
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        logger.info(`Retrying Redis connection: attempt ${times}, delay ${delay}ms`);
        return delay;
    },
});

// Same reasoning as the mastering worker: one shared CPU, and a second
// concurrent job would only make both slower. Analysis is much cheaper than a
// master (a couple of seconds a track), so a backfill still moves quickly.
const CONCURRENCY = parseInt(process.env.ANALYSIS_CONCURRENCY, 10) || 1;

// Printed unconditionally rather than through the logger: this line is how you
// tell from `fly logs` whether this process is actually running, which is the
// first thing to check when analysis results never appear.
console.log(`[analysisWorker] starting; queue=${ANALYSIS_QUEUE_NAME} concurrency=${CONCURRENCY} redis=${redisUrl.replace(/:[^:@]*@/, ':***@')}`);

const worker = new Worker(ANALYSIS_QUEUE_NAME, async (job) => {
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
}, { connection: redisConnection, concurrency: CONCURRENCY });

worker.on('ready', () => console.log('[analysisWorker] ready and listening for jobs'));
worker.on('completed', (job) => logger.info('Analysis job completed', { jobId: job.id, songId: job.data.songId }));
worker.on('failed', (job, err) => logger.error('Analysis job failed', {
    jobId: job?.id, songId: job?.data?.songId, err: err.message,
}));
worker.on('error', (err) => logger.error('Audio analysis worker error', err));
