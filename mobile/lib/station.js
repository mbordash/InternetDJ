/**
 * InternetDJ station engine.
 *
 * Turns the existing public API into an endless, personalised radio with no
 * account behind it. Everything it knows about the listener lives on the
 * device; the server is only ever asked "what goes with this track".
 *
 * The whole thing rests on GET /music/:songId/similar, which already ranks on
 * shared genre tags, compatible key and mixable tempo, and hands back the
 * reasons in words. So this file does not score anything. Its job is the part
 * the endpoint cannot do: choosing what to ask about next, and not playing the
 * same eight tracks forever.
 *
 * Deliberately free of React Native imports so it can be unit tested in node
 * and dropped into Expo unchanged. Both of its dependencies are injected:
 *
 *   fetchJson(path)  -> parsed JSON from the API
 *   store            -> { load(), save(taste) }, backed by AsyncStorage on the
 *                       device and by anything at all in a test
 */

// Keep this many tracks queued ahead of the one playing. Three is enough to
// cover a skip and a prefetch without building a long queue that goes stale as
// the listener's taste moves.
const QUEUE_TARGET = 3;

// Do not repeat a track until this many others have gone by. The catalogue is
// finite, so this is a ring rather than a permanent ban: on a small catalogue
// the station would otherwise dead-end instead of looping gracefully.
const RECENT_MEMORY = 40;

// How often to seed from outside the similarity chain.
//
// This is the single most important number here. Chaining similar -> similar
// -> similar drifts: forty minutes in, a techno station is playing ambient,
// because each step was a small move and they all pointed the same way. Worse,
// on a catalogue this size the chain closes into a loop of the same dozen
// tracks. Breaking the chain one time in four fixes both, at the cost of the
// occasional track that does not beatmatch the one before it. That is what
// radio sounds like.
const DISCOVERY_RATE = 0.25;

// And how often to pull back toward what the listener has actually liked,
// rather than what merely sounds like the last thing played.
const TASTE_RATE = 0.3;

// A track abandoned this fast was not skipped for being a bad mix, it was
// disliked. Past this it counts as played.
const SKIP_MS = 20000;

const EMPTY_TASTE = { liked: [], disliked: [], played: [] };

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Where a cold station starts.
 *
 * No account means no listening history on the first run, so the opening seed
 * comes from the catalogue rather than the listener. Featured is tried first
 * because it is curated; most-played is the fallback that always has rows.
 */
const COLD_START = ['/music/featured', '/music/most-played', '/music/latest'];

class Station {
    constructor({ fetchJson, store, genre = null }) {
        this.fetchJson = fetchJson;
        this.store = store;
        this.genre = genre;          // optional: pin the station to one tag

        this.queue = [];
        this.current = null;
        this.recent = [];            // ids, newest last, capped at RECENT_MEMORY
        this.taste = { ...EMPTY_TASTE };
        this.lastReasons = [];       // why the current track followed the last
        /**
         * Set when a seed runs out of candidates, to push the next pick outside
         * the chain. It exists because `current` cannot do that job: `current`
         * is also what is playing, and refill runs in the background after
         * next() returns, so clearing it there blanked the reason line under a
         * track that was still playing.
         */
        this.forceDiscovery = false;
    }

    async load() {
        this.taste = { ...EMPTY_TASTE, ...(await this.store.load()) };
    }

    // ---------------------------------------------------------------- taste

    /**
     * Record what the listener did with a track.
     *
     * Held to a bounded size on purpose: this is a taste profile, not a
     * listening log, and an unbounded array on a phone is a slow leak. The
     * newest signals are the ones that should steer the station anyway.
     */
    async record(songId, { playedMs = 0, liked = false, skipped = false } = {}) {
        const id = Number(songId);
        const drop = (list) => list.filter((x) => x !== id);

        if (liked) {
            this.taste.liked = [...drop(this.taste.liked), id].slice(-60);
            this.taste.disliked = drop(this.taste.disliked);
        } else if (skipped && playedMs < SKIP_MS) {
            this.taste.disliked = [...drop(this.taste.disliked), id].slice(-60);
        } else if (playedMs >= SKIP_MS) {
            this.taste.played = [...drop(this.taste.played), id].slice(-120);
        }

        await this.store.save(this.taste);
    }

    // --------------------------------------------------------------- seeding

    /**
     * Which track to ask the server about next.
     *
     * Three sources, weighted. Continuity is the default because a station
     * should flow, but it is never the only source or the chain drifts and
     * then closes on itself.
     */
    async chooseSeed() {
        // Built as a weight table rather than a chain of comparisons, because
        // two of the three sources are not always available and the shares have
        // to add up either way. An earlier version tested cumulative ranges by
        // hand and leaked every unavailable source's share to discovery, which
        // ran discovery at nearly twice its configured rate on a cold station -
        // audible as a run of tracks that did not follow each other at all.
        const sources = [];
        if (this.taste.liked.length) sources.push(['taste', TASTE_RATE]);
        // A seed that just ran dry takes continuity off the table for one pick.
        if (this.current && !this.forceDiscovery) {
            sources.push(['continuity', 1 - DISCOVERY_RATE - TASTE_RATE]);
        }
        this.forceDiscovery = false;
        sources.push(['discovery', DISCOVERY_RATE]);

        const total = sources.reduce((sum, [, weight]) => sum + weight, 0);
        let roll = Math.random() * total;
        let chosen = 'discovery';
        for (const [name, weight] of sources) {
            if (roll < weight) { chosen = name; break; }
            roll -= weight;
        }

        if (chosen === 'taste') return { id: pick(this.taste.liked), why: 'taste' };
        if (chosen === 'continuity') return { id: this.current.id, why: 'continuity' };

        const discovered = await this.discover();
        if (discovered) return { id: discovered, why: 'discovery' };
        // Nothing new to reach for: carry on from where we are rather than stop.
        if (this.current) return { id: this.current.id, why: 'continuity' };
        return null;
    }

