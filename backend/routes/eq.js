const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/authenticate');
const router = express.Router();

// Save EQ settings for a user
router.post('/settings', authenticate, async (req, res) => {
    const { eqGains } = req.body;
    const userId = req.user.id;

    // Validate eqGains
    if (!eqGains || typeof eqGains !== 'object' || Array.isArray(eqGains)) {
        console.warn('Invalid eqGains received:', eqGains);
        return res.status(400).json({ error: 'Invalid EQ settings: must be a non-array object' });
    }

    try {
        // Log eqGains before serialization
        console.log('Saving eqGains for userId:', userId, 'eqGains:', eqGains);

        // Serialize eqGains to JSON
        let eqGainsJson;
        try {
            eqGainsJson = JSON.stringify(eqGains);
        } catch (err) {
            console.warn('Failed to serialize eqGains:', eqGains, 'Error:', err.message);
            return res.status(400).json({ error: 'Invalid EQ settings: cannot serialize to JSON' });
        }

        // Verify serialized JSON is valid
        if (!eqGainsJson || eqGainsJson === '[object Object]') {
            console.warn('Invalid JSON serialization:', eqGainsJson);
            return res.status(400).json({ error: 'Invalid EQ settings: serialization produced invalid JSON' });
        }

        console.log('Serialized eqGains:', eqGainsJson); // Debug log

        // Update database
        const result = await pool.query(
            'UPDATE users SET eq_gains = ? WHERE id = ?',
            [eqGainsJson, userId]
        );

        // Log the result structure, handling BigInt
        console.log('UPDATE query result:', JSON.stringify(result, (key, value) =>
            typeof value === 'bigint' ? Number(value) : value, 2));

        // Check if result is valid and has affectedRows
        if (!result || typeof result.affectedRows !== 'number') {
            console.error('Invalid query result format for userId:', userId, 'result:', result);
            return res.status(500).json({ error: 'Invalid query result format' });
        }

        // Check affectedRows
        if (result.affectedRows === 0) {
            console.warn('No user found for userId:', userId);
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify stored JSON is valid in MariaDB
        const rows = await pool.query(
            'SELECT JSON_VALID(eq_gains) AS is_valid FROM users WHERE id = ?',
            [userId]
        );
        console.log('JSON_VALID check rows:', JSON.stringify(rows, (key, value) =>
            typeof value === 'bigint' ? Number(value) : value, 2));

        if (!rows || rows.length === 0 || rows[0].is_valid !== 1) {
            console.error('Stored eq_gains is not valid JSON for userId:', userId, 'eq_gains:', eqGainsJson);
            await pool.query('UPDATE users SET eq_gains = NULL WHERE id = ?', [userId]);
            return res.status(500).json({ error: 'Failed to save valid JSON EQ settings' });
        }

        res.status(200).json({ message: 'EQ settings saved successfully' });
    } catch (err) {
        console.error('Error saving EQ settings:', {
            message: err.message,
            userId,
            stack: err.stack,
        });
        res.status(500).json({ error: 'Failed to save EQ settings' });
    }
});

// Fetch EQ settings for a user
router.get('/settings', authenticate, async (req, res) => {
    const userId = req.user.id;

    try {
        console.log('Fetching EQ settings for userId:', userId); // Debug log

        const rows = await pool.query(
            'SELECT eq_gains FROM users WHERE id = ?',
            [userId]
        );

        console.log('Raw rows:', JSON.stringify(rows, (key, value) =>
            typeof value === 'bigint' ? Number(value) : value, 2)); // Debug log

        if (!rows || rows.length === 0) {
            console.warn('No user found for userId:', userId);
            return res.status(404).json({ error: 'User not found', eqGains: null });
        }

        const eqGains = rows[0].eq_gains || null;
        res.status(200).json({ eqGains });
    } catch (err) {
        console.error('Error fetching EQ settings:', {
            message: err.message,
            userId,
            stack: err.stack,
        });
        res.status(500).json({ error: 'Failed to fetch EQ settings', eqGains: null });
    }
});

module.exports = router;