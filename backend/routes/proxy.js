const express = require('express');
const axios = require('axios');
const { isPublicBucketUrl } = require('../utils/storage');
const router = express.Router();

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

    try {
        console.log('Proxying audio request to:', url); // Debug log
        const response = await axios({
            method: 'GET',
            url,
            responseType: 'stream', // Stream to handle large files
            headers: {
                Range: req.headers.range, // Forward Range header
            },
        });

        // Set response headers
        res.set({
            'Content-Type': response.headers['content-type'] || 'audio/mpeg',
            'Content-Length': response.headers['content-length'],
            'Content-Range': response.headers['content-range'],
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': req.get('origin') || 'http://localhost:3000', // Fallback to localhost
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
        });

        // Stream the response
        response.data.pipe(res);
    } catch (err) {
        console.error('Proxy audio error:', {
            message: err.message,
            status: err.response?.status,
            url,
        });
        res.status(err.response?.status || 500).json({
            error: 'Failed to fetch audio file',
            details: err.message,
        });
    }
});

module.exports = router;