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

// List all samples in the user's library
router.get('/', authenticate, async (req, res) => {
    try {
        const samples = await pool.query(
            'SELECT id, name, mp3_url, created_at FROM sample_library WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(samples);
    } catch (err) {
        console.error('Error in GET /sample-library:', err);
        res.status(500).json({ error: 'Failed to fetch sample library: ' + err.message });
    }
});

// Upload a new sample to the library
router.post('/', authenticate, async (req, res) => {
    const mp3 = req.files?.mp3;
    if (!mp3) {
        return res.status(400).json({ error: 'MP3 file is required' });
    }
    if (mp3.size > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'MP3 file exceeds 10MB limit' });
    }
    if (!mp3.mimetype.includes('audio/mpeg')) {
        return res.status(400).json({ error: 'File must be an MP3' });
    }
    try {
        const uploadParams = {
            Bucket: process.env.BUCKET_NAME,
            Key: `samples/${req.user.id}-${Date.now()}.mp3`,
            Body: mp3.data,
        };
        await s3Client.send(new PutObjectCommand(uploadParams));
        const mp3Url = buildPublicFileUrl(uploadParams.Key);
        const name = mp3.name || `Sample-${Date.now()}`;
        const result = await pool.query(
            'INSERT INTO sample_library (user_id, name, mp3_url) VALUES (?, ?, ?)',
            [req.user.id, name, mp3Url]
        );
        res.status(201).json({
            id: Number(result.insertId), // Convert BigInt to number
            name,
            mp3_url: mp3Url,
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

        // Insert into DB
        const result = await pool.query(
            'INSERT INTO sample_library (user_id, name, mp3_url) VALUES (?, ?, ?)',
            [userId, name, mp3Url]
        );

        res.status(201).json({
            id: Number(result.insertId),
            name,
            mp3_url: mp3Url,
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