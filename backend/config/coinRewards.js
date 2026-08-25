/**
 * Single source of truth for every IDJC coin reward on the site.
 *
 * These numbers are policy, so they live in git where a change is reviewable
 * and attributable — not in a database row that can be edited without a trace.
 * Earned coins are a real liability: profiles show `unpaid = earned - paid`,
 * and payouts are settled by hand as on-chain SPL transfers, so raising a rate
 * here raises what the treasury owes.
 *
 * Before this module existed the listen formula was duplicated verbatim in the
 * nightly cron and the backfill script, and the two drifted apart. Anything
 * that awards coins must read its numbers from here.
 */

// Activity identifiers. These are persisted in coin_events.activity_type, so
// renaming one is a data migration, not a rename.
const ACTIVITY = {
    DAILY_LISTENS: 'daily_listens',
};

const REWARDS = {
    /**
     * Plays of a profile's songs.
     *
     * `listensPerCoin` is an exchange rate applied to a profile's *lifetime*
     * listen count, not to each day in isolation. Flooring a single day's
     * listens threw the remainder away every night, and at this site's traffic
     * (~3 listens per profile per day) that meant almost every profile earned
     * zero almost every day. Accruing against the lifetime total keeps the same
     * 10:1 rate while letting listens accumulate across days until they cross
     * the next coin.
     *
     * `dailyCap` still bounds how fast a profile can realise that entitlement,
     * so a backlog or a farming run drips out rather than landing at once.
     */
    [ACTIVITY.DAILY_LISTENS]: {
        listensPerCoin: 10,
        dailyCap: 10,
    },
};

/**
 * Coins a profile is entitled to for its lifetime listens, before any cap.
 */
const entitlementForListens = (lifetimeListens) => {
    const { listensPerCoin } = REWARDS[ACTIVITY.DAILY_LISTENS];
    const listens = Number(lifetimeListens) || 0;
    if (listens <= 0) {
        return 0;
    }
    return Math.floor(listens / listensPerCoin);
};

/**
 * How many coins to award now, given lifetime listens and what has already
 * been granted. Self-correcting: running it twice awards nothing the second
 * time, and remainders discarded by the old daily-floor rule are recovered on
 * subsequent runs (rate-limited by dailyCap).
 */
const listenCoinsToAward = (lifetimeListens, coinsAlreadyGranted) => {
    const { dailyCap } = REWARDS[ACTIVITY.DAILY_LISTENS];
    const outstanding = entitlementForListens(lifetimeListens) - (Number(coinsAlreadyGranted) || 0);
    if (outstanding <= 0) {
        return 0;
    }
    return Math.min(outstanding, dailyCap);
};

module.exports = {
    ACTIVITY,
    REWARDS,
    entitlementForListens,
    listenCoinsToAward,
};
