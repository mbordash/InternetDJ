const express = require('express');
const pool = require('../config/database');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const authenticate = require('../middleware/authenticate');
const router = express.Router();
const crypto = require('crypto');
const Mailgun = require('mailgun.js');
const FormData = require('form-data');
const { buildPublicFileUrl, extractObjectKey } = require('../utils/storage');
const { createNotification, NOTIFICATION_TYPES } = require('../utils/notifications');

// Initialize Mailgun
const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY,
});
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_URL_PROD ||
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL_LOCAL ||
    'http://localhost:3000';

// JSON.stringify replacer to handle BigInt
const bigIntReplacer = (key, value) => {
    if (typeof value === 'bigint') {
        return Number(value);
    }
    return value;
};

// Generate secure token
const generateToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

// Send email via Mailgun
const sendEmail = async (to, subject, html) => {
    try {
        await mg.messages.create(MAILGUN_DOMAIN, {
            from: `InternetDJ <noreply@${MAILGUN_DOMAIN}>`,
            to,
            subject,
            html,
        });
        console.log('Email sent to:', to);
    } catch (err) {
        console.error('Error sending email:', err.message, err.stack);
        throw new Error('Failed to send email');
    }
};

// Middleware to ensure profile exists
const ensureProfile = async (req, res, next) => {
    const userId = req.user?.id;
    console.log('Ensuring profile for user ID:', userId);

    if (!userId) {
        console.error('No user ID provided in request');
        return res.status(401).json({ error: 'Unauthorized: No user ID' });
    }

    try {
        const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [userId]);
        console.log('Profiles query result:', JSON.stringify(profiles, bigIntReplacer, 2));

        let profileId;
        if (!profiles || profiles.length === 0) {
            console.log('No profile found, creating one for user:', userId);
            const users = await pool.query('SELECT name FROM users WHERE id = ?', [userId]);
            console.log('Users query result:', JSON.stringify(users, bigIntReplacer, 2));
            if (!users || users.length === 0) {
                console.error('User not found:', userId);
                return res.status(404).json({ error: 'User not found' });
            }
            const name = users[0]?.name || 'Unknown';
            const profileResult = await pool.query(
                'INSERT INTO profiles (user_id, name) VALUES (?, ?)',
                [userId, name]
            );
            profileId = Number(profileResult.insertId);
            console.log('Created profile for user:', userId, 'Profile ID:', profileId);
        } else {
            profileId = Number(profiles[0]?.id);
            if (!profileId) {
                console.error('Profile found but no ID:', profiles);
                return res.status(500).json({ error: 'Invalid profile data' });
            }
            console.log('Found profile for user:', userId, 'Profile ID:', profileId);
        }

        req.profileId = profileId;
        next();
    } catch (err) {
        console.error('Ensure profile error for user ID:', userId, {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to ensure profile' });
    }
};

// Middleware to ensure collaboration ownership
const ensureCollaborationOwner = async (req, res, next) => {
    const { collaborationId } = req.params;
    const profileId = req.profileId;

    try {
        const collaboration = await pool.query('SELECT profile_id FROM collaborations WHERE id = ?', [collaborationId]);
        if (!collaboration || collaboration.length === 0) {
            return res.status(404).json({ error: 'Collaboration not found' });
        }
        if (Number(collaboration[0].profile_id) !== profileId) {
            return res.status(403).json({ error: 'Unauthorized: Not the collaboration owner' });
        }
        next();
    } catch (err) {
        console.error('Ensure collaboration owner error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to verify collaboration ownership' });
    }
};

