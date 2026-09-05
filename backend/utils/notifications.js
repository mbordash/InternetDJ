const pool = require('../config/database');
const logger = require('./logger');
const Mailgun = require('mailgun.js');
const FormData = require('form-data');

const NOTIFICATION_TYPES = {
    SONG_LIKED: 'song_liked',
    SONG_REVIEWED: 'song_reviewed',
    FORUM_POST_REPLIED: 'forum_post_replied',
    PROFILE_FOLLOWED: 'profile_followed',
    IDJC_RECEIVED: 'idjc_received',
    COLLAB_TRACK_ADDED: 'collab_track_added',
    ARTIST_SONG_UPLOADED: 'artist_song_uploaded',
    PLAYLIST_DEDICATION: 'playlist_dedication',
    REVIEW_REPLIED: 'review_replied',
    REVIEW_REACTION: 'review_reaction',
    SONG_VERSION_ADDED: 'song_version_added',
    SITE_UPDATE: 'site_update',
};

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_URL_PROD ||
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL_LOCAL ||
    'http://localhost:3000';

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;

let mailgunClient = null;
if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
    const mailgun = new Mailgun(FormData);
    mailgunClient = mailgun.client({ username: 'api', key: MAILGUN_API_KEY });
}

const buildActivityUrl = (type, entityType, entityId, metadata) => {
    if (entityType === 'song' && entityId) {
        return `${FRONTEND_URL}/song/${entityId}`;
    }
    if (entityType === 'forum_post' && entityId) {
        return `${FRONTEND_URL}/forum/post/${entityId}`;
    }
    if (entityType === 'profile' && entityId) {
        return `${FRONTEND_URL}/profile/${entityId}`;
    }
    if (entityType === 'playlist' && entityId) {
        return `${FRONTEND_URL}/crate/${entityId}`;
    }
    if (entityType === 'release' && entityId) {
        return `${FRONTEND_URL}/release/${entityId}`;
    }
    if (entityType === 'article' && entityId) {
        return `${FRONTEND_URL}/articles/${entityId}`;
    }
    if (entityType === 'collaboration') {
        if (metadata?.owner_profile_id) {
            return `${FRONTEND_URL}/profile/${metadata.owner_profile_id}/collaborations`;
        }
        return `${FRONTEND_URL}/collabs`;
    }
    if (type === NOTIFICATION_TYPES.COLLAB_TRACK_ADDED) {
        return `${FRONTEND_URL}/collabs`;
    }
    return FRONTEND_URL;
};

const createNotification = async ({
    recipientUserId,
    actorUserId,
    type,
    message,
    entityType = null,
    entityId = null,
    metadata = null,
}) => {
    const recipientId = Number(recipientUserId);
    const actorId = Number(actorUserId);

    if (!recipientId || !actorId || !type || !message) {
        return null;
    }

    if (recipientId === actorId) {
        return null;
    }

    const safeMetadata = metadata && typeof metadata === 'object' ? metadata : null;

    try {
        const result = await pool.query(
            `
                INSERT INTO notifications (
                    recipient_user_id,
                    actor_user_id,
                    type,
                    message,
                    entity_type,
                    entity_id,
                    metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                recipientId,
                actorId,
                type,
                message,
                entityType,
                entityId,
                safeMetadata ? JSON.stringify(safeMetadata) : null,
            ]
        );

        // No email here. Activity mail is batched by
        // scripts/sendWeeklyDigest.js, which sends one message per member per
        // week listing what is unread, and nothing at all in a quiet week. The
        // row written above is the record; the digest only decides what reaches
        // an inbox. An IDJC tip is the exception and still mails immediately,
        // through sendIdjcTipEmail below: that is money arriving, not activity.
        return Number(result.insertId) || null;
    } catch (err) {
        // Notification failures should never block user actions.
        logger.warn('Failed to create notification:', {
            message: err.message,
            recipientUserId: recipientId,
            actorUserId: actorId,
            type,
        });
        return null;
    }
};

const sendIdjcTipEmail = async ({ recipientUserId, amount, entityId, actorLabel = 'An anonymous supporter' }) => {
    if (!mailgunClient) {
        return;
    }

    const [recipient] = await pool.query(
        'SELECT id, email, email_profile_activity_enabled FROM users WHERE id = ? LIMIT 1',
        [recipientUserId]
    );

    if (!recipient?.email) {
        return;
    }

    if (recipient.email_profile_activity_enabled === 0 || !recipient.email_profile_activity_enabled) {
        return;
    }

    const formattedAmount = Number(amount).toLocaleString('en-US', { maximumFractionDigits: 9 });
    const url = buildActivityUrl(NOTIFICATION_TYPES.IDJC_RECEIVED, 'profile', entityId, null);
    const subject = `InternetDJ activity: You received ${formattedAmount} IDJC.`;
    const html = `
        <h2>New activity on InternetDJ</h2>
        <p><strong>${actorLabel}</strong> just gifted you IDJ Coin:</p>
        <p>You received ${formattedAmount} IDJC.</p>
        <p><a href="${url}">Open on InternetDJ</a></p>
    `;

    await mailgunClient.messages.create(MAILGUN_DOMAIN, {
        from: `InternetDJ <noreply@${MAILGUN_DOMAIN}>`,
        to: recipient.email,
        subject,
        html,
    });
};


/**
 * Post one site update to every member's notifications.
 *
 * A loop over createNotification would be one INSERT per account and one
 * Mailgun decision per account, which is the wrong shape for something that by
 * definition addresses everyone. INSERT ... SELECT writes the whole set in a
 * single statement instead, and no email is sent at all - see the SITE_UPDATE
 * note in sendEmailNotification for why an announcement stays in-site.
 *
 * The author is excluded, matching createNotification's rule that nobody is
 * notified about their own action.
 *
 * Returns the number of members notified.
 */
const broadcastNotification = async ({
    actorUserId,
    message,
    entityType = null,
    entityId = null,
    metadata = null,
    type = NOTIFICATION_TYPES.SITE_UPDATE,
}) => {
    const actorId = Number(actorUserId);
    if (!actorId || !message) {
        return 0;
    }

    const safeMetadata = metadata && typeof metadata === 'object' ? metadata : null;

    const result = await pool.query(
        `
            INSERT INTO notifications (
                recipient_user_id,
                actor_user_id,
                type,
                message,
                entity_type,
                entity_id,
                metadata
            )
            SELECT u.id, ?, ?, ?, ?, ?, ?
              FROM users u
             WHERE u.id <> ?
        `,
        [
            actorId,
            type,
            message,
            entityType,
            entityId,
            safeMetadata ? JSON.stringify(safeMetadata) : null,
            actorId,
        ]
    );

    return Number(result.affectedRows) || 0;
};

module.exports = {
    NOTIFICATION_TYPES,
    createNotification,
    broadcastNotification,
    sendIdjcTipEmail,
};
