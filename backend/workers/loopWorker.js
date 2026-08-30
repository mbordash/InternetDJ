const { Worker } = require('bullmq');
const Redis = require('ioredis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
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

ffmpeg.setFfmpegPath(ffmpegStatic);

// MusicGen is unreliable at the two-to-four-second lengths this page offers:
// short takes often come back as a lead-in artifact and little else. Generate
// a longer, settled clip and trim it back to the length the member asked for,
// keeping the downbeat at the start.
const MIN_GENERATION_SECONDS = 8;

const trimToLength = (inputPath, outputPath, seconds) => new Promise((resolve, reject) => {
    ffmpeg(inputPath)
        .setDuration(seconds)
        .audioCodec('pcm_s16le')
        .toFormat('wav')
        .on('error', reject)
        .on('end', resolve)
        .save(outputPath);
});

logger.info('Initializing loop worker...'); // Log startup

const worker = new Worker('loop-gen', async (job) => {
    logger.info('Worker received job', { jobId: job.id, data: job.data });

    const { loopId, fullPrompt, duration } = job.data;

    await pool.query('UPDATE loops SET status = ? WHERE id = ?', ['generating', loopId]);
    logger.info('Updated loop status to generating', { loopId });

    const outputPath = path.join(__dirname, '..', 'temp', `${loopId}.wav`);
    const rawPath = path.join(__dirname, '..', 'temp', `${loopId}-raw.wav`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const requestedDuration = Number(duration) || MIN_GENERATION_SECONDS;
    const generateDuration = Math.max(requestedDuration, MIN_GENERATION_SECONDS);

    logger.info('Calling Replicate for loop generation', {
        loopId, fullPrompt, requestedDuration, generateDuration,
    });

    try {
        // Create prediction
        const predictionRes = await axios.post('https://api.replicate.com/v1/predictions', {
            version: '671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb', // Latest MusicGen version
            input: {
                prompt: fullPrompt,
                duration: generateDuration,
                model_version: 'stereo-large',
                output_format: 'wav',
                // Peak normalization scales a quiet take up until its loudest
                // sample hits full scale, which turns a near-silent generation
                // into a wall of amplified noise. Loudness normalization (the
                // model's own default) keeps quiet takes quiet.
                normalization_strategy: 'loudness',
                // Replicate's default is 3. Higher values weight the prompt
                // more heavily against the model's own habits, which is what
                // a request for a specific genre needs -- at 3 a "jazz drum
                // track" came back as a generic funk groove.
                classifier_free_guidance: 5
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
        const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        if (!outputUrl) {
            throw new Error('Replicate prediction succeeded with no audio output');
        }
        const audioRes = await axios.get(outputUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(rawPath, audioRes.data);

        logger.info('Loop generated and downloaded from Replicate', { loopId });

        if (generateDuration > requestedDuration) {
            try {
                await trimToLength(rawPath, outputPath, requestedDuration);
                logger.info('Trimmed loop to requested length', { loopId, requestedDuration });
            } catch (trimErr) {
                // A longer loop beats no loop: fall back to the untrimmed take.
                logger.error('Failed to trim loop, using full generation', { loopId, err: trimErr.message });
                fs.copyFileSync(rawPath, outputPath);
            }
        } else {
            fs.copyFileSync(rawPath, outputPath);
        }

        // Upload to S3
        const audioBuffer = fs.readFileSync(outputPath);
        const uploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: `loops/${loopId}.wav`,
            Body: audioBuffer,
            ContentType: 'audio/wav'
        };
        await s3Client.send(new PutObjectCommand(uploadParams));
        const s3Url = buildPublicFileUrl(uploadParams.Key);

        await pool.query('UPDATE loops SET status = ?, url = ? WHERE id = ?', ['ready', s3Url, loopId]);
        logger.info('Loop uploaded to S3 and status updated to ready', { loopId, s3Url });

    } catch (err) {
        await pool.query('UPDATE loops SET status = ? WHERE id = ?', ['failed', loopId]);
        logger.error('Error generating loop with Replicate', err);
        throw err;
    } finally {
        // Cleanup runs on failure too, so a failed job doesn't leave a
        // half-written WAV behind in temp.
        [rawPath, outputPath].forEach((file) => {
            try {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch (cleanupErr) {
                logger.error('Failed to clean up temp loop file', { file, err: cleanupErr.message });
            }
        });
    }
}, { connection: redisConnection });

worker.on('ready', () => logger.info('Loop worker is ready and listening for jobs'));
worker.on('completed', (job) => logger.info(`Loop job completed`, { jobId: job.id, loopId: job.data.loopId }));
worker.on('failed', (job, err) => logger.error(`Loop job failed`, { jobId: job.id, loopId: job.data.loopId, err: err.message }));
worker.on('error', (err) => logger.error('Loop worker error', err));