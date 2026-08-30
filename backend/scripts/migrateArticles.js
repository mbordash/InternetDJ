/**
 * Creates the `articles` table. schema.sql only runs when the database
 * container initialises from empty, so an existing deployment needs this:
 *   node backend/scripts/migrateArticles.js
 *
 * Safe to re-run - CREATE TABLE IF NOT EXISTS, and the columns are read back
 * from information_schema afterwards, because IF NOT EXISTS makes a no-op and a
 * success look identical.
 *
 * The ALTERs after the CREATE are not redundant. A deployment that already has
 * an early version of this table would skip the CREATE entirely and silently
 * keep the old shape, so every column added after the table first shipped needs
 * its own idempotent ALTER to reach those databases too.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

const CREATE = `
CREATE TABLE IF NOT EXISTS articles (
    id INT NOT NULL AUTO_INCREMENT,
    slug VARCHAR(220) NOT NULL,
    title VARCHAR(300) NOT NULL,
    deck VARCHAR(600) DEFAULT NULL,
    body_html MEDIUMTEXT,
    body_text MEDIUMTEXT,
    category VARCHAR(80) DEFAULT NULL,
    category_slug VARCHAR(80) DEFAULT NULL,
    author_name VARCHAR(120) DEFAULT NULL,
    profile_id INT DEFAULT NULL,
    hero_image_url VARCHAR(500) DEFAULT NULL,
    published_at DATE DEFAULT NULL,
    status ENUM('draft','submitted','published','deleted') NOT NULL DEFAULT 'published',
    is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
    legacy_story_id INT DEFAULT NULL,
    source_url VARCHAR(600) DEFAULT NULL,
    archived_at VARCHAR(20) DEFAULT NULL,
    views INT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP NULL DEFAULT NULL,
    editor_note TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_article_slug (slug),
    KEY idx_article_category (category_slug, published_at),
    KEY idx_article_published (status, published_at),
    KEY idx_article_legacy (legacy_story_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;

const STATEMENTS = [
    ['articles table', CREATE],
    ['deck column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS deck VARCHAR(600) DEFAULT NULL`],
    ['category_slug column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_slug VARCHAR(80) DEFAULT NULL`],
    ['hero_image_url column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS hero_image_url VARCHAR(500) DEFAULT NULL`],
    ['source_url column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_url VARCHAR(600) DEFAULT NULL`],
    ['archived_at column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS archived_at VARCHAR(20) DEFAULT NULL`],
    ['views column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS views INT NOT NULL DEFAULT 0`],
    ['submitted_at column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP NULL DEFAULT NULL`],
    ['editor_note column', `ALTER TABLE articles ADD COLUMN IF NOT EXISTS editor_note TEXT DEFAULT NULL`],
    // MODIFY rather than ADD: a deployment that already created this table has
    // the two-value enum, and a member submission would be silently coerced to
    // '' by a strict-mode-off server or rejected by a strict one. Re-stating the
    // full definition is the only way to widen it, and is a no-op where the
    // column already matches.
    ['status accepts submitted and deleted', `ALTER TABLE articles MODIFY COLUMN status
        ENUM('draft','submitted','published','deleted') NOT NULL DEFAULT 'published'`],
    ['category index', `ALTER TABLE articles ADD INDEX IF NOT EXISTS idx_article_category (category_slug, published_at)`],
    ['published index', `ALTER TABLE articles ADD INDEX IF NOT EXISTS idx_article_published (status, published_at)`],
];

const EXPECTED = [
    'id', 'slug', 'title', 'deck', 'body_html', 'body_text', 'category', 'category_slug',
    'author_name', 'profile_id', 'hero_image_url', 'published_at', 'status', 'is_legacy',
    'legacy_story_id', 'source_url', 'archived_at', 'views', 'submitted_at', 'editor_note',
];

(async () => {
    try {
        out('Applying articles migration...');
        for (const [label, sql] of STATEMENTS) {
            await pool.query(sql);
            out(`  ok  ${label}`);
        }

        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS defaultValue
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'articles'
             ORDER BY ORDINAL_POSITION`
        );

        out('');
        out('Columns now present on `articles`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 20)} ${pad(column.type, 42)} default=${column.defaultValue ?? 'NULL'}`);
        }

        const missing = EXPECTED.filter(name => !columns.some(c => c.name === name));
        if (missing.length) {
            errOut('');
            errOut(`MISSING: ${missing.join(', ')} - the migration did not fully apply.`);
            await finish(1);
            return;
        }

        const [counts] = await pool.query(
            `SELECT COUNT(*) AS total, SUM(is_legacy = TRUE) AS legacy FROM articles`
        );
        out('');
        out(`${Number(counts.total)} article(s) in the table, ${Number(counts.legacy || 0)} from the legacy archive.`);
        if (Number(counts.total) === 0) {
            out('');
            out('Next: import the recovered archive with');
            out('  node backend/scripts/importArticles.js article-recovery/articles.jsonl');
        }
    } catch (err) {
        errOut(`Error creating articles table: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
