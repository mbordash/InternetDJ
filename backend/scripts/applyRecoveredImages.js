#!/usr/bin/env node
/**
 * Points article rows at the artwork recovered from the Wayback Machine.
 *
 * backend/scripts/recoverArticleImages.js does the fetching and writes
 * article-recovery/recovered-images.json, a map of slug to the path the file
 * was saved at. That manifest and the files themselves are committed, so this
 * needs no network and can run as part of a release.
 *
 * Keyed on slug rather than id because ids are assigned by whichever database
 * ran the import and differ between environments, while the slug is what the
 * importer itself matches on.
 *
 * It only ever overwrites a hero_image_url that still points at the dead
 * internetdj.com domain, or an empty one. That is what makes it safe to leave
 * in the release chain: once an editor sets a picture by hand, or clears one,
 * this stops touching that row instead of reverting the change on every deploy.
 *
 *   node backend/scripts/applyRecoveredImages.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

const MANIFEST = path.join(__dirname, '..', '..', 'article-recovery', 'recovered-images.json');
const DRY_RUN = process.argv.includes('--dry-run');

const main = async () => {
    if (!fs.existsSync(MANIFEST)) {
        console.log(`No manifest at ${MANIFEST}; nothing to apply.`);
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const slugs = Object.keys(manifest);
    console.log(`Manifest lists ${slugs.length} recovered image(s)${DRY_RUN ? ' (dry run)' : ''}`);

    let updated = 0;
    let already = 0;
    let edited = 0;
    let missing = 0;

    for (const slug of slugs) {
        const target = manifest[slug];
        const rows = await pool.query(
            'SELECT id, hero_image_url FROM articles WHERE slug = ? LIMIT 1', [slug]);
        if (!rows.length) { missing += 1; continue; }

        const current = String(rows[0].hero_image_url || '');
        if (current === target) { already += 1; continue; }

        // Anything that is not a dead internetdj.com URL and not empty is an
        // editorial decision, and this script does not get to overrule it.
        const replaceable = current === ''
            || /^https?:\/\/(www\.)?internetdj\.com\//i.test(current);
        if (!replaceable) { edited += 1; continue; }

        if (!DRY_RUN) {
            await pool.query('UPDATE articles SET hero_image_url = ? WHERE id = ?',
                [target, rows[0].id]);
        }
        updated += 1;
    }

    console.log(`  ${updated} row(s) ${DRY_RUN ? 'would be ' : ''}pointed at recovered artwork`);
    console.log(`  ${already} already correct`);
    console.log(`  ${edited} left alone (an editor has set their own picture)`);
    console.log(`  ${missing} slug(s) in the manifest are not in this database`);
};

main()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
