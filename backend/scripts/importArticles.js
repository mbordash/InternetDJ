/**
 * Loads the recovered InternetDJ.com archive into the `articles` table.
 *
 *   node backend/scripts/importArticles.js article-recovery/articles.jsonl
 *   node backend/scripts/importArticles.js article-recovery/articles.jsonl --dry-run
 *
 * Idempotent: rows are matched on slug and updated in place, so a re-run after
 * improving the scraper refreshes the text rather than duplicating it. Articles
 * edited on the current site are not clobbered - only rows still marked
 * is_legacy are updated.
 *
 * The scrape is a best-effort reconstruction of pages that no longer exist, so
 * this is also the quality gate: records that came back too thin to be a real
 * article, or whose title is the site's own <title> rather than a headline, are
 * rejected here rather than published as empty pages.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { out, warnOut, errOut, finish } = require('../utils/cli');
// Shared with the member-submission endpoint, so the archive and anything
// written on the site today pass through exactly the same filter.
const { sanitizeArticleHtml, articleHtmlToText } = require('../utils/articleHtml');

const MIN_BODY_CHARS = 200;

// The scrape falls back to <title> when it cannot find a headline, and on a
// broken capture that yields the site's own title for every row. Those are not
// articles.
const SITE_TITLE_MARKERS = [
    'internetdj.com - the global independent',
    'the global independent music',
    'page not found', 'wayback machine', '404 not found',
];

/**
 * The canonical categories.
 *
 * The old CMS accumulated a drift of labels for the same handful of sections
 * ("Music News", "DJ News", "News"), and topic ids were reused inconsistently
 * across the years, so neither can be trusted on its own. Everything is mapped
 * onto this short list instead. `guides` is not a legacy category at all - it
 * exists for the how-to writing the site publishes now.
 */
const CATEGORIES = {
    news: 'News',
    interviews: 'Interviews',
    features: 'Features',
    reviews: 'Reviews',
    guides: 'Guides',
};

const CATEGORY_ALIASES = {
    'music news': 'news', 'dj news': 'news', 'news': 'news', 'music blog': 'news',
    'industry news': 'news', 'event news': 'news',
    'interview': 'interviews', 'interviews': 'interviews',
    'feature': 'features', 'features': 'features', 'editorial': 'features',
    'review': 'reviews', 'reviews': 'reviews', 'album reviews': 'reviews',
    'guide': 'guides', 'guides': 'guides', 'tutorial': 'guides', 'how to': 'guides',
};

// A headline is a far better signal than the CMS topic for these two: the old
// site filed interviews under whatever topic the artist belonged to.
const INTERVIEW_TITLE = /\b(the\s+)?(exclusive\s+)?(internetdj\s+)?interview\b|::\s*the\s+interview|\binterview\s+with\b/i;
const GUIDE_TITLE = /^(how to|a guide to|the beginner|beginners?|getting started)\b|\bguide\b|\btutorial\b|\bsetup for beginners\b|\btips (for|on)\b/i;

const slugify = (text, max = 200) => String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');

const categoryFor = (record) => {
    if (INTERVIEW_TITLE.test(record.title || '')) return 'interviews';
    if (GUIDE_TITLE.test(record.title || '')) return 'guides';
    const raw = String(record.category || '').trim().toLowerCase();
    if (CATEGORY_ALIASES[raw]) return CATEGORY_ALIASES[raw];
    return 'news';
};

const clean = (value, max) => {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return max && text.length > max ? text.slice(0, max) : text;
};

const isJunkTitle = (title) => {
    const t = String(title || '').toLowerCase();
    if (!t || t.length < 4) return true;
    return SITE_TITLE_MARKERS.some(marker => t.includes(marker));
};

