/**
 * Creates the auto-master queue tables. schema.sql only runs when the database
 * container initialises from empty, so an existing deployment needs this run
 * once by hand:  node backend/scripts/migrateMasteringTables.js
 *
 * Safe to re-run - every statement is IF NOT EXISTS.
 */
const pool = require('../config/database');
const logger = require('../utils/logger');

const STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS mastering_jobs (
        id VARCHAR(36) NOT NULL,
        song_id INT NOT NULL,
        user_id INT NOT NULL,
        status ENUM('queued','analyzing','rendering','ready','failed') NOT NULL DEFAULT 'queued',
        analysis MEDIUMTEXT,
        plan MEDIUMTEXT,
        result_url VARCHAR(255),
        error TEXT,
        audio_duration_sec DECIMAL(10,2),
        started_at TIMESTAMP NULL DEFAULT NULL,
        finished_at TIMESTAMP NULL DEFAULT NULL,
        duration_ms INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY song_id (song_id),
        KEY user_id (user_id),
        KEY status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

    /* Analysis is the expensive half and the source never changes, so it is
       cached against the exact mp3_url it was measured from. Re-uploading the
       audio changes the url and invalidates the row on its own. */
    `CREATE TABLE IF NOT EXISTS song_analysis (
        song_id INT NOT NULL,
        mp3_url VARCHAR(255) NOT NULL,
        analysis MEDIUMTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (song_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
];

(async () => {
    try {
        for (const sql of STATEMENTS) {
            await pool.query(sql);
            logger.info('Applied mastering migration statement');
        }
        logger.info('Mastering tables are present');
    } catch (err) {
        logger.error('Error creating mastering tables:', err);
        process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
})();
