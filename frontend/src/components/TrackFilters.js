import React from 'react';
import PropTypes from 'prop-types';
import { MUSICAL_KEYS, camelotOf, compatibleKeys } from '../utils/musicalKeys';

// Tempo and key filters, shared by Browse and Search so the two behave
// identically and there is one place to change how filtering reads.

export const EMPTY_FILTERS = { bpmMin: '', bpmMax: '', key: '', keyMode: 'compatible' };

export const hasActiveFilters = (filters) =>
    Boolean(filters.bpmMin || filters.bpmMax || filters.key);

/** Turn the filter state into query params, leaving out anything unset. */
export const filtersToParams = (filters) => {
    const params = {};
    if (filters.bpmMin) params.bpmMin = filters.bpmMin;
    if (filters.bpmMax) params.bpmMax = filters.bpmMax;
    if (filters.key) {
        params.key = filters.key;
        params.keyMode = filters.keyMode;
    }
    return params;
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

/** Small labelled chip listing a track's detected tempo and key. */
export const TrackMetaChips = ({ bpm, musicalKey, className = '' }) => {
    if (bpm == null && !musicalKey) return null;
    const camelot = musicalKey ? camelotOf(musicalKey) : null;
    return (
        <span className={`inline-flex flex-wrap gap-2 align-middle ${className}`}>
            {bpm != null && (
                <span className="retro-chip" title="Detected tempo">{Math.round(bpm)} BPM</span>
            )}
            {musicalKey && (
                <span className="retro-chip" title="Detected key">
                    {musicalKey}{camelot ? ` · ${camelot}` : ''}
                </span>
            )}
        </span>
    );
};

TrackMetaChips.propTypes = {
    bpm: PropTypes.number,
    musicalKey: PropTypes.string,
    className: PropTypes.string,
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
                <h2 className="retro-display text-base retro-glow-cyan">Find tracks by tempo &amp; key</h2>
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
    }).isRequired,
    onChange: PropTypes.func.isRequired,
    resultCount: PropTypes.number,
    missing: PropTypes.shape({ bpm: PropTypes.number, key: PropTypes.number }),
    busy: PropTypes.bool,
};

export default TrackFilters;
