#!/usr/bin/env node

require('dotenv').config();
const pool = require('../config/database');

const parseArgs = () => {
    const args = process.argv.slice(2);
    const opts = {
        from: null,
        to: null,
        commit: false,
        recompute: false,
    };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--from') opts.from = args[i + 1];
        if (arg === '--to') opts.to = args[i + 1];
        if (arg === '--commit') opts.commit = true;
        if (arg === '--recompute') opts.recompute = true;
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

    console.log(`Processing ${dateRows.length} day(s), from ${from} to ${to}.`);
    if (!opts.commit) {
        console.log('Dry run mode. Re-run with --commit to write results.');
    }

    let rowsInserted = 0;
    let rowsUpdated = 0;
    let rowsSkipped = 0;
    let totalCoins = 0;

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
            const coinsEarned = Math.min(Math.floor(listensCount / 10), 10);

            if (coinsEarned <= 0) {
                rowsSkipped += 1;
                continue;
            }

            totalCoins += coinsEarned;

            if (!opts.commit) {
                continue;
            }

            if (opts.recompute) {
                const result = await pool.query(
                    `
                    INSERT INTO profile_earnings (profile_id, earnings_date, listens_count, coins_earned)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        listens_count = VALUES(listens_count),
                        coins_earned = VALUES(coins_earned)
                    `,
                    [profileId, earningsDate, listensCount, coinsEarned]
                );

                // MariaDB driver returns affectedRows=2 for update via upsert.
                if (result.affectedRows === 1) rowsInserted += 1;
                if (result.affectedRows === 2) rowsUpdated += 1;
            } else {
                const result = await pool.query(
                    `
                    INSERT IGNORE INTO profile_earnings (profile_id, earnings_date, listens_count, coins_earned)
                    VALUES (?, ?, ?, ?)
                    `,
                    [profileId, earningsDate, listensCount, coinsEarned]
                );

                if (result.affectedRows === 1) {
                    rowsInserted += 1;
                } else {
                    rowsSkipped += 1;
                }
            }
        }
    }

    console.log('Backfill complete.');
    console.log(`Estimated coins from scanned records: ${totalCoins}`);
    console.log(`Inserted rows: ${rowsInserted}`);
    if (opts.recompute) console.log(`Updated rows: ${rowsUpdated}`);
    console.log(`Skipped rows: ${rowsSkipped}`);
};

run()
    .catch((err) => {
        console.error('Backfill failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

