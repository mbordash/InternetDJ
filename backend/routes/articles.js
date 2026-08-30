/**
 * Editorial articles: news, features, interviews and guides.
 *
 * Most of what this serves is the recovered InternetDJ.com archive (2001-2017),
 * rebuilt from the Internet Archive and imported by
 * backend/scripts/importArticles.js. New articles written on the current site
 * live in the same table and differ only in that their legacy columns are NULL.
 *
 * Everything here is public and read-only. Authoring is not exposed yet - the
 * archive is loaded by the import script, so there is no endpoint that writes.
 */

const express = require('express');
const pool = require('../config/database');
const logger = require('../utils/logger');
const authenticate = require('../middleware/authenticate');
const { uploadToS3, deleteFromS3 } = require('../utils/s3');
const { sanitizeArticleHtml, articleHtmlToText } = require('../utils/articleHtml');

const router = express.Router();

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

// Mirrors the canonical set in importArticles.js. Kept as an allowlist so a
// category in the query string can be dropped straight into a WHERE clause
// without becoming a way to probe the table.
const CATEGORIES = {
    news: 'News',
    interviews: 'Interviews',
    features: 'Features',
    reviews: 'Reviews',
    guides: 'Guides',
};

// The list endpoints never need the article text, and body_html on a legacy
// interview runs to tens of kilobytes. Selecting it for a 24-item index turned
// a small page into a megabyte of JSON.
const CARD_FIELDS = `
    a.id, a.slug, a.title, a.deck, a.category, a.category_slug,
    a.author_name, a.hero_image_url, a.published_at, a.is_legacy, a.views`;

const toCard = (row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    deck: row.deck,
    category: row.category,
    category_slug: row.category_slug,
    author_name: row.author_name,
    hero_image_url: row.hero_image_url,
    published_at: row.published_at,
    is_legacy: Boolean(row.is_legacy),
    views: Number(row.views || 0),
});

const clampLimit = (value) => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
};

const clampOffset = (value) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The category directory, with counts.
 *
 * Declared before /:slug so a request for /categories is not read as a request
 * for an article whose slug happens to be "categories".
 */
router.get('/categories', async (req, res) => {
    try {
        const rows = await pool.query(`
            SELECT a.category_slug, a.category, COUNT(*) AS total
            FROM articles a
            WHERE a.status = 'published'
            GROUP BY a.category_slug, a.category
            ORDER BY total DESC
        `);
        res.json(rows.map(row => ({
            slug: row.category_slug,
            name: row.category || CATEGORIES[row.category_slug] || row.category_slug,
            total: Number(row.total),
        })));
    } catch (err) {
        logger.error('Articles: failed to list categories:', err);
        res.status(500).json({ error: 'Failed to load categories' });
    }
});

/**
 * The index. Optional ?category= and ?q=, paged by ?limit= and ?offset=.
 */
