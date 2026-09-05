/**
 * Adds artist releases - albums, EPs and singles:
 *   node backend/scripts/migrateReleases.js
 *
 * schema.sql only runs when the database container initialises from empty, so
 * an existing deployment needs this, and it runs from the fly release_command
 * so the tables exist before the release takes traffic. The profile page reads
 * releases on every artist view, so a deploy landing first would 500 them.
 *
 * A release is not a playlist, even though both group tracks. A playlist (a
 * mixtape, in the UI) is a listener collecting other people's music; a release
 * is the artist saying these tracks are one body of work, in this order, under
 * this cover. They differ in owner, in ordering, in whether the order is
 * meaningful, and in where they show up, so they get their own table rather
 * than a type flag on playlists that half the playlist queries would then have
 * to remember to exclude.
 *
 * release_songs deliberately has no unique key on song_id: a track can appear
 * on an EP and again on a later album or compilation, which is ordinary in
 * electronic music. The song page lists every release a track appears on rather
 * than pretending there is exactly one.
 *
 * track_no orders the release. It is not unique either - two tracks briefly
 * sharing a number while the artist drags the list around is a UI state, not a
 * database error, and the read path breaks ties on song id so the order is
 * still stable.
 *
 * Safe to re-run: both statements are CREATE TABLE IF NOT EXISTS and the
 * results are read back out of information_schema rather than inferred.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

const TABLES = [
    ['releases', `
        CREATE TABLE IF NOT EXISTS releases (
            id INT(11) NOT NULL AUTO_INCREMENT,
            profile_id INT(11) NOT NULL,
            title VARCHAR(255) NOT NULL,
            release_type ENUM('album','ep','single') NOT NULL DEFAULT 'album',
            description TEXT DEFAULT NULL,
            cover_url VARCHAR(255) DEFAULT NULL,
            release_date DATE DEFAULT NULL,
            visibility ENUM('public','private') NOT NULL DEFAULT 'public',
            created_at TIMESTAMP NULL DEFAULT current_timestamp(),
            updated_at TIMESTAMP NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
            PRIMARY KEY (id),
            KEY idx_releases_profile (profile_id, release_date),
            KEY idx_releases_visibility (visibility, release_date),
            CONSTRAINT fk_releases_profile FOREIGN KEY (profile_id)
                REFERENCES profiles (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `],
    ['release_songs', `
        CREATE TABLE IF NOT EXISTS release_songs (
            release_id INT(11) NOT NULL,
            song_id INT(11) NOT NULL,
            track_no INT(11) NOT NULL DEFAULT 1,
            added_at TIMESTAMP NULL DEFAULT current_timestamp(),
            PRIMARY KEY (release_id, song_id),
            KEY idx_release_songs_song (song_id),
            KEY idx_release_songs_order (release_id, track_no),
            CONSTRAINT fk_release_songs_release FOREIGN KEY (release_id)
                REFERENCES releases (id) ON DELETE CASCADE,
            CONSTRAINT fk_release_songs_song FOREIGN KEY (song_id)
                REFERENCES songs (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `],
];

(async () => {
    try {
        out('Applying releases migration...');

        for (const [label, sql] of TABLES) {
            await pool.query(sql);
            out(`  ok  ${label} table`);
        }

        const present = await pool.query(
            `SELECT TABLE_NAME AS name
               FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('releases','release_songs')
              ORDER BY TABLE_NAME`
        );

        out('');
        out('Tables now present:');
        for (const table of present) {
            out(`  ${table.name}`);
        }

        const missing = ['release_songs', 'releases'].filter(
            (name) => !present.some((t) => t.name === name)
        );
        if (missing.length) {
            errOut('');
            errOut(`MISSING: ${missing.join(', ')} - the migration did not fully apply.`);
            await finish(1);
            return;
        }

        const [counts] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM releases) AS releases,
                (SELECT COUNT(*) FROM release_songs) AS tracks`
        );
        out('');
        out(`${Number(counts.releases)} release(s) holding ${Number(counts.tracks)} track placement(s).`);

        const byType = await pool.query(
            'SELECT release_type AS type, COUNT(*) AS n FROM releases GROUP BY release_type ORDER BY release_type'
        );
        for (const row of byType) {
            out(`  ${pad(row.type, 8)} ${Number(row.n)}`);
        }
    } catch (err) {
        errOut(`Error creating release tables: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
