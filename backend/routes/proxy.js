const express = require('express');
const axios = require('axios');
const { isPublicBucketUrl } = require('../utils/storage');
const router = express.Router();

// Headers that must survive the hop from the bucket to the browser. Range
// playback depends on content-range/accept-ranges being reported accurately.
const PASSTHROUGH_HEADERS = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
    'cache-control',
];

// Proxy route for audio files
router.get('/audio', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Audio URL is required' });
    }

    // Optional: Restrict URLs to Tigris bucket for security
    if (!isPublicBucketUrl(url)) {
        return res.status(400).json({ error: 'Invalid audio URL' });
    }

    // The browser aborts the in-flight range request every time the user seeks.
    // Without this the upstream stream stays open and leaks a socket per seek.
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) controller.abort();
    });

    try {
        const forwardedHeaders = {};
        if (req.headers.range) forwardedHeaders.Range = req.headers.range;
        if (req.headers['if-range']) forwardedHeaders['If-Range'] = req.headers['if-range'];

        const response = await axios({
            method: 'GET',
            url,
            responseType: 'stream', // Stream to handle large files
            signal: controller.signal,
            headers: forwardedHeaders,
            // 206 answers a Range request and 304 answers a conditional one;
            // neither should be thrown as an error.
            validateStatus: (status) => status >= 200 && status < 400,
        });

        PASSTHROUGH_HEADERS.forEach((header) => {
            const value = response.headers[header];
            if (value !== undefined) res.set(header, value);
        });
        if (response.headers['accept-ranges'] === undefined) {
            res.set('Accept-Ranges', 'bytes');
        }

        // Mirror the origin's status. A Range request must come back as 206: on a
        // 200 the browser treats the partial body as the whole file, so the seek
        // silently produces a broken media element and playback stops.
        res.status(response.status);

        response.data.on('error', (err) => {
            console.error('Proxy audio stream error:', err.message);
            res.destroy();
        });
        response.data.pipe(res);
    } catch (err) {
        if (axios.isCancel(err) || err.code === 'ERR_CANCELED') {
            return; // Client seeked or navigated away; nothing to report.
        }
        console.error('Proxy audio error:', {
            message: err.message,
            status: err.response?.status,
            url,
        });
        if (res.headersSent) {
            return res.destroy();
        }
        res.status(err.response?.status || 502).json({
            error: 'Failed to fetch audio file',
            details: err.message,
        });
    }
});

module.exports = router;
