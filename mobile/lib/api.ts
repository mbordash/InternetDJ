/**
 * The InternetDJ API, as the app sees it.
 *
 * Every endpoint used here is public. The app has no account, sends no token
 * and needs no auth header, which is the decision that makes the whole thing
 * small: nothing below can 401, so there is no session to refresh and no
 * sign-in wall between someone opening the app and hearing music.
 */
import Constants from 'expo-constants';

/**
 * Production by default.
 *
 * Point this at a machine on your LAN to work against a local server:
 * a simulator can reach localhost, but a physical phone cannot, so use the
 * host machine's IP rather than 127.0.0.1.
 */
export const API_BASE =
    (Constants.expoConfig?.extra?.apiBase as string | undefined) ?? 'https://internetdj.co/api';

export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

/**
 * One fetch for the whole app.
 *
 * Times out rather than hanging: a phone that has drifted out of signal will
 * otherwise leave the station waiting on a promise that never settles, and the
 * station's own error handling reads that as "still loading" forever.
 */
export async function fetchJson<T = any>(path: string, timeoutMs = 12000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${API_BASE}${path}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            throw new ApiError(`${path} answered ${response.status}`, response.status);
        }
        return (await response.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

// --- shapes ---------------------------------------------------------------
// Only the fields the app actually reads. The endpoints return more.

export type Song = {
    id: number;
    title: string;
    mp3_url?: string | null;
    image_url?: string | null;
    genre?: string | null;
    plays?: number;
    bpm?: number | null;
    musical_key?: string | null;
    camelot?: string | null;
    duration?: number | null;
    profile_id: number;
    profile_name?: string;
    profile_slug?: string | null;
    /** Present on /similar only: why this track was returned, already in words. */
    match_reasons?: string[];
};

export type GenreTag = {
    key: string;
    label: string;
    count: number;
    aliases: string[];
};

export type Release = {
    id: number;
    title: string;
    release_type: 'album' | 'ep' | 'single';
    cover_url?: string | null;
    track_count?: number;
};

/** Free-form, comma separated. Splitting is the caller's job everywhere. */
export const genreTags = (genre?: string | null): string[] =>
    (genre || '').split(',').map((t) => t.trim()).filter(Boolean);

export const api = {
    similar: (songId: number) =>
        fetchJson<{ songs: Song[]; basis: any }>(`/music/${songId}/similar`),

    song: (songId: number) => fetchJson<{ song: Song }>(`/music/${songId}`),

    latest: () => fetchJson<Song[]>('/music/latest'),
    mostPlayed: () => fetchJson<Song[]>('/music/most-played'),
    featured: () => fetchJson<Song[]>('/music/featured'),

    /** Sections: justAdded, playedLately, fromArchive. */
    recent: () => fetchJson<{ justAdded: Song[]; playedLately: Song[]; fromArchive: Song[] }>('/music/recent'),

    /**
     * The tag directory. `key` is the normalised form that /music/by-tag
     * expects; `label` is the spelling to show. They differ often - "drum
     * bass" is the key for a tag that displays as "drum and bass" and absorbs
     * seven other spellings.
     */
    genres: () => fetchJson<GenreTag[]>('/music/genres'),

    byTag: (tag: string) =>
        fetchJson<{ songs: Song[] }>(`/music/by-tag/${encodeURIComponent(tag)}`),

    /** Supports q, bpmMin, bpmMax, key and rating bounds. */
    search: (params: Record<string, string | number | undefined>) => {
        const query = Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
            .join('&');
        return fetchJson<{ songs: Song[]; profiles: any[] }>(`/music/search?${query}`);
    },

    profile: (profileId: number | string) => fetchJson<any>(`/profile/${profileId}`),

    releases: (profileId: number | string) =>
        fetchJson<{ releases: Release[] }>(`/releases/by-profile/${profileId}`),

    /**
     * Count a play. IP-deduped server side, so calling it once per track is
     * correct and calling it twice is harmless. Artists earn from app listens
     * exactly as they do from the website, which is the one thing to be sure
     * of before shipping a player that is not the website.
     */
    countPlay: async (songId: number) => {
        try {
            await fetch(`${API_BASE}/music/play/${songId}`, { method: 'POST' });
        } catch {
            // A missed play count must never interrupt playback.
        }
    },
};
