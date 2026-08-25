const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const authenticate = require('../middleware/authenticate');
const pool = require('../config/database');
const logger = require('../utils/logger');
const { MUSICAL_KEYS } = require('../utils/musicalKeys');
const router = express.Router();

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
logger.info('Redis connection for stems route:', process.env.REDIS_URL); // Log on startup

const stemQueue = new Queue('stem-gen', { connection: redisConnection });

const STEM_TYPES = ['bass', 'synth', 'effects', 'drums'];
const MIN_BPM = 60;
const MAX_BPM = 180;
const MAX_DURATION = 10;

// Say which instrument, and nothing about how it should sound. Tone words here
// compete with the member's own description: a template reading "punchy and
// dry, close-miked" is a brief for a funk kit, and it drowned out a request
// for a jazz one. MusicGen also has no negative prompting, so "no other
// instruments" subtracts nothing and only steers it toward sparse,
// near-silent takes -- "solo <instrument>" carries the isolation instead.
const STEM_DESCRIPTORS = {
    bass: 'solo bass',
    synth: 'solo synthesizer',
    drums: 'solo drum kit',
    effects: 'solo sound design texture',
};

// The member's own words go first, where they carry the most weight. Key is
// meaningless for an unpitched drum kit, so it is left off there.
const buildStemPrompt = (type, prompt, bpm, key) => {
    const parts = [prompt.trim(), STEM_DESCRIPTORS[type], `${bpm} BPM`];
    if (type !== 'drums') {
        parts.push(`in ${key}`);
    }
    return parts.filter(Boolean).join(', ');
};

const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

// POST /api/stems/generate (matches your API style)
router.post('/generate', authenticate, async (req, res) => { // authenticate optional
    logger.info('Received POST /api/stems/generate request'); // Log entry

    const { type, prompt, duration = MAX_DURATION } = req.body;
    // The key is interpolated into the model prompt and stored in a VARCHAR(20),
    // so only accept one the picker actually offers.
    const key = MUSICAL_KEYS.includes(req.body.key) ? req.body.key : 'C minor';
    const userId = req.user.id; // From passport

    if (!STEM_TYPES.includes(type)) {
        logger.error('Invalid stem type:', type);
        return res.status(400).json({ error: 'Invalid stem type' });
    }

    if (typeof prompt !== 'string' || !prompt.trim()) {
        logger.error('Missing stem prompt');
        return res.status(400).json({ error: 'Describe the sound you want first' });
    }

    if (Number(duration) > MAX_DURATION) {
        logger.error('Duration exceeds limit:', duration);
        return res.status(400).json({ error: `Duration cannot exceed ${MAX_DURATION} seconds` });
    }

    // The tempo reaches us as a string from a <select>, and an out-of-range or
    // missing value used to fall through into the prompt verbatim.
    const requestedBpm = clampInt(req.body.bpm, MIN_BPM, MAX_BPM, 120);
    const requestedDuration = clampInt(duration, 2, MAX_DURATION, MAX_DURATION);

    try {
        // Check daily limit
        const countResult = await pool.query(
            'SELECT COUNT(*) AS count FROM stems WHERE user_id = ? AND created_at >= NOW() - INTERVAL 1 DAY',
            [userId]
        );
        const dailyCount = Number(countResult[0].count);
        if (dailyCount >= 10) {
            logger.info('Daily stem limit reached for user', { userId });
            return res.status(429).json({ error: 'Daily limit of 10 stems reached' });
        }

        const stemId = uuidv4();
        const fullPrompt = buildStemPrompt(type, prompt, requestedBpm, key);

        logger.info('Attempting to insert stem into DB', {
            stemId, userId, bpm: requestedBpm, key, duration: requestedDuration,
        });
        // Store what the member typed, not the engineered prompt: the stem
        // list shows this back to them.
        await pool.query(
            'INSERT INTO stems (id, type, prompt, user_id, bpm, `key`, duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [stemId, type, prompt.trim(), userId, requestedBpm, key, requestedDuration]
        );
        logger.info('Stem inserted into DB successfully', { stemId });

        logger.info('Adding stem to queue', { stemId, fullPrompt });
        await stemQueue.add('generate-stem', { stemId, fullPrompt, duration: requestedDuration });
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
        const dailyRemaining = 10 - dailyCount;
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