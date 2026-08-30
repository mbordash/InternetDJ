/**
 * Adds the vanity-slug column and its unique index to `profiles`.
 *
 * schema.sql only runs when the database container initialises from empty, so
 * any database that predates the slug feature never receives these. Run it
 * directly with:
 *
 *   node backend/scripts/migrateProfileSlugs.js
 *
 * It also runs as part of the fly release_command, so a deploy cannot reach
 * traffic before the column exists. Without it, every route that selects
 * `p.slug` answers 500 with ER_BAD_FIELD_ERROR — and that is eight route files
 * including auth.js, profile.js and music.js, so effectively the whole site.
 *
 * No backfill: NULL means "no slug chosen yet". MariaDB permits many NULLs in a
 * UNIQUE index, and utils/profilePath falls back to the numeric id, so existing
 * profiles keep working untouched until their artist picks an address.
 *
 * Safe to re-run. Both statements are IF NOT EXISTS, and the results are read
 * back out of information_schema afterwards, because IF NOT EXISTS makes a
 * no-op and a success look identical.
 */
const pool = require('../config/database');
const { out, warnOut, errOut, finish, pad } = require('../utils/cli');

const COLUMN_SQL = `ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS slug VARCHAR(40) DEFAULT NULL`;

const INDEX_NAME = 'profiles_slug_unique';
const INDEX_SQL = `ALTER TABLE profiles
    ADD UNIQUE KEY IF NOT EXISTS ${INDEX_NAME} (slug)`;

const columnExists = async () => {
    const rows = await pool.query(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles'
           AND COLUMN_NAME = 'slug'`
    );
    return rows[0] || null;
};

// Read the index back by shape, not just by name: `ADD UNIQUE KEY IF NOT EXISTS`
// matches on the index name alone, so an index over `slug` created earlier under
// some other name would let the ALTER silently no-op while leaving uniqueness
// unenforced under the name the rest of this script checks for.
const slugIndexes = async () => pool.query(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles'
       AND COLUMN_NAME = 'slug'`
);

(async () => {
    try {
        out('Applying profile slug migration to `profiles`...');

        await pool.query(COLUMN_SQL);
        out('  ok  slug column');

        // Adding the unique key fails outright if duplicates are already sitting
        // in the column — possible on a database where the column was added by
        // hand without the index. Say which values collide, because the raw
        // ER_DUP_ENTRY names only the first one it happens to hit.
        const indexes = await slugIndexes();
        if (!indexes.some((i) => Number(i.nonUnique) === 0)) {
            const dupes = await pool.query(
                `SELECT slug, COUNT(*) AS n FROM profiles
                 WHERE slug IS NOT NULL
                 GROUP BY slug HAVING n > 1
                 ORDER BY n DESC`
            );
            if (dupes.length) {
                errOut('');
                errOut('Cannot add the unique index — these slugs are already duplicated:');
                for (const d of dupes) {
                    errOut(`  ${pad(d.slug, 42)} x${Number(d.n)}`);
                }
                errOut('Resolve them by hand, then re-run this script.');
                await finish(1);
                return;
            }
        }

        await pool.query(INDEX_SQL);
        out(`  ok  ${INDEX_NAME} index`);

        const column = await columnExists();
        if (!column) {
            errOut('');
            errOut('MISSING: profiles.slug does not exist — the migration did not apply.');
            await finish(1);
            return;
        }

        const after = await slugIndexes();
        const unique = after.filter((i) => Number(i.nonUnique) === 0);
        if (!unique.length) {
            errOut('');
            errOut('MISSING: no unique index over profiles.slug — uniqueness is unenforced.');
            await finish(1);
            return;
        }
        if (!unique.some((i) => i.name === INDEX_NAME)) {
            warnOut('');
            warnOut(`Note: slug uniqueness is enforced by ${unique.map((i) => i.name).join(', ')},`);
            warnOut(`not by ${INDEX_NAME}. That is safe, just not the name schema.sql uses.`);
        }

        out('');
        out(`Column:  ${pad(column.name, 10)} ${pad(column.type, 14)} nullable=${column.nullable}`);
        out(`Indexes: ${unique.map((i) => `${i.name} (unique)`).join(', ')}`);

        const [counts] = await pool.query(
            'SELECT COUNT(*) AS total, COUNT(slug) AS withSlug FROM profiles'
        );
        out('');
        out(`${Number(counts.total)} profile(s), ${Number(counts.withSlug)} with a slug set.`);
        out('Profiles without one stay reachable at /profile/<id>, as intended.');
    } catch (err) {
        errOut(`Error adding the profile slug column: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
