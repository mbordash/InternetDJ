/**
 * Adds delisting, private share links and version history to songs:
 *   node backend/scripts/migrateSongVisibility.js
 *
 * schema.sql only runs when the database container initialises from empty, so
 * an existing deployment needs this, and it runs from the fly release_command
 * so a release cannot take traffic before the columns exist. Every public song
 * listing on the site gains `AND s.visibility = 'public'` in the same release,
 * so without the column the browse, search, genre and profile pages all 500.
 *
 * Three things land here, because they are one idea from the artist's side -
 * who can see this track, and which recording is it:
 *
 *   visibility          'public' or 'private'. Private means delisted: gone
 *                       from browse, search, genre pages, the sitemap and the
 *                       artist's public profile, but still there, still owned,
 *                       still carrying its plays and its reviews. Delisting is
 *                       explicitly not deleting, so the default is 'public'
 *                       and no existing track is hidden by this migration.
 *
 *   share_token         A private link, in the SoundCloud sense. A random
 *                       32-character token that reaches the track whatever its
 *                       visibility is, so an artist can send a work in progress
 *                       to a few people without publishing it. NULL means no
 *                       link has been created; deleting the token revokes every
 *                       link already handed out, which is why revoke and rotate
 *                       are separate actions in the UI. UNIQUE because the
 *                       token is the lookup key.
 *
 *   current_version_no  Which numbered version songs.mp3_url currently points
 *                       at. The song row always holds the current audio, so
 *                       nothing that plays a track had to change; song_versions
 *                       holds the history beside it.
 *
 * song_versions is deliberately not backfilled. A track that has never been
 * revised has no history worth a row, and writing one for every existing song
 * would copy the whole peaks column for all of them. The first time an artist
 * uploads a new version, the route archives the outgoing audio as version 1 and
 * inserts the new one as version 2, so the history is complete from the point
 * it starts to matter. Songs with no rows are shown as a single version.
 *
 * Safe to re-run: every statement is IF NOT EXISTS, and the results are read
 * back out of information_schema rather than inferred, since IF NOT EXISTS
 * makes a no-op and a success look identical.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

const SONG_COLUMNS = [
    ['visibility column', `ALTER TABLE songs
        ADD COLUMN IF NOT EXISTS visibility ENUM('public','private') NOT NULL DEFAULT 'public'`],
    ['share_token column', `ALTER TABLE songs
        ADD COLUMN IF NOT EXISTS share_token VARCHAR(32) DEFAULT NULL`],
    ['current_version_no column', `ALTER TABLE songs
        ADD COLUMN IF NOT EXISTS current_version_no INT(11) NOT NULL DEFAULT 1`],
];

const SONG_INDEXES = [
    ['uniq_songs_share_token', `ALTER TABLE songs
        ADD UNIQUE INDEX IF NOT EXISTS uniq_songs_share_token (share_token)`],
    ['idx_songs_visibility', `ALTER TABLE songs
        ADD INDEX IF NOT EXISTS idx_songs_visibility (visibility, created_at)`],
];

const SONG_VERSIONS_TABLE = `
    CREATE TABLE IF NOT EXISTS song_versions (
        id INT(11) NOT NULL AUTO_INCREMENT,
        song_id INT(11) NOT NULL,
        version_no INT(11) NOT NULL,
        label VARCHAR(120) DEFAULT NULL,
        notes VARCHAR(500) DEFAULT NULL,
        mp3_url VARCHAR(255) NOT NULL,
        peaks MEDIUMTEXT DEFAULT NULL,
        duration FLOAT DEFAULT NULL,
        is_current TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT current_timestamp(),
        PRIMARY KEY (id),
        UNIQUE KEY uniq_song_version (song_id, version_no),
        KEY idx_song_versions_song (song_id, version_no),
        CONSTRAINT fk_song_versions_song FOREIGN KEY (song_id)
            REFERENCES songs (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

const EXPECTED = ['visibility', 'share_token', 'current_version_no'];

(async () => {
    try {
        out('Applying song visibility, share link and version migration...');

        for (const [label, sql] of SONG_COLUMNS) {
            await pool.query(sql);
            out(`  ok  ${label}`);
        }
        for (const [label, sql] of SONG_INDEXES) {
            await pool.query(sql);
            out(`  ok  ${label}`);
        }

        await pool.query(SONG_VERSIONS_TABLE);
        out('  ok  song_versions table');

        const columns = await pool.query(
            `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_DEFAULT AS defaultValue
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'songs'
                AND COLUMN_NAME IN ('visibility','share_token','current_version_no')
              ORDER BY COLUMN_NAME`
        );

        out('');
        out('Columns now present on `songs`:');
        for (const column of columns) {
            out(`  ${pad(column.name, 22)} ${pad(column.type, 26)} default=${column.defaultValue ?? 'NULL'}`);
        }

        const missing = EXPECTED.filter((name) => !columns.some((c) => c.name === name));
        if (missing.length) {
            errOut('');
            errOut(`MISSING: ${missing.join(', ')} - the migration did not fully apply.`);
            await finish(1);
            return;
        }

        const [tables] = await pool.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'song_versions'`
        );
        if (Number(tables.n) === 0) {
            errOut('');
            errOut('MISSING: song_versions table - the migration did not fully apply.');
            await finish(1);
            return;
        }

        const [counts] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(visibility = 'private') AS hidden,
                    SUM(share_token IS NOT NULL) AS shared
               FROM songs`
        );
        const [versions] = await pool.query('SELECT COUNT(*) AS n FROM song_versions');

        out('');
        out(`${Number(counts.total)} song(s): ${Number(counts.hidden || 0)} delisted, `
            + `${Number(counts.shared || 0)} with a private share link.`);
        out(`${Number(versions.n)} archived version row(s).`);
    } catch (err) {
        errOut(`Error adding song visibility and version support: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