// Create collaboration
router.post('/', authenticate, ensureProfile, async (req, res) => {
    const { title, description, is_public, allow_uploads } = req.body;
    const profileId = req.profileId;
    console.log('Creating collaboration with profile ID:', profileId, 'Title:', title);

    try {
        if (!title) return res.status(400).json({ error: 'Title is required' });

        const profileCheck = await pool.query('SELECT id FROM profiles WHERE id = ?', [profileId]);
        console.log('Profile check result:', JSON.stringify(profileCheck, bigIntReplacer, 2));
        if (!profileCheck || profileCheck.length === 0) {
            console.error('Profile ID not found:', profileId);
            return res.status(400).json({ error: 'Invalid profile ID' });
        }

        const result = await pool.query(
            'INSERT INTO collaborations (profile_id, title, description, is_public, allow_uploads) VALUES (?, ?, ?, ?, ?)',
            [profileId, title, description || '', !!is_public, !!allow_uploads]
        );
        console.log('Insert result:', JSON.stringify(result, bigIntReplacer, 2));

        if (!result || !result.insertId) {
            console.error('Insert query did not return insertId:', result);
            return res.status(500).json({ error: 'Failed to create collaboration: No insert ID returned' });
        }

        res.status(201).json({
            collaboration: {
                id: Number(result.insertId),
                profile_id: profileId,
                title,
                description: description || '',
                is_public: !!is_public,
                allow_uploads: !!allow_uploads,
                created_at: new Date()
            }
        });
    } catch (err) {
        console.error('POST /collabs error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to create collaboration' });
    }
});

// Update collaboration
router.patch('/:collaborationId', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId } = req.params;
    const { title, description, is_public, allow_uploads } = req.body;
    const profileId = req.profileId;

    try {
        if (!title) return res.status(400).json({ error: 'Title is required' });

        const result = await pool.query(
            'UPDATE collaborations SET title = ?, description = ?, is_public = ?, allow_uploads = ? WHERE id = ? AND profile_id = ?',
            [title, description || null, !!is_public, !!allow_uploads, collaborationId, profileId]
        );
        console.log('Update result:', JSON.stringify(result, bigIntReplacer, 2));

        if (!result || result.affectedRows === 0) {
            console.error('No rows updated for collaboration ID:', collaborationId);
            return res.status(404).json({ error: 'Collaboration not found or unauthorized' });
        }

        const updatedCollaboration = await pool.query(
            'SELECT c.*, p.name AS profile_name FROM collaborations c LEFT JOIN profiles p ON c.profile_id = p.id WHERE c.id = ?',
            [collaborationId]
        );
        if (!updatedCollaboration || updatedCollaboration.length === 0) {
            return res.status(404).json({ error: 'Collaboration not found after update' });
        }
        const collab = updatedCollaboration[0];

        res.json({
            collaboration: {
                id: Number(collab.id),
                profile_id: Number(collab.profile_id),
                title: collab.title,
                description: collab.description,
                is_public: !!collab.is_public,
                allow_uploads: !!collab.allow_uploads,
                profile_name: collab.profile_name || 'Unknown',
                created_at: collab.created_at,
                updated_at: collab.updated_at
            }
        });
    } catch (err) {
        console.error('PATCH /collabs/:collaborationId error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to update collaboration' });
    }
});

// List user's collaborations
router.get('/', authenticate, ensureProfile, async (req, res) => {
    const profileId = req.profileId;

    try {
        const owned = await pool.query(
            'SELECT c.*, p.name AS profile_name FROM collaborations c LEFT JOIN profiles p ON c.profile_id = p.id WHERE c.profile_id = ?',
            [profileId]
        );
        const invited = await pool.query(
            'SELECT c.*, p.name AS profile_name FROM collaborations c LEFT JOIN profiles p ON c.profile_id = p.id JOIN collaboration_permissions cp ON c.id = cp.collaboration_id WHERE cp.profile_id = ?',
            [profileId]
        );

        const ownedRows = owned || [];
        const invitedRows = invited || [];

        const collaborations = [...ownedRows, ...invitedRows].map(c => ({
            id: Number(c.id),
            profile_id: Number(c.profile_id),
            title: c.title,
            description: c.description,
            is_public: !!c.is_public,
            allow_uploads: !!c.allow_uploads,
            profile_name: c.profile_name || 'Unknown',
            created_at: c.created_at,
            updated_at: c.updated_at
        }));

        res.json({ collaborations });
    } catch (err) {
        console.error('GET /collabs error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to fetch collaborations' });
    }
});

