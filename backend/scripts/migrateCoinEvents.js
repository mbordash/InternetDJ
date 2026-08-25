/**
 * Creates the coin ledger and seeds it from the existing daily-listen
 * earnings. schema.sql only runs when the database container initialises from
 * empty, so an existing deployment needs this run once by hand:
 *   node backend/scripts/migrateCoinEvents.js
 *
 * Safe to re-run - the table is IF NOT EXISTS and the seed is INSERT IGNORE
 * against the ledger's unique key.
 *
 * After this runs, coin_events is the source of truth for coin balances.
 * profile_earnings keeps its role as the per-day listen history; its
 * coins_earned column stays populated so the two can be reconciled, but totals
 * are read from the ledger.
 */
const pool = require('../config/database');
const logger = require('../utils/logger');
const { ACTIVITY } = require('../config/coinRewards');

const CREATE_TABLE = `
    CREATE TABLE IF NOT EXISTS coin_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_id INT NOT NULL,
        activity_type VARCHAR(50) NOT NULL,
        source_id VARCHAR(100) NOT NULL,
        coins INT NOT NULL,
        metadata TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_profile_activity_source (profile_id, activity_type, source_id),
        KEY idx_profile (profile_id),
        KEY idx_activity (activity_type),
        CONSTRAINT coin_events_ibfk_1 FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

// Seeds one ledger row per historical earnings row that actually paid coins.
// DATE_FORMAT pins source_id to the same YYYY-MM-DD string the nightly job
// writes, so a re-run collides on the unique key instead of duplicating.
const SEED_FROM_EARNINGS = `
    INSERT IGNORE INTO coin_events (profile_id, activity_type, source_id, coins, created_at)
    SELECT profile_id, ?, DATE_FORMAT(earnings_date, '%Y-%m-%d'), coins_earned, created_at
    FROM profile_earnings
    WHERE coins_earned > 0
`;

(async () => {
    try {
        await pool.query(CREATE_TABLE);
        console.log('coin_events table is present');

        const seeded = await pool.query(SEED_FROM_EARNINGS, [ACTIVITY.DAILY_LISTENS]);
        console.log(`Seeded coin ledger from profile_earnings: ${Number(seeded.affectedRows) || 0} row(s) inserted`);

        const [totals] = await pool.query(
            `
            SELECT
                (SELECT COALESCE(SUM(coins_earned), 0) FROM profile_earnings) AS earnings_total,
                (SELECT COALESCE(SUM(coins), 0) FROM coin_events) AS ledger_total
            `
        );

        const earningsTotal = Number(totals.earnings_total) || 0;
        const ledgerTotal = Number(totals.ledger_total) || 0;

        if (earningsTotal === ledgerTotal) {
            console.log(`Ledger reconciles with profile_earnings: ${ledgerTotal} coins`);
        } else {
            // Not fatal — a future activity will legitimately push the ledger
            // above the listens history — but on the first run they must match.
            console.warn(`Ledger does not match profile_earnings: earnings=${earningsTotal} ledger=${ledgerTotal}`);
        }
    } catch (err) {
        logger.error('Coin ledger migration failed:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
