const { Worker } = require('bullmq');
const Redis = require('ioredis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const logger = require('../utils/logger');
const { buildPublicFileUrl } = require('../utils/storage');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,  // Required for BullMQ with ioredis
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000); // Exponential backoff: 50ms, 100ms, ..., up to 2s
        logger.info(`Retrying Redis connection: attempt ${times}, delay ${delay}ms`);
        return delay;
    },
    reconnectOnError: (err) => {
        const targetError = 'READONLY'; // Retry on read-only errors (e.g., connected to replica)
        if (err.message.includes(targetError)) {
            return true; // Reconnect and resend command
        }
        return false;
    }
});

logger.info('Worker started with Redis connection:', redisUrl); // Log on startup

logger.info('Initializing stem worker...'); // Log startup

const worker = new Worker('stem-gen', async (job) => {
    logger.info('Worker received job', { jobId: job.id, data: job.data });

    const { stemId, fullPrompt, duration } = job.data;

    await pool.query('UPDATE stems SET status = ? WHERE id = ?', ['generating', stemId]);
    logger.info('Updated stem status to generating', { stemId });

    const outputPath = path.join(__dirname, '..', 'temp', `${stemId}.wav`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    logger.info('Calling Replicate for stem generation', { stemId, fullPrompt, duration });

    try {
        // Create prediction
        const predictionRes = await axios.post('https://api.replicate.com/v1/predictions', {
            version: '671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb', // Latest MusicGen version
            input: {
                prompt: fullPrompt,
                duration: duration,
                model_version: 'stereo-large',
                output_format: 'wav',
                normalization_strategy: 'peak'
            }
        }, {
            headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }
        });

        let prediction = predictionRes.data;

        // Poll for completion
        while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s
            const statusRes = await axios.get(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
                headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }
            });
            prediction = statusRes.data;
            logger.info('Prediction status:', prediction.status);
        }

        if (prediction.status === 'failed') {
            throw new Error('Replicate prediction failed: ' + prediction.error);
        }

        // Download the output WAV
        const audioRes = await axios.get(prediction.output, { responseType: 'arraybuffer' });
        fs.writeFileSync(outputPath, audioRes.data);

        logger.info('Stem generated and downloaded from Replicate', { stemId });

        // Upload to S3
        const audioBuffer = fs.readFileSync(outputPath);
        const uploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: `stems/${stemId}.wav`,
            Body: audioBuffer,
            ContentType: 'audio/wav'
        };
        await s3Client.send(new PutObjectCommand(uploadParams));
        const s3Url = buildPublicFileUrl(uploadParams.Key);

        await pool.query('UPDATE stems SET status = ?, url = ? WHERE id = ?', ['ready', s3Url, stemId]);
        logger.info('Stem uploaded to S3 and status updated to ready', { stemId, s3Url });

        fs.unlinkSync(outputPath); // Cleanup
    } catch (err) {
        await pool.query('UPDATE stems SET status = ? WHERE id = ?', ['failed', stemId]);
        logger.error('Error generating stem with Replicate', err);
        throw err;
    }
}, { connection: redisConnection });

worker.on('ready', () => logger.info('Stem worker is ready and listening for jobs'));
worker.on('completed', (job) => logger.info(`Stem job completed`, { jobId: job.id, stemId: job.data.stemId }));
worker.on('failed', (job, err) => logger.error(`Stem job failed`, { jobId: job.id, stemId: job.data.stemId, err: err.message }));
worker.on('error', (err) => logger.error('Stem worker error', err));