/**
 * Types for station.js.
 *
 * The engine itself stays plain JavaScript so it can be unit tested in node
 * with no build step (see station.test.js). This gives the app real types over
 * it rather than an `any` and a `@ts-ignore` at the import.
 */
export type SeedReason = 'continuity' | 'taste' | 'discovery';

export type StationTrack = {
    id: number;
    title: string;
    artist: string;
    profileId: number;
    image?: string | null;
    bpm?: number | null;
    key?: string | null;
    url: string;
    duration?: number | null;
    reasons: string[];
    seededBy: SeedReason;
};

export type Taste = { liked: number[]; disliked: number[]; played: number[] };

export type StationOptions = {
    /** Returns parsed JSON for an API path such as `/music/12/similar`. */
    fetchJson: (path: string) => Promise<any>;
    store: { load: () => Promise<Partial<Taste>>; save: (taste: Taste) => Promise<void> };
    /** Pin the station to a single genre tag. */
    genre?: string | null;
};

export declare class Station {
    constructor(options: StationOptions);
    genre: string | null;
    current: StationTrack | null;
    queue: StationTrack[];
    taste: Taste;

    load(): Promise<void>;
    next(): Promise<StationTrack | null>;
    refill(): Promise<void>;
    record(songId: number, signals: { playedMs?: number; liked?: boolean; skipped?: boolean }): Promise<void>;
    remember(id: number): void;
    /** One line for under the now-playing title. */
    because(): string;
}

export declare const QUEUE_TARGET: number;
export declare const RECENT_MEMORY: number;
export declare const DISCOVERY_RATE: number;
export declare const TASTE_RATE: number;
export declare const SKIP_MS: number;
