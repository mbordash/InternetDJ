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
const solanaRouter = require('./routes/solana');
const collabRouter = require('./routes/collabs');
const projectRoutes = require('./routes/projects');
const playlistsRouter = require('./routes/playlists');
const sampleLibraryRouter = require('./routes/sampleLibrary');
const loopsRouter = require('./routes/loops');
const idjcRouter = require('./routes/idjc');
const notificationsRouter = require('./routes/notifications');
const sitemapRouter = require('./routes/sitemap');
const articlesRouter = require('./routes/articles');
const path = require('path');
const http = require('http');
const fs = require('fs');
const initializeSocket = require('./socket');
const { isCrawler, extractMetadata, fetchMetadata, injectOGMetaTags } = require('./middleware/ogMetaTags');
const { resolvePageStatus } = require('./middleware/notFound');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const frontendLocalUrl = process.env.FRONTEND_URL_LOCAL || 'http://localhost:3000';
const frontendProdUrl = process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL || process.env.CLIENT_URL;
// The one hostname the site is allowed to answer on. PRIMARY_DOMAIN is honoured
// first for deployments that set it, but it does not have to be set: the
// canonical origin is already spelled out in FRONTEND_URL_PROD, and requiring a
// second variable to agree with the first is how this redirect ended up inert
// in production.
const canonicalOrigin = (() => {
    const configured = process.env.PRIMARY_DOMAIN || frontendProdUrl;
    if (!configured) return null;
    try {
        return new URL(configured).origin;
    } catch {
        logger.warn(`Canonical host redirect disabled: could not parse "${configured}" as a URL`);
        return null;
    }
})();
const canonicalHost = canonicalOrigin ? new URL(canonicalOrigin).host : null;

// Hosts that are the app talking to itself rather than a visitor: the Fly
// private network, the machine's own address, and local development. Sending a
// redirect to any of these breaks the caller instead of helping a crawler.
const isInternalHost = (host) => !host
    || host === 'localhost'
    || host.endsWith('.internal')
    || /^\[?[0-9a-f:.]+\]?$/i.test(host);   // bare IPv4/IPv6 literal

/**
 * Send every visitor to the canonical hostname, keeping the path.
 *
 * www.internetdj.co was pointed at a registrar redirect that answered 404 as
 * often as it answered 301, and when it did redirect it threw the path away and
 * dumped the visitor on the home page. Google fetching a sitemap through it got
 * HTML back and reported "Sitemap could not be read". internetdj.fly.dev had
 * the opposite problem: it served the whole site happily, as a second complete
 * copy for a crawler to index.
 *
 * Only GET and HEAD are redirected. A 301 on a POST invites the client to
 * re-send it as a GET and lose the body, and anything posting to a non-canonical
 * host is a bug worth seeing rather than papering over.
 */
app.use((req, res, next) => {
    const host = req.hostname;
    if (!canonicalHost || host === canonicalHost || isInternalHost(host)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const redirectUrl = `${canonicalOrigin}${req.originalUrl}`;
    logger.debug(`Redirecting from ${host}${req.originalUrl} to ${redirectUrl}`);
    return res.redirect(301, redirectUrl);
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
// Audio playback is byte-range streaming: a single track can issue dozens of
// requests and every seek issues more, so it gets its own generous bucket
// instead of eating the shared API budget and 429ing the rest of the app.
const AUDIO_PROXY_PATH = '/api/proxy/audio';
const isAudioProxyRequest = (req) => req.originalUrl.split('?')[0] === AUDIO_PROXY_PATH;

const audioProxyRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    message: { error: 'Too many audio requests from this IP, please try again shortly' },
    standardHeaders: true,
    legacyHeaders: false,
});

const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    skip: isAudioProxyRequest,
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

app.use(AUDIO_PROXY_PATH, audioProxyRateLimiter);
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

// robots.txt now allows Googlebot to fetch the read endpoints the pages render
// from, because blocking them meant React could not rehydrate and Google
// indexed the resulting error state as a soft 404. Fetchable is not the same as
// indexable though, so the JSON says so itself: X-Robots-Tag is the header that
// actually keeps these responses out of the index, and unlike a robots.txt
// Disallow it does not also break rendering.
app.use('/api/', (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex');
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/eq', eqRouter);
app.use('/api/forum', forumRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/solana', solanaRouter);
app.use('/api/collabs', collabRouter);
app.use('/api/projects', projectRoutes);
app.use('/api/sample-library', sampleLibraryRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/loops', loopsRouter);
app.use('/api/idjc', idjcRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/articles', articlesRouter);

// robots.txt and sitemap.xml are generated from the database, so they must be
// matched before express.static and before the SPA catch-all below.
app.use('/', sitemapRouter);

// Serve frontend
const staticPath = path.join(__dirname, '../frontend/build');
logger.debug('Serving static files from:', staticPath);
// index:false is load-bearing. express.static answers a bare "/" with
// index.html all by itself, which meant the request never reached the
// crawler branch in the catch-all below and the home page — the most
// shared URL on the site — went out with no Open Graph tags at all while
// every other route got them. Facebook's debugger reported og:image as
// "inferred" for exactly this reason. With index:false the directory
// request falls through and the catch-all serves index.html itself,
// which is what it already does for every other path.
app.use(express.static(staticPath, { index: false }));

// statusCode is a parameter because this used to be hard coded to 200 for
// every path on the domain, which is what made deleted songs and paths that
// never existed look identical to real pages and filled Search Console with
// soft 404s. See middleware/notFound.js.
const sendHtml = (res, html, statusCode = 200) => {
    const payload = Buffer.from(html, 'utf8');
    res.status(statusCode);
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
        // req.query as well as the path: /articles serves a different page per
        // ?category=, and passing only the path made them all identical.
        const metadata = extractMetadata(req.path, req.query);
        if (metadata) {
            logger.debug(`Crawler detected: ${userAgent}, extracting metadata for ${metadata.type}/${metadata.id}`);
            
            const ogMetadata = await fetchMetadata(metadata);
            
            if (ogMetadata) {
                // Read the HTML file and inject OG tags
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        logger.error('Error reading index.html:', err);
                        return res.status(500).json({ error: 'Failed to serve frontend' });
                    }
                    
                    const baseUrl = `${req.protocol}://${req.get('host')}`;
                    const modifiedHtml = injectOGMetaTags(data, ogMetadata, baseUrl);
                    // Metadata came back, so there is a real row behind this
                    // URL and no existence check is needed to know it is 200.
                    sendHtml(res, modifiedHtml, 200);
                });
                return;
            }
        }
    }
    
    // Reaching here means either an ordinary visitor, or a crawler this
    // request could not be given a share card for. Either way it is the point
    // where a URL naming something real has to be told apart from one that
    // does not, since the shell that goes back is byte identical either way.
    //
    // resolvePageStatus already fails open internally; the catch is a second
    // net so that a bug in the resolver can only ever cost a status code, and
    // never turn the whole site into 404s.
    let statusCode = 200;
    try {
        if (await resolvePageStatus(req.path) === 'missing') statusCode = 404;
    } catch (err) {
        logger.error('404 resolution failed, serving 200:', err);
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            logger.error('Error serving index.html:', err);
            res.status(500).json({ error: 'Failed to serve frontend' });
            return;
        }
        sendHtml(res, data, statusCode);
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