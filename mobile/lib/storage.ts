/**
 * Everything the app remembers, which is everything, because there is no
 * account behind it.
 *
 * Two separate stores with different characters:
 *
 *   taste      what the station learns. Bounded, disposable, and rebuilt by
 *              listening if it is ever lost.
 *   playlists  what the listener made. Not disposable at all, and the reason
 *              the UI has to say "Saved on this phone" out loud - these are
 *              not the Mixtapes on their account and cannot become them
 *              without a sign-in that does not exist yet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Song } from './api';

const TASTE_KEY = 'idj.taste.v1';
const PLAYLIST_KEY = 'idj.playlists.v1';

export type Taste = { liked: number[]; disliked: number[]; played: number[] };

/** Matches the shape station.js expects from an injected store. */
export const tasteStore = {
    async load(): Promise<Partial<Taste>> {
        try {
            const raw = await AsyncStorage.getItem(TASTE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            // A corrupt or unreadable profile is not worth surfacing. The
            // station starts cold and rebuilds it within a few tracks.
            return {};
        }
    },
    async save(taste: Taste) {
        try {
            await AsyncStorage.setItem(TASTE_KEY, JSON.stringify(taste));
        } catch {
            // Ignore: losing a like is better than interrupting playback.
        }
    },
};

export type PlaylistTrack = Pick<Song, 'id' | 'title' | 'image_url' | 'profile_name'> & {
    mp3_url?: string | null;
};

export type Playlist = {
    id: string;
    name: string;
    tracks: PlaylistTrack[];
    createdAt: number;
};

/**
 * Playlists are read and written whole.
 *
 * A phone holds tens of playlists, not thousands, and a single JSON blob keeps
 * every mutation atomic. Per-playlist keys would be faster and would also make
 * a half-finished write leave one playlist referencing tracks another no
 * longer has.
 */
export const playlistStore = {
    async all(): Promise<Playlist[]> {
        try {
            const raw = await AsyncStorage.getItem(PLAYLIST_KEY);
            return raw ? (JSON.parse(raw) as Playlist[]) : [];
        } catch {
            return [];
        }
    },

    async replace(playlists: Playlist[]) {
        await AsyncStorage.setItem(PLAYLIST_KEY, JSON.stringify(playlists));
    },

    async create(name: string): Promise<Playlist[]> {
        const playlists = await this.all();
        playlists.unshift({
            id: `pl_${Date.now().toString(36)}`,
            name: name.trim() || 'Untitled',
            tracks: [],
            createdAt: Date.now(),
        });
        await this.replace(playlists);
        return playlists;
    },

    async addTrack(playlistId: string, track: PlaylistTrack): Promise<Playlist[]> {
        const playlists = await this.all();
        const target = playlists.find((p) => p.id === playlistId);
        // Adding the same track twice is a mis-tap, not an intention.
        if (target && !target.tracks.some((t) => t.id === track.id)) {
            target.tracks.push(track);
            await this.replace(playlists);
        }
        return playlists;
    },

    async removeTrack(playlistId: string, songId: number): Promise<Playlist[]> {
        const playlists = await this.all();
        const target = playlists.find((p) => p.id === playlistId);
        if (target) {
            target.tracks = target.tracks.filter((t) => t.id !== songId);
            await this.replace(playlists);
        }
        return playlists;
    },

    async remove(playlistId: string): Promise<Playlist[]> {
        const playlists = (await this.all()).filter((p) => p.id !== playlistId);
        await this.replace(playlists);
        return playlists;
    },
};
