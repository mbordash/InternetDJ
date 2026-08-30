#!/usr/bin/env node
/**
 * Pulls the original article artwork back out of the Wayback Machine.
 *
 * When InternetDJ.com went away it took /images/articles/ with it, so all 957
 * archive articles carry a hero_image_url that no longer resolves. The Wayback
 * Machine crawled a good part of that directory, and this fetches back what it
 * has: about 620 of the 957.
 *
 * Two things matter for the match rate. Captures are indexed by lowercased
 * FILENAME rather than by full URL, because the archive holds the same file
 * under www and bare-domain forms and with mixed case in the path, and matching
 * whole URLs silently misses most of them. And a small set of names is tried in
 * variant form, because the site's hero images were usually NAMElarge.jpg while
 * what the crawler happened to catch was sometimes only NAME.jpg.
 *
 * Files land in frontend/public/images/articles/archive and are committed to
 * the repo rather than pushed to the S3 bucket. They are a fixed, one-time,
 * immutable set of the site's own history, and putting them in the repo means
 * they are versioned, need no credentials to restore, and cannot go missing
 * again the way the originals did. The bucket is for uploads, which are
 * unbounded and belong to users.
 *
 * Nothing here touches the database. It writes a manifest keyed by slug, and
 * backend/scripts/applyRecoveredImages.js is what puts the paths in the table.
 *
 * Resumable: a file already on disk is never fetched twice, so it is safe to
 * interrupt and re-run. Archive.org refuses more than a couple of concurrent
 * connections, so this is deliberately serial.
 *
 *   node backend/scripts/recoverArticleImages.js [--limit N] [--refresh-index]
 */

const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'frontend', 'public', 'images', 'articles', 'archive');
const PUBLIC_PREFIX = '/images/articles/archive';
const INDEX_FILE = path.join(ROOT, 'article-recovery', 'wayback-images.json');
const MANIFEST_FILE = path.join(ROOT, 'article-recovery', 'recovered-images.json');

const CDX = 'https://web.archive.org/cdx/search/cdx'
    + '?url=internetdj.com/images/articles*'
    + '&output=json&fl=original,timestamp,statuscode,mimetype,length&limit=60000';

const args = process.argv.slice(2);
const LIMIT = (() => {
    const i = args.indexOf('--limit');
    return i >= 0 ? Number(args[i + 1]) : Infinity;
})();
const REFRESH = args.includes('--refresh-index');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------

const loadIndex = async () => {
    if (!REFRESH && fs.existsSync(INDEX_FILE)) {
        return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    }
    process.stdout.write('Fetching Wayback capture index... ');
    const res = await fetch(CDX, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`CDX returned ${res.status}`);
    const rows = await res.json();
    rows.shift();
    console.log(`${rows.length} captures`);
    fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(rows));
    return rows;
};

/**
 * Best capture per filename. "Best" is a 200 that the archive itself labelled as
 * an image, and among those the largest - the crawler often caught a thumbnail
 * on one pass and the full picture on another, and the big one is the hero.
 */
const indexByFilename = (rows) => {
    const map = new Map();
    for (const [orig, ts, status, mime, len] of rows) {
        let base;
        try {
            base = decodeURIComponent(orig.split('/').pop()).toLowerCase();
        } catch {
            base = orig.split('/').pop().toLowerCase();
        }
        if (!base) continue;
        const usable = status === '200' && /^image\//i.test(mime || '');
        if (!usable) continue;
        const size = Number(len) || 0;
        const cur = map.get(base);
        if (!cur || size > cur.size) map.set(base, { orig, ts, size });
    }
    return map;
};

// The site's hero was normally NAMElarge.jpg. Where the crawler only caught
// NAME.jpg, that is still the right picture for the article.
const nameVariants = (base) => {
    const dot = base.lastIndexOf('.');
    const stem = dot < 0 ? base : base.slice(0, dot);
    const ext = dot < 0 ? '' : base.slice(dot);
    const out = [base];
    if (/large$/.test(stem)) out.push(stem.replace(/large$/, '') + ext);
    else out.push(`${stem}large${ext}`);
    if (/_?thumb$/.test(stem)) out.push(stem.replace(/_?thumb$/, '') + ext);
    for (const e of ['.jpg', '.jpeg', '.png', '.gif']) if (e !== ext) out.push(stem + e);
    return [...new Set(out)];
};

// thumb.php?src=/images/articles/NAME.jpg&wmax=... - the resizer is gone with
// the rest of the site, but the file it was pointed at is what we want anyway.
const realImageUrl = (url) => {
    const m = String(url).match(/thumb\.php\?src=([^&]+)/i);
    if (!m) return url;
    try {
        return `http://www.internetdj.com${decodeURIComponent(m[1])}`;
    } catch {
        return url;
    }
};

const filenameOf = (url) => {
    try {
        return decodeURIComponent(String(url).split('?')[0].split('/').pop()).toLowerCase();
    } catch {
        return String(url).split('?')[0].split('/').pop().toLowerCase();
    }
};