(async () => {
    const file = process.argv[2] || path.join(__dirname, '..', '..', 'article-recovery', 'articles.jsonl');
    const dryRun = process.argv.includes('--dry-run');

    if (!fs.existsSync(file)) {
        errOut(`No such file: ${file}`);
        errOut('Run the scraper first:  python3 article-recovery/scrape.py');
        await finish(1);
        return;
    }

    const records = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            records.push(JSON.parse(line));
        } catch {
            warnOut('  skipping unparseable line');
        }
    }
    out(`Read ${records.length} scraped record(s) from ${file}`);

    const rejected = { thin: 0, junkTitle: 0, noSlug: 0, duplicate: 0, sameArticle: 0 };
    const bySlug = new Map();

    for (const record of records) {
        const bodyText = String(record.body_text || '');
        if (bodyText.length < MIN_BODY_CHARS) { rejected.thin += 1; continue; }
        if (isJunkTitle(record.title)) { rejected.junkTitle += 1; continue; }

        // Pretty-URL rows carry the original slug, which is the one already
        // indexed and linked from elsewhere on the web - worth preserving
        // exactly. The storyid-era rows never had one, so it comes from the
        // headline, with the legacy id appended to keep it unique.
        let slug = clean(record.slug, 200);
        if (!slug) {
            const base = slugify(record.title, 180);
            slug = base ? (record.legacy_id ? `${base}-${record.legacy_id}` : base) : null;
        }
        if (!slug) { rejected.noSlug += 1; continue; }

        // The same article can appear twice when a slug row and a storyid row
        // both survived; keep whichever recovered more text.
        const existing = bySlug.get(slug);
        if (existing) {
            rejected.duplicate += 1;
            if (String(existing.body_text || '').length >= bodyText.length) continue;
        }

        const categoryKey = categoryFor(record);
        bySlug.set(slug, {
            slug,
            title: clean(record.title, 300),
            deck: clean(record.deck, 600),
            body_html: sanitizeArticleHtml(record.body_html),
            body_text: articleHtmlToText(sanitizeArticleHtml(record.body_html)) || bodyText,
            category: CATEGORIES[categoryKey],
            category_slug: categoryKey,
            author_name: clean(record.author, 120),
            hero_image_url: clean(record.hero_image, 500),
            published_at: record.published_on || null,
            legacy_story_id: Number.isInteger(record.legacy_id) ? record.legacy_id : null,
            source_url: clean(record.wayback, 600),
            archived_at: clean(record.timestamp, 20),
        });
    }

    /**
     * Second pass: the same article published under two different URLs.
     *
     * The old site exposed a piece both as /article/<slug> and as
     * /article/<slug>-<storyid>, and both were captured, so slug de-duplication
     * alone lets one article through twice - the Yahel Sherman interview landed
     * as two rows with identical text. Two URLs for one article is exactly the
     * duplicate content the sitemap work was trying to avoid, so identity here
     * is the headline plus the publication date, not the address.
     *
     * The survivor is the one that recovered more text; on a tie the shorter
     * slug wins, because that is the version without the id bolted on the end.
     */
    const byIdentity = new Map();
    for (const article of bySlug.values()) {
        const key = `${(article.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${article.published_at || ''}`;
        const rival = byIdentity.get(key);
        if (!rival) { byIdentity.set(key, article); continue; }

        rejected.sameArticle += 1;
        const better = article.body_text.length !== rival.body_text.length
            ? (article.body_text.length > rival.body_text.length ? article : rival)
            : (article.slug.length < rival.slug.length ? article : rival);
        byIdentity.set(key, better);
    }

    const articles = [...byIdentity.values()];

    /**
     * Drop standfirsts that are really the site's own meta description.
     *
     * The older pages carry no per-article description, so the scraper falls
     * back to <meta name="description"> - which on those templates is the site
     * blurb, "DJ Profiles, MP3 music, Forum, Daily articles and news about
     * electronica...". It was appearing as the standfirst on 634 articles,
     * where it says nothing about the piece it sits under.
     *
     * Detected by repetition rather than by matching known strings: a real
     * standfirst is written for one article and appears once, so any deck
     * shared by several articles is boilerplate by definition. That catches
     * the site descriptions from every era without a list to maintain, and it
     * is done here rather than in the scraper because only the importer sees
     * the whole corpus at once.
     */
    const MAX_DECK_REPEATS = 4;
    const MIN_DECK_CHARS = 15;
    const deckCounts = articles.reduce((acc, a) => {
        if (a.deck) acc[a.deck] = (acc[a.deck] || 0) + 1;
        return acc;
    }, {});
    let boilerplateDecks = 0;
    for (const a of articles) {
        if (!a.deck) continue;
        if (deckCounts[a.deck] > MAX_DECK_REPEATS || a.deck.length < MIN_DECK_CHARS) {
            a.deck = null;
            boilerplateDecks += 1;
        }
    }

    out('');
    out(`Accepted ${articles.length}; rejected ${records.length - articles.length} `
        + `(thin=${rejected.thin} junk-title=${rejected.junkTitle} no-slug=${rejected.noSlug} `
        + `dupe-url=${rejected.duplicate} same-article=${rejected.sameArticle})`);

    out(`Cleared ${boilerplateDecks} boilerplate standfirst(s); `
        + `${articles.filter(a => a.deck).length} article(s) keep a real one.`);

    const byCategory = articles.reduce((acc, a) => {
        acc[a.category] = (acc[a.category] || 0) + 1;
        return acc;
    }, {});
    out('');
    out('By category:');
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])
        .forEach(([name, n]) => out(`  ${String(n).padStart(5)}  ${name}`));

    const dated = articles.filter(a => a.published_at).map(a => a.published_at).sort();
    if (dated.length) out(`\nDate range: ${dated[0]} .. ${dated[dated.length - 1]} (${dated.length} dated)`);

    if (dryRun) {
        out('');
        out('--dry-run: nothing written.');
        await finish(0);
        return;
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    try {
        // Which slugs are already present, so the summary can tell a first
        // import from a top-up. affectedRows cannot: MariaDB reports 1 both for
        // a fresh insert and for an ON DUPLICATE KEY UPDATE that matched an
        // identical row, and only 2 when something actually changed. Reading
        // the slugs once up front is a single indexed query and is the only way
        // to report this honestly.
        const existingRows = await pool.query('SELECT slug FROM articles');
        const existingSlugs = new Set(existingRows.map(row => row.slug));
        for (const a of articles) {
            const result = await pool.query(
                `INSERT INTO articles
                    (slug, title, deck, body_html, body_text, category, category_slug,
                     author_name, hero_image_url, published_at, status, is_legacy,
                     legacy_story_id, source_url, archived_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', TRUE, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    title = IF(is_legacy, VALUES(title), title),
                    deck = IF(is_legacy, VALUES(deck), deck),
                    body_html = IF(is_legacy, VALUES(body_html), body_html),
                    body_text = IF(is_legacy, VALUES(body_text), body_text),
                    category = IF(is_legacy, VALUES(category), category),
                    category_slug = IF(is_legacy, VALUES(category_slug), category_slug),
                    author_name = IF(is_legacy, VALUES(author_name), author_name),
                    hero_image_url = IF(is_legacy, VALUES(hero_image_url), hero_image_url),
                    published_at = IF(is_legacy, VALUES(published_at), published_at),
                    source_url = IF(is_legacy, VALUES(source_url), source_url),
                    archived_at = IF(is_legacy, VALUES(archived_at), archived_at)`,
                [a.slug, a.title, a.deck, a.body_html, a.body_text, a.category, a.category_slug,
                 a.author_name, a.hero_image_url, a.published_at, a.legacy_story_id,
                 a.source_url, a.archived_at]
            );
            if (!existingSlugs.has(a.slug)) inserted += 1;
            else if (Number(result.affectedRows) >= 2) updated += 1;
            else unchanged += 1;
        }
    } catch (err) {
        errOut(`Import failed: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    const [totals] = await pool.query('SELECT COUNT(*) AS total FROM articles');
    out('');
    out(`Inserted ${inserted}, updated ${updated}, unchanged ${unchanged}. `
        + `${Number(totals.total)} article(s) now in the table.`);
    await finish(0);
})();
