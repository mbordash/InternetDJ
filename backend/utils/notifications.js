const pool = require('../config/database');
const logger = require('./logger');
const Mailgun = require('mailgun.js');
const FormData = require('form-data');

const NOTIFICATION_TYPES = {
    SONG_LIKED: 'song_liked',
    SONG_REVIEWED: 'song_reviewed',
    FORUM_POST_REPLIED: 'forum_post_replied',
    PROFILE_FOLLOWED: 'profile_followed',
    COLLAB_TRACK_ADDED: 'collab_track_added',
    ARTIST_SONG_UPLOADED: 'artist_song_uploaded',
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

const sendEmailNotification = async ({ recipientUserId, actorUserId, type, message, entityType, entityId, metadata }) => {
    if (!mailgunClient) {
        return;
    }

    const [recipient] = await pool.query(
        'SELECT id, email, name, email_profile_activity_enabled, email_artist_activity_enabled FROM users WHERE id = ? LIMIT 1',
        [recipientUserId]
    );

    if (!recipient?.email) {
        return;
    }

    const isProfileActivityNotification = [
        NOTIFICATION_TYPES.SONG_LIKED,
        NOTIFICATION_TYPES.SONG_REVIEWED,
        NOTIFICATION_TYPES.FORUM_POST_REPLIED,
        NOTIFICATION_TYPES.PROFILE_FOLLOWED,
        NOTIFICATION_TYPES.COLLAB_TRACK_ADDED,
    ].includes(type);

    const isArtistActivityNotification = type === NOTIFICATION_TYPES.ARTIST_SONG_UPLOADED;

    if (isProfileActivityNotification && (recipient.email_profile_activity_enabled === 0 || !recipient.email_profile_activity_enabled)) {
        return;
    }

    if (isArtistActivityNotification && (recipient.email_artist_activity_enabled === 0 || !recipient.email_artist_activity_enabled)) {
        return;
    }

    const [actorProfile] = await pool.query(
        'SELECT name FROM profiles WHERE user_id = ? LIMIT 1',
        [actorUserId]
    );
    const actorName = actorProfile?.name || 'A member';

    const url = buildActivityUrl(type, entityType, entityId, metadata);
    const subject = `InternetDJ activity: ${message}`;
    const html = `
        <h2>New activity on InternetDJ</h2>
        <p><strong>${actorName}</strong> triggered this update:</p>
        <p>${message}</p>
        <p><a href="${url}">Open on InternetDJ</a></p>
        <p>If you prefer, you can check all updates from your notifications area in-app.</p>
    `;

    await mailgunClient.messages.create(MAILGUN_DOMAIN, {
        from: `InternetDJ <noreply@${MAILGUN_DOMAIN}>`,
        to: recipient.email,
        subject,
        html,
    });
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

        const createdId = Number(result.insertId) || null;

        try {
            await sendEmailNotification({
                recipientUserId: recipientId,
                actorUserId: actorId,
                type,
                message,
                entityType,
                entityId,
                metadata: safeMetadata,
            });
        } catch (emailErr) {
            logger.warn('Failed to send notification email:', {
                message: emailErr.message,
                recipientUserId: recipientId,
                type,
            });
        }

        return createdId;
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

module.exports = {
    NOTIFICATION_TYPES,
    createNotification,
};

