const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/authenticate');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/preferences', authenticate, async (req, res) => {
    try {
        const [row] = await pool.query(
            'SELECT email_notifications_enabled FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );

        if (!row) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            email_notifications_enabled: row.email_notifications_enabled !== 0,
        });
    } catch (err) {
        logger.error('Error in GET /notifications/preferences:', err);
        res.status(500).json({ error: 'Failed to fetch notification preferences' });
    }
});

router.patch('/preferences', authenticate, async (req, res) => {
    const { email_notifications_enabled } = req.body;

    if (typeof email_notifications_enabled !== 'boolean') {
        return res.status(400).json({ error: 'email_notifications_enabled must be a boolean' });
    }

    try {
        await pool.query(
            'UPDATE users SET email_notifications_enabled = ? WHERE id = ?',
            [email_notifications_enabled ? 1 : 0, req.user.id]
        );

        res.json({ success: true, email_notifications_enabled });
    } catch (err) {
        logger.error('Error in PATCH /notifications/preferences:', err);
        res.status(500).json({ error: 'Failed to update notification preferences' });
    }
});

router.get('/', authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            `
                SELECT
                    n.id,
                    n.type,
                    n.message,
                    n.entity_type,
                    n.entity_id,
                    n.is_read,
                    n.created_at,
                    n.metadata,
                    p.id AS actor_profile_id,
                    p.name AS actor_name,
                    p.picture_url AS actor_picture
                FROM notifications n
                LEFT JOIN profiles p ON p.user_id = n.actor_user_id
                WHERE n.recipient_user_id = ?
                ORDER BY n.created_at DESC
                LIMIT 100
            `,
            [req.user.id]
        );

        const notifications = rows.map((row) => ({
            id: Number(row.id),
            type: row.type,
            message: row.message,
            entity_type: row.entity_type || null,
            entity_id: row.entity_id != null ? Number(row.entity_id) : null,
            is_read: !!row.is_read,
            created_at: row.created_at,
            metadata: row.metadata || null,
            actor_profile_id: row.actor_profile_id != null ? Number(row.actor_profile_id) : null,
            actor_name: row.actor_name || 'Unknown',
            actor_picture: row.actor_picture || null,
        }));

        res.json({ notifications });
    } catch (err) {
        logger.error('Error in GET /notifications:', err);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

router.patch('/:notificationId/read', authenticate, async (req, res) => {
    const notificationId = Number(req.params.notificationId);
    if (!notificationId) {
        return res.status(400).json({ error: 'Invalid notification ID' });
    }

    try {
        const result = await pool.query(
            `
                UPDATE notifications
                SET is_read = 1
                WHERE id = ? AND recipient_user_id = ?
            `,
            [notificationId, req.user.id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ success: true });
    } catch (err) {
        logger.error('Error in PATCH /notifications/:notificationId/read:', err);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

router.patch('/read-all', authenticate, async (req, res) => {
    try {
        await pool.query(
            'UPDATE notifications SET is_read = 1 WHERE recipient_user_id = ? AND is_read = 0',
            [req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        logger.error('Error in PATCH /notifications/read-all:', err);
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

module.exports = router;

