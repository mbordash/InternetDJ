import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { MUSICAL_KEYS, camelotOf, compatibleKeys } from '../utils/musicalKeys';

// Tempo, key and rating filters, shared by Browse and Search so the two behave
// identically and there is one place to change how filtering reads.

export const EMPTY_FILTERS = {
    bpmMin: '', bpmMax: '', key: '', keyMode: 'compatible', ratingMin: '', ratingMax: '',
};

export const hasActiveFilters = (filters) =>
    Boolean(filters.bpmMin || filters.bpmMax || filters.key || filters.ratingMin || filters.ratingMax);

/**
 * How far either side of a track's tempo a "find tracks at this BPM" link
 * looks. Detection returns a float and different tracks land a beat apart at
 * the same nominal tempo, so an exact match would find almost nothing; a couple
 * of BPM either way is also the range a DJ would actually beatmatch within.
 */
export const BPM_LINK_TOLERANCE = 2;

/**
 * Link to the browse page pre-filtered around a tempo. Used from anywhere a
 * track's detected BPM is shown, so the number is a way into the catalogue
 * rather than a dead label.
 */
export const tempoHref = (bpm, tolerance = BPM_LINK_TOLERANCE) => {
    const centre = Math.round(Number(bpm));
    if (!Number.isFinite(centre)) return null;
    const min = Math.max(BPM_RANGE.min, centre - tolerance);
    const max = Math.min(BPM_RANGE.max, centre + tolerance);
    return `/browse?bpmMin=${min}&bpmMax=${max}`;
};

/** Link to the browse page pre-filtered to the tracks that mix with a key. */
export const keyHref = (key) => {
    const canonical = canonicalKey(key);
    return canonical ? `/browse?key=${encodeURIComponent(canonical)}&keyMode=compatible` : null;
};

/** Turn the filter state into query params, leaving out anything unset. */
export const filtersToParams = (filters) => {
    const params = {};
    if (filters.bpmMin) params.bpmMin = filters.bpmMin;
    if (filters.bpmMax) params.bpmMax = filters.bpmMax;
    if (filters.key) {
        params.key = filters.key;
        params.keyMode = filters.keyMode;
    }
    if (filters.ratingMin) params.ratingMin = filters.ratingMin;
    if (filters.ratingMax) params.ratingMax = filters.ratingMax;
    return params;
};

/** The tempo values the inputs and the incoming links both accept. */
export const BPM_RANGE = { min: 20, max: 300 };

/** The rating scale, matching what the review form can actually record. */
export const RATING_RANGE = { min: 0, max: 10, step: 0.5 };

/**
 * How far either side of a score a "find tracks rated like this" link looks.
 * Half a point each way: wide enough that a track sitting at 8.2 and one at
 * 8.6 find each other, narrow enough that 6s and 9s do not end up in the same
 * list, which would make the link mean nothing.
 */
export const RATING_LINK_TOLERANCE = 0.5;

/** Link to the browse page pre-filtered to tracks scoring around a rating. */
export const ratingHref = (rating, tolerance = RATING_LINK_TOLERANCE) => {
    const score = Number(rating);
    if (!Number.isFinite(score)) return null;
    const min = Math.max(RATING_RANGE.min, Math.round((score - tolerance) * 10) / 10);
    const max = Math.min(RATING_RANGE.max, Math.round((score + tolerance) * 10) / 10);
    return `/browse?ratingMin=${min}&ratingMax=${max}`;
};

const canonicalKey = (key) => {
    const wanted = String(key ?? '').trim().toLowerCase();
    return MUSICAL_KEYS.find(k => k.toLowerCase() === wanted) || '';
};

/**
 * The inverse of filtersToParams: read filter state out of a URL.
 *
 * Filters live in the URL so that a link can carry them — the BPM on a song
 * page points at browse with the tempo already set — and so a filtered view
 * survives a reload or a share. Anything unparseable is dropped rather than
 * fed to the API, which would only answer with a 400.
 */