// Keep the original name where it is safe to serve, so the restored archive
// still looks like the archive rather than a pile of hashes.
const safeName = (base) => base.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

const MAGIC = [
    [Buffer.from([0xff, 0xd8, 0xff]), 'jpg'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png'],
    [Buffer.from('GIF8'), 'gif'],
    [Buffer.from('RIFF'), 'webp'],
];

/**
 * The archive answers a miss with an HTML page and a 200, so the status code
 * alone proves nothing. Anything that is not recognisably an image, or is small
 * enough to be a spacer or a "missing image" placeholder, is rejected.
 */
const looksLikeImage = (buf) => {
    if (!buf || buf.length < 1024) return null;
    for (const [sig, kind] of MAGIC) if (buf.subarray(0, sig.length).equals(sig)) return kind;
    return null;
};

const fetchCapture = async (capture, attempt = 0) => {
    const url = `https://web.archive.org/web/${capture.ts}id_/${capture.orig}`;
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(45000),
            headers: { 'User-Agent': 'InternetDJ-archive-restore/1.0 (+https://internetdj.co)' },
        });
        if (res.status === 429 || res.status === 503) throw new Error(`throttled ${res.status}`);
        if (!res.ok) return { error: `http ${res.status}` };
        const buf = Buffer.from(await res.arrayBuffer());
        const kind = looksLikeImage(buf);
        if (!kind) return { error: `not an image (${buf.length} bytes)` };
        return { buf, kind };
    } catch (err) {
        // Backs off rather than giving up: the archive throttles hard, and a
        // failure here usually means "slow down", not "gone".
        if (attempt < 3) {
            await sleep(2000 * (attempt + 1));
            return fetchCapture(capture, attempt + 1);
        }
        return { error: err.message };
    }
};

// ---------------------------------------------------------------------------

const main = async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const archive = indexByFilename(await loadIndex());
    console.log(`${archive.size} distinct images available in the archive`);

    const rows = await pool.query(`
        SELECT slug, hero_image_url FROM articles
        WHERE hero_image_url REGEXP '^https?://(www\\\\.)?internetdj\\\\.com/'
        ORDER BY slug
    `);
    console.log(`${rows.length} article(s) carrying a dead image URL`);

    // Work out what to fetch before fetching anything, so the run can report a
    // total and so one file shared by several articles is downloaded once.
    const targets = new Map();
    const plan = [];
    let unmatched = 0;

    for (const row of rows) {
        const base = filenameOf(realImageUrl(row.hero_image_url));
        let hit = null;
        let matchedName = null;
        for (const v of nameVariants(base)) {
            const c = archive.get(v);
            if (c) { hit = c; matchedName = v; break; }
        }
        if (!hit) { unmatched += 1; continue; }
        const name = safeName(matchedName);
        if (!targets.has(name)) targets.set(name, hit);
        plan.push({ slug: row.slug, name });
    }

    console.log(`${plan.length} article(s) matched to ${targets.size} distinct file(s); `
        + `${unmatched} have no capture`);

    const manifest = fs.existsSync(MANIFEST_FILE)
        ? JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
        : {};

    let fetched = 0;
    let cached = 0;
    let failed = 0;
    let bytes = 0;
    const failures = [];
    const entries = [...targets.entries()].slice(0, LIMIT === Infinity ? undefined : LIMIT);

    for (const [name, capture] of entries) {
        const dest = path.join(OUT_DIR, name);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) { cached += 1; continue; }

        const result = await fetchCapture(capture);
        if (result.error) {
            failed += 1;
            failures.push(`${name}: ${result.error}`);
        } else {
            fs.writeFileSync(dest, result.buf);
            bytes += result.buf.length;
            fetched += 1;
        }

        const done = fetched + cached + failed;
        if (done % 25 === 0) {
            process.stdout.write(`  ${done}/${entries.length}  `
                + `fetched ${fetched}, had ${cached}, failed ${failed}\n`);
        }
        // Polite spacing. The archive is hosting this material for free and
        // refuses anything that looks like a hammering.
        await sleep(350);
    }

    // Only articles whose file actually exists on disk go in the manifest, so a
    // partial run produces a correct manifest for the part that finished.
    let mapped = 0;
    for (const { slug, name } of plan) {
        const dest = path.join(OUT_DIR, name);
        if (!fs.existsSync(dest) || fs.statSync(dest).size <= 1024) continue;
        manifest[slug] = `${PUBLIC_PREFIX}/${name}`;
        mapped += 1;
    }
    fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 1)}\n`);

    console.log('');
    console.log(`Downloaded ${fetched} file(s), ${(bytes / 1048576).toFixed(1)} MB this run`);
    console.log(`${cached} already on disk, ${failed} failed`);
    console.log(`Manifest: ${mapped} article(s) -> ${path.relative(ROOT, MANIFEST_FILE)}`);
    if (failures.length) {
        console.log(`\nFirst failures:\n  ${failures.slice(0, 10).join('\n  ')}`);
    }
    await pool.end?.();
};

main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
});