    /** A track from outside the chain, used to break drift and closed loops. */
    async discover() {
        const paths = this.genre
            ? [`/music/by-tag/${encodeURIComponent(this.genre)}`, ...COLD_START]
            : COLD_START;

        for (const path of paths) {
            try {
                const body = await this.fetchJson(path);
                // These endpoints disagree about their envelope: some answer a
                // bare array, /recent answers sections, /by-tag answers {songs}.
                const rows = Array.isArray(body)
                    ? body
                    : body.songs || body.justAdded || [];
                const fresh = rows.filter((r) =>
                    !this.isRecent(r.id) && Number(r.profile_id) !== this.lastArtistId());
                if (fresh.length) return Number(pick(fresh).id);
            } catch {
                // A dead section must not kill the station; try the next one.
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- queue

    isRecent(id) {
        return this.recent.includes(Number(id));
    }

    /** The artist whose track will play immediately before the next one. */
    lastArtistId() {
        const tail = this.queue.length ? this.queue[this.queue.length - 1] : this.current;
        return tail ? Number(tail.profileId) : null;
    }

    remember(id) {
        this.recent = [...this.recent.filter((x) => x !== Number(id)), Number(id)]
            .slice(-RECENT_MEMORY);
    }

    /**
     * Top the queue back up.
     *
     * Asks about one seed at a time rather than fetching a long queue up front,
     * so the station responds to a like or a skip on the very next track
     * instead of playing out something chosen five tracks ago.
     */
    async refill() {
        let guard = 0;

        while (this.queue.length < QUEUE_TARGET && guard < 8) {
            guard += 1;

            const seed = await this.chooseSeed();
            if (!seed) break;

            let body;
            try {
                body = await this.fetchJson(`/music/${seed.id}/similar`);
            } catch {
                continue;
            }

            const candidates = (body.songs || []).filter((song) =>
                !this.isRecent(song.id)
                && !this.taste.disliked.includes(Number(song.id))
                && !this.queue.some((q) => q.id === Number(song.id))
                // Never twice in a row. /similar already excludes the seed's
                // own artist, but the seed is often a liked track or a
                // discovery rather than what is playing, so the endpoint's
                // exclusion is not the one that matters here.
                && Number(song.profile_id) !== this.lastArtistId());

            if (!candidates.length) {
                // This seed is exhausted. Force the next pass outside the chain
                // rather than asking the same question again. Note this must not
                // clear `current`: that is the track playing right now, and this
                // runs in the background while it plays.
                this.forceDiscovery = true;
                continue;
            }

            // Weighted toward the top of the ranking without being deterministic,
            // so two listeners on the same seed do not hear an identical station
            // and one track cannot dominate every rotation.
            const take = candidates[Math.floor(Math.random() ** 2 * candidates.length)];

            this.queue.push({
                id: Number(take.id),
                title: take.title,
                artist: take.profile_name,
                profileId: take.profile_id,
                image: take.image_url,
                bpm: take.bpm,
                key: take.camelot || take.musical_key,
                reasons: take.match_reasons || [],
                seededBy: seed.why,
                url: take.mp3_url || null,
                duration: take.duration ?? null,
            });
            this.remember(take.id);
        }
    }

    /**
     * The next track, ready to play.
     *
     * /similar carries mp3_url and duration, so a queued track is already
     * playable and this needs no request at all. The fallback below covers a
     * server that predates that change, and any row whose audio is missing.
     */
    async next() {
        if (this.queue.length < QUEUE_TARGET) await this.refill();

        const track = this.queue.shift();
        if (!track) return null;

        if (!track.url) {
            try {
                const { song } = await this.fetchJson(`/music/${track.id}`);
                track.url = song.mp3_url;
                track.duration = song.duration;
            } catch {
                // A track that will not resolve is skipped silently rather than
                // stopping the station on a dead row.
                return this.next();
            }
        }
        if (!track.url) return this.next();

        this.current = track;
        this.lastReasons = track.reasons;
        this.remember(track.id);

        // Keep one ahead, without making the listener wait for it.
        this.refill().catch(() => {});

        return track;
    }

    /** One line the UI can show under the now-playing title. */
    because() {
        if (!this.current) return '';
        if (this.current.seededBy === 'discovery') return 'Something different';
        if (this.current.seededBy === 'taste') return 'Because you liked something like this';
        return this.lastReasons.length ? this.lastReasons.join(' · ') : 'Up next';
    }
}

module.exports = { Station, QUEUE_TARGET, RECENT_MEMORY, DISCOVERY_RATE, TASTE_RATE, SKIP_MS };
