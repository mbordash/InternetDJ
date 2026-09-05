/**
 * Playback, and the station driving it.
 *
 * On the audio library: react-native-track-player is the usual answer for a
 * music app and it is not usable here. Its stable line is 4.x, which is a
 * legacy-architecture module, and React Native 0.86 has removed the legacy
 * architecture; 5.x exists only as an alpha. expo-audio is New Architecture
 * native but exposes background playback with no now-playing metadata and no
 * remote commands, so audio would keep going with a blank lock screen and dead
 * buttons. expo-video carries `staysActiveInBackground`,
 * `showNowPlayingNotification` and a `metadata` object, and plays an audio-only
 * source perfectly well. Lock screen controls are the entire reason this app
 * is native rather than a website, so that decided it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useVideoPlayer, VideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';

import { api, fetchJson } from './api';
import { tasteStore } from './storage';
// Plain JS on purpose: it is unit tested in node (lib/station.test.js) and has
// no React Native imports, so it stays runnable outside the app. station.d.ts
// gives it types here without making it a TypeScript file.
import { Station, type StationTrack } from './station';

export type { StationTrack };

type PlayerValue = {
    player: VideoPlayer;
    track: StationTrack | null;
    /** The line under the title: the endpoint's own reasons, or why we jumped. */
    because: string;
    isPlaying: boolean;
    loading: boolean;
    error: string | null;
    start: (genre?: string | null) => Promise<void>;
    startFrom: (songId: number, genre?: string | null) => Promise<void>;
    skip: () => Promise<void>;
    toggle: () => void;
    like: () => Promise<void>;
    liked: boolean;
    genre: string | null;
    /** Seconds. `duration` is 0 until the asset reports one. */
    position: number;
    duration: number;
    seek: (seconds: number) => void;
    /** Play a fixed list. Ends by handing back to the station. */
    playQueue: (
        name: string,
        tracks: { id: number; title: string; image_url?: string | null; profile_name?: string; mp3_url?: string | null }[],
        options?: { startIndex?: number; shuffle?: boolean },
    ) => Promise<void>;
    /** The playlist being walked, or null when the station is driving. */
    queueName: string | null;
    /** True when this song is the one loaded in the player right now. */
    isCurrent: (songId: number) => boolean;
};

const PlayerContext = createContext<PlayerValue | null>(null);