router.get('/', async (req, res) => {
    try {
        const limit = clampLimit(req.query.limit);
        const offset = clampOffset(req.query.offset);
        const where = ["a.status = 'published'"];
        const params = [];

        const category = String(req.query.category || '').toLowerCase();
        if (category && CATEGORIES[category]) {
            where.push('a.category_slug = ?');
            params.push(category);
        }

        const q = String(req.query.q || '').trim();
        if (q) {
            // LIKE rather than a fulltext index: the table is a few thousand
            // rows and will not grow quickly, and a LIKE keeps the search
            // behaving the same on a freshly created database, where a
            // fulltext index would need its own migration.
            where.push('(a.title LIKE ? OR a.deck LIKE ? OR a.body_text LIKE ?)');
            const like = `%${q}%`;
            params.push(like, like, like);
        }

        const clause = `WHERE ${where.join(' AND ')}`;
        const [countRow] = await pool.query(
            `SELECT COUNT(*) AS total FROM articles a ${clause}`, params);

        // Undated legacy rows sort last rather than first: a NULL date means
        // the capture did not carry one, which is not the same as being new.
        const rows = await pool.query(
            `SELECT ${CARD_FIELDS}
             FROM articles a
             ${clause}
             ORDER BY a.published_at IS NULL, a.published_at DESC, a.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const total = Number(countRow ? countRow.total : 0);
        res.json({
            articles: rows.map(toCard),
            total,
            limit,
            offset,
            has_more: offset + rows.length < total,
        });
    } catch (err) {
        logger.error('Articles: failed to list:', err);
        res.status(500).json({ error: 'Failed to load articles' });
    }
});

/**
 * Everything below writes, and everything below sits above the /:slug handler
 * on purpose: that route matches any single path segment, so a /mine or /queue
 * declared after it would be read as a request for an article with that slug.
 */

const MIN_TITLE = 6;
const MIN_BODY_TEXT = 400;
const EDITABLE_STATUSES = ['draft', 'submitted', 'published', 'deleted'];

/**
 * Editors only.
 *
 * is_admin is read from the database rather than from the JWT. The flag is in
 * the token as well, but a token is issued at login and lives for as long as it
 * lives: trusting it would mean an admin demoted today keeps editorial control
 * until their session expires.
 */
const requireAdmin = async (req, res, next) => {
    try {
        const rows = await pool.query('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
        if (!rows.length || Number(rows[0].is_admin) !== 1) {
            return res.status(403).json({ error: 'Editors only' });
        }
        return next();
    } catch (err) {
        logger.error('Articles: admin check failed:', err);
        return res.status(500).json({ error: 'Failed to verify permissions' });
    }
};

const slugify = (text) => String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
    .replace(/-+$/g, '');

/** A slug nothing else is using. */
const uniqueSlug = async (title) => {
    const base = slugify(title) || 'article';
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const clash = await pool.query('SELECT id FROM articles WHERE slug = ? LIMIT 1', [candidate]);
        if (!clash.length) return candidate;
    }
    return `${base}-${Date.now()}`;
};

/**
 * Submit an article.
 *
 * Members submit; they do not publish. Everything lands as 'submitted' and an
 * editor decides - including when the submitter is the editor, so there is one
 * path through the system rather than two, and an admin's own draft gets the
 * same review screen as anyone else's.
 *
 * The image is required. An article index made of cards is mostly artwork, and
 * a submission without one either blocks publication later or quietly ships a
 * hole in the grid.
 */
router.post('/', authenticate, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const deck = String(req.body.deck || '').trim();
    const category = String(req.body.category || '').toLowerCase();
    const rawBody = String(req.body.body_html || '');
    const image = req.files?.image;

    if (title.length < MIN_TITLE) {
        return res.status(400).json({ error: `Give the article a title of at least ${MIN_TITLE} characters.` });
    }
    if (!CATEGORIES[category]) {
        return res.status(400).json({ error: 'Pick one of the listed categories.' });
    }
    if (!image) {
        return res.status(400).json({ error: 'An image is required. Every article needs artwork for its card.' });
    }

    const bodyHtml = sanitizeArticleHtml(rawBody);
    const bodyText = articleHtmlToText(bodyHtml);
    if (bodyText.length < MIN_BODY_TEXT) {
        return res.status(400).json({
            error: `The article is too short - ${bodyText.length} characters of text, and at least ${MIN_BODY_TEXT} are needed.`,
        });
    }

    let imageUrl;
    try {
        imageUrl = await uploadToS3(image, req.user.id);
    } catch (err) {
        // uploadToS3 throws readable messages for the two cases a submitter can
        // actually fix - wrong type and too large - so they are passed through.
        logger.warn(`Articles: image upload failed for user ${req.user.id}: ${err.message}`);
        return res.status(400).json({ error: err.message || 'Could not upload that image.' });
    }

    try {
        const profiles = await pool.query('SELECT id, name FROM profiles WHERE user_id = ? LIMIT 1', [req.user.id]);
        const profile = profiles[0] || null;
        const slug = await uniqueSlug(title);

        const result = await pool.query(
            `INSERT INTO articles
                (slug, title, deck, body_html, body_text, category, category_slug,
                 author_name, profile_id, hero_image_url, status, is_legacy, submitted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', FALSE, CURRENT_TIMESTAMP)`,
            [slug, title, deck || null, bodyHtml, bodyText, CATEGORIES[category], category,
             profile?.name || req.user.name || null, profile?.id || null, imageUrl]
        );

        res.status(201).json({
            id: Number(result.insertId),
            slug,
            status: 'submitted',
            message: 'Thanks - your article has been sent to the editor.',
        });
    } catch (err) {
        // The row failed, so the image it would have referenced is now an
        // orphan in the bucket. Remove it rather than leave it paid for and
        // unreachable.
        deleteFromS3(imageUrl).catch(() => {});
        logger.error('Articles: failed to save submission:', err);
        res.status(500).json({ error: 'Failed to save the article' });
    }
});

/** A member's own submissions, whatever their status. */
router.get('/mine', authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT ${CARD_FIELDS}, a.status, a.editor_note, a.submitted_at
             FROM articles a
             JOIN profiles p ON p.id = a.profile_id
             WHERE p.user_id = ?
             ORDER BY a.submitted_at DESC, a.id DESC`,
            [req.user.id]
        );
        res.json(rows.map(row => ({
            ...toCard(row),
            status: row.status,
            editor_note: row.editor_note,
            submitted_at: row.submitted_at,
        })));
    } catch (err) {
        logger.error('Articles: failed to list submissions:', err);
        res.status(500).json({ error: 'Failed to load your articles' });
    }
});

/**
 * The editor's desk.
 *
 * Defaults to what is waiting - submitted and draft, oldest first, because a
 * review queue that surfaces the newest item makes the first person to submit
 * wait longest. But an editor also needs to reach the 1,200 already-published
 * articles to fix the mistakes in them, and those are far too many to list, so
 * ?status=published requires a search term and returns matches rather than
 * everything.
 */
router.get('/queue', authenticate, requireAdmin, async (req, res) => {
    try {
        const status = String(req.query.status || '').toLowerCase();
        const q = String(req.query.q || '').trim();

        let where = "a.status IN ('submitted', 'draft')";
        const params = [];

        if (status && EDITABLE_STATUSES.includes(status)) {
            where = 'a.status = ?';
            params.push(status);
        }
        if (q) {
            where += ' AND (a.title LIKE ? OR a.slug LIKE ?)';
            params.push(`%${q}%`, `%${q}%`);
        } else if (status === 'published') {
            // Refusing rather than truncating: an editor who searched for
            // nothing wants to be told to search, not handed the first 50 of
            // twelve hundred articles and left wondering where the rest went.
            return res.status(400).json({ error: 'Search for a title to edit a published article.' });
        }

        const rows = await pool.query(
            `SELECT ${CARD_FIELDS}, a.status, a.submitted_at, a.editor_note
             FROM articles a
             WHERE ${where}
             ORDER BY a.submitted_at IS NULL, a.submitted_at ASC, a.id ASC
             LIMIT 60`,
            params
        );
        res.json(rows.map(row => ({
            ...toCard(row),
            status: row.status,
            submitted_at: row.submitted_at,
            editor_note: row.editor_note,
        })));
    } catch (err) {
        logger.error('Articles: failed to load queue:', err);
        res.status(500).json({ error: 'Failed to load the queue' });
    }
});

/** One article for editing, whatever its status. */
router.get('/queue/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const rows = await pool.query('SELECT * FROM articles WHERE id = ? LIMIT 1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Article not found' });
        res.json(rows[0]);
    } catch (err) {
        logger.error('Articles: failed to load for editing:', err);
        res.status(500).json({ error: 'Failed to load the article' });
    }
});

/**
 * Edit, publish, or send back.
 *
 * One endpoint for all three because they are the same write: the editor
 * changes some fields and sets a status. Splitting publish into its own route
 * would mean an edit-then-publish is two requests that can half-fail.
 */
router.patch('/queue/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const existing = await pool.query('SELECT * FROM articles WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing.length) return res.status(404).json({ error: 'Article not found' });
        const article = existing[0];

        const updates = {};
        if (req.body.title !== undefined) {
            const title = String(req.body.title).trim();
            if (title.length < MIN_TITLE) return res.status(400).json({ error: 'Title is too short.' });
            updates.title = title;
        }
        if (req.body.deck !== undefined) updates.deck = String(req.body.deck).trim() || null;
        if (req.body.body_html !== undefined) {
            updates.body_html = sanitizeArticleHtml(req.body.body_html);
            updates.body_text = articleHtmlToText(updates.body_html);
        }
        if (req.body.category !== undefined) {
            const category = String(req.body.category).toLowerCase();
            if (!CATEGORIES[category]) return res.status(400).json({ error: 'Unknown category.' });
            updates.category = CATEGORIES[category];
            updates.category_slug = category;
        }
        if (req.body.author_name !== undefined) updates.author_name = String(req.body.author_name).trim() || null;
        if (req.body.editor_note !== undefined) updates.editor_note = String(req.body.editor_note).trim() || null;

        if (req.body.status !== undefined) {
            const status = String(req.body.status);
            // EDITABLE_STATUSES includes 'deleted', which is what makes restore
            // work: setting a deleted article back to 'published' is an
            // ordinary edit rather than a special endpoint.
            if (!EDITABLE_STATUSES.includes(status)) {
                return res.status(400).json({ error: 'Unknown status.' });
            }
            updates.status = status;
            // Publishing dates the article, unless it already carries one - a
            // legacy piece being re-edited keeps its original date.
            if (status === 'published' && !article.published_at) {
                updates.published_at = new Date().toISOString().slice(0, 10);
            }
        }

        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

        const fields = Object.keys(updates);
        await pool.query(
            `UPDATE articles SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
            [...fields.map(f => updates[f]), req.params.id]
        );

        const [updated] = await pool.query('SELECT * FROM articles WHERE id = ? LIMIT 1', [req.params.id]);
        res.json(updated);
    } catch (err) {
        logger.error('Articles: failed to update:', err);
        res.status(500).json({ error: 'Failed to update the article' });
    }
});

