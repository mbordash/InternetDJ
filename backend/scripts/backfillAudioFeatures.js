/**
 * Sweeps existing songs into tempo/key analysis, so tracks uploaded before
 * detection existed get their fields populated too.
 *
 *   node backend/scripts/backfillAudioFeatures.js --status
 *   node backend/scripts/backfillAudioFeatures.js --dry-run
 *   node backend/scripts/backfillAudioFeatures.js --limit 100
 *   node backend/scripts/backfillAudioFeatures.js --limit 20 --inline
 *   node backend/scripts/backfillAudioFeatures.js --limit 100 --retry-failed
 *   node backend/scripts/backfillAudioFeatures.js --reset-stuck
 *   node backend/scripts/backfillAudioFeatures.js --song 123
 *   node backend/scripts/backfillAudioFeatures.js --song 123 --inline
 *
 * Modes:
 *   --status   report only: what the database holds, what the queue holds, and
 *              whether anything is draining it. Start here.
 *   --dry-run  list what would be processed, change nothing.
 *   (default)  hand songs to the analysis worker via the queue.
 *   --inline   analyse in this process instead of queueing. Slower and serial,
 *              but it needs no worker running and prints each result as it
 *              goes, so it both works and shows its working.
 *   --song ID  report what is stored for one song, whatever its status. Add
 *              --inline to analyse just that song immediately. This is the
 *              answer to "why is the tempo blank on THIS track".
 *   --reset-stuck
 *              put 'queued' and 'analyzing' rows back to 'pending'. Use when
 *              jobs were queued but never ran, which now means the song's row
 *              says 'queued' while nothing matching it is left in job_queue -
 *              a status the sweep deliberately does not touch on its own,
 *              because it cannot tell a lost job from one that is about to be
 *              picked up.
 *
 * Bounded by --limit (default 200) on purpose: run it a few times and watch,
 * rather than dumping the whole catalogue into the queue at once. Queued
 * backfill jobs sit at a lower priority than fresh uploads, so a sweep never
 * makes a member wait on their own upload.
 *
 * Safe to re-run: songs are marked 'queued' as they are enqueued, so a second
 * run continues rather than queueing everything twice.
 */
const pool = require('../config/database');
const { out, warnOut, errOut, finish, pad } = require('../utils/cli');
const {
    enqueueSongAnalysis, closeQueue, ANALYSIS_QUEUE_NAME,
    getAnalysisCounts, getAnalysisFailures,
} = require('../utils/analysisQueue');
const { analyzeSong } = require('../utils/songAnalysis');

const DEFAULT_LIMIT = 200;

function parseArgs(argv) {
    const args = {
        limit: DEFAULT_LIMIT, dryRun: false, retryFailed: false,
        inline: false, status: false, resetStuck: false, songId: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--retry-failed') args.retryFailed = true;
        else if (arg === '--inline') args.inline = true;
        else if (arg === '--status') args.status = true;
        else if (arg === '--reset-stuck') args.resetStuck = true;
        else if (arg === '--song') args.songId = parseInt(argv[++i], 10);
        else if (arg.startsWith('--song=')) args.songId = parseInt(arg.split('=')[1], 10);
        else if (arg === '--limit') args.limit = parseInt(argv[++i], 10);
        else if (arg.startsWith('--limit=')) args.limit = parseInt(arg.split('=')[1], 10);
        else {
            errOut(`Unknown argument: ${arg}`);
            errOut('Usage: backfillAudioFeatures.js [--status] [--dry-run] [--inline]');
            errOut('                                   [--retry-failed] [--reset-stuck]');
            errOut('                                   [--song ID] [--limit N]');
            return null;
        }
    }
    if (!Number.isFinite(args.limit) || args.limit < 1) {
        errOut('--limit must be a positive number');
        return null;
    }
    if (args.songId !== null && (!Number.isFinite(args.songId) || args.songId < 1)) {
        errOut('--song must be a song id');
        return null;
    }
    return args;
}

