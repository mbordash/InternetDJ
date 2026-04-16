const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const authenticate = require('../middleware/authenticate');
const pool = require('../config/database');
const logger = require('../utils/logger');
const router = express.Router();

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
logger.info('Redis connection for stems route:', process.env.REDIS_URL); // Log on startup

const stemQueue = new Queue('stem-gen', { connection: redisConnection });

// POST /api/stems/generate (matches your API style)
router.post('/generate', authenticate, async (req, res) => { // authenticate optional
    logger.info('Received POST /api/stems/generate request'); // Log entry

    const { type, prompt, bpm = 128, key = 'C minor', duration = 10 } = req.body;
    const userId = req.user.id; // From passport

    if (!['bass', 'synth', 'effects', 'drums'].includes(type)) {
        logger.error('Invalid stem type:', type);
        return res.status(400).json({ error: 'Invalid stem type' });
    }

    if (duration > 10) {
        logger.error('Duration exceeds limit:', duration);
        return res.status(400).json({ error: 'Duration cannot exceed 10 seconds' });
    }

    try {
        // Check daily limit
        const countResult = await pool.query(
            'SELECT COUNT(*) AS count FROM stems WHERE user_id = ? AND created_at >= NOW() - INTERVAL 1 DAY',
            [userId]
        );
        const dailyCount = Number(countResult[0].count);
        if (dailyCount >= 5) {
            logger.info('Daily stem limit reached for user', { userId });
            return res.status(429).json({ error: 'Daily limit of 5 stems reached' });
        }

        const stemId = uuidv4();
        const fullPrompt = `Isolated ${type} stem only: ${prompt}, ${bpm} BPM, ${key}, no other instruments, clean for DAW`;

        logger.info('Attempting to insert stem into DB', { stemId, userId, bpm, key, duration });
        await pool.query(
            'INSERT INTO stems (id, type, prompt, user_id, bpm, `key`, duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [stemId, type, fullPrompt, userId, bpm, key, duration]
        );
        logger.info('Stem inserted into DB successfully', { stemId });

        logger.info('Adding stem to queue', { stemId });
        await stemQueue.add('generate-stem', { stemId, fullPrompt, duration });
        logger.info('Stem added to queue successfully', { stemId });

        res.json({
            stemId,
            status: 'queued',
            checkStatus: `/api/stems/${stemId}`
        });
    } catch (err) {
        logger.error('Error in POST /api/stems/generate:', err);
        res.status(500).json({ error: 'Failed to queue stem generation' });
    }
});

router.get('/my', authenticate, async (req, res) => {
    logger.info('Received GET /api/stems/my request');

    const userId = req.user.id;

    try {
        const stems = await pool.query('SELECT * FROM stems WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        const countResult = await pool.query(
            'SELECT COUNT(*) AS count FROM stems WHERE user_id = ? AND created_at >= NOW() - INTERVAL 1 DAY',
            [userId]
        );
        const dailyCount = Number(countResult[0].count);
        const dailyRemaining = 5 - dailyCount;
        logger.info('User stems fetched', { count: stems.length });
        res.json({ stems, dailyRemaining });
    } catch (err) {
        logger.error('Error in GET /api/stems/my:', err);
        res.status(500).json({ error: 'Failed to fetch user stems' });
    }
});

// GET /api/stems/:id (status + details)
router.get('/:id', authenticate, async (req, res) => { // authenticate optional
    logger.info('Received GET /api/stems/:id request', { id: req.params.id });

    const { id } = req.params;
    const userId = req.user.id;

    try {
        logger.info('Querying stem from DB', { id, userId });
        const stems = await pool.query('SELECT * FROM stems WHERE id = ? AND user_id = ?', [id, userId]);
        logger.info('Query result length:', stems.length);
        logger.info('Query result:', stems); // New log (be careful with sensitive data in prod)

        if (!stems.length) {
            logger.error('Stem not found', { id, userId });
            return res.status(404).json({ error: 'Stem not found' });
        }
        logger.info('Stem fetched successfully', { id });
        res.json(stems[0]);
    } catch (err) {
        logger.error('Error in GET /api/stems/:id:', err);
        res.status(500).json({ error: 'Failed to fetch stem' });
    }
});

module.exports = router;