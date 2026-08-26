/**
 * Lists the URLs worth pushing through Facebook's Sharing Debugger after the
 * share-card work deploys.
 *
 *   node backend/scripts/ogRescrapeList.js            # top 40, all sections
 *   node backend/scripts/ogRescrapeList.js --limit=100
 *   node backend/scripts/ogRescrapeList.js --section=songs
 *
 * Why this is needed at all: Facebook scrapes a URL once and caches the result
 * more or less indefinitely. Every link shared before this deploy was scraped
 * against a page that had no Open Graph tags, so Facebook is holding a blank
 * card for it — and re-sharing the same URL serves that cached blank rather
 * than re-fetching. The cache only clears when the URL is scraped again, which
 * is what the Sharing Debugger does:
 *
 *   https://developers.facebook.com/tools/debug/?q=<url>
 *
 * Paste a URL, press "Scrape Again", and the card is rebuilt from the tags the
 * server now serves. This script decides which URLs are worth that effort.
 *
 * Ordering is by plays, follower reach and recency rather than by id, because
 * the point is to fix the links most likely to be shared or re-shared next —
 * not to grind through the whole catalogue by hand.
 *
 * This script only reads, and prints. It deliberately does not call Facebook's
 * batch-invalidation API: that needs an app access token, and firing it is an
 * outward-facing action that should be a deliberate choice rather than a side
 * effect of asking what the list is.
 */
const pool = require('../config/database');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : fallback;
};

const LIMIT = parseInt(argValue('limit', '40'), 10);
if (!Number.isInteger(LIMIT) || LIMIT < 1) {
    // A NaN would reach the driver as a LIMIT placeholder and fail per-section,
    // which reads as "that query is broken" rather than "that flag is wrong".
    console.error(`--limit must be a positive integer, got: ${argValue('limit')}`);
    process.exit(1);
}
const ONLY = argValue('section', null);
const BASE = (process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL || 'https://internetdj.co').replace(/\/+$/, '');

const SECTIONS = {
    // Tracks are the unit people actually paste into a group. Most-played
    // first: those are the ones with existing shares to repair.
    songs: {
        title: 'Songs — most played',
        why: 'These have the most existing shares sitting on a blank cached card.',
        run: async (limit) => {
            const rows = await pool.query(`
                SELECT s.id, s.title, s.plays, p.name AS artist
                FROM songs s
                LEFT JOIN profiles p ON s.profile_id = p.id
                ORDER BY s.plays DESC, s.id DESC
                LIMIT ?
            `, [limit]);
            return rows.map(r => ({
                url: `${BASE}/song/${r.id}`,
                note: `${r.title || 'Untitled'} — ${r.artist || 'unknown artist'} (${Number(r.plays) || 0} plays)`,
            }));
        },
    },

    // Artist pages are the second thing shared, and the vanity-slug URL is the
    // one that was broken worst: it never produced a card at all, so both forms
    // are listed where a slug exists.
    profiles: {
        title: 'Artist profiles — most tracks',
        why: 'Vanity-slug URLs previously produced no card whatsoever. Where a slug exists, the slug URL is the canonical one and the one worth scraping.',
        run: async (limit) => {
            const rows = await pool.query(`
                SELECT p.id, p.slug, p.name, COUNT(s.id) AS tracks
                FROM profiles p
                JOIN songs s ON s.profile_id = p.id
                GROUP BY p.id, p.slug, p.name
                ORDER BY tracks DESC, p.id ASC
                LIMIT ?
            `, [limit]);
            return rows.flatMap(r => {
                const entries = [];
                if (r.slug) {
                    entries.push({
                        url: `${BASE}/profile/${r.slug}`,
                        note: `${r.name || 'unnamed'} (${Number(r.tracks)} tracks) — canonical slug URL, previously uncarded`,
                    });
                }
                entries.push({
                    url: `${BASE}/profile/${r.id}`,
                    note: `${r.name || 'unnamed'} (${Number(r.tracks)} tracks)${r.slug ? ' — numeric URL, for older shared links' : ''}`,
                });
                return entries;
            });
        },
    },

    // Crates had no card handling before this change at all.
    crates: {
        title: 'Public crates and mixtapes — recently updated',
        why: 'Crates were never handled by the crawler middleware, so every crate link ever shared is a blank card.',
        run: async (limit) => {
            const rows = await pool.query(`
                SELECT pl.id, pl.name, owner.name AS owner, COUNT(ps.song_id) AS tracks
                FROM playlists pl
                LEFT JOIN profiles owner ON pl.profile_id = owner.id
                JOIN playlist_songs ps ON ps.playlist_id = pl.id
                WHERE pl.is_public = TRUE
                GROUP BY pl.id, pl.name, owner.name
                ORDER BY pl.updated_at DESC
                LIMIT ?
            `, [limit]);
            return rows.map(r => ({
                url: `${BASE}/crate/${r.id}`,
                note: `${r.name || 'Untitled crate'} by ${r.owner || 'unknown'} (${Number(r.tracks)} tracks)`,
            }));
        },
    },

    forum: {
        title: 'Forum threads — most commented',
        why: 'Also previously uncarded. Busy threads are the ones that get linked back into chat.',
        run: async (limit) => {
            const rows = await pool.query(`
                SELECT fp.id, fp.title, COUNT(fc.id) AS comments
                FROM forum_posts fp
                LEFT JOIN forum_comments fc ON fc.post_id = fp.id
                GROUP BY fp.id, fp.title
                ORDER BY comments DESC, fp.updated_at DESC
                LIMIT ?
            `, [limit]);
            return rows.map(r => ({
                url: `${BASE}/forum/post/${r.id}`,
                note: `${r.title || 'Untitled'} (${Number(r.comments)} comments)`,
            }));
        },
    },

    // Entry points: shared less often, but they are what a "come back to
    // InternetDJ" post links to, so they are worth scraping once each.
    landing: {
        title: 'Landing pages',
        why: 'Low volume, but these are what an invite post links to. Scrape once each.',
        run: async () => ['', '/discover', '/browse', '/new', '/crates', '/forum', '/about']
            .map(p => ({ url: `${BASE}${p || '/'}`, note: 'entry point' })),
    },
};

const main = async () => {
    const wanted = ONLY ? [ONLY] : Object.keys(SECTIONS);
    const unknown = wanted.filter(s => !SECTIONS[s]);
    if (unknown.length) {
        console.error(`Unknown section(s): ${unknown.join(', ')}`);
        console.error(`Available: ${Object.keys(SECTIONS).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    console.log(`Facebook re-scrape list for ${BASE}`);
    console.log(`Debugger: https://developers.facebook.com/tools/debug/?q=<url>\n`);

    let total = 0;
    for (const name of wanted) {
        const section = SECTIONS[name];
        let entries;
        try {
            entries = await section.run(LIMIT);
        } catch (err) {
            console.log(`## ${section.title}\n   (skipped — query failed: ${err.message})\n`);
            continue;
        }

        console.log(`## ${section.title}  [${entries.length}]`);
        console.log(`   ${section.why}\n`);
        entries.forEach(e => {
            console.log(`   ${e.url}`);
            console.log(`       ${e.note}`);
        });
        console.log('');
        total += entries.length;
    }

    console.log(`${total} URLs listed.`);
    console.log('Scrape the songs and profiles sections first — they carry the most existing shares.');
};

main()
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
