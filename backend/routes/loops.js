const express = require('express');
const { v4: uuidv4 } = require('uuid');
const authenticate = require('../middleware/authenticate');
const pool = require('../config/database');
const logger = require('../utils/logger');
const { MUSICAL_KEYS } = require('../utils/musicalKeys');
const { enqueueLoopGeneration } = require('../utils/loopQueue');
const router = express.Router();

const LOOP_TYPES = ['bass', 'synth', 'effects', 'drums'];
const MIN_BPM = 60;
const MAX_BPM = 180;
const MAX_DURATION = 10;

// Say which instrument, and nothing about how it should sound. Tone words here
// compete with the member's own description: a template reading "punchy and
// dry, close-miked" is a brief for a funk kit, and it drowned out a request
// for a jazz one. MusicGen also has no negative prompting, so "no other
// instruments" subtracts nothing and only steers it toward sparse,
// near-silent takes -- "solo <instrument>" carries the isolation instead.
const LOOP_DESCRIPTORS = {
    bass: 'solo bass',
    synth: 'solo synthesizer',
    drums: 'solo drum kit',
    effects: 'solo sound design texture',
};

/**
 * Strip negations before the words reach the model.
 *
 * MusicGen conditions on a text embedding and has no notion of negation, so
 * "no drums" is read as "drums": the word is in the conditioning and the model
 * has no way to invert it. Asking for a bass line with "no drums" is a reliable
 * way to be handed a bass line with drums, which is exactly what happened.
 *
 * Cutting the clause out is better than passing it through, because what
 * remains is a positive description, and "solo <instrument>" from the
 * descriptor already carries the isolation the member was reaching for. The
 * clause is removed rather than rewritten: guessing at an opposite ("no drums"
 * becoming "drumless"?) invents a brief the member did not write.
 */
const NEGATION = /\b(?:no|without|not|avoid|exclude|minus|except|omit|absolutely no|nothing but(?= ))\s+[^,.;]+/gi;

const stripNegations = (text) => text
    .replace(NEGATION, ' ')
    .replace(/\s*[-–—]{1,2}\s*/g, ' ')   // leftover dashes from "bass only -- no drums"
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*,\s*,/g, ',')
    .replace(/^[\s,;.]+|[\s,;.]+$/g, '')
    .trim();

// The member's own words go first, where they carry the most weight. Key is
// meaningless for an unpitched drum kit, so it is left off there.
const buildLoopPrompt = (type, prompt, bpm, key) => {
    const parts = [stripNegations(prompt), LOOP_DESCRIPTORS[type], `${bpm} BPM`];
    if (type !== 'drums') {
        parts.push(`in ${key}`);
    }
    return parts.filter(Boolean).join(', ');
};

const BAR_CHOICES = [1, 2, 4, 8];

/**
 * How long a loop should be, in seconds, for a number of bars at a tempo.
 *
 * The picker used to ask for seconds, and a loop trimmed to a round number of
 * seconds is a musical length only by accident: four seconds at 128 BPM is 2.13
 * bars. Butt-joining two copies of that lands off the beat every time, which is
 * how it was noticed. Bars are what a loop actually is, so bars are what the
 * request carries and the trim honours.
 *
 * Four beats to the bar. The sampler assumes 4/4 throughout, in its grid, its
 * bar markers and its pattern repeat.
 */
const barsToSeconds = (bars, bpm) => (bars * 4 * 60) / bpm;

const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

