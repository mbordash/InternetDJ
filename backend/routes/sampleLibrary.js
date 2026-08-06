const express = require('express');
const pool = require('../config/database');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { buildPublicFileUrl } = require('../utils/storage');
ffmpeg.setFfmpegPath(ffmpegStatic);
const stream = require('stream');
const mm = require('music-metadata');

// Best-effort duration probe (seconds); returns null on failure
async function probeDuration(buffer, mimeType = 'audio/mpeg') {
    try {
        const metadata = await mm.parseBuffer(buffer, mimeType, { duration: true });
        const duration = metadata?.format?.duration;
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch (err) {
        console.warn('Failed to probe audio duration:', err.message);
        return null;
    }
}

// List all samples in the user's library
router.get('/', authenticate, async (req, res) => {
    try {
        const samples = await pool.query(
            'SELECT id, name, mp3_url, duration, created_at FROM sample_library WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(samples);
    } catch (err) {
        console.error('Error in GET /sample-library:', err);
        res.status(500).json({ error: 'Failed to fetch sample library: ' + err.message });
    }
});

// Convert a WAV buffer to MP3 using ffmpeg
function transcodeWavToMp3(wavBuffer) {
    return new Promise((resolve, reject) => {
        const input = new stream.PassThrough();
        input.end(wavBuffer);
        const buffers = [];
        ffmpeg(input)
            .inputFormat('wav')
            .audioCodec('libmp3lame')
            .audioBitrate(192)
            .toFormat('mp3')
            .on('error', reject)
            .on('end', () => resolve(Buffer.concat(buffers)))
            .pipe(new stream.PassThrough()
                .on('data', (chunk) => buffers.push(chunk))
                .on('error', reject)
            );
    });
}

// Upload a new sample to the library (MP3 or WAV; WAV is transcoded to MP3)
router.post('/', authenticate, async (req, res) => {
    const upload = req.files?.mp3;
    if (!upload) {
        return res.status(400).json({ error: 'Audio file is required' });
    }
    const isMp3 = upload.mimetype.includes('audio/mpeg');
    const isWav = upload.mimetype.includes('audio/wav') || upload.mimetype.includes('audio/x-wav')
        || upload.mimetype.includes('audio/wave') || /\.wav$/i.test(upload.name || '');
    if (!isMp3 && !isWav) {
        return res.status(400).json({ error: 'File must be an MP3 or WAV' });
    }
    const sizeLimit = (isWav ? 50 : 10) * 1024 * 1024;
    if (upload.size > sizeLimit) {
        return res.status(400).json({ error: `File exceeds ${isWav ? 50 : 10}MB limit` });
    }
    try {
        let mp3Data = upload.data;
        if (isWav && !isMp3) {
            try {
                mp3Data = await transcodeWavToMp3(upload.data);
            } catch (err) {
                console.error('WAV transcode failed:', err.message);
                return res.status(400).json({ error: 'Failed to convert WAV to MP3: ' + err.message });
            }
        }
        const uploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: `samples/${req.user.id}-${Date.now()}.mp3`,
            Body: mp3Data,
            ContentType: 'audio/mpeg',
        };
        await s3Client.send(new PutObjectCommand(uploadParams));
        const mp3Url = buildPublicFileUrl(uploadParams.Key);
        const name = (upload.name || `Sample-${Date.now()}`).replace(/\.wav$/i, '.mp3');
        const duration = await probeDuration(mp3Data);
        const result = await pool.query(
            'INSERT INTO sample_library (user_id, name, mp3_url, duration) VALUES (?, ?, ?, ?)',
            [req.user.id, name, mp3Url, duration]
        );
        res.status(201).json({
            id: Number(result.insertId), // Convert BigInt to number
            name,
            mp3_url: mp3Url,
            duration,
            created_at: new Date(),
        });
    } catch (err) {
        console.error('Error in POST /sample-library:', err);
        res.status(500).json({ error: 'Failed to upload sample: ' + err.message });
    }
});

// Copy stem to sample library (new route)
router.post('/from-stem', authenticate, async (req, res) => {
    const { stemId } = req.body;
    const userId = req.user.id;

    if (!stemId) {
        return res.status(400).json({ error: 'stemId is required' });
    }

    try {
        // Fetch stem details (ensure it belongs to user and is ready)
        const stems = await pool.query(
            'SELECT url, type FROM stems WHERE id = ? AND user_id = ? AND status = ?',
            [stemId, userId, 'ready']
        );
        if (stems.length === 0) {
            return res.status(404).json({ error: 'Ready stem not found' });
        }

        const stem = stems[0];
        const wavKey = stem.url.split('/').slice(-2).join('/'); // e.g., stems/id.wav
        const mp3Key = `samples/${userId}-${Date.now()}.mp3`;

        // Download WAV from S3
        const getParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: wavKey,
        };
        const { Body } = await s3Client.send(new GetObjectCommand(getParams));

        // Convert WAV to MP3 using fluent-ffmpeg
        const mp3Buffer = await new Promise((resolve, reject) => {
            const passThrough = new stream.PassThrough();
            Body.pipe(passThrough);

            const buffers = [];
            ffmpeg(passThrough)
                .inputFormat('wav')
                .audioCodec('libmp3lame')
                .toFormat('mp3')
                .on('error', reject)
                .on('end', () => resolve(Buffer.concat(buffers)))
                .pipe(new stream.PassThrough()
                    .on('data', (chunk) => buffers.push(chunk))
                    .on('error', reject)
                );
        });

        // Upload MP3 to S3
        const uploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: mp3Key,
            Body: mp3Buffer,
            ContentType: 'audio/mpeg',
        };
        await s3Client.send(new PutObjectCommand(uploadParams));

        const mp3Url = buildPublicFileUrl(mp3Key);
        const name = `${stem.type.charAt(0).toUpperCase() + stem.type.slice(1)} Stem - ${stemId.slice(0, 8)}`; // e.g., "Bass Stem - abc12345"
        const duration = await probeDuration(mp3Buffer);

        // Insert into DB
        const result = await pool.query(
            'INSERT INTO sample_library (user_id, name, mp3_url, duration) VALUES (?, ?, ?, ?)',
            [userId, name, mp3Url, duration]
        );

        res.status(201).json({
            id: Number(result.insertId),
            name,
            mp3_url: mp3Url,
            duration,
            created_at: new Date(),
        });
    } catch (err) {
        console.error('Error in POST /sample-library/from-stem:', err);
        res.status(500).json({ error: 'Failed to copy stem to sample library: ' + err.message });
    }
});

// Delete a sample from the library
router.delete('/:sampleId', authenticate, async (req, res) => {
    const { sampleId } = req.params;
    try {
        const sample = await pool.query(
            'SELECT id FROM sample_library WHERE id = ? AND user_id = ?',
            [sampleId, req.user.id]
        );
        if (sample.length === 0) {
            return res.status(404).json({ error: 'Sample not found' });
        }
        const usage = await pool.query(
            'SELECT COUNT(*) as count FROM project_samples WHERE sample_id = ?',
            [sampleId]
        );
        if (Number(usage[0].count) > 0) {
            return res.status(400).json({ error: 'Cannot delete sample used in projects' });
        }
        await pool.query('DELETE FROM sample_library WHERE id = ?', [sampleId]);
        res.status(200).json({ message: 'Sample deleted' });
    } catch (err) {
        console.error('Error in DELETE /sample-library/:sampleId:', err);
        res.status(500).json({ error: 'Failed to delete sample: ' + err.message });
    }
});

module.exports = router;