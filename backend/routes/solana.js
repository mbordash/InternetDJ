const express = require('express');
const axios = require('axios');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Solana JSON-RPC proxy.
 *
 * The browser used to talk to Helius directly, which meant the API key was
 * compiled into the frontend bundle and readable by anyone who opened
 * devtools. Routing through here keeps every key server-side, lets us fail
 * over between providers when one rate-limits us, and lets one cached read
 * serve every visitor instead of every browser fetching the same thing.
 *
 * Wallet signing deliberately stays in the browser. This only forwards reads
 * and transactions the user has already signed, so no private key ever comes
 * near the server.
 */

// Only what the gifting flow actually needs. Without this the endpoint would be
// an open Solana relay that anyone could point their own app at.
const ALLOWED_METHODS = new Set([
    'getAccountInfo',
    'getMultipleAccounts',
    'getBalance',
    'getTokenAccountsByOwner',
    'getTokenAccountBalance',
    'getMinimumBalanceForRentExemption',
    'getLatestBlockhash',
    'getBlockHeight',
    'getSlot',
    'getSignatureStatuses',
    'getTransaction',
    'getFeeForMessage',
    'sendTransaction',
    'simulateTransaction',
    'getVersion',
    'getHealth',
]);

// Providers are tried in order. Configure with SOLANA_RPC_URLS (comma
// separated); SOLANA_RPC_URL is honoured for backwards compatibility, and the
// public endpoint is a keyless last resort rather than a primary.
// Keyless public endpoints, tried after anything configured. They need no
// signup, so the chain still has depth when only one keyed provider is set.
// api.mainnet-beta.solana.com is last because it is the most aggressively
// throttled and Solana Labs asks that apps not depend on it.
const PUBLIC_FALLBACKS = [
    'https://solana-rpc.publicnode.com',
    'https://api.mainnet-beta.solana.com',
];

function upstreams() {
    const configured = (process.env.SOLANA_RPC_URLS || process.env.SOLANA_RPC_URL || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
    return [...new Set([...configured, ...PUBLIC_FALLBACKS])];
}

/**
 * The IDJ Coin mint is immutable in practice — decimals and owning program
 * don't change — and the gift flow reads it twice per gift. Caching it turns
 * two calls per gift, per user, into one call per TTL for the whole site.
 */
const MINT_CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cacheKeyFor(method, params) {
    const mint = process.env.IDJC_MINT_ADDRESS;
    if (!mint) return null;
    if (method === 'getAccountInfo' && Array.isArray(params) && params[0] === mint) {
        return `getAccountInfo:${mint}:${JSON.stringify(params[1] || {})}`;
    }
    return null;
}

function readCache(key) {
    if (!key) return null;
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
        cache.delete(key);
        return null;
    }
    return hit.value;
}

async function forward(payload) {
    const errors = [];
    for (const url of upstreams()) {
        try {
            const response = await axios.post(url, payload, {
                timeout: 15000,
                headers: { 'Content-Type': 'application/json' },
                // Handle the status ourselves so a 429 becomes a failover
                // rather than a thrown error we can't distinguish.
                validateStatus: () => true,
            });

            const providerRejected = response.status === 401
                || response.status === 403
                || response.status === 408
                || response.status === 429
                || response.status >= 500;
            if (providerRejected) {
                errors.push(`${hostOf(url)}: HTTP ${response.status}`);
                continue;
            }
            if (response.status >= 400) {
                return { status: response.status, data: response.data };
            }
            return { status: 200, data: response.data };
        } catch (err) {
            errors.push(`${hostOf(url)}: ${err.code || err.message}`);
        }
    }
    logger.warn('All Solana RPC upstreams failed', { errors });
    return null;
}

function hostOf(url) {
    try {
        return new URL(url).host;
    } catch {
        return 'unknown';
    }
}

router.post('/rpc', express.json({ limit: '1mb' }), async (req, res) => {
    const body = req.body;

    // Batch requests would let one call smuggle in a disallowed method.
    if (Array.isArray(body)) {
        return res.status(400).json({ error: 'Batch requests are not supported' });
    }
    if (!body || typeof body !== 'object' || typeof body.method !== 'string') {
        return res.status(400).json({ error: 'Invalid JSON-RPC request' });
    }
    if (!ALLOWED_METHODS.has(body.method)) {
        logger.warn('Blocked Solana RPC method', { method: body.method });
        return res.status(403).json({ error: `Method not allowed: ${body.method}` });
    }

    const key = cacheKeyFor(body.method, body.params);
    const cached = readCache(key);
    if (cached) {
        // The id must echo *this* request, not the one that filled the cache.
        return res.json({ ...cached, id: body.id });
    }

    const result = await forward(body);
    if (!result) {
        return res.status(503).json({
            error: 'Solana network is busy right now. Please try again in a moment.',
        });
    }

    if (key && result.status === 200 && result.data && !result.data.error) {
        cache.set(key, { value: result.data, expires: Date.now() + MINT_CACHE_TTL_MS });
    }

    res.status(result.status).json(result.data);
});

module.exports = router;
