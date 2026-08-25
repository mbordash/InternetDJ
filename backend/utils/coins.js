/**
 * Coin ledger helpers.
 *
 * Every coin a profile earns is one row in `coin_events`. The unique key on
 * (profile_id, activity_type, source_id) makes awards idempotent by
 * construction: replaying a night, re-running a backfill, or two cron machines
 * racing all converge on the same balance instead of double-granting.
 *
 * `source_id` is whatever makes the award unique for that activity — an
 * earnings date for daily listens, a review id for a review, a follow id for a
 * follow. It is a string so different activities can key on different things.
 */
const pool = require('../config/database');

/**
 * Record a coin award. Returns true if this call created the row, false if the
 * award already existed and was ignored.
 */
const awardCoins = async ({ profileId, activityType, sourceId, coins, metadata = null }) => {
    const amount = Number(coins) || 0;
    if (amount <= 0) {
        // Zero-coin events are noise in an audit trail. The listens history
        // that produced them is kept in profile_earnings.
        return false;
    }

    const result = await pool.query(
        `
        INSERT IGNORE INTO coin_events (profile_id, activity_type, source_id, coins, metadata)
        VALUES (?, ?, ?, ?, ?)
        `,
        [profileId, activityType, String(sourceId), amount, metadata ? JSON.stringify(metadata) : null]
    );

    return result.affectedRows === 1;
};

/**
 * Total coins a profile has ever earned, across every activity.
 */
const getTotalEarned = async (profileId) => {
    const rows = await pool.query(
        'SELECT COALESCE(SUM(coins), 0) AS total FROM coin_events WHERE profile_id = ?',
        [profileId]
    );
    return Number(rows[0].total) || 0;
};

/**
 * Coins a profile has earned from one activity. Used by accrual rules that
 * need to know what they have already granted before deciding what to grant
 * now.
 */
const getEarnedForActivity = async (profileId, activityType) => {
    const rows = await pool.query(
        'SELECT COALESCE(SUM(coins), 0) AS total FROM coin_events WHERE profile_id = ? AND activity_type = ?',
        [profileId, activityType]
    );
    return Number(rows[0].total) || 0;
};

/**
 * Same as getEarnedForActivity, but for every profile at once. The nightly job
 * runs across all profiles, and one query beats one per profile.
 */
const getEarnedForActivityByProfile = async (activityType) => {
    const rows = await pool.query(
        `
        SELECT profile_id, COALESCE(SUM(coins), 0) AS total
        FROM coin_events
        WHERE activity_type = ?
        GROUP BY profile_id
        `,
        [activityType]
    );

    const byProfile = new Map();
    for (const row of rows) {
        byProfile.set(Number(row.profile_id), Number(row.total) || 0);
    }
    return byProfile;
};

module.exports = {
    awardCoins,
    getTotalEarned,
    getEarnedForActivity,
    getEarnedForActivityByProfile,
};