/** Counts straight from the songs table: what is stored, not what is queued. */
async function reportDatabase() {
    const rows = await pool.query(
        `SELECT analysis_status AS status, COUNT(*) AS count
         FROM songs GROUP BY analysis_status ORDER BY status`
    );
    const totals = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(bpm IS NOT NULL) AS withBpm,
                SUM(musical_key IS NOT NULL) AS withKey,
                SUM(duration IS NOT NULL) AS withDuration
         FROM songs`
    );

    out('Database');
    out(`  songs total          ${Number(totals[0].total)}`);
    out(`  with bpm             ${Number(totals[0].withBpm || 0)}`);
    out(`  with key             ${Number(totals[0].withKey || 0)}`);
    out(`  with duration        ${Number(totals[0].withDuration || 0)}`);
    out('  analysis_status:');
    if (!rows.length) {
        out('    (no songs)');
    }
    for (const row of rows) {
        out(`    ${pad(row.status, 18)} ${Number(row.count)}`);
    }
    return rows;
}

/**
 * Counts from the job_queue table, which is what says whether anything is
 * consuming jobs. Completed jobs are deleted rather than counted, so unlike the
 * old Redis-backed report there is no "completed" total to lean on; what stands
 * in for it is the songs table above, where a drained queue shows up as rows
 * moving to 'done'.
 */
async function reportQueue() {
    out('');
    out(`Queue "${ANALYSIS_QUEUE_NAME}"`);
    let counts;
    try {
        counts = await getAnalysisCounts();
    } catch (err) {
        errOut(`  could not read the job queue: ${err.message}`);
        errOut('  If the job_queue table is missing, run:');
        errOut('    node backend/scripts/migrateJobQueue.js');
        return null;
    }

    for (const [name, value] of Object.entries(counts)) {
        out(`  ${pad(name, 18)} ${value}`);
    }

    const failed = await getAnalysisFailures(4);
    if (failed.length) {
        out('  recent failures:');
        for (const job of failed) {
            out(`    song ${pad(job.data?.songId, 8)} ${job.last_error || 'unknown reason'}`);
        }
    }

    // The whole point of this command: say plainly whether work is stuck.
    out('');
    if (counts.waiting > 0 && counts.active === 0) {
        warnOut(`${counts.waiting} job(s) are due and nothing has picked them up.`);
        warnOut('Either the analysis worker is not running, or it has only just');
        warnOut('started. Re-run --status: if the number has not moved, check that');
        warnOut('"analysisworker" is listed under [processes] in fly.toml and that its');
        warnOut('machine is running (fly status). Defining [processes] makes fly ignore');
        warnOut('the dockerfile CMD, so a worker missing from that list never starts.');
        warnOut('To make progress right now without it: --reset-stuck then --inline.');
    } else if (counts.waiting > 0) {
        out(`${counts.waiting} job(s) still waiting, ${counts.active} in progress. A worker is running; re-run --status to watch it drain.`);
    } else if (counts.active > 0) {
        out(`${counts.active} job(s) in progress, none waiting.`);
    } else if (counts.delayed > 0) {
        out(`${counts.delayed} job(s) waiting on a retry backoff, none due yet.`);
    } else {
        out('Queue is empty.');
    }
    return counts;
}

/** Everything known about one song's analysis, for "why is this one blank". */
async function reportSong(songId, inline) {
    const rows = await pool.query(
        `SELECT id, title, mp3_url, bpm, musical_key, duration, analysis_status
         FROM songs WHERE id = ?`,
        [songId]
    );
    out('');
    if (!rows.length) {
        errOut(`No song with id ${songId}.`);
        return false;
    }
    const song = rows[0];
    out(`Song #${song.id} — ${song.title || '(untitled)'}`);
    out(`  analysis_status      ${song.analysis_status}`);
    out(`  bpm                  ${song.bpm ?? '(not set)'}`);
    out(`  musical_key          ${song.musical_key ?? '(not set)'}`);
    out(`  duration             ${song.duration ?? '(not set)'}`);
    out(`  has audio            ${song.mp3_url ? 'yes' : 'NO — nothing to analyse'}`);

    // Say what the status actually means for this row, rather than making
    // someone map a status onto a cause themselves.
    out('');
    switch (song.analysis_status) {
        case 'pending':
            out('This song has never been analysed. The sweep is bounded by --limit,');
            out('so songs beyond that limit stay pending until a later run.');
            break;
        case 'queued':
            out('Queued but not yet processed. If it never moves, the worker is not');
            out('running (see --status) or its job was dropped (see --reset-stuck).');
            break;
        case 'analyzing':
            out('Marked in progress. If it is stuck here, the worker died mid-job;');
            out('--reset-stuck will put it back in line.');
            break;
        case 'failed':
            out('Analysis failed for this song. --retry-failed will try again,');
            out('or run with --inline below to see the actual error.');
            break;
        case 'done':
            if (song.bpm === null && song.musical_key === null) {
                out('Analysed, but neither reading was confident enough to store.');
            } else if (song.musical_key === null) {
                out('Analysed. Tempo stored; the key was not confident enough — common');
                out('for percussive or atonal tracks. The artist can set it by hand.');
            } else if (song.bpm === null) {
                out('Analysed. Key stored; no steady tempo was found.');
            } else {
                out('Analysed and both readings stored. If the edit form still shows');
                out('these blank, that is a frontend problem, not a data one.');
            }
            break;
        default:
            break;
    }

    if (!inline) {
        out('');
        out(`To analyse this song right now: --song ${song.id} --inline`);
        return true;
    }
    if (!song.mp3_url) return false;

    await runInline([song]);
    return true;
}

async function selectSongs(statuses, limit) {
    // One placeholder per status: the mariadb driver does not expand an array
    // into an IN list. LIMIT is interpolated because it cannot be bound here,
    // which is safe only because parseArgs already proved it is an integer.
    const placeholders = statuses.map(() => '?').join(', ');
    return pool.query(
        `SELECT id, title, analysis_status FROM songs
         WHERE analysis_status IN (${placeholders})
           AND mp3_url IS NOT NULL AND mp3_url <> ''
         ORDER BY id DESC
         LIMIT ${limit}`,
        statuses
    );
}