// POST /api/loops/generate (matches your API style)
router.post('/generate', authenticate, async (req, res) => { // authenticate optional
    logger.info('Received POST /api/loops/generate request'); // Log entry

    const { type, prompt } = req.body;
    // The key is interpolated into the model prompt and stored in a VARCHAR(20),
    // so only accept one the picker actually offers.
    const key = MUSICAL_KEYS.includes(req.body.key) ? req.body.key : 'C minor';
    const userId = req.user.id; // From passport

    if (!LOOP_TYPES.includes(type)) {
        logger.error('Invalid loop type:', type);
        return res.status(400).json({ error: 'Invalid loop type' });
    }

    if (typeof prompt !== 'string' || !prompt.trim()) {
        logger.error('Missing loop prompt');
        return res.status(400).json({ error: 'Describe the sound you want first' });
    }

    // The tempo reaches us as a string from a <select>, and an out-of-range or
    // missing value used to fall through into the prompt verbatim.
    const requestedBpm = clampInt(req.body.bpm, MIN_BPM, MAX_BPM, 120);

    const requestedBars = BAR_CHOICES.includes(Number(req.body.bars)) ? Number(req.body.bars) : 2;
    // Kept to two decimals: ffmpeg takes fractional seconds, and the whole point
    // is that the length is exact rather than rounded to something tidy.
    const requestedDuration = Math.round(barsToSeconds(requestedBars, requestedBpm) * 100) / 100;

    if (requestedDuration > MAX_DURATION) {
        logger.error('Bar length exceeds the ceiling', { requestedBars, requestedBpm, requestedDuration });
        return res.status(400).json({
            error: `${requestedBars} bars at ${requestedBpm} BPM is ${requestedDuration}s, over the ${MAX_DURATION}s limit. Pick fewer bars or a faster tempo.`,
        });
    }

    try {
        // Check daily limit
        const countResult = await pool.query(
            'SELECT COUNT(*) AS count FROM loops WHERE user_id = ? AND created_at >= NOW() - INTERVAL 1 DAY',
            [userId]
        );
        const dailyCount = Number(countResult[0].count);
        if (dailyCount >= 10) {
            logger.info('Daily loop limit reached for user', { userId });
            return res.status(429).json({ error: 'Daily limit of 10 loops reached' });
        }

        const loopId = uuidv4();
        const fullPrompt = buildLoopPrompt(type, prompt, requestedBpm, key);

        logger.info('Attempting to insert loop into DB', {
            loopId, userId, bpm: requestedBpm, key, duration: requestedDuration,
        });
        // Store what the member typed, not the engineered prompt: the loop
        // list shows this back to them.
        await pool.query(
            'INSERT INTO loops (id, type, prompt, user_id, bpm, `key`, duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [loopId, type, prompt.trim(), userId, requestedBpm, key, requestedDuration]
        );
        logger.info('Loop inserted into DB successfully', { loopId });

        logger.info('Adding loop to queue', { loopId, fullPrompt });
        await enqueueLoopGeneration({ loopId, fullPrompt, duration: requestedDuration });
        logger.info('Loop added to queue successfully', { loopId });

        res.json({
            loopId,
            status: 'queued',
            checkStatus: `/api/loops/${loopId}`
        });
    } catch (err) {
        logger.error('Error in POST /api/loops/generate:', err);
        res.status(500).json({ error: 'Failed to queue loop generation' });
    }
});

router.get('/my', authenticate, async (req, res) => {
    logger.info('Received GET /api/loops/my request');

    const userId = req.user.id;

    try {
        const loops = await pool.query('SELECT * FROM loops WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        const countResult = await pool.query(
            'SELECT COUNT(*) AS count FROM loops WHERE user_id = ? AND created_at >= NOW() - INTERVAL 1 DAY',
            [userId]
        );
        const dailyCount = Number(countResult[0].count);
        const dailyRemaining = 10 - dailyCount;
        logger.info('User loops fetched', { count: loops.length });
        res.json({ loops, dailyRemaining });
    } catch (err) {
        logger.error('Error in GET /api/loops/my:', err);
        res.status(500).json({ error: 'Failed to fetch user loops' });
    }
});

// GET /api/loops/:id (status + details)
router.get('/:id', authenticate, async (req, res) => { // authenticate optional
    logger.info('Received GET /api/loops/:id request', { id: req.params.id });

    const { id } = req.params;
    const userId = req.user.id;

    try {
        logger.info('Querying loop from DB', { id, userId });
        const loops = await pool.query('SELECT * FROM loops WHERE id = ? AND user_id = ?', [id, userId]);
        logger.info('Query result length:', loops.length);
        logger.info('Query result:', loops); // New log (be careful with sensitive data in prod)

        if (!loops.length) {
            logger.error('Loop not found', { id, userId });
            return res.status(404).json({ error: 'Loop not found' });
        }
        logger.info('Loop fetched successfully', { id });
        res.json(loops[0]);
    } catch (err) {
        logger.error('Error in GET /api/loops/:id:', err);
        res.status(500).json({ error: 'Failed to fetch loop' });
    }
});

module.exports = router;