/**
 * Makes clips die with their track:
 *     node backend/scripts/migrateProjectSampleCascade.js
 *
 * `project_samples` rows point at a track through track_id, but the table was
 * created with no foreign key and no index on that column. Nothing has ever
 * cleaned them up, so every clip whose track or project was deleted is still
 * sitting in the table pointing at an id that no longer exists.
 *
 * The delete-project route in routes/projects.js even carries the comment
 * "cascades to tracks and project_samples". Half of that was true: `tracks` has
 * a real foreign key to `projects`, so tracks do cascade. Clips never did.
 *
 * Adding the constraint fixes both paths at once, which is why it is done here
 * rather than by adding another DELETE to each route: a clip is removed when
 * its track goes, and when a whole project goes the tracks cascade and the
 * clips now follow them. That also makes the existing comment honest.
 *
 * Orphans have to go first. MariaDB validates existing rows when the constraint
 * is added, so a single leftover row fails the ALTER and, from the release
 * command, aborts the deploy. They are deleted rather than repaired because
 * there is nothing to repair them to: the track they belonged to is gone.
 *
 * Safe to re-run. The index is IF NOT EXISTS, the constraint is added only when
 * information_schema says it is absent (MariaDB has no IF NOT EXISTS on ADD
 * CONSTRAINT), and both are read back afterwards rather than inferred, since a
 * no-op and a success otherwise look identical.
 */
const pool = require('../config/database');
const { out, errOut, finish, pad } = require('../utils/cli');

(async () => {
    try {
        out('Applying track cascade migration to `project_samples`...');

        // Count first so the deploy log says what was cleaned up. A large
        // number here is expected on the first run rather than alarming: it is
        // every clip from every track and every project ever deleted.
        const [orphans] = await pool.query(
            `SELECT COUNT(*) AS n
               FROM project_samples ps
              WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.id = ps.track_id)`
        );
        const orphanCount = Number(orphans.n) || 0;

        if (orphanCount > 0) {
            await pool.query(
                `DELETE ps FROM project_samples ps
                  WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.id = ps.track_id)`
            );
            out(`  ok  removed ${orphanCount} orphaned clip(s)`);
        } else {
            out('  ok  no orphaned clips to remove');
        }

        // The foreign key needs an index on the referencing column. MariaDB
        // would create one implicitly, but naming it here keeps it recognisable
        // and means the lookup exists even if the constraint is dropped later.
        await pool.query(`ALTER TABLE project_samples
            ADD INDEX IF NOT EXISTS idx_project_samples_track (track_id)`);
        out('  ok  idx_project_samples_track index');

        const [existing] = await pool.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'project_samples'
                AND CONSTRAINT_NAME = 'fk_project_samples_track'`
        );
        if (Number(existing.n) === 0) {
            await pool.query(`ALTER TABLE project_samples
                ADD CONSTRAINT fk_project_samples_track
                FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE CASCADE`);
            out('  ok  fk_project_samples_track foreign key');
        } else {
            out('  ok  fk_project_samples_track foreign key (already present)');
        }

        const constraints = await pool.query(
            `SELECT CONSTRAINT_NAME AS name, DELETE_RULE AS onDelete
               FROM information_schema.REFERENTIAL_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE()
                AND TABLE_NAME = 'project_samples'`
        );

        out('');
        out('Foreign keys now present on `project_samples`:');
        for (const constraint of constraints) {
            out(`  ${pad(constraint.name, 32)} ON DELETE ${constraint.onDelete}`);
        }

        const cascade = constraints.find(
            (c) => c.name === 'fk_project_samples_track' && c.onDelete === 'CASCADE'
        );
        if (!cascade) {
            errOut('');
            errOut('MISSING: fk_project_samples_track ON DELETE CASCADE - the migration did not fully apply.');
            await finish(1);
            return;
        }

        out('');
        out('Done. Deleting a track or a project now takes its clips with it.');
        await finish(0);
    } catch (err) {
        errOut(`Migration failed: ${err.message}`);
        errOut(err.stack);
        await finish(1);
    }
})();
