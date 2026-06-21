const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
const crypto = require('crypto');
const Mailgun = require('mailgun.js');
const logger = require('../utils/logger');
const FormData = require('form-data');
const authenticate = require('../middleware/authenticate');
const pool = require('../config/database');
const router = express.Router();


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

// Input validation
const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePassword = (password) => {
    return password.length >= 8;
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
        logger.debug('Email sent to:', to);
    } catch (err) {
        logger.error('Error sending email:', err);
        throw new Error('Failed to send email');
    }
};

// Verify reCAPTCHA (v2 Checkbox)
const verifyRecaptcha = async (recaptchaToken) => {
    try {
        const recaptchaResponse = await axios.post(
            `https://www.google.com/recaptcha/api/siteverify`,
            null,
            {
                params: {
                    secret: process.env.RECAPTCHA_SECRET_KEY,
                    response: recaptchaToken,
                },
            }
        );
        if (!recaptchaResponse.data.success) {
            throw new Error('reCAPTCHA verification failed');
        }
        return true;
    } catch (err) {
        logger.error('reCAPTCHA verification error:', err);
        throw new Error('reCAPTCHA verification failed');
    }
};

// Google Auth
router.get('/google', (req, res, next) => {
    const returnUrl = req.query.return || '/';
    req.session.returnUrl = returnUrl;
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}/login?error=auth_failed` }),
    async (req, res) => {
        if (!req.user || !req.user.google_id || !req.user.email) {
            logger.error('No user, Google ID, or email in callback:', req.user);
            return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
        }

        try {
            logger.debug('Full req.user:', JSON.stringify(req.user, null, 2));

            const googleUserId = String(req.user.google_id).trim();
            const email = req.user.email;
            const name = req.user.name || 'Unknown';
            logger.debug('Google auth callback - Email:', email, 'Google User ID:', googleUserId, 'Type:', typeof googleUserId);

            if (!/^\d{20,}$/.test(googleUserId)) {
                logger.error('Invalid Google User ID format:', googleUserId);
                return res.redirect(`${FRONTEND_URL}/login?error=invalid_google_id`);
            }

            const existingUsers = await pool.query('SELECT id, google_id, password, is_email_verified, is_admin FROM users WHERE email = ?', [email]);
            logger.debug('Existing users query result:', existingUsers);

            let userId;

            if (existingUsers.length > 0) {
                const existingUser = existingUsers[0];
                const storedGoogleId = existingUser.google_id ? String(existingUser.google_id).trim() : null;
                logger.debug('Stored Google ID:', storedGoogleId, 'Type:', typeof storedGoogleId, 'Incoming Google User ID:', googleUserId);

                const isInvalidGoogleId = storedGoogleId && !/^\d{20,}$/.test(storedGoogleId);

                if (storedGoogleId && storedGoogleId !== googleUserId && !isInvalidGoogleId) {
                    logger.error('Email linked to different Google account:', email, 'Stored ID:', storedGoogleId, 'Incoming ID:', googleUserId);
                    const relinkToken = generateToken();
                    await pool.query(
                        'UPDATE users SET relink_token = ?, relink_google_id = ? WHERE id = ?',
                        [relinkToken, googleUserId, existingUser.id]
                    );
                    const relinkUrl = `${FRONTEND_URL}/confirm-google-relink?token=${relinkToken}`;
                    await sendEmail(
                        email,
                        'Confirm Google Account Re-link for InternetDJ',
                        `
              <h1>Google Account Re-link Request</h1>
              <p>You attempted to log in with a different Google account for ${email}.</p>
              <p>Click the link below to confirm re-linking this email to the new Google account:</p>
              <a href="${relinkUrl}">Re-link Google Account</a>
              <p>This link expires in 1 hour. If you didn’t request this, ignore this email.</p>
            `
                    );
                    return res.redirect(`${FRONTEND_URL}/login?error=relink_email_sent`);
                }

                userId = existingUser.id;

                if (!storedGoogleId || isInvalidGoogleId) {
                    await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [googleUserId, userId]);
                    logger.debug('Updated Google ID for user:', userId, 'New Google ID:', googleUserId);
                }

                if (!existingUser.is_email_verified) {
                    await pool.query('UPDATE users SET is_email_verified = ? WHERE id = ?', [true, userId]);
                    logger.debug('Set is_email_verified to true for user:', userId);
                }
            } else {
                const userResult = await pool.query(
                    'INSERT INTO users (email, name, google_id, is_email_verified) VALUES (?, ?, ?, ?)',
                    [email, name, googleUserId, true]
                );
                userId = userResult.insertId;
                logger.debug('Created new user:', userId);
            }

            const profiles = await pool.query('SELECT id FROM profiles WHERE user_id = ?', [userId]);
            if (!profiles.length) {
                await pool.query('INSERT INTO profiles (user_id, name) VALUES (?, ?)', [userId, name]);
                logger.debug('Created default profile for user:', userId);
            }

            const jwtToken = jwt.sign({ id: userId, email, name, is_admin: existingUsers.length > 0 ? existingUsers[0].is_admin : 0 }, process.env.JWT_SECRET, {
                expiresIn: '7d',
            });
            logger.debug('Generated token for user:', userId);

            const returnUrl = req.session.returnUrl || '/';
            delete req.session.returnUrl;

            res.redirect(`${FRONTEND_URL}/login?token=${jwtToken}&return=${encodeURIComponent(returnUrl)}`);
        } catch (err) {
            logger.error('Error in Google callback:', err);
            return res.redirect(`${FRONTEND_URL}/login?error=token_failed`);
        }
    }
);

// Confirm Google Re-link
router.get('/confirm-google-relink', async (req, res) => {
    const { token: relinkToken, return: returnUrl = '/' } = req.query;

    if (!relinkToken) {
        logger.debug('No re-link token provided');
        return res.redirect(`${FRONTEND_URL}/login?error=invalid_relink_token`);
    }

    try {
        logger.debug('Confirming re-link with token:', relinkToken);
        const users = await pool.query('SELECT id, email, name, relink_google_id, is_admin FROM users WHERE relink_token = ?', [relinkToken]);
        if (users.length === 0) {
            logger.debug('Invalid re-link token:', relinkToken);
            return res.redirect(`${FRONTEND_URL}/login?error=invalid_relink_token`);
        }

        const user = users[0];
        const userId = user.id;
        const newGoogleId = user.relink_google_id;

        await pool.query(
            'UPDATE users SET google_id = ?, relink_token = NULL, relink_google_id = NULL WHERE id = ?',
            [newGoogleId, userId]
        );
        logger.debug('Re-linked Google ID for user:', userId, 'New Google ID:', newGoogleId);

        await pool.query('UPDATE users SET is_email_verified = ? WHERE id = ?', [true, userId]);

        const jwtToken = jwt.sign({ id: userId, email: user.email, name: user.name, is_admin: user.is_admin }, process.env.JWT_SECRET, {
            expiresIn: '7d',
        });
        logger.debug('Generated JWT for user:', userId);

        res.redirect(`${FRONTEND_URL}/login?token=${jwtToken}&return=${encodeURIComponent(returnUrl)}`);
    } catch (err) {
        logger.error('Error confirming re-link for token:', relinkToken, err);
        return res.redirect(`${FRONTEND_URL}/login?error=server_error`);
    }
});

// Email Registration
router.post('/register', async (req, res) => {
    const { email, password, name, recaptchaToken } = req.body;

    if (!email || !password || !name || !recaptchaToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    try {
        await verifyRecaptcha(recaptchaToken);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        const existingUsers = await pool.query('SELECT id, google_id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            if (existingUsers[0].google_id) {
                return res.status(400).json({ error: 'Email is already registered with Google authentication' });
            }
            return res.status(400).json({ error: 'Email already registered' });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const verificationToken = generateToken();

        const userResult = await pool.query(
            'INSERT INTO users (email, name, password, verification_token) VALUES (?, ?, ?, ?)',
            [email, name, hashedPassword, verificationToken]
        );

        const userId = userResult.insertId;

        await pool.query('INSERT INTO profiles (user_id, name) VALUES (?, ?)', [userId, name]);
        logger.debug('Created profile for user:', userId);

        const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
        await sendEmail(
            email,
            'Verify Your InternetDJ Account',
            `
        <h1>Welcome to InternetDJ!</h1>
        <p>Please verify your email by clicking the link below:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>If you didn’t register, ignore this email.</p>
      `
        );

        res.json({ message: 'Registration successful. Please check your email to verify your account.' });
    } catch (err) {
        logger.error('Error during registration:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Email Verification
router.get('/verify-email', async (req, res) => {
    const { token: verificationToken, return: returnUrl = '/' } = req.query;

    if (!verificationToken) {
        logger.debug('No verification token provided');
        return res.redirect(`${FRONTEND_URL}/login?error=invalid_verification_token`);
    }

    try {
        logger.debug('Verifying email with token:', verificationToken);
        const users = await pool.query('SELECT id, email, name, is_admin FROM users WHERE verification_token = ?', [verificationToken]);
        if (users.length === 0) {
            logger.debug('Invalid verification token:', verificationToken);
            return res.redirect(`${FRONTEND_URL}/login?error=invalid_verification_token`);
        }

        const userId = users[0].id;
        logger.debug('Found user ID:', userId);

        await pool.query(
            'UPDATE users SET is_email_verified = ?, verification_token = NULL WHERE id = ?',
            [true, userId]
        );
        logger.debug('Email verified for user:', userId);

        const userData = await pool.query('SELECT email, name, is_admin FROM users WHERE id = ?', [userId]);
        const { email, name, is_admin } = userData[0];
        const jwtToken = jwt.sign({ id: userId, email, name, is_admin }, process.env.JWT_SECRET, {
            expiresIn: '7d',
        });
        logger.debug('Generated JWT for user:', userId);

        res.redirect(`${FRONTEND_URL}/login?token=${jwtToken}&return=${encodeURIComponent(returnUrl)}`);
    } catch (err) {
        logger.error('Error verifying email for token:', verificationToken, err);
        return res.redirect(`${FRONTEND_URL}/login?error=server_error`);
    }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
    const { email, recaptchaToken } = req.body;

    if (!email || !recaptchaToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        await verifyRecaptcha(recaptchaToken);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        const users = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ error: 'No account found with this email' });
        }

        const userId = users[0].id;

        const resetToken = generateToken();
        const expires = new Date(Date.now() + 3600000); // 1 hour

        await pool.query(
            'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
            [resetToken, expires, userId]
        );

        const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
        await sendEmail(
            email,
            'Reset Your InternetDJ Password',
            `
        <h1>Password Reset Request</h1>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link expires in 1 hour. If you didn’t request a reset, ignore this email.</p>
      `
        );

        res.json({ message: 'Password reset email sent. Please check your email.' });
    } catch (err) {
        logger.error('Error in forgot password:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    try {
        const users = await pool.query(
            'SELECT id FROM users WHERE reset_password_token = ? AND reset_password_expires > ?',
            [token, new Date()]
        );
        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const userId = users[0].id;

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        await pool.query(
            'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
            [hashedPassword, userId]
        );

        res.json({ message: 'Password reset successful. You can now log in.' });
    } catch (err) {
        logger.error('Error resetting password:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Email Login
router.post('/login', async (req, res) => {
    const { email, password, recaptchaToken, return: returnUrl = '/' } = req.body;

    if (!email || !password || !recaptchaToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        await verifyRecaptcha(recaptchaToken);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        const users = await pool.query('SELECT id, email, name, password, google_id, is_email_verified, is_admin FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];

        if (!user.is_email_verified) {
            return res.status(401).json({ error: 'Please verify your email before logging in' });
        }

        if (!user.password) {
            return res.status(401).json({ error: 'This account uses Google authentication' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const jwtToken = jwt.sign({ id: user.id, email: user.email, name: user.name, is_admin: user.is_admin }, process.env.JWT_SECRET, {
            expiresIn: '7d',
        });

        res.json({ token: jwtToken, return: returnUrl });
    } catch (err) {
        logger.error('Error during login:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Current User
router.get('/me', authenticate, async (req, res) => {
    try {
        logger.debug('Fetching user for ID:', req.user.id);
        const rows = await pool.query(
            `
                SELECT
                    u.id,
                    u.email,
                    u.name,
                    u.is_admin,
                    u.email_notifications_enabled,
                    p.id AS profile_id,
                    p.picture_url AS picture
                FROM users u
                         LEFT JOIN profiles p ON p.user_id = u.id
                WHERE u.id = ?
            `,
            [req.user.id]
        );

        if (!rows || rows.length === 0) {
            logger.error('User not found for ID:', req.user.id);
            return res.status(404).json({ error: 'User not found' });
        }

        const row = rows[0];
        const user = {
            id: Number(row.id),
            email: row.email,
            name: row.name || 'Unknown',
            is_admin: row.is_admin === 1,
            email_notifications_enabled: row.email_notifications_enabled !== 0,
            profile_id: row.profile_id ? Number(row.profile_id) : null,
            picture: row.picture || null,
        };

        if (!user.profile_id) {
            logger.debug('No profile found for user:', user.id, 'creating one...');
            const profileResult = await pool.query(
                'INSERT INTO profiles (user_id, name) VALUES (?, ?)',
                [user.id, user.name]
            );
            user.profile_id = Number(profileResult.insertId);
            logger.debug('Created profile for user:', user.id, 'Profile ID:', user.profile_id);
        }

        res.json(user);
    } catch (err) {
        logger.error('Error in /auth/me:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;