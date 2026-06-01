const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('./database');
require('dotenv').config();

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
}

const callbackURL =
    process.env.GOOGLE_CALLBACK_URL ||
    (process.env.API_BASE_URL
        ? `${process.env.API_BASE_URL.replace(/\/+$/, '')}/auth/google/callback`
        : '/api/auth/google/callback');

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL,
        },
        async (token, tokenSecret, profile, done) => {
            let conn;
            try {
                conn = await pool.getConnection();
                console.log('Google profile:', profile);

                if (!profile.emails || !profile.emails[0]?.value) {
                    return done(new Error('No email provided by Google'));
                }

                const email = profile.emails[0].value;
                const displayName = profile.displayName || 'Unknown';

                // Check for existing user by google_id or email
                const users = await conn.query(
                    'SELECT id, email, name, google_id FROM users WHERE google_id = ? OR email = ?',
                    [profile.id, email]
                );

                if (users.length > 0) {
                    const existingUser = users[0];
                    // If user exists with this email but no google_id, update the google_id
                    if (!existingUser.google_id && existingUser.email === email) {
                        await conn.query(
                            'UPDATE users SET google_id = ?, name = ?, is_email_verified = ? WHERE id = ?',
                            [profile.id, displayName, true, existingUser.id]
                        );
                    }
                    const user = {
                        id: existingUser.id.toString(),
                        google_id: profile.id,
                        email: existingUser.email,
                        name: existingUser.name,
                    };
                    return done(null, user);
                }

                // No existing user, create a new one
                const result = await conn.query(
                    'INSERT INTO users (google_id, email, name, is_email_verified) VALUES (?, ?, ?, ?)',
                    [profile.id, email, displayName, true]
                );

                const newUser = {
                    id: result.insertId.toString(),
                    google_id: profile.id,
                    email: email,
                    name: displayName,
                };

                return done(null, newUser);
            } catch (err) {
                console.error('Google strategy error:', err);
                return done(err);
            } finally {
                if (conn) conn.release();
            }
        }
    )
);

passport.serializeUser((user, done) => {
    console.log('Serializing user:', user);
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query('SELECT id, email, name, google_id FROM users WHERE id = ?', [id]);
        if (rows.length === 0) return done(null, false);
        const user = {
            id: rows[0].id.toString(),
            google_id: rows[0].google_id,
            email: rows[0].email,
            name: rows[0].name,
        };
        done(null, user);
    } catch (err) {
        console.error('Deserialize error:', err);
        done(err);
    } finally {
        if (conn) conn.release();
    }
});

module.exports = passport;