async function runInline(songs) {
    out('');
    out(`Analysing ${songs.length} song(s) in this process. Ctrl-C is safe to use.`);
    out('');

    let done = 0;
    let blank = 0;
    let failed = 0;

    for (const [index, song] of songs.entries()) {
        const label = `[${index + 1}/${songs.length}] #${song.id} ${song.title || '(untitled)'}`;
        try {
            const started = Date.now();
            const result = await analyzeSong(song.id);
            const ms = Date.now() - started;

            if (result.skipped) {
                out(`${label} — skipped: ${result.reason}`);
                continue;
            }
            done++;

            const bpmText = result.storedBpm !== null
                ? `${Math.round(result.storedBpm)} BPM`
                : `no BPM stored (best guess ${result.detectedBpm ?? 'none'}, confidence ${result.bpmConfidence})`;
            const keyText = result.storedKey !== null
                ? result.storedKey + (result.keyAlternative ? ` (or ${result.keyAlternative})` : '')
                : `no key stored (best guess ${result.detectedKey ?? 'none'}, confidence ${result.keyConfidence})`;

            if (result.storedBpm === null || result.storedKey === null) blank++;
            out(`${label} — ${bpmText}, ${keyText}, ${Math.round(result.durationSec)}s [${ms}ms]`);
        } catch (err) {
            failed++;
            errOut(`${label} — FAILED: ${err.message}`);
        }
    }

    out('');
    out(`Analysed ${done}, failed ${failed}.`);
    if (blank) {
        out(`${blank} song(s) stored a blank for tempo or key: detection was not confident`);
        out('enough to be worth showing. Artists can fill those in from Manage Songs.');
    }
    if (failed) {
        out('Re-run with --retry-failed to try the failures again.');
    }
}

async function runQueued(songs) {
    out('');
    let queued = 0;
    for (const song of songs) {
        const ok = await enqueueSongAnalysis(song.id, { backfill: true });
        if (!ok) {
            // enqueueSongAnalysis logs the reason. Leave the row alone so the
            // next run retries it.
            errOut(`#${song.id} could not be queued`);
            continue;
        }
        await pool.query("UPDATE songs SET analysis_status = 'queued' WHERE id = ?", [song.id]);
        queued++;
        out(`queued #${pad(song.id, 8)} ${song.title || '(untitled)'}`);
    }

    out('');
    out(`Queued ${queued} of ${songs.length} song(s).`);
    if (queued < songs.length) {
        warnOut(`${songs.length - queued} could not be queued; re-run to retry.`);
    }
    out('These are now waiting for the analysisworker process. Check on them with:');
    out('  node backend/scripts/backfillAudioFeatures.js --status');
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args) {
        await finish(1, [closeQueue]);
        return;
    }

    try {
        await reportDatabase();

        if (args.status) {
            await reportQueue();
            await finish(0, [closeQueue]);
            return;
        }

        if (args.songId !== null) {
            const ok = await reportSong(args.songId, args.inline);
            await finish(ok ? 0 : 1, [closeQueue]);
            return;
        }

        if (args.resetStuck) {
            const result = await pool.query(
                `UPDATE songs SET analysis_status = 'pending'
                 WHERE analysis_status IN ('queued', 'analyzing')`
            );
            const moved = Number(result.affectedRows) || 0;
            out('');
            out(`Moved ${moved} song(s) from queued/analyzing back to pending.`);
            if (moved) {
                out('They will be picked up by the next sweep:');
                out(`  node backend/scripts/backfillAudioFeatures.js --limit ${args.limit} --inline`);
            }
            await finish(0, [closeQueue]);
            return;
        }

        // 'analyzing' is deliberately excluded: a job mid-flight, or one that
        // died mid-flight, should be looked at rather than silently re-queued.
        const statuses = args.retryFailed ? ['pending', 'failed'] : ['pending'];
        const songs = await selectSongs(statuses, args.limit);

        out('');
        out(`Looking for songs with analysis_status in (${statuses.join(', ')}), limit ${args.limit}.`);

        if (!songs.length) {
            out('Nothing to do — no songs are waiting for analysis.');
            out('If you expected some, check the analysis_status counts above:');
            out('  everything "done" means the sweep already ran;');
            out('  anything "failed" needs --retry-failed;');
            out('  anything "queued" is waiting on the worker (see --status).');
            await finish(0, [closeQueue]);
            return;
        }

        out(`Found ${songs.length} song(s).`);

        if (args.dryRun) {
            out('');
            out('Dry run — nothing will be changed. Would process:');
            for (const song of songs) {
                out(`  #${pad(song.id, 8)} ${pad(song.analysis_status, 10)} ${song.title || '(untitled)'}`);
            }
            await finish(0, [closeQueue]);
            return;
        }

        if (args.inline) {
            await runInline(songs);
        } else {
            await runQueued(songs);
        }
    } catch (err) {
        errOut(`Error backfilling audio features: ${err.message}`);
        errOut(err.stack);
        await finish(1, [closeQueue]);
        return;
    }

    await finish(0, [closeQueue]);
})();
