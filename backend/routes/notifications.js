const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/authenticate');
const logger = require('../utils/logger');
const { broadcastNotification, NOTIFICATION_TYPES } = require('../utils/notifications');

const router = express.Router();

// The bell polls, so the list is capped rather than paged. A hundred rows is
// far more than anyone scrolls, and older activity is still reachable from the
// thing it happened to.
const MAX_NOTIFICATIONS = 100;

router.get('/preferences', authenticate, async (req, res) => {
    try {
        const [row] = await pool.query(
                'SELECT email_profile_activity_enabled, email_artist_activity_enabled FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );

        if (!row) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            email_profile_activity_enabled: row.email_profile_activity_enabled !== 0,
            email_artist_activity_enabled: row.email_artist_activity_enabled !== 0,
        });
    } catch (err) {
        logger.error('Error in GET /notifications/preferences:', err);
        res.status(500).json({ error: 'Failed to fetch notification preferences' });
    }
});

router.patch('/preferences', authenticate, async (req, res) => {
    const { email_profile_activity_enabled, email_artist_activity_enabled } = req.body;

    const updates = {};
    if (email_profile_activity_enabled !== undefined) {
        if (typeof email_profile_activity_enabled !== 'boolean') {
            return res.status(400).json({ error: 'email_profile_activity_enabled must be a boolean' });
        }
        updates.email_profile_activity_enabled = email_profile_activity_enabled ? 1 : 0;
    }

    if (email_artist_activity_enabled !== undefined) {
        if (typeof email_artist_activity_enabled !== 'boolean') {
            return res.status(400).json({ error: 'email_artist_activity_enabled must be a boolean' });
        }
        updates.email_artist_activity_enabled = email_artist_activity_enabled ? 1 : 0;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No preferences to update' });
    }

    try {
        const setClauses = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(req.user.id);

        await pool.query(
            `UPDATE users SET ${setClauses} WHERE id = ?`,
            values
        );

        res.json({ success: true, ...updates });
    } catch (err) {
        logger.error('Error in PATCH /notifications/preferences:', err);
        res.status(500).json({ error: 'Failed to update notification preferences' });
    }
});

router.get('/', authenticate, async (req, res) => {
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || MAX_NOTIFICATIONS, 1),
        MAX_NOTIFICATIONS
    );

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
                    p.slug AS actor_profile_slug,
                    p.name AS actor_name,
                    p.picture_url AS actor_picture
                FROM notifications n
                LEFT JOIN profiles p ON p.user_id = n.actor_user_id
                WHERE n.recipient_user_id = ?
                  ${unreadOnly ? 'AND n.is_read = 0' : ''}
                ORDER BY n.created_at DESC
                LIMIT ?
            `,
            [req.user.id, limit]
        );

        // Sent with the list so the bell needs one request rather than two,
        // and so the badge can never disagree with what the panel shows.
        const [unread] = await pool.query(
            'SELECT COUNT(*) AS n FROM notifications WHERE recipient_user_id = ? AND is_read = 0',
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
            actor_profile_slug: row.actor_profile_slug || null,
            actor_name: row.actor_name || 'Unknown',
            actor_picture: row.actor_picture || null,
        }));

        res.json({ notifications, unread_count: Number(unread?.n) || 0 });
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

// Dismiss a single notification. Read and dismissed are different things: read
// means seen, dismissed means the member is done with it, and a list that can
// only ever grow stops being usable long before the hundred-row cap bites.
router.delete('/:notificationId', authenticate, async (req, res) => {
    const notificationId = Number(req.params.notificationId);
    if (!notificationId) {
        return res.status(400).json({ error: 'Invalid notification ID' });
    }

    try {
        const result = await pool.query(
            'DELETE FROM notifications WHERE id = ? AND recipient_user_id = ?',
            [notificationId, req.user.id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ success: true });
    } catch (err) {
        logger.error('Error in DELETE /notifications/:notificationId:', err);
        res.status(500).json({ error: 'Failed to dismiss notification' });
    }
});

/**
 * Post a site update to every member. Admin only.
 *
 * This is the one notification type nobody triggers by using the site, so it is
 * the one that needs its own door. It writes in-site notifications and sends no
 * email at all - see the SITE_UPDATE note in utils/notifications.js.
 *
 * is_admin is re-read from the database rather than taken from the JWT claim of
 * the same name. The claim is set at sign-in and would still say admin after
 * the flag was cleared, which is exactly the wrong direction for the only
 * endpoint on the site that writes a row for every account at once.
 */
router.post('/announce', authenticate, async (req, res) => {
    const { message, link_type, link_id } = req.body;

    try {
        const [account] = await pool.query(
            'SELECT is_admin FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );
        if (!account || Number(account.is_admin) !== 1) {
            return res.status(403).json({ error: 'Admins only' });
        }

        const text = typeof message === 'string' ? message.trim() : '';
        if (!text) {
            return res.status(400).json({ error: 'Message is required' });
        }
        // The column is varchar(500); refuse it here so the member reads a
        // sentence rather than a truncated announcement nobody can correct.
        if (text.length > 500) {
            return res.status(400).json({ error: 'Message must be 500 characters or fewer' });
        }

        const linkType = ['song', 'profile', 'forum_post', 'playlist', 'release', 'article']
            .includes(link_type) ? link_type : null;
        const linkId = linkType && Number(link_id) ? Number(link_id) : null;

        const notified = await broadcastNotification({
            actorUserId: req.user.id,
            type: NOTIFICATION_TYPES.SITE_UPDATE,
            message: text,
            entityType: linkId ? linkType : null,
            entityId: linkId,
        });

        logger.info(`Site update announced by user ${req.user.id} to ${notified} member(s)`);
        res.json({ success: true, notified });
    } catch (err) {
        logger.error('Error in POST /notifications/announce:', err);
        res.status(500).json({ error: 'Failed to post site update' });
    }
});

module.exports = router;