/**
 * Remove an article from the site.
 *
 * A soft delete, and deliberately so. importArticles.js matches on slug and
 * updates legacy rows in place, but never writes `status` - so an article
 * removed this way stays removed the next time the archive is re-imported,
 * where a real DELETE would simply be re-inserted and reappear. It also means
 * a mistake is one PATCH away from being undone.
 *
 * Everything public already filters on status = 'published', so the article
 * leaves the index, the search, the API and the sitemap the moment this runs.
 */
router.delete('/queue/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const rows = await pool.query(
            'SELECT id, title, status FROM articles WHERE id = ? LIMIT 1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Article not found' });
        if (rows[0].status === 'deleted') {
            return res.json({ id: rows[0].id, status: 'deleted', message: 'Already deleted.' });
        }

        await pool.query("UPDATE articles SET status = 'deleted' WHERE id = ?", [req.params.id]);
        logger.info(`Articles: ${req.user.id} deleted article ${req.params.id} (${rows[0].title})`);
        res.json({
            id: rows[0].id,
            status: 'deleted',
            message: 'Deleted. It is off the site but recoverable from the deleted list.',
        });
    } catch (err) {
        logger.error('Articles: failed to delete:', err);
        res.status(500).json({ error: 'Failed to delete the article' });
    }
});