// Public collaborations feed
router.get('/public', async (req, res) => {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 50;

    try {
        const rows = await pool.query(
            `
                SELECT
                    c.id,
                    c.profile_id,
                    c.title,
                    c.description,
                    c.allow_uploads,
                    c.created_at,
                    c.updated_at,
                    p.user_id AS owner_user_id,
                    p.name AS owner_name,
                    p.picture_url AS owner_picture_url,
                    COUNT(ct.id) AS track_count,
                    MAX(ct.created_at) AS last_track_at
                FROM collaborations c
                LEFT JOIN profiles p ON c.profile_id = p.id
                LEFT JOIN collaboration_tracks ct ON ct.collaboration_id = c.id
                WHERE c.is_public = 1
                GROUP BY
                    c.id,
                    c.profile_id,
                    c.title,
                    c.description,
                    c.allow_uploads,
                    c.created_at,
                    c.updated_at,
                    p.user_id,
                    p.name,
                    p.picture_url
                ORDER BY COALESCE(MAX(ct.created_at), c.updated_at, c.created_at) DESC
                LIMIT ?
            `,
            [limit]
        );

        const collaborations = (rows || []).map((row) => ({
            id: Number(row.id),
            profile_id: Number(row.profile_id),
            title: row.title || 'Untitled Collaboration',
            description: row.description || '',
            allow_uploads: !!row.allow_uploads,
            created_at: row.created_at,
            updated_at: row.updated_at,
            owner_user_id: row.owner_user_id ? Number(row.owner_user_id) : null,
            owner_name: row.owner_name || 'Unknown',
            owner_picture_url: row.owner_picture_url || null,
            track_count: Number(row.track_count) || 0,
            last_track_at: row.last_track_at || null,
        }));

        res.json({ collaborations });
    } catch (err) {
        console.error('GET /collabs/public error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage,
        });
        res.status(500).json({ error: 'Failed to fetch public collaborations' });
    }
});

// Get collaboration details
router.get('/:collaborationId', authenticate, ensureProfile, async (req, res) => {
    const { collaborationId } = req.params;
    const profileId = req.profileId;

    try {
        const collaboration = await pool.query(
            'SELECT c.*, p.name AS profile_name FROM collaborations c LEFT JOIN profiles p ON c.profile_id = p.id WHERE c.id = ?',
            [collaborationId]
        );
        if (!collaboration || collaboration.length === 0) return res.status(404).json({ error: 'Collaboration not found' });
        const collab = collaboration[0];
        const collaborationOwnerId = Number(collab.profile_id);

        if (collaborationOwnerId !== profileId && !collab.is_public) {
            const permission = await pool.query(
                'SELECT * FROM collaboration_permissions WHERE collaboration_id = ? AND profile_id = ?',
                [collaborationId, profileId]
            );
            if (!permission || permission.length === 0) return res.status(403).json({ error: 'Unauthorized' });
        }

        const tracks = await pool.query(
            'SELECT ct.*, p.name AS profile_name FROM collaboration_tracks ct LEFT JOIN profiles p ON ct.profile_id = p.id WHERE ct.collaboration_id = ?',
            [collaborationId]
        );

        res.json({
            collaboration: {
                id: Number(collab.id),
                profile_id: Number(collab.profile_id),
                title: collab.title,
                description: collab.description,
                is_public: !!collab.is_public,
                allow_uploads: !!collab.allow_uploads,
                profile_name: collab.profile_name || 'Unknown',
                created_at: collab.created_at,
                updated_at: collab.updated_at,
                tracks: (tracks || []).map(t => ({
                    id: Number(t.id),
                    profile_id: Number(t.profile_id),
                    title: t.title,
                    mp3_url: t.mp3_url,
                    is_master: !!t.is_master,
                    profile_name: t.profile_name || 'Unknown',
                    created_at: t.created_at
                }))
            }
        });
    } catch (err) {
        console.error('GET /collabs/:collaborationId error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to fetch collaboration' });
    }
});

