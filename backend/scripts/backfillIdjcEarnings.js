#!/usr/bin/env node
/**
 * Rebuilds daily-listen earnings from song_plays.
 *
 * Coins accrue against a profile's *lifetime* listens, not each day in
 * isolation, so this walks dates in ascending order and carries the running
 * totals forward. That is also why it recovers coins the old daily-floor rule
 * discarded: a profile that played 9 listens a day for a week earned nothing
 * under the old rule and earns 6 coins under this one.
 *
 * Both writes are idempotent. profile_earnings is keyed on
 * (profile_id, earnings_date) and the ledger on
 * (profile_id, activity_type, source_id), so re-running awards nothing twice.
 *
 * Dry run by default; --commit writes. The dry run simulates the same accrual
 * the commit would perform, so its numbers are real projections rather than
 * the structural zeros this script used to print.
 *
 * There is deliberately no --recompute. Rewriting historical coin amounts
 * would desynchronise them from the append-only ledger that now holds the
 * balances.
 */
require('dotenv').config();
const pool = require('../config/database');
const { ACTIVITY, listenCoinsToAward } = require('../config/coinRewards');
const { awardCoins, getEarnedForActivityByProfile } = require('../utils/coins');

const parseArgs = () => {
    const args = process.argv.slice(2);
    const opts = { from: null, to: null, commit: false };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--from') opts.from = args[i + 1];
        if (arg === '--to') opts.to = args[i + 1];
        if (arg === '--commit') opts.commit = true;
    }

    return opts;
};

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const toDateString = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().split('T')[0];
};

const getYesterday = () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 1);
    return toDateString(date);
};

const getDateBounds = async (fromArg, toArg) => {
    const to = toArg || getYesterday();
    if (!isValidDate(to)) {
        throw new Error('Invalid --to date. Use YYYY-MM-DD');
    }

    if (fromArg) {
        if (!isValidDate(fromArg)) {
            throw new Error('Invalid --from date. Use YYYY-MM-DD');
        }
        return { from: fromArg, to };
    }

    const rows = await pool.query(
        `SELECT DATE(MIN(played_at)) AS min_date, DATE(MAX(played_at)) AS max_date FROM song_plays`
    );

    if (!rows.length || !rows[0].min_date) {
        return { from: null, to };
    }

    return {
        from: toDateString(rows[0].min_date),
        to: toDateString(rows[0].max_date < new Date(to) ? rows[0].max_date : to),
    };
};

/**
 * Listens each profile accumulated strictly before the window starts. Zero for
 * a full-history run, but a --from run has to start from the real lifetime
 * total or it would re-grant coins the profile already holds.
 */
const getListensBefore = async (from) => {
    const rows = await pool.query(
        `
        SELECT s.profile_id, COUNT(*) AS listens_count
        FROM song_plays sp
        JOIN songs s ON s.id = sp.song_id
        WHERE DATE(sp.played_at) < ?
        GROUP BY s.profile_id
        `,
        [from]
    );

    const byProfile = new Map();
    for (const row of rows) {
        byProfile.set(Number(row.profile_id), Number(row.listens_count) || 0);
    }
    return byProfile;
};

const run = async () => {
    const opts = parseArgs();
    const { from, to } = await getDateBounds(opts.from, opts.to);

    if (!from) {
        console.log('No song plays found. Nothing to backfill.');
        return;
    }

    const dateRows = await pool.query(
        `
        SELECT DISTINCT DATE(played_at) AS earnings_date
        FROM song_plays
        WHERE DATE(played_at) BETWEEN ? AND ?
        ORDER BY earnings_date ASC
        `,
        [from, to]
    );

    if (!dateRows.length) {
        console.log(`No play records between ${from} and ${to}. Nothing to backfill.`);
        return;
    }

    const lifetimeByProfile = await getListensBefore(from);
    const grantedByProfile = await getEarnedForActivityByProfile(ACTIVITY.DAILY_LISTENS);
    const alreadyGranted = [...grantedByProfile.values()].reduce((sum, n) => sum + n, 0);

    console.log(`Processing ${dateRows.length} day(s), from ${from} to ${to}.`);
    console.log(`Coins already granted for listens: ${alreadyGranted}`);
    if (!opts.commit) {
        console.log('Dry run mode. Re-run with --commit to write results.');
    }

    let coinsAwarded = 0;
    let ledgerRows = 0;
    let historyRows = 0;
    const profilesTouched = new Set();

    for (const row of dateRows) {
        const earningsDate = toDateString(row.earnings_date);

        const profileListenRows = await pool.query(
            `
            SELECT s.profile_id, COUNT(*) AS listens_count
            FROM song_plays sp
            JOIN songs s ON s.id = sp.song_id
            WHERE DATE(sp.played_at) = ?
            GROUP BY s.profile_id
            `,
            [earningsDate]
        );

        for (const profileRow of profileListenRows) {
            const profileId = Number(profileRow.profile_id);
            const listensCount = Number(profileRow.listens_count) || 0;
            if (listensCount <= 0) continue;

            const lifetimeListens = (lifetimeByProfile.get(profileId) || 0) + listensCount;
            lifetimeByProfile.set(profileId, lifetimeListens);

            const granted = grantedByProfile.get(profileId) || 0;
            const coinsEarned = listenCoinsToAward(lifetimeListens, granted);

            profilesTouched.add(profileId);
            coinsAwarded += coinsEarned;
            // Track the simulated grant either way, so a dry run projects the
            // same accrual a commit would produce.
            grantedByProfile.set(profileId, granted + coinsEarned);

            if (!opts.commit) {
                continue;
            }

            const historyResult = await pool.query(
                `
                INSERT IGNORE INTO profile_earnings (profile_id, earnings_date, listens_count, coins_earned)
                VALUES (?, ?, ?, ?)
                `,
                [profileId, earningsDate, listensCount, coinsEarned]
            );
            if (historyResult.affectedRows === 1) historyRows += 1;

            const inserted = await awardCoins({
                profileId,
                activityType: ACTIVITY.DAILY_LISTENS,
                sourceId: earningsDate,
                coins: coinsEarned,
                metadata: { listens_count: listensCount, lifetime_listens: lifetimeListens, backfilled: true },
            });
            if (inserted) ledgerRows += 1;
        }
    }

    console.log(opts.commit ? 'Backfill complete.' : 'Dry run complete.');
    console.log(`Profiles affected: ${profilesTouched.size}`);
    console.log(`Coins ${opts.commit ? 'awarded' : 'that would be awarded'}: ${coinsAwarded}`);
    if (opts.commit) {
        console.log(`Ledger rows inserted: ${ledgerRows}`);
        console.log(`Listen history rows inserted: ${historyRows}`);
    }
};

run()
    .catch((err) => {
        console.error('Backfill failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