/**
 * One article, by slug, plus a few neighbours from the same category.
 */
router.get('/:slug', async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT a.*, p.name AS profile_name, p.slug AS profile_slug
             FROM articles a
             LEFT JOIN profiles p ON p.id = a.profile_id
             WHERE a.slug = ? AND a.status = 'published'
             LIMIT 1`,
            [req.params.slug]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Article not found' });
        }

        const article = rows[0];

        // Fire-and-forget: a failed view count must not fail the page, and the
        // reader should not wait on the write to see the article.
        pool.query('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id])
            .catch(err => logger.warn(`Articles: view count failed for ${article.id}: ${err.message}`));

        const related = await pool.query(
            `SELECT ${CARD_FIELDS}
             FROM articles a
             WHERE a.status = 'published' AND a.category_slug = ? AND a.id != ?
             ORDER BY a.published_at IS NULL, a.published_at DESC
             LIMIT 6`,
            [article.category_slug, article.id]
        );

        res.json({
            id: article.id,
            slug: article.slug,
            title: article.title,
            deck: article.deck,
            body_html: article.body_html,
            category: article.category,
            category_slug: article.category_slug,
            author_name: article.author_name,
            author_profile: article.profile_slug || article.profile_id || null,
            hero_image_url: article.hero_image_url,
            published_at: article.published_at,
            is_legacy: Boolean(article.is_legacy),
            // Shown as provenance on legacy articles: this page was rebuilt
            // from a public archive, and saying so is more honest than
            // presenting a reconstruction as the original.
            source_url: article.is_legacy ? article.source_url : null,
            views: Number(article.views || 0) + 1,
            related: related.map(toCard),
        });
    } catch (err) {
        logger.error(`Articles: failed to load ${req.params.slug}:`, err);
        res.status(500).json({ error: 'Failed to load article' });
    }
});

module.exports = router;