export const paramsToFilters = (searchParams) => {
    const bpm = (name) => {
        const raw = searchParams.get(name);
        const value = Number(raw);
        return raw && Number.isFinite(value) && value >= BPM_RANGE.min && value <= BPM_RANGE.max
            ? String(Math.round(value))
            : '';
    };

    const rating = (name) => {
        const raw = searchParams.get(name);
        const value = Number(raw);
        return raw && Number.isFinite(value) && value >= RATING_RANGE.min && value <= RATING_RANGE.max
            ? String(Math.round(value * 10) / 10)
            : '';
    };

    const key = canonicalKey(searchParams.get('key'));
    return {
        bpmMin: bpm('bpmMin'),
        bpmMax: bpm('bpmMax'),
        key,
        keyMode: key && searchParams.get('keyMode') === 'exact' ? 'exact' : 'compatible',
        ratingMin: rating('ratingMin'),
        ratingMax: rating('ratingMax'),
    };
};

// Ranges most electronic music actually sits in. Plain tempo numbers do the
// work; the genre name is just a hint at what lives there.
const TEMPO_PRESETS = [
    { label: 'Slow', hint: 'downtempo', min: 60, max: 100 },
    { label: '110-124', hint: 'house', min: 110, max: 124 },
    { label: '124-132', hint: 'tech house', min: 124, max: 132 },
    { label: '132-150', hint: 'techno / trance', min: 132, max: 150 },
    { label: '160-180', hint: 'drum & bass', min: 160, max: 180 },
];

/**
 * What the rating filter currently asks for, in words. A band reads as a range
 * because that is what a "rated like this" link sets; a bare minimum reads as
 * "7.5+", which is what dragging the slider means.
 */
const ratingLabel = (filters) => {
    if (filters.ratingMin && filters.ratingMax) return `${filters.ratingMin} \u2013 ${filters.ratingMax}`;
    if (filters.ratingMin) return `${filters.ratingMin}+`;
    if (filters.ratingMax) return `up to ${filters.ratingMax}`;
    return 'Any';
};

/**
 * Small labelled chip listing a track's detected tempo and key.
 *
 * With `linked`, each chip is a way into the catalogue rather than a label:
 * the tempo opens browse filtered around that BPM, the key opens browse showing
 * what mixes with it. Off by default so lists that already sit inside a
 * filtered view do not link back to themselves.
 */
export const TrackMetaChips = ({ bpm, musicalKey, rating, className = '', linked = false }) => {
    if (bpm == null && !musicalKey && rating == null) return null;
    const camelot = musicalKey ? camelotOf(musicalKey) : null;

    const Chip = ({ href, title, children }) => (
        linked && href
            ? <Link to={href} className="retro-chip" title={title}>{children}</Link>
            : <span className="retro-chip" title={title}>{children}</span>
    );

    return (
        <span className={`inline-flex flex-wrap gap-2 align-middle ${className}`}>
            {bpm != null && (
                <Chip
                    href={tempoHref(bpm)}
                    title={linked
                        ? `Detected tempo — browse tracks near ${Math.round(bpm)} BPM`
                        : 'Detected tempo'}
                >
                    {Math.round(bpm)} BPM
                </Chip>
            )}
            {musicalKey && (
                <Chip
                    href={keyHref(musicalKey)}
                    title={linked
                        ? `Detected key — browse tracks that mix with ${musicalKey}`
                        : 'Detected key'}
                >
                    {musicalKey}{camelot ? ` · ${camelot}` : ''}
                </Chip>
            )}
            {rating != null && (
                <Chip
                    href={ratingHref(rating)}
                    title={linked
                        ? `Average rating — browse tracks scoring around ${rating.toFixed(1)}`
                        : 'Average rating'}
                >
                    {rating.toFixed(1)} / 10
                </Chip>
            )}
        </span>
    );
};

TrackMetaChips.propTypes = {
    bpm: PropTypes.number,
    musicalKey: PropTypes.string,
    rating: PropTypes.number,
    className: PropTypes.string,
    linked: PropTypes.bool,
};

const TrackFilters = ({ filters, onChange, resultCount = null, missing = null, busy = false }) => {
    const set = (patch) => onChange({ ...filters, ...patch });

    const presetActive = (preset) =>
        String(filters.bpmMin) === String(preset.min) && String(filters.bpmMax) === String(preset.max);

    const alsoMatches = filters.key && filters.keyMode === 'compatible'
        ? compatibleKeys(filters.key).filter(key => key !== filters.key)
        : [];

    return (
        <div className="retro-panel retro-cut p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <h2 className="retro-display text-base retro-glow-cyan">Find tracks by tempo, key &amp; rating</h2>
                {hasActiveFilters(filters) && (
                    <button
                        type="button"
                        onClick={() => onChange(EMPTY_FILTERS)}
                        className="retro-link retro-mono text-lg underline"
                    >
                        Clear
                    </button>
                )}
            </div>

            <div>
                <span className="retro-label">Tempo</span>
                <div className="flex flex-wrap gap-2 mt-1">
                    {TEMPO_PRESETS.map(preset => (
                        <button
                            key={preset.label}
                            type="button"
                            aria-pressed={presetActive(preset)}
                            onClick={() => set(presetActive(preset)
                                ? { bpmMin: '', bpmMax: '' }
                                : { bpmMin: String(preset.min), bpmMax: String(preset.max) })}
                            title={preset.hint}
                            className={`retro-chip ${presetActive(preset) ? 'ring-2 ring-fuchsia-400' : ''}`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-3 mt-3">
                    <label className="sr-only" htmlFor="filter-bpm-min">Slowest BPM</label>
                    <input
                        id="filter-bpm-min"
                        type="number"
                        min="20"
                        max="300"
                        placeholder="Any"
                        value={filters.bpmMin}
                        onChange={(e) => set({ bpmMin: e.target.value })}
                        className="retro-field w-24 px-3 py-2"
                    />
                    <span className="retro-mono text-lg text-gray-400">to</span>
                    <label className="sr-only" htmlFor="filter-bpm-max">Fastest BPM</label>
                    <input
                        id="filter-bpm-max"
                        type="number"
                        min="20"
                        max="300"
                        placeholder="Any"
                        value={filters.bpmMax}
                        onChange={(e) => set({ bpmMax: e.target.value })}
                        className="retro-field w-24 px-3 py-2"
                    />
                    <span className="retro-mono text-lg text-gray-400">BPM</span>
                </div>
            </div>

            <div>
                <label className="retro-label" htmlFor="filter-key">Key</label>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                    <select
                        id="filter-key"
                        value={filters.key}
                        onChange={(e) => set({ key: e.target.value })}
                        className="retro-field px-3 py-2"
                    >
                        <option value="">Any key</option>
                        {MUSICAL_KEYS.map(key => (
                            <option key={key} value={key}>{key} · {camelotOf(key)}</option>
                        ))}
                    </select>

                    <div className="flex items-center gap-3" role="radiogroup" aria-label="Key matching">
                        {[
                            ['compatible', 'Keys that mix'],
                            ['exact', 'Exactly this key'],
                        ].map(([mode, label]) => (
                            <label key={mode} className="retro-mono text-lg flex items-center gap-1.5 cursor-pointer">
                                <input
                                    type="radio"
                                    name="keyMode"
                                    value={mode}
                                    checked={filters.keyMode === mode}
                                    onChange={() => set({ keyMode: mode })}
                                    disabled={!filters.key}
                                />
                                <span className={filters.key ? '' : 'text-gray-500'}>{label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Say what "keys that mix" actually expanded to, rather than
                    making people trust an invisible rule. */}
                {alsoMatches.length > 0 && (
                    <p className="retro-mono text-lg text-gray-400 mt-2">
                        Also matching {alsoMatches.map(key => `${key} (${camelotOf(key)})`).join(', ')}
                        {' '}&mdash; these share notes with {filters.key}, so they mix.
                    </p>
                )}
            </div>

            <div>
                <div className="flex items-baseline justify-between gap-4">
                    <label className="retro-label" htmlFor="filter-rating">Rating</label>
                    <span className="retro-mono text-lg text-cyan-300">{ratingLabel(filters)}</span>
                </div>
                {/* The same slider as the review form, so a score is set the
                    same way wherever it appears. Dragging it means "at least
                    this", which also clears any narrow band an incoming link
                    set: otherwise the minimum could be dragged above the
                    maximum and quietly match nothing. */}
                <input
                    id="filter-rating"
                    type="range"
                    min={RATING_RANGE.min}
                    max={RATING_RANGE.max}
                    step={RATING_RANGE.step}
                    value={filters.ratingMin || RATING_RANGE.min}
                    onChange={(e) => {
                        const value = Number(e.target.value);
                        set({
                            ratingMin: value > RATING_RANGE.min ? String(value) : '',
                            ratingMax: '',
                        });
                    }}
                    aria-valuetext={filters.ratingMin
                        ? `rated at least ${filters.ratingMin} out of 10`
                        : 'any rating'}
                    className="retro-slider w-full cursor-pointer mt-1"
                />
                <div className="flex justify-between items-baseline text-xs text-gray-500">
                    <span>Any</span>
                    <span>10</span>
                </div>
                {/* A band only ever arrives from a "rated like this" link, and
                    without a way back out the slider alone cannot clear it. */}
                {filters.ratingMax && (
                    <button
                        type="button"
                        onClick={() => set({ ratingMin: '', ratingMax: '' })}
                        className="retro-link retro-mono text-lg underline mt-1"
                    >
                        Clear rating range
                    </button>
                )}
                <p className="retro-mono text-lg text-gray-400 mt-1">
                    A track's score is the average of the ratings its comments carried.
                </p>
            </div>

            {(busy || resultCount !== null) && (
                <div className="retro-mono text-lg text-gray-300 border-t border-cyan-400/20 pt-3 space-y-1">
                    <p>{busy ? 'Searching…' : `${resultCount} track${resultCount === 1 ? '' : 's'} found.`}</p>
                    {/* Missing data is not the same as no match, and saying so
                        keeps the catalogue from looking smaller than it is. */}
                    {!busy && missing?.key > 0 && (
                        <p className="text-gray-400">
                            {missing.key} track{missing.key === 1 ? ' has' : 's have'} no detected key yet and
                            {missing.key === 1 ? ' is' : ' are'} not shown. Artists can set it in Manage Songs.
                        </p>
                    )}
                    {!busy && missing?.bpm > 0 && (
                        <p className="text-gray-400">
                            {missing.bpm} track{missing.bpm === 1 ? ' has' : 's have'} no detected tempo yet and
                            {missing.bpm === 1 ? ' is' : ' are'} not shown.
                        </p>
                    )}
                    {!busy && missing?.rating > 0 && (
                        <p className="text-gray-400">
                            {missing.rating} track{missing.rating === 1 ? ' has' : 's have'} not been rated yet and
                            {missing.rating === 1 ? ' is' : ' are'} not shown. Ratings come from comments.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

TrackFilters.propTypes = {
    filters: PropTypes.shape({
        bpmMin: PropTypes.string,
        bpmMax: PropTypes.string,
        key: PropTypes.string,
        keyMode: PropTypes.string,
        ratingMin: PropTypes.string,
        ratingMax: PropTypes.string,
    }).isRequired,
    onChange: PropTypes.func.isRequired,
    resultCount: PropTypes.number,
    missing: PropTypes.shape({
        bpm: PropTypes.number, key: PropTypes.number, rating: PropTypes.number,
    }),
    busy: PropTypes.bool,
};

export default TrackFilters;