export const usePlayer = () => {
    const value = useContext(PlayerContext);
    if (!value) throw new Error('usePlayer must be used inside <PlayerProvider>');
    return value;
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
    const stationRef = useRef<Station | null>(null);
    /**
     * A fixed list being walked, when one is playing. Held in a ref rather than
     * state because `advance` mutates the index and must not be rebuilt for it;
     * only the name is state, since the UI reads that.
     */
    const queueRef = useRef<{ tracks: StationTrack[]; index: number; name: string } | null>(null);
    const [queueName, setQueueName] = useState<string | null>(null);
    const [track, setTrack] = useState<StationTrack | null>(null);
    const [because, setBecause] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [liked, setLiked] = useState(false);
    const [genre, setGenre] = useState<string | null>(null);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);

    // When the current track started, so a skip can be told from a listen.
    const startedAt = useRef<number>(0);

    const player = useVideoPlayer(null, (p) => {
        p.staysActiveInBackground = true;   // keeps going when the screen locks
        p.showNowPlayingNotification = true; // lock screen art, title, controls
        p.audioMixingMode = 'doNotMix';
        p.loop = false;
        // Drives the scrubber. Twice a second is enough for a progress bar and
        // cheap enough to leave running the whole time something is playing.
        p.timeUpdateEventInterval = 0.5;
    });

    const seek = useCallback((seconds: number) => {
        player.currentTime = Math.max(0, Math.min(seconds, player.duration || seconds));
        setPosition(seconds);
    }, [player]);

    const ensureStation = useCallback(async (pinned: string | null) => {
        if (!stationRef.current || stationRef.current.genre !== pinned) {
            stationRef.current = new Station({
                // The engine speaks in API paths, which is exactly what
                // fetchJson takes, so it is handed over unwrapped.
                fetchJson,
                store: tasteStore,
                genre: pinned,
            });
            await stationRef.current.load();
        }
        return stationRef.current;
    }, []);

    /**
     * Load a track and start it. Every path that makes noise goes through here,
     * so the lock screen metadata, the play count and the listen timer cannot
     * drift apart between the station and a playlist.
     */
    const playTrack = useCallback(async (next: StationTrack, why: string) => {
        setTrack(next);
        setBecause(why);
        setLiked(false);
        setError(null);
        setPosition(0);
        setDuration(next.duration ?? 0);
        startedAt.current = Date.now();

        await player.replaceAsync({
            uri: next.url,
            metadata: {
                title: next.title,
                artist: next.artist,
                artwork: next.image ?? undefined,
            },
        });
        player.play();

        api.countPlay(next.id);
    }, [player]);

    /**
     * Whatever comes next.
     *
     * Two sources, one player. A playlist is a fixed list walked in order; the
     * station is generated as it goes. They are not two playback systems - the
     * lock screen can only represent one thing playing, and that is the reason
     * this app is native at all, so there is exactly one player and it is fed
     * by one of two queues.
     *
     * A finished playlist hands back to the station rather than stopping, seeded
     * from its last track, because "it keeps going" is the whole product. The
     * reason line says so when it happens.
     */
    const advance = useCallback(async () => {
        setLoading(true);
        try {
            const queued = queueRef.current;

            if (queued && queued.index + 1 < queued.tracks.length) {
                queued.index += 1;
                await playTrack(
                    queued.tracks[queued.index],
                    `${queued.name} · ${queued.index + 1} of ${queued.tracks.length}`,
                );
                return;
            }

            if (queued) {
                // End of the list: fall through into a station that continues
                // from where the playlist left off.
                const last = queued.tracks[queued.tracks.length - 1];
                queueRef.current = null;
                setQueueName(null);
                const station = await ensureStation(null);
                station.current = last;
                station.remember(last.id);
                const next = (await station.next()) as StationTrack | null;
                if (!next) {
                    setError('That was the end of the playlist.');
                    return;
                }
                await playTrack(next, `${queued.name} finished · carrying on from here`);
                return;
            }

            const station = stationRef.current;
            if (!station) return;
            const next = (await station.next()) as StationTrack | null;
            if (!next) {
                setError('The station could not find anything else to play.');
                return;
            }
            await playTrack(next, station.because());
        } catch (err: any) {
            setError(err?.message ?? 'Could not load the next track.');
        } finally {
            setLoading(false);
        }
    }, [ensureStation, playTrack]);

    const start = useCallback(async (pinned: string | null = null) => {
        queueRef.current = null;      // a station replaces a playlist
        setQueueName(null);
        setGenre(pinned ?? null);
        stationRef.current = null;               // a pinned station is a new station
        await ensureStation(pinned ?? null);
        await advance();
    }, [advance, ensureStation]);

    /** Start from a specific track: the "start station" button on a track page. */
    const startFrom = useCallback(async (songId: number, pinned: string | null = null) => {
        queueRef.current = null;
        setQueueName(null);
        setGenre(pinned ?? null);
        stationRef.current = null;
        const station = await ensureStation(pinned ?? null);

        setLoading(true);
        try {
            const { song } = await api.song(songId);
            const seed: StationTrack = {
                id: Number(song.id),
                title: song.title,
                artist: song.profile_name ?? 'Unknown',
                profileId: Number(song.profile_id),
                image: song.image_url,
                bpm: song.bpm ?? null,
                key: song.camelot ?? song.musical_key ?? null,
                url: song.mp3_url as string,
                duration: song.duration ?? null,
                reasons: [],
                seededBy: 'continuity',
            };

            // Seed the engine's own state so everything after this follows on
            // from the chosen track rather than starting cold again.
            station.current = seed;
            station.remember(seed.id);

            setTrack(seed);
            setBecause('Starting from this track');
            setLiked(false);
            setError(null);
            setPosition(0);
            setDuration(seed.duration ?? 0);
            startedAt.current = Date.now();

            await player.replaceAsync({
                uri: seed.url,
                metadata: { title: seed.title, artist: seed.artist, artwork: seed.image ?? undefined },
            });
            player.play();
            api.countPlay(seed.id);
        } catch (err: any) {
            setError(err?.message ?? 'Could not start from that track.');
        } finally {
            setLoading(false);
        }
    }, [ensureStation, player]);

    /**
     * Play a fixed list, in order or shuffled.
     *
     * Tracks stored in a device playlist normally carry their audio url, since
     * it was known when they were added. Any that do not are resolved here
     * rather than at play time, so a gap in the list is dropped up front
     * instead of stalling in the middle of a set.
     */
    const playQueue = useCallback(async (
        name: string,
        tracks: { id: number; title: string; image_url?: string | null; profile_name?: string; mp3_url?: string | null }[],
        options: { startIndex?: number; shuffle?: boolean } = {},
    ) => {
        if (!tracks.length) return;

        setLoading(true);
        try {
            const resolved: StationTrack[] = [];
            for (const t of tracks) {
                let url = t.mp3_url ?? null;
                let duration: number | null = null;
                if (!url) {
                    try {
                        const { song } = await api.song(t.id);
                        url = song.mp3_url ?? null;
                        duration = song.duration ?? null;
                    } catch {
                        continue;   // a track that will not resolve is left out
                    }
                }
                if (!url) continue;
                resolved.push({
                    id: Number(t.id),
                    title: t.title,
                    artist: t.profile_name ?? 'Unknown',
                    profileId: 0,
                    image: t.image_url ?? null,
                    url,
                    duration,
                    reasons: [],
                    seededBy: 'continuity',
                });
            }

            if (!resolved.length) {
                setError('None of those tracks could be played.');
                return;
            }

            let ordered = resolved;
            let index = Math.min(Math.max(options.startIndex ?? 0, 0), resolved.length - 1);

            if (options.shuffle) {
                // Fisher-Yates. Starting from a chosen track and shuffling at
                // the same time is contradictory, so shuffle always starts at
                // the top of its own new order.
                ordered = [...resolved];
                for (let i = ordered.length - 1; i > 0; i -= 1) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
                }
                index = 0;
            }

            queueRef.current = { tracks: ordered, index, name };
            setQueueName(name);
            setGenre(null);
            await playTrack(
                ordered[index],
                `${name} · ${index + 1} of ${ordered.length}${options.shuffle ? ' · shuffled' : ''}`,
            );
        } catch (err: any) {
            setError(err?.message ?? 'Could not play that playlist.');
        } finally {
            setLoading(false);
        }
    }, [playTrack]);

    /**
     * Skip. How long it played decides what the station learns: a track
     * abandoned in the first few seconds is a dislike, one left running is not.
     */
    const skip = useCallback(async () => {
        const station = stationRef.current;
        if (station && track) {
            await station.record(track.id, {
                skipped: true,
                playedMs: Date.now() - startedAt.current,
            });
        }
        await advance();
    }, [advance, track]);

    const like = useCallback(async () => {
        const station = stationRef.current;
        if (!station || !track) return;
        await station.record(track.id, { liked: true });
        setLiked(true);
    }, [track]);

    const toggle = useCallback(() => {
        if (player.playing) player.pause();
        else player.play();
    }, [player]);

    useEventListener(player, 'playingChange', ({ isPlaying: playing }) => setIsPlaying(playing));

    useEventListener(player, 'timeUpdate', ({ currentTime }) => {
        setPosition(currentTime);
        // duration only becomes known once the asset has loaded, and /similar's
        // value is the stored one rather than what is actually playing, so the
        // player is the authority once it has an answer.
        if (player.duration && player.duration !== duration) setDuration(player.duration);
    });

    // End of track: bank it as a real listen, then move on. `playToEnd` is the
    // natural boundary; nothing else advances the station on its own.
    //
    // The guard is load bearing. The player is constructed with a null source
    // and this event also fires for an empty or failed one, so an unguarded
    // handler advanced the station before anything had ever played: on the
    // simulator it silently burned six tracks during mount and started playing
    // on its own, without the listener touching the start button. A track can
    // only reach its end if there was a track.
    useEventListener(player, 'playToEnd', () => {
        const station = stationRef.current;
        if (!station || !track) return;

        station.record(track.id, { playedMs: Date.now() - startedAt.current }).catch(() => {});
        advance().catch(() => {});
    });

    // Warm the station on launch so the first tap on play is instant rather
    // than a request. Nothing is played until the listener asks.
    useEffect(() => {
        ensureStation(null).catch(() => {});
    }, [ensureStation]);

    const isCurrent = useCallback((songId: number) => track?.id === Number(songId), [track]);

    const value = useMemo<PlayerValue>(() => ({
        player, track, because, isPlaying, loading, error,
        start, startFrom, skip, toggle, like, liked, genre,
        position, duration, seek, isCurrent, playQueue, queueName,
    }), [player, track, because, isPlaying, loading, error, start, startFrom, skip, toggle,
        like, liked, genre, position, duration, seek, isCurrent, playQueue, queueName]);

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
