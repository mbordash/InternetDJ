/**
 * Station engine checks.  Run with:  node mobile/station.test.js
 *
 * Self-contained on purpose: a stub catalogue and a stub /similar live in this
 * file, so there is no server, no database and no network. The engine takes its
 * fetch and its storage as arguments precisely so this is possible.
 *
 * What it checks is what actually goes wrong in a radio, none of which is
 * visible by reading the code:
 *
 *   - the same track coming round again too soon
 *   - two tracks by the same artist back to back
 *   - the seed mix drifting away from the configured weights
 *
 * Both bugs found when this engine was first built were of that kind. If you
 * change QUEUE_TARGET, RECENT_MEMORY, DISCOVERY_RATE or TASTE_RATE, run this.
 */
const assert = require('assert');
const { Station, DISCOVERY_RATE, TASTE_RATE } = require('./station');

// --- stub catalogue -------------------------------------------------------
// Twelve artists, four tracks each, spread across tempos and keys the way a
// real catalogue is rather than uniformly.
const ARTISTS = ['Subspace', 'Ferrite', 'Null Pointer', 'Kolter', 'Vantablack', 'Mira Sound',
                 'Deep Rig', 'Halcyon', 'Static Bloom', 'Orbital Decay', 'Low End', 'Nine Volt'];
const KEYS = ['8A', '9A', '10A', '7A', '8B', '11B', '6A', '7B'];
const BPMS = [122, 124, 126, 128, 130, 132, 134, 174];

const CATALOGUE = [];
ARTISTS.forEach((artist, a) => {
    for (let k = 0; k < 4; k += 1) {
        const n = CATALOGUE.length;
        CATALOGUE.push({
            id: n + 1,
            title: `${artist} track ${k + 1}`,
            profile_id: a + 1,
            profile_name: artist,
            mp3_url: `https://example.test/${n}.mp3`,
            duration: 300 + n,
            bpm: BPMS[n % BPMS.length],
            camelot: KEYS[n % KEYS.length],
            match_reasons: ['also techno'],
        });
    }
});

const byId = (id) => CATALOGUE.find((t) => t.id === Number(id));

/**
 * Stands in for the API.
 *
 * The similar response deliberately mirrors the real one's two constraints,
 * because both shape the engine: at most eight results, and never the seed's
 * own artist.
 */
const makeFetch = (counter) => async (path) => {
    const similar = path.match(/^\/music\/(\d+)\/similar$/);
    if (similar) {
        counter.similar += 1;
        const seed = byId(similar[1]);
        // Ranked to a wide pool and then sampled, rather than always the same
        // eight nearest. The real endpoint pulls 200 candidates and scores them
        // on three signals with ties broken by plays, so different seeds return
        // genuinely different sets. A stub that always answers identically
        // exhausts its seeds unrealistically fast and pushes the engine outside
        // the chain more often than production would.
        const pool = CATALOGUE
            .filter((t) => t.profile_id !== seed.profile_id)
            .sort((a, b) => Math.abs(a.bpm - seed.bpm) - Math.abs(b.bpm - seed.bpm))
            .slice(0, 20);
        const songs = pool.sort(() => Math.random() - 0.5).slice(0, 8);
        return { songs, basis: { bpm: seed.bpm, camelot: seed.camelot } };
    }
    if (/^\/music\/(featured|most-played|latest)$/.test(path)) {
        counter.discovery += 1;
        return [...CATALOGUE].sort(() => Math.random() - 0.5).slice(0, 10);
    }
    if (/^\/music\/\d+$/.test(path)) {
        counter.hydrate += 1;
        return { song: byId(path.split('/').pop()) };
    }
    throw new Error(`unexpected path ${path}`);
};

const newStation = (counter) => {
    let saved = {};
    return new Station({
        fetchJson: makeFetch(counter),
        store: { load: async () => saved, save: async (t) => { saved = t; } },
    });
};

// --- the run --------------------------------------------------------------
(async () => {
    const RUNS = 8;
    const LENGTH = 30;
    const counter = { similar: 0, discovery: 0, hydrate: 0 };
    const seeds = { continuity: 0, taste: 0, discovery: 0 };
    let repeats = 0;
    let backToBack = 0;
    let missingUrl = 0;
    let total = 0;

    for (let run = 0; run < RUNS; run += 1) {
        const station = newStation(counter);
        await station.load();

        const seen = new Set();
        let previousArtist = null;

        for (let i = 1; i <= LENGTH; i += 1) {
            const track = await station.next();
            assert.ok(track, `station ran dry after ${i - 1} tracks`);

            total += 1;
            seeds[track.seededBy] += 1;
            if (seen.has(track.id)) repeats += 1;
            seen.add(track.id);
            if (track.artist === previousArtist) backToBack += 1;
            previousArtist = track.artist;
            if (!track.url) missingUrl += 1;

            assert.ok(station.because().length > 0, 'every track needs a reason line');

            if (i % 5 === 0) await station.record(track.id, { liked: true });
            else if (i % 7 === 0) await station.record(track.id, { skipped: true, playedMs: 3000 });
            else await station.record(track.id, { playedMs: 240000 });
        }
    }

    const share = (n) => n / total;
    const pct = (n) => `${Math.round(100 * share(n))}%`;

    console.log(`station: ${RUNS} runs x ${LENGTH} tracks = ${total}`);
    console.log(`  seeds        continuity ${pct(seeds.continuity)}  taste ${pct(seeds.taste)}  discovery ${pct(seeds.discovery)}`);
    console.log(`  repeats      ${repeats}`);
    console.log(`  same artist  ${backToBack} back to back`);
    console.log(`  no audio     ${missingUrl}`);
    console.log(`  requests     ${counter.similar} similar, ${counter.discovery} discovery, ${counter.hydrate} hydrate`);

    assert.strictEqual(repeats, 0, 'a track repeated inside a single run');
    assert.strictEqual(backToBack, 0, 'two tracks by the same artist played back to back');
    assert.strictEqual(missingUrl, 0, 'a track was handed over with no audio url');

    // /similar carries mp3_url now, so the per-track hydrate should never fire.
    assert.strictEqual(counter.hydrate, 0, 'hydrated a track that /similar already described');

    // Bounds rather than exact rates: the mix is random, and an exhausted seed
    // legitimately pushes the next pick outside the chain. These are wide
    // enough not to be flaky and tight enough to catch a weighting bug, which
    // is what doubled the discovery rate the first time round.
    assert.ok(share(seeds.discovery) < DISCOVERY_RATE * 2,
        `discovery ran at ${pct(seeds.discovery)}, far above its ${Math.round(DISCOVERY_RATE * 100)}% weight`);
    assert.ok(share(seeds.continuity) > 0.25,
        `continuity ran at ${pct(seeds.continuity)}; the station is not flowing`);
    assert.ok(share(seeds.taste) > TASTE_RATE / 3,
        `taste ran at ${pct(seeds.taste)}; likes are not steering the station`);

    console.log('\nall checks passed');
})().catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
});