// Upload track
router.post('/:collaborationId/tracks', authenticate, ensureProfile, async (req, res) => {
    const { collaborationId } = req.params;
    const profileId = req.profileId;

    try {
        if (!req.files || !req.files.mp3) {
            return res.status(400).json({ error: 'Audio file is required' });
        }

        const { title, is_master } = req.body;
        const audioFile = req.files.mp3;

        if (!['audio/mpeg', 'audio/webm'].includes(audioFile.mimetype)) {
            return res.status(400).json({ error: 'Invalid audio format (must be MP3 or WebM)' });
        }

        const collaboration = await pool.query(
            'SELECT c.*, p.user_id AS owner_user_id FROM collaborations c JOIN profiles p ON p.id = c.profile_id WHERE c.id = ?',
            [collaborationId]
        );
        if (!collaboration || collaboration.length === 0) return res.status(404).json({ error: 'Collaboration not found' });
        const collab = collaboration[0];
        const collaborationOwnerId = Number(collab.profile_id);

        if (collaborationOwnerId !== profileId) {
            const permission = await pool.query(
                'SELECT can_upload FROM collaboration_permissions WHERE collaboration_id = ? AND profile_id = ?',
                [collaborationId, profileId]
            );
            if (!permission || permission.length === 0 || !permission[0].can_upload) {
                return res.status(403).json({ error: 'Unauthorized to upload' });
            }
        }

        const extension = audioFile.mimetype === 'audio/mpeg' ? 'mp3' : 'webm';
        const audioKey = `collaborations/${collaborationId}/${req.user.id}-${Date.now()}.${extension}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: audioKey,
            Body: audioFile.data,
            ContentType: audioFile.mimetype
        }));
        const audioUrl = buildPublicFileUrl(audioKey);

        const result = await pool.query(
            'INSERT INTO collaboration_tracks (collaboration_id, profile_id, title, mp3_url, is_master) VALUES (?, ?, ?, ?, ?)',
            [collaborationId, profileId, title, audioUrl, is_master === 'true']
        );

        await createNotification({
            recipientUserId: Number(collab.owner_user_id),
            actorUserId: req.user.id,
            type: NOTIFICATION_TYPES.COLLAB_TRACK_ADDED,
            message: 'Someone added a new track to your collaboration.',
            entityType: 'collaboration',
            entityId: Number(collaborationId),
            metadata: {
                owner_profile_id: Number(collab.profile_id),
                collaboration_title: collab.title,
                track_id: Number(result.insertId),
                track_title: title || null,
            },
        });

        res.status(201).json({
            track: {
                id: Number(result.insertId),
                collaboration_id: Number(collaborationId),
                profile_id: profileId,
                title,
                mp3_url: audioUrl,
                is_master: is_master === 'true',
                created_at: new Date()
            }
        });
    } catch (err) {
        console.error('POST /collabs/:collaborationId/tracks error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to upload track' });
    }
});

// List invitees for a collaboration
router.get('/:collaborationId/invitees', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId } = req.params;

    try {
        const invitations = await pool.query(
            'SELECT ci.id, ci.collaboration_id, ci.email, ci.status, ci.invited_at, ci.accepted_at, p.id AS profile_id, p.name AS profile_name ' +
            'FROM collaboration_invitations ci ' +
            'LEFT JOIN profiles p ON ci.email = (SELECT email FROM users WHERE id = p.user_id) ' +
            'WHERE ci.collaboration_id = ?',
            [collaborationId]
        );
        console.log('Invitations query result:', JSON.stringify(invitations, bigIntReplacer, 2));

        res.json({
            invitees: (invitations || []).map(inv => ({
                id: Number(inv.id),
                collaboration_id: Number(inv.collaboration_id),
                email: inv.email,
                profile_id: inv.profile_id ? Number(inv.profile_id) : null,
                profile_name: inv.profile_name || 'Unknown',
                status: inv.status,
                invited_at: inv.invited_at,
                accepted_at: inv.accepted_at
            }))
        });
    } catch (err) {
        console.error('GET /collabs/:collaborationId/invitees error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to fetch invitees' });
    }
});

// Resend invitation
router.post('/:collaborationId/invitees/:invitationId/resend', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId, invitationId } = req.params;

    try {
        const invitation = await pool.query(
            'SELECT id, collaboration_id, email, status FROM collaboration_invitations WHERE id = ? AND collaboration_id = ?',
            [invitationId, collaborationId]
        );
        if (!invitation || invitation.length === 0) {
            return res.status(404).json({ error: 'Invitation not found' });
        }
        if (invitation[0].status !== 'pending') {
            return res.status(400).json({ error: 'Invitation is not pending' });
        }

        const collaboration = await pool.query('SELECT title FROM collaborations WHERE id = ?', [collaborationId]);
        if (!collaboration || collaboration.length === 0) {
            return res.status(404).json({ error: 'Collaboration not found' });
        }

        const token = generateToken();
        await pool.query(
            'UPDATE collaboration_invitations SET token = ?, invited_at = NOW() WHERE id = ?',
            [token, invitationId]
        );

        const inviteUrl = `${FRONTEND_URL}/collabs/invite/${token}`;
        await sendEmail(
            invitation[0].email,
            `Invitation to Collaborate on ${collaboration[0].title}`,
            `
                <h1>Collaboration Invitation</h1>
                <p>You've been invited to collaborate on "<strong>${collaboration[0].title}</strong>" on InternetDJ.</p>
                <p><a href="${inviteUrl}">Click here to accept</a></p>
                <p>If you didn’t expect this invitation, please ignore this email.</p>
            `
        );

        res.json({ success: true, message: 'Invitation resent successfully' });
    } catch (err) {
        console.error('POST /collabs/:collaborationId/invitees/:invitationId/resend error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to resend invitation' });
    }
});

// Delete track
router.delete('/:collaborationId/tracks/:trackId', authenticate, ensureProfile, async (req, res) => {
    const { collaborationId, trackId } = req.params;
    const profileId = req.profileId;

    try {
        const collaboration = await pool.query('SELECT profile_id FROM collaborations WHERE id = ?', [collaborationId]);
        if (!collaboration || collaboration.length === 0) {
            return res.status(404).json({ error: 'Collaboration not found' });
        }

        const track = await pool.query('SELECT profile_id, mp3_url FROM collaboration_tracks WHERE id = ? AND collaboration_id = ?', [trackId, collaborationId]);
        if (!track || track.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }

        // Check if user is collaboration owner or track uploader
        const collaborationOwnerId = Number(collaboration[0].profile_id);
        const trackOwnerId = Number(track[0].profile_id);
        if (collaborationOwnerId !== profileId && trackOwnerId !== profileId) {
            return res.status(403).json({ error: 'Unauthorized: You can only delete your own tracks or tracks in your collaboration' });
        }

        // Delete track from S3
        const key = extractObjectKey(track[0].mp3_url);
        await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: key
        }));

        // Delete track from database
        await pool.query('DELETE FROM collaboration_tracks WHERE id = ? AND collaboration_id = ?', [trackId, collaborationId]);

        res.status(204).send();
    } catch (err) {
        console.error('DELETE /collabs/:collaborationId/tracks/:trackId error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to delete track' });
    }
});

// Revoke invitation
router.delete('/:collaborationId/invitees/:invitationId', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId, invitationId } = req.params;

    try {
        const result = await pool.query(
            'UPDATE collaboration_invitations SET status = ?, accepted_at = NULL WHERE id = ? AND collaboration_id = ?',
            ['removed', invitationId, collaborationId]
        );
        console.log('Revoke invitation result:', JSON.stringify(result, bigIntReplacer, 2));

        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        res.status(204).send();
    } catch (err) {
        console.error('DELETE /collabs/:collaborationId/invitees/:invitationId error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to revoke invitation' });
    }
});

// Remove collaborator from collaboration
router.delete('/:collaborationId/collaborators/:collaboratorProfileId', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId, collaboratorProfileId } = req.params;
    const profileId = req.profileId;

    try {
        if (Number(collaboratorProfileId) === profileId) {
            return res.status(400).json({ error: 'Cannot remove yourself as a collaborator' });
        }

        const result = await pool.query(
            'DELETE FROM collaboration_permissions WHERE collaboration_id = ? AND profile_id = ?',
            [collaborationId, collaboratorProfileId]
        );
        console.log('Delete permissions result:', JSON.stringify(result, bigIntReplacer, 2));

        if (!result || result.affectedRows === 0) {
            return res.status(404).json({ error: 'Collaborator not found' });
        }

        await pool.query(
            'UPDATE collaboration_invitations SET status = ?, accepted_at = NULL WHERE collaboration_id = ? AND email = (SELECT email FROM users WHERE id = (SELECT user_id FROM profiles WHERE id = ?))',
            ['removed', collaborationId, collaboratorProfileId]
        );

        res.status(204).send();
    } catch (err) {
        console.error('DELETE /collabs/:collaborationId/collaborators/:collaboratorProfileId error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to remove collaborator' });
    }
});

// Invite collaborator
router.post('/:collaborationId/invite', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId } = req.params;
    const { email, can_upload } = req.body;
    const profileId = req.profileId;

    try {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email' });
        }

        const collaboration = await pool.query('SELECT * FROM collaborations WHERE id = ? AND profile_id = ?', [collaborationId, profileId]);
        if (!collaboration || collaboration.length === 0) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const existing = await pool.query(
            'SELECT * FROM collaboration_invitations WHERE collaboration_id = ? AND email = ?',
            [collaborationId, email]
        );
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: 'Email already invited' });
        }

        const token = generateToken();
        const result = await pool.query(
            'INSERT INTO collaboration_invitations (collaboration_id, email, token, status, can_upload) VALUES (?, ?, ?, ?, ?)',
            [collaborationId, email, token, 'pending', !!can_upload]
        );

        const inviteUrl = `${FRONTEND_URL}/collabs/invite/${token}`;
        await sendEmail(
            email,
            `Invitation to Collaborate on ${collaboration[0].title}`,
            `
                <h1>Collaboration Invitation</h1>
                <p>You've been invited to collaborate on "<strong>${collaboration[0].title}</strong>" on InternetDJ.</p>
                <p><a href="${inviteUrl}">Click here to accept</a></p>
                <p>If you didn’t expect this invitation, please ignore this email.</p>
            `
        );

        res.status(201).json({
            invitation: {
                id: Number(result.insertId),
                collaboration_id: Number(collaborationId),
                email,
                token,
                status: 'pending',
                can_upload: !!can_upload,
                invited_at: new Date()
            }
        });
    } catch (err) {
        console.error('POST /collabs/:collaborationId/invite error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

// Accept invitation
router.post('/invite/:token', authenticate, ensureProfile, async (req, res) => {
    const { token } = req.params;
    const profileId = req.profileId;
    const userId = req.user.id;

    try {
        const invitation = await pool.query('SELECT * FROM collaboration_invitations WHERE token = ?', [token]);
        console.log('Invitation query result:', JSON.stringify(invitation, bigIntReplacer, 2));
        if (!invitation || invitation.length === 0) {
            console.error('Invitation not found for token:', token);
            return res.status(404).json({ error: 'Invitation not found' });
        }
        if (invitation[0].status !== 'pending') {
            console.error('Invitation already processed:', invitation[0].status, 'Token:', token);
            return res.status(400).json({ error: 'Invitation already processed' });
        }

        const user = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
        console.log('User query result:', JSON.stringify(user, bigIntReplacer, 2));
        if (!user || user.length === 0) {
            console.error('User not found for ID:', userId);
            return res.status(404).json({ error: 'User not found' });
        }
        if (user[0].email.toLowerCase() !== invitation[0].email.toLowerCase()) {
            console.error(
                'Email mismatch: User email:', user[0].email.toLowerCase(),
                'Invitation email:', invitation[0].email.toLowerCase(),
                'Token:', token
            );
            return res.status(403).json({ error: 'This invitation is not for you' });
        }

        await pool.query(
            'UPDATE collaboration_invitations SET status = ?, accepted_at = NOW() WHERE id = ?',
            ['accepted', invitation[0].id]
        );
        console.log('Updated invitation status to accepted for ID:', invitation[0].id);

        await pool.query(
            'INSERT INTO collaboration_permissions (collaboration_id, profile_id, can_view, can_upload) VALUES (?, ?, ?, ?)',
            [invitation[0].collaboration_id, profileId, 1, invitation[0].can_upload]
        );
        console.log('Inserted collaboration permission for collaboration ID:', invitation[0].collaboration_id, 'Profile ID:', profileId);

        res.json({ success: true, collaboration_id: Number(invitation[0].collaboration_id) });
    } catch (err) {
        console.error('POST /collabs/invite/:token error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to accept invitation' });
    }
});

// Fetch pending invites
router.get('/invites/pending', authenticate, async (req, res) => {
    const userEmail = req.user.email;

    try {
        const invites = await pool.query(
            `
                SELECT ci.id, ci.collaboration_id, c.title AS collaboration_title, ci.email, ci.status, ci.invited_at, ci.token, ci.can_upload
                FROM collaboration_invitations ci
                         JOIN collaborations c ON ci.collaboration_id = c.id
                WHERE ci.email = ? AND ci.status = 'pending'
            `,
            [userEmail]
        );
        console.log('Pending invites query result:', JSON.stringify(invites, bigIntReplacer, 2));

        res.json({
            invites: invites.map(invite => ({
                id: Number(invite.id),
                collaboration_id: Number(invite.collaboration_id),
                collaboration_title: invite.collaboration_title,
                email: invite.email,
                status: invite.status,
                invited_at: invite.invited_at,
                token: invite.token,
                can_upload: !!invite.can_upload
            }))
        });
    } catch (err) {
        console.error('GET /collabs/invites/pending error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to fetch pending invites' });
    }
});

// Delete collaboration
router.delete('/:collaborationId', authenticate, ensureProfile, ensureCollaborationOwner, async (req, res) => {
    const { collaborationId } = req.params;
    const profileId = req.profileId;

    try {
        const collaboration = await pool.query('SELECT * FROM collaborations WHERE id = ? AND profile_id = ?', [collaborationId, profileId]);
        if (!collaboration || collaboration.length === 0) return res.status(403).json({ error: 'Unauthorized' });

        const tracks = await pool.query('SELECT mp3_url FROM collaboration_tracks WHERE collaboration_id = ?', [collaborationId]);
        for (const track of tracks || []) {
            const key = extractObjectKey(track.mp3_url);
            await s3Client.send(new DeleteObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: key
            }));
        }

        await pool.query('DELETE FROM collaborations WHERE id = ?', [collaborationId]);

        res.status(204).send();
    } catch (err) {
        console.error('DELETE /collabs/:collaborationId error:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            sqlMessage: err.sqlMessage
        });
        res.status(500).json({ error: 'Failed to delete collaboration' });
    }
});

module.exports = router;