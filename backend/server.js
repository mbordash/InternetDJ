const express = require('express');
const logger = require('./utils/logger');
const cors = require('cors');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const rateLimit = require('express-rate-limit');
const passport = require('./config/passport');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const musicRoutes = require('./routes/music');
const reviewRoutes = require('./routes/reviews');
const forumRouter = require('./routes/forum');
const eqRouter = require('./routes/eq');
const proxyRouter = require('./routes/proxy');
const collabRouter = require('./routes/collabs');
const projectRoutes = require('./routes/projects');
const playlistsRouter = require('./routes/playlists');
const sampleLibraryRouter = require('./routes/sampleLibrary');
const stemsRouter = require('./routes/stems');
const idjcRouter = require('./routes/idjc');
const notificationsRouter = require('./routes/notifications');
const path = require('path');
const http = require('http');
const fs = require('fs');
const initializeSocket = require('./socket');
const { isCrawler, extractMetadata, fetchSongMetadata, fetchProfileMetadata, injectOGMetaTags } = require('./middleware/ogMetaTags');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const frontendLocalUrl = process.env.FRONTEND_URL_LOCAL || 'http://localhost:3000';
const frontendProdUrl = process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL || process.env.CLIENT_URL;
const primaryDomain = process.env.PRIMARY_DOMAIN;
const primaryAppHost = process.env.PRIMARY_APP_HOST;

// Optional canonical host redirect for Fly/custom domain deployments
app.use((req, res, next) => {
    const host = req.hostname; // or req.get('host')
    if (primaryDomain && primaryAppHost && host === primaryAppHost) {
        const redirectUrl = `${primaryDomain.replace(/\/+$/, '')}${req.originalUrl}`;
        logger.debug(`Redirecting from ${host}${req.originalUrl} to ${redirectUrl}`);
        return res.redirect(301, redirectUrl);
    }
    next();
});

app.use((req, res, next) => {
    logger.info(`Incoming request: ${req.method} ${req.path}`);
    next();
});


const CONCURRENCY_LIMIT = parseInt(process.env.FFMPEG_CONCURRENCY_LIMIT, 10) || 1;
logger.debug(`FFmpeg concurrency limit set to: ${CONCURRENCY_LIMIT}`);

// Debug: Log environment variables (omit sensitive ones)
logger.debug('Environment variables:', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DB_HOST: process.env.DB_HOST,
    DB_USER: process.env.DB_USER,
    DB_NAME: process.env.DB_NAME,
    FRONTEND_URL_LOCAL: process.env.FRONTEND_URL_LOCAL,
    FRONTEND_URL_PROD: process.env.FRONTEND_URL_PROD,
});

// CORS origins
const allowedOrigins = [
    frontendLocalUrl,
    frontendProdUrl,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
].filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
        credentials: true,
    })
);

// Rate limiter
const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Explicitly use req.ip (now trusted) as the key; fallback to a default if undefined
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        logger.debug(`Rate limit key for request: ${ip} (path: ${req.path})`); // Log to verify
        return ip;
    },
    handler: (req, res, next, optionsUsed) => {
        logger.debug(`Rate limit HIT for IP: ${req.ip}, Path: ${req.path}`); // Use req.ip here too
        res.status(optionsUsed.statusCode).send(optionsUsed.message);
    },
});

app.use('/api/', globalRateLimiter);

// Middleware
app.use(express.json());
app.use(fileUpload());
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'defaultsecret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000,
        },
    })
);
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/eq', eqRouter);
app.use('/api/forum', forumRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/collabs', collabRouter);
app.use('/api/projects', projectRoutes);
app.use('/api/sample-library', sampleLibraryRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/stems', stemsRouter);
app.use('/api/idjc', idjcRouter);
app.use('/api/notifications', notificationsRouter);

// Serve frontend
const staticPath = path.join(__dirname, '../frontend/build');
logger.debug('Serving static files from:', staticPath);
app.use(express.static(staticPath));

const sendHtml200 = (res, html) => {
    const payload = Buffer.from(html, 'utf8');
    res.status(200);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Length', payload.byteLength.toString());
    res.set('Accept-Ranges', 'none');
    res.send(payload);
};

// Catch-all route for frontend (must be after all API routes)
app.get(/(.*)/, async (req, res) => {
    const filePath = path.join(staticPath, 'index.html');
    
    // Check if this is a crawler request and if so, inject OG tags
    const userAgent = req.get('user-agent') || '';
    if (isCrawler(userAgent)) {
        const metadata = extractMetadata(req.path);
        if (metadata) {
            logger.debug(`Crawler detected: ${userAgent}, extracting metadata for ${metadata.type}/${metadata.id}`);
            
            let ogMetadata = null;
            if (metadata.type === 'song') {
                ogMetadata = await fetchSongMetadata(metadata.id);
            } else if (metadata.type === 'profile') {
                ogMetadata = await fetchProfileMetadata(metadata.id);
            }
            
            if (ogMetadata) {
                // Read the HTML file and inject OG tags
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        logger.error('Error reading index.html:', err);
                        return res.status(500).json({ error: 'Failed to serve frontend' });
                    }
                    
                    const baseUrl = `${req.protocol}://${req.get('host')}`;
                    const modifiedHtml = injectOGMetaTags(data, ogMetadata, baseUrl);
                    sendHtml200(res, modifiedHtml);
                });
                return;
            }
        }
    }
    
    // Default: serve index.html as a full-body 200 response
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            logger.error('Error serving index.html:', err);
            res.status(500).json({ error: 'Failed to serve frontend' });
            return;
        }
        sendHtml200(res, data);
    });
});

initializeSocket(server);

// Error handling
app.use((err, req, res, _next) => {
    logger.error('Global error:', err);
    const origin = req.get('origin');
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
    }
    res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.PORT || 5050;
server.listen(PORT, () => {
    logger.debug(`Server running on port ${PORT}`);
}).on('error', (err) => {
    logger.error('Server startup error:', err);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});