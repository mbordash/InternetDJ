const fs = require('fs');
const tmp = require('tmp');
const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('../config/database');
const s3Client = require('../config/tigris');
const logger = require('../utils/logger');
const { buildPublicFileUrl, extractObjectKey } = require('../utils/storage');
const { analyzeAudio } = require('../utils/audioAnalysis');
const { buildMasteringPlan } = require('../utils/masteringPlan');
const { renderMaster } = require('../utils/masteringRender');
const { runWorker } = require('../utils/jobQueue');
const { MASTER_QUEUE_NAME, PREVIEW_PREFIX, LEASE_MS } = require('../utils/masteringQueue');

// One at a time on purpose. Each job is two or three full ffmpeg passes over
// the track, and the app runs on a single shared CPU - a second concurrent job
// would not finish sooner, it would just make both slower and starve the web
// process. Raise this together with the VM size, not before it.
const CONCURRENCY = parseInt(process.env.MASTERING_CONCURRENCY, 10) || 1;

async function setStatus(jobId, status, extra = {}, requireStatus = null) {
    const fields = ['status = ?'];
    const values = [status];
    for (const [column, value] of Object.entries(extra)) {
        fields.push(`${column} = ?`);
        values.push(value);
    }
    values.push(jobId);

    // requireStatus makes the write conditional, so a job cancelled mid-render
    // cannot be resurrected by the worker finishing it afterwards.
    let sql = `UPDATE mastering_jobs SET ${fields.join(', ')} WHERE id = ?`;
    if (requireStatus) {
        sql += ' AND status = ?';
        values.push(requireStatus);
    }
    const result = await pool.query(sql, values);
    return Number(result.affectedRows) > 0;
}

async function downloadToTemp(mp3Url) {
    const key = extractObjectKey(mp3Url);
    if (!key) throw new Error('Song has an unrecognised storage URL');

    const { Body } = await s3Client.send(new GetObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: key,
    }));

    const file = tmp.fileSync({ postfix: '.mp3', discardDescriptor: true });
    await new Promise((resolve, reject) => {
        Body.pipe(fs.createWriteStream(file.name))
            .on('finish', resolve)
            .on('error', reject);
    });
    return file;
}

// Analysis is the expensive half and the audio never changes underneath a
// given URL, so a second master of the same track skips straight to rendering.
async function getCachedAnalysis(songId, mp3Url) {
    try {
        const rows = await pool.query(
            'SELECT analysis FROM song_analysis WHERE song_id = ? AND mp3_url = ?',
            [songId, mp3Url]
        );
        if (rows.length) return JSON.parse(rows[0].analysis);
    } catch (err) {
        logger.error('Could not read cached analysis:', err.message);
    }
    return null;
}

async function cacheAnalysis(songId, mp3Url, analysis) {
    try {
        await pool.query(
            `INSERT INTO song_analysis (song_id, mp3_url, analysis) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE mp3_url = VALUES(mp3_url), analysis = VALUES(analysis),
                                     created_at = CURRENT_TIMESTAMP`,
            [songId, mp3Url, JSON.stringify(analysis)]
        );
    } catch (err) {
        logger.error('Could not cache analysis:', err.message);
    }
}

runWorker(MASTER_QUEUE_NAME, async (job) => {
    const { jobId, songId, userId } = job.data;
    const startedAt = Date.now();
    logger.info('Mastering worker received job', { jobId, songId, userId });

    let sourceFile = null;
    let outputFile = null;

    try {
        // The artist can cancel while the job is still waiting in line. Cancel
        // marks the row failed but does not pull the job out of the queue, so
        // without this check the worker would process it anyway and overwrite
        // the cancellation with a finished master.
        const claimed = await pool.query(
            `UPDATE mastering_jobs SET status = 'analyzing', started_at = NOW()
             WHERE id = ? AND status = 'queued'`,
            [jobId]
        );
        if (!claimed.affectedRows) {
            logger.info('Skipping mastering job that is no longer queued', { jobId });
            return;
        }

        const songs = await pool.query('SELECT mp3_url, title, genre FROM songs WHERE id = ?', [songId]);
        if (!songs.length) throw new Error('Song not found');
        const song = songs[0];

        sourceFile = await downloadToTemp(song.mp3_url);

        let analysis = await getCachedAnalysis(songId, song.mp3_url);
        if (analysis) {
            logger.info('Reusing cached analysis', { jobId, songId });
        } else {
            analysis = await analyzeAudio(sourceFile.name);
            await cacheAnalysis(songId, song.mp3_url, analysis);
        }

        const plan = buildMasteringPlan(analysis, { genre: song.genre });

        const stillRunning = await setStatus(jobId, 'rendering', {
            analysis: JSON.stringify(analysis),
            audio_duration_sec: analysis.durationSec || null,
        }, 'analyzing');
        if (!stillRunning) {
            logger.info('Mastering job was cancelled during analysis', { jobId });
            return;
        }

        outputFile = tmp.fileSync({ postfix: '.mp3', discardDescriptor: true });
        const result = await renderMaster({
            inputPath: sourceFile.name,
            outputPath: outputFile.name,
            plan,
            measured: analysis,
            analyze: analyzeAudio,
        });

        // The preview lives under its own prefix so the cleanup cron can sweep
        // previews nobody kept without touching published songs. Saving copies
        // the audio into a real song upload; this object is always disposable.
        const previewKey = `${PREVIEW_PREFIX}${jobId}.mp3`;
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: previewKey,
            Body: fs.createReadStream(outputFile.name),
            ContentType: 'audio/mpeg',
        }));

        const finishedPlan = {
            ...plan,
            findings: [...plan.findings, ...result.notes],
            applied: {
                filters: result.filters,
                driveDb: result.driveDb,
                corrected: result.corrected,
                onTarget: result.onTarget,
            },
            verification: {
                integratedLufs: result.verification.integratedLufs,
                truePeakDb: result.verification.truePeakDb,
                lra: result.verification.lra,
            },
        };

        const stored = await setStatus(jobId, 'ready', {
            plan: JSON.stringify(finishedPlan),
            result_url: buildPublicFileUrl(previewKey),
            finished_at: new Date(),
            duration_ms: Date.now() - startedAt,
        }, 'rendering');

        if (!stored) {
            // Cancelled while rendering. Nothing now references this object, so
            // the cleanup sweep would never find it - remove it here instead.
            logger.info('Mastering job was cancelled during render; discarding preview', { jobId });
            await s3Client.send(new DeleteObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: previewKey,
            })).catch(err => logger.error('Could not discard cancelled preview:', err.message));
            return;
        }

        logger.info('Mastering job completed', { jobId, songId, ms: Date.now() - startedAt });
    } catch (err) {
        logger.error('Mastering job failed', { jobId, songId, error: err.message });
        await setStatus(jobId, 'failed', {
            error: err.message ? String(err.message).slice(0, 2000) : 'Unknown error',
            finished_at: new Date(),
            duration_ms: Date.now() - startedAt,
        }).catch(dbErr => logger.error('Could not record job failure:', dbErr.message));
        throw err;
    } finally {
        for (const file of [sourceFile, outputFile]) {
            if (!file) continue;
            try {
                file.removeCallback();
            } catch (cleanupErr) {
                logger.error('Failed to remove mastering temp file:', cleanupErr.message);
            }
        }
    }
}, {
    concurrency: CONCURRENCY,
    leaseMs: LEASE_MS,
    onReady: () => logger.info(`Mastering worker ready (concurrency ${CONCURRENCY})`),
});
