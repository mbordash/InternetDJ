import React, { useCallback, useEffect, useState, useContext, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AuthContext } from '../context/AuthContext';
import * as lamejs from '@breezystack/lamejs';
import * as Tone from 'tone';
import PianoRoll from '../components/PianoRoll';
import TrackSettingsModal from '../components/TrackSettingsModal';
import TrackEffectsModal from '../components/TrackEffectsModal';
import MidiGenerateModal from '../components/MidiGenerateModal';
import LoopGenerateModal from '../components/LoopGenerateModal';
import API_URL from '../utils/api';
import useProjectPlayback from '../hooks/useProjectPlayback';
import { loadSampleDurations, getToneBuffer } from '../utils/audioBuffers';
import ClipWaveform from '../components/ClipWaveform';

const ItemTypes = {
    SAMPLE: 'sample',
};

const PIXELS_PER_SECOND = 100;

const PASTEL_COLORS = [
    'bg-pink-100',
    'bg-green-100',
    'bg-purple-100',
    'bg-primary-brand-100',
    'bg-yellow-100',
    'bg-orange-100',
];

// Non-destructive clip window: trim_start/trim_end are offsets (seconds) into the source sample
// Timeline unit convention
// ------------------------
// The timeline x-axis is MUSICAL time, expressed in "timeline units" — seconds
// measured at the 120 BPM reference tempo. One beat is always 0.5 units and one
// bar always 2 units, at every tempo, so the grid and the clips on it never move
// when the project tempo changes. What tempo changes is how fast the playhead
// crosses that fixed canvas:
//   realSeconds = timelineUnits * timeScale,   timeScale = 120 / bpm
// Drop to 90 BPM and timeScale becomes 1.333, so the same bar takes a third
// longer to play — the song slows down, the ruler stays put. At 120 BPM
// timeScale is exactly 1 and units and real seconds coincide.
//
// Stored in UNITS: playheadPosition, timelineDuration, audio clip start_time,
// and MIDI note start_time and duration.
// Stored in REAL SECONDS: audio file/clip durations, fade lengths, and anything
// handed to an AudioContext or the Tone transport.
// Convert at the boundary; never add one to the other.
//
// This comment used to list MIDI note times as real seconds, which is wrong and
// contradicted the code three lines of scrolling away. Notes are musical: they
// keep their bar position when the tempo changes, exactly like clips.
const unitsToReal = (timelineUnits, timeScale) => timelineUnits * timeScale;
const realToUnits = (realSeconds, timeScale) => realSeconds / timeScale;

const getClipTimes = (sample, fullDuration) => {
    const trimStart = Math.max(0, sample.trim_start || 0);
    const rawEnd = sample.trim_end != null ? sample.trim_end : (fullDuration || 0);
    const trimEnd = fullDuration ? Math.min(rawEnd, fullDuration) : rawEnd;
    return { trimStart, trimEnd, effDuration: Math.max(0, trimEnd - trimStart) };
};

const SampleBlock = ({ sample, trackId, onDrag, volume, zoom, duration, timeScale, isLoadingDurations, waveformColor, trackVolume, onClipEdit, isSelected, onSelect, onDuplicate }) => {
    const [{ isDragging }, drag] = useDrag({
        type: ItemTypes.SAMPLE,
        item: () => {
            return { id: sample.id, trackId, start_time: sample.start_time, sampleId: sample.sample_id };
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
        canDrag: !isLoadingDurations,
    });

    const handleClick = (e) => {
        e.stopPropagation();
        if (onSelect && !isLoadingDurations) {
            onSelect(isSelected ? null : sample.id);
        }
    };

    const handleDoubleClick = (e) => {
        e.stopPropagation();
        if (onClipEdit && !isLoadingDurations) {
            onClipEdit(sample);
        }
    };

    const { trimStart, trimEnd, effDuration } = getClipTimes(sample, duration);
    const hasClipEdits = (sample.trim_start || 0) > 0 || sample.trim_end != null || (sample.fade_in || 0) > 0 || (sample.fade_out || 0) > 0;
    // effDuration is real seconds; the block is drawn on the timeline-units axis
    const blockWidth = realToUnits(effDuration, timeScale) * zoom;

    return (
        <div
            ref={drag}
            className={`absolute h-12 flex items-center p-1 bg-cyan-400/5 border rounded-md shadow-sm hover:bg-cyan-400/10 ${
                isSelected ? 'border-cyan-400 ring-2 ring-cyan-400/60' : 'border-cyan-400/25'
            } ${
                isDragging ? 'opacity-50' : 'opacity-100'
            } ${isLoadingDurations ? 'cursor-not-allowed' : 'cursor-move'}`}
            style={{
                left: `${sample.start_time * zoom}px`,
                width: `${Math.max(blockWidth, 100)}px`,
            }}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleDoubleClick(e); }
            }}
            tabIndex={0}
            role="button"
            aria-pressed={isSelected}
            aria-label={`Clip at ${sample.start_time.toFixed(2)}${isSelected ? ', selected' : ''}`}
            title="Double-click to edit fades and trim. Select and use arrow keys to nudge, with Shift for fine steps."
        >
            <ClipWaveform
                url={sample.mp3_url}
                from={trimStart}
                to={trimEnd}
                className={waveformColor}
            />
            {hasClipEdits && !isLoadingDurations && (
                <span className="absolute top-0 right-1 text-[10px] text-cyan-300 pointer-events-none" title="Clip has fades/trim">✂</span>
            )}
            {isSelected && !isLoadingDurations && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate?.(sample.id);
                    }}
                    className="absolute -top-2 -right-2 z-30 w-5 h-5 flex items-center justify-center text-[11px] leading-none bg-cyan-600 hover:bg-cyan-500 text-white rounded-full shadow focus:outline-none"
                    title="Duplicate clip after itself (Cmd/Ctrl+D)"
                    aria-label="Duplicate clip"
                >
                    ⧉
                </button>
            )}
        </div>
    );
};

const SampleDeleteDropZone = ({ onDelete, isLoadingDurations }) => {
    const [{ isOver }, drop] = useDrop({
        accept: ItemTypes.SAMPLE,
        drop: (item) => {
            if (item.id) {
                onDelete(item.id);
            }
        },
        collect: (monitor) => ({
            isOver: !!monitor.isOver(),
        }),
        canDrop: () => !isLoadingDurations,
    });

    return (
        <div
            ref={drop}
            className={`flex items-center justify-center w-72 h-10 border-2 border-dashed rounded-md text-sm font-medium transition-colors ${
                isOver && !isLoadingDurations
                    ? 'border-red-500 bg-red-500/20 text-red-300'
                    : 'border-cyan-400/35 bg-cyan-400/5 text-gray-300'
            } ${isLoadingDurations ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            Drop Sample Here to Delete from Track
        </div>
    );
};

const DraggableSample = ({ sample, name, sampleId }) => {
    const playerRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // Preview playback, on the same buffer the timeline and the drawing use, so
    // auditioning a library sample costs no extra download.
    useEffect(() => () => {
        try { playerRef.current?.stop(); } catch (_) { /* not started */ }
        try { playerRef.current?.dispose(); } catch (_) { /* already gone */ }
        playerRef.current = null;
    }, [sample.id]);

    const handlePlay = async () => {
        try {
            if (playerRef.current && playerRef.current.state === 'started') {
                playerRef.current.stop();
                setIsPlaying(false);
                return;
            }
            await Tone.start();
            if (!playerRef.current) {
                const buffer = await getToneBuffer(sample.mp3_url);
                const player = new Tone.Player(buffer).toDestination();
                player.onstop = () => setIsPlaying(false);
                playerRef.current = player;
            }
            playerRef.current.start();
            setIsPlaying(true);
        } catch (err) {
            console.warn('Error previewing library sample:', err.message);
            setIsPlaying(false);
        }
    };

    const [{ isDragging }, drag] = useDrag({
        type: ItemTypes.SAMPLE,
        item: () => {
            return { sampleId, type: ItemTypes.SAMPLE };
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    });

    return (
        <div
            ref={drag}
            className={`flex items-center space-x-2 p-2 bg-cyan-400/5 border border-cyan-400/25 rounded-md cursor-move ${
                isDragging ? 'opacity-50' : 'opacity-100'
            }`}
        >
            <button
                onClick={handlePlay}
                className="text-gray-200 hover:text-white focus:outline-none flex-shrink-0"
            >
                {isPlaying ? '❚❚' : '▶'}
            </button>
            <div className="flex-1">{name}</div>
            <ClipWaveform url={sample.mp3_url} className="w-24 flex-none text-gray-400" />
        </div>
    );
};

const Timeline = ({ trackId, samples, onDrop, onDrag, zoom, sampleDurations, isLoadingDurations, waveformColor, bpm, isSnapping, timelineDuration, playheadPosition, trackVolume, onClipEdit, selectedSampleId, onSelectSample, onDuplicateClip, registerPlayhead }) => {
    const timelineRef = useRef(null);

    const [{ isOver }, drop] = useDrop({
        accept: ItemTypes.SAMPLE,
        drop: (item, monitor) => {
            if (!timelineRef.current) {
                console.error('Timeline ref not set for track:', trackId);
                return undefined;
            }
            if (!item.sampleId) {
                console.error('Drop item missing sampleId:', item);
                return undefined;
            }
            const timelineRect = timelineRef.current.getBoundingClientRect();
            const clientX = monitor.getClientOffset().x;
            const initialClientX = monitor.getInitialClientOffset()?.x;
            const initialSourceX = monitor.getInitialSourceClientOffset()?.x;

            let mouseOffsetX = 0;
            if (initialClientX && initialSourceX) {
                mouseOffsetX = initialClientX - initialSourceX;
            } else {
                console.warn('Initial client/source offset unavailable, assuming mouseOffsetX = 0');
            }

            const relativeX = clientX - timelineRect.left - mouseOffsetX;
            const timeScale = 120 / bpm;
            let start_time = relativeX / zoom;

            if (isSnapping) {
                const snapIntervalReal = 15 / bpm; // 1/16 note
                const snapIntervalScaled = realToUnits(snapIntervalReal, timeScale);
                start_time = Math.round(start_time / snapIntervalScaled) * snapIntervalScaled;
            }

            // Four decimals, not two. Snapping produces multiples of 0.125,
            // and rounding those to 0.01 moved every other position back off
            // the grid it had just been snapped to: 0.125 became 0.13, 0.375
            // became 0.38.
            if (start_time < 0.05) {
                start_time = 0.0;
            } else {
                start_time = Math.round(start_time * 10000) / 10000;
            }

            const result = { trackId, start_time: Math.max(0, start_time), sampleId: item.sampleId };

            if (item.id) {
                onDrag(item.id, result.trackId, result.start_time);
            } else {
                onDrop(result.trackId, result.start_time, result.sampleId);
            }

            return result;
        },
        collect: (monitor) => ({
            isOver: !!monitor.isOver(),
        }),
    });

    const timeScale = 120 / bpm;
    const totalRealSeconds = unitsToReal(timelineDuration, timeScale);
    const minorInterval = 15 / bpm; // 1/16 note in real seconds
    const numMinorMarkers = Math.ceil(totalRealSeconds / minorInterval);

    return (
        <div
            ref={(node) => {
                timelineRef.current = node;
                drop(node);
            }}
            id={`timeline-${trackId}`}
            className={`relative h-12 border border-cyan-400/25 bg-cyan-400/5 ${isOver ? 'bg-cyan-400/10' : ''}`}
            style={{ width: `${timelineDuration * zoom}px` }}
        >
            {Array.from({ length: numMinorMarkers }, (_, i) => {
                const realTime = i * minorInterval;
                const scaledTime = realToUnits(realTime, timeScale);
                const pixelPosition = scaledTime * zoom;
                const isBarMarker = i % 16 === 0; // bar = 16 sixteenths
                const isBeatMarker = i % 4 === 0; // beat = 4 sixteenths

                return (
                    <div
                        key={`grid-${i}`}
                        className={`absolute top-0 z-0 border-l ${
                            isBarMarker
                                ? 'border-cyan-400/40 border-opacity-80 h-full'
                                : isBeatMarker
                                    ? 'border-gray-300 border-opacity-60 h-1/2'
                                    : 'border-gray-200 border-opacity-30 h-1/4'
                        }`}
                        style={{ left: `${pixelPosition}px` }}
                    />
                );
            })}
            {samples.map((sample) => (
                <SampleBlock
                    key={sample.id}
                    sample={sample}
                    trackId={trackId}
                    onDrag={onDrag}
                    volume={sample.volume ?? 1}
                    zoom={zoom}
                    duration={sampleDurations[sample.id] || 0}
                    timeScale={timeScale}
                    isLoadingDurations={isLoadingDurations}
                    waveformColor={waveformColor}
                    trackVolume={trackVolume}
                    onClipEdit={onClipEdit}
                    isSelected={selectedSampleId === sample.id}
                    onSelect={onSelectSample}
                    onDuplicate={onDuplicateClip}
                />
            ))}
            {/* Playhead bar */}
            <div
                className="absolute top-0 bottom-0 w-1 bg-red-500"
                ref={registerPlayhead}
                style={{ left: 0, transform: `translate3d(${playheadPosition * zoom}px, 0, 0)` }}
            />
        </div>
    );
};

const ClipSettingsModal = ({ clip, fullDuration, onClose, onSave }) => {
    const [fadeIn, setFadeIn] = useState(clip.fade_in || 0);
    const [fadeOut, setFadeOut] = useState(clip.fade_out || 0);
    const [trimStart, setTrimStart] = useState(clip.trim_start || 0);
    const [trimEnd, setTrimEnd] = useState(clip.trim_end != null ? clip.trim_end : '');
    const [volume, setVolume] = useState(clip.volume ?? 1);
    const [validationError, setValidationError] = useState(null);

    const handleSave = () => {
        const fi = Number(fadeIn) || 0;
        const fo = Number(fadeOut) || 0;
        const ts = Number(trimStart) || 0;
        const te = trimEnd === '' || trimEnd === null ? null : Number(trimEnd);
        const vol = Number(volume);
        if (!Number.isFinite(vol) || vol < 0 || vol > 4) {
            setValidationError('Volume must be between 0 and 4');
            return;
        }
        if (fi < 0 || fo < 0 || ts < 0) {
            setValidationError('Values cannot be negative');
            return;
        }
        if (te != null && te <= ts) {
            setValidationError('Trim end must be greater than trim start');
            return;
        }
        if (fullDuration && ts >= fullDuration) {
            setValidationError(`Trim start must be less than the sample length (${fullDuration.toFixed(2)}s)`);
            return;
        }
        onSave(clip.id, { fade_in: fi, fade_out: fo, trim_start: ts, trim_end: te, volume: vol });
        onClose();
    };

    const numberInputClass = "w-full px-3 py-2 bg-[#1d0a38] text-white border border-cyan-400/30 rounded-md text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500";

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-[#140628] text-gray-200 rounded-lg shadow-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-semibold mb-1">Clip Settings</h2>
                <p className="text-sm text-gray-400 mb-4">
                    {clip.name}{fullDuration ? ` — ${fullDuration.toFixed(2)}s` : ''}
                </p>
                {validationError && <p className="text-red-400 text-sm mb-3">{validationError}</p>}
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1" htmlFor="clip-volume">
                        Clip volume
                        <span className="ml-2 text-gray-400 font-normal">
                            {Math.round((Number(volume) || 0) * 100)}%
                        </span>
                    </label>
                    <input
                        id="clip-volume"
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="w-full"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                        This clip only, on top of the track fader. For the one hit that came
                        in louder than the rest of the take.
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Fade In (s)</label>
                        <input type="number" min="0" step="0.1" value={fadeIn}
                               onChange={(e) => setFadeIn(e.target.value)} className={numberInputClass} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Fade Out (s)</label>
                        <input type="number" min="0" step="0.1" value={fadeOut}
                               onChange={(e) => setFadeOut(e.target.value)} className={numberInputClass} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Trim Start (s)</label>
                        <input type="number" min="0" step="0.05" value={trimStart}
                               onChange={(e) => setTrimStart(e.target.value)} className={numberInputClass} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Trim End (s)</label>
                        <input type="number" min="0" step="0.05" value={trimEnd} placeholder="Full length"
                               onChange={(e) => setTrimEnd(e.target.value)} className={numberInputClass} />
                    </div>
                </div>
                <div className="flex justify-end space-x-3">
                    <button onClick={onClose}
                            className="retro-btn px-4 py-2 text-xs">
                        Cancel
                    </button>
                    <button onClick={handleSave}
                            className="retro-btn retro-btn--hot px-4 py-2 text-xs">
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * Playhead lines, moved without re-rendering.
 *
 * The engine calls back on every animation frame; every line registered here
 * gets a transform written straight to the DOM. React still renders the line's
 * resting position, which is what shows while stopped, paused or just seeked,
 * and the callback takes over while the transport runs.
 *
 * Elements are pruned by `isConnected` rather than by an unregister callback,
 * because a ref callback in React 18 cannot return a cleanup and lanes mount
 * and unmount as tracks come and go.
 */
function usePlayheadLines(zoom) {
    const elements = useRef(new Set());
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;

    const register = useCallback((el) => {
        if (el) elements.current.add(el);
    }, []);

    const onFrame = useCallback((units) => {
        const x = units * zoomRef.current;
        elements.current.forEach((el) => {
            if (!el.isConnected) {
                elements.current.delete(el);
                return;
            }
            el.style.transform = `translate3d(${x}px, 0, 0)`;
        });
    }, []);

    return { register, onFrame };
}

const MultiTrackSampler = () => {
    const { projectId } = useParams();
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const [saveState, setSaveState] = useState('idle');   // 'idle' | 'saving' | 'saved'
    const [lastSavedAt, setLastSavedAt] = useState(null);
    // Clicking Save blurs the title input first, which already fires a save.
    // setState is async, so saveState can't gate the duplicate - a ref can.
    const savingRef = useRef(null);   // holds the in-flight save promise
    const [project, setProject] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const [tracks, setTracks] = useState([]);
    // Mirrors `tracks` for handlers that need the current value rather than the
    // one captured when they were created, such as committing a track rename
    // from a blur that fires after several state updates.
    const tracksRef = useRef([]);

    const [projectSamples, setProjectSamples] = useState([]);
    const [librarySamples, setLibrarySamples] = useState([]);
    // Sample-library browsing. Every tile mounts its own WaveSurfer and fetches
    // its mp3, so the visible count is a real cost, not just a scrolling
    // nuisance — hence the render cap as well as the filter.
    const [sampleSearch, setSampleSearch] = useState('');
    const [sampleSort, setSampleSort] = useState('newest');
    const [showAllSamples, setShowAllSamples] = useState(false);
    const SAMPLE_PAGE_SIZE = 24;

    const visibleLibrarySamples = useMemo(() => {
        const q = sampleSearch.trim().toLowerCase();
        const matched = q
            ? librarySamples.filter((sample) => (sample.name || '').toLowerCase().includes(q))
            : librarySamples;

        const sorted = [...matched].sort((a, b) => {
            if (sampleSort === 'name') {
                return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
            }
            const at = new Date(a.created_at || 0).getTime();
            const bt = new Date(b.created_at || 0).getTime();
            return sampleSort === 'oldest' ? at - bt : bt - at;
        });

        return sorted;
    }, [librarySamples, sampleSearch, sampleSort]);

    // A search is an explicit request to see matches, so it bypasses the cap.
    const isSampleSearching = sampleSearch.trim().length > 0;
    const sampleRenderLimit = showAllSamples || isSampleSearching
        ? visibleLibrarySamples.length
        : SAMPLE_PAGE_SIZE;
    const renderedLibrarySamples = visibleLibrarySamples.slice(0, sampleRenderLimit);
    const hiddenSampleCount = visibleLibrarySamples.length - renderedLibrarySamples.length;

    const formatSampleDuration = (seconds) => {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value <= 0) return null;
        if (value < 10) return `${value.toFixed(1)}s`;
        const mins = Math.floor(value / 60);
        const secs = Math.round(value % 60);
        return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
    };
    const [newTrackName, setNewTrackName] = useState('');
    const [newTrackType, setNewTrackType] = useState('sample');
    // Two kinds of bad news, told two different ways.
    //
    // `loadError` means the project itself could not be fetched, so there is no
    // editor to show and the page is replaced. `notice` is everything else: a
    // failed mute toggle, an empty track name, a clip dropped on a MIDI track.
    //
    // These used to share one state, and any of them replaced the whole editor
    // with one line of red text and a Back to Projects link. Nothing cleared it,
    // so a mistyped track name meant leaving and reopening the project, while
    // playback carried on unseen underneath, because the rAF loop and the
    // WaveSurfer instances live in refs that a re-render does not touch.
    const [loadError, setLoadError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [isSnapping, setIsSnapping] = useState(true);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [bpm, setBpm] = useState(120);
    const [zoom, setZoom] = useState(100);
    const [sampleDurations, setSampleDurations] = useState({});
    const [isLoadingDurations, setIsLoadingDurations] = useState(false);
    // Export used to borrow isLoadingDurations as its busy flag, which is how a
    // render came to blank every waveform on the timeline. The drawing no
    // longer reads either flag, but the two states mean different things and
    // are worth keeping apart.
    const [isExporting, setIsExporting] = useState(false);
    const [isPublic, setIsPublic] = useState(false);
    const [timelineDuration, setTimelineDuration] = useState(30 * (120 / 120));
    const fileInputRef = useRef(null);
    const topTimelineRef = useRef(null);
    const [trackVolumes, setTrackVolumes] = useState({});
    const [trackPans, setTrackPans] = useState({});
    const [soloTracks, setSoloTracks] = useState({});
    // Declared above the playback hook, which reads it.
    const [metronomeOn, setMetronomeOn] = useState(false);

    // Playback, shared with the public player. See hooks/useProjectPlayback.js.
    //
    // The mix is passed explicitly here rather than derived from the track rows,
    // because in the editor all four of volume, pan, mute and solo are live
    // controls whose current values live in this component's state. The public
    // player has no such controls and lets the hook read the rows instead.
    const { register: registerPlayhead, onFrame: movePlayheads } = usePlayheadLines(zoom);

    const {
        isPlaying,
        isPaused,
        playheadPosition,
        toggle,
        stop: handleStop,
        seek: handleSeek,
    } = useProjectPlayback({
        tracks,
        projectSamples,
        sampleDurations,
        bpm,
        timelineDuration,
        // Memoised on purpose. The hook reapplies the mix whenever this object
        // changes identity, and the playhead sets state every animation frame,
        // so a fresh literal here would push volume, pan and mute onto every
        // player and every synth sixty times a second while a project plays.
        mix: useMemo(() => ({
            trackVolumes,
            trackPans,
            mutedTrackIds: tracks.filter(t => t.is_muted).map(t => t.id),
            soloTrackIds: Object.entries(soloTracks).filter(([, on]) => on).map(([id]) => Number(id)),
        }), [trackVolumes, trackPans, tracks, soloTracks]),
        metronome: metronomeOn,
        onError: setNotice,
        onFrame: movePlayheads,
    });
    const [selectedClip, setSelectedClip] = useState(null);
    const [selectedSampleId, setSelectedSampleId] = useState(null);
    // Mirrored for the keydown listener, which is bound once and would
    // otherwise read whatever the selection was when it was bound.
    const selectedSampleIdRef = useRef(null);
    const [selectedTrack, setSelectedTrack] = useState(null);
    const [minimizedTracks, setMinimizedTracks] = useState({});
    const [selectedTrackForEffects, setSelectedTrackForEffects] = useState(null);
    const [selectedTrackForGenerate, setSelectedTrackForGenerate] = useState(null);
    const [selectedTrackForLoop, setSelectedTrackForLoop] = useState(null);
    const metronomeRef = useRef(false);
    // Space and S reach playback through refs, so the keydown listener does not
    // have to be rebound every time these change identity.
    const playAllRef = useRef(null);
    const stopRef = useRef(null);
    const duplicateSelectedRef = useRef(null);
    const nudgeSelectedRef = useRef(null);

    useEffect(() => { selectedSampleIdRef.current = selectedSampleId; }, [selectedSampleId]);
    const deleteSelectedRef = useRef(null);
    const initializedTracks = useRef(new Set());

    useEffect(() => { tracksRef.current = tracks; }, [tracks]);

    // Notices clear themselves. Most are transient by nature and the successful
    // retry already sets them to null; this covers the ones with no follow-up
    // action, so a stale message does not sit above the timeline all session.
    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 8000);
        return () => clearTimeout(timer);
    }, [notice]);

    // Initialize minimized state for MIDI tracks
    useEffect(() => {
        setMinimizedTracks(prev => {
            const newMinimized = { ...prev };
            tracks.forEach(track => {
                if (track.track_type === 'midi' && newMinimized[track.id] === undefined) {
                    newMinimized[track.id] = track.instrument_type === 'drumsampler' ? false : true; // Default non-drum to minimized
                    initializedTracks.current.add(track.id);
                }
            });
            return newMinimized;
        });
    }, [tracks]);

    // Levels and pans, derived from the track rows.
    //
    // Keyed on a signature rather than on `tracks`, because `tracks` also
    // changes on every MIDI note edit, and rebuilding and re-setting both maps
    // for a note that moved by a sixteenth is two renders for nothing.
    const derivedMix = useMemo(() => {
        const volumes = {};
        const pans = {};
        tracks.forEach(track => {
            volumes[track.id] = track.volume ?? 1;
            pans[track.id] = track.pan ?? 0;
        });
        return {
            volumes,
            pans,
            signature: tracks.map(t => `${t.id}:${volumes[t.id]}:${pans[t.id]}`).join('|'),
        };
    }, [tracks]);

    // Read through a ref so the signature is the only dependency: the memo hands
    // back fresh objects on every tracks change, and listing them here would
    // re-run this exactly as often as keying on `tracks` did.
    const derivedMixRef = useRef(derivedMix);
    derivedMixRef.current = derivedMix;

    useEffect(() => {
        setTrackVolumes(derivedMixRef.current.volumes);
        setTrackPans(derivedMixRef.current.pans);
    }, [derivedMix.signature]);

    // A track is audible unless muted, or another track is soloed and this one isn't
    const isTrackAudible = (trackId) => {
        const track = tracks.find(t => t.id === trackId);
        if (track?.is_muted) return false;
        const anySolo = Object.values(soloTracks).some(Boolean);
        if (anySolo && !soloTracks[trackId]) return false;
        return true;
    };

    const getEffectiveTrackGain = (trackId) => (isTrackAudible(trackId) ? (trackVolumes[trackId] ?? 1) : 0);

    const handleToggleMute = async (trackId) => {
        const track = tracks.find(t => t.id === trackId);
        const newMuted = !track?.is_muted;
        setTracks(prev => prev.map(t => (t.id === trackId ? { ...t, is_muted: newMuted } : t)));
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                { is_muted: newMuted },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setNotice(null);
        } catch (err) {
            console.error('Toggle mute error:', err.response?.data || err.message);
            setTracks(prev => prev.map(t => (t.id === trackId ? { ...t, is_muted: !newMuted } : t)));
            setNotice('Failed to update mute: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleToggleSolo = (trackId) => {
        setSoloTracks(prev => ({ ...prev, [trackId]: !prev[trackId] }));
    };

    const handleClipSettingsSave = async (sampleId, clipSettings) => {
        const prevSample = projectSamples.find(s => s.id === sampleId);
        setProjectSamples(prev => prev.map(s => (s.id === sampleId ? { ...s, ...clipSettings } : s)));
        try {
            const token = localStorage.getItem('token');
            const response = await axios.put(
                `${API_URL}/projects/${projectId}/samples/${sampleId}`,
                clipSettings,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProjectSamples(prev => prev.map(s => (s.id === sampleId ? { ...s, ...response.data } : s)));
            setNotice(null);
        } catch (err) {
            console.error('Update clip settings error:', err.response?.data || err.message);
            if (prevSample) {
                setProjectSamples(prev => prev.map(s => (s.id === sampleId ? prevSample : s)));
            }
            setNotice('Failed to update clip settings: ' + (err.response?.data?.error || err.message));
        }
    };


    useEffect(() => {
        const handleKeyDown = (e) => {
            const target = e.target;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
            const accel = e.ctrlKey || e.metaKey; // Cmd on a Mac, Ctrl elsewhere
            if (accel && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if (accel && ((e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
                // Ctrl+Y is the Windows redo; Cmd+Shift+Z is the Mac one.
                e.preventDefault();
                redo();
            } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && !e.altKey) {
                e.preventDefault();
                duplicateSelectedRef.current?.();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelectedRef.current?.();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                // Only when a clip is selected, so the arrows still scroll the
                // timeline the rest of the time.
                if (!selectedSampleIdRef.current) return;
                e.preventDefault();
                nudgeSelectedRef.current?.(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
            } else if (e.key === 'Escape') {
                setSelectedSampleId(null);
            } else if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                playAllRef.current?.();
            } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                stopRef.current?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [history, historyIndex]);

    // Clip lengths, shared with the public player. A clip whose row already
    // carries a duration is taken as read, so an established project costs no
    // network at all. The rest come from the shared buffer cache, which is the
    // same decode the waveform drawing and playback use, so a missing duration
    // costs one fetch for all three. See utils/audioBuffers.js.
    useEffect(() => {
        let cancelled = false;
        if (projectSamples.length === 0) {
            setSampleDurations({});
            return undefined;
        }
        const everythingCached = projectSamples.every(sample => {
            const cached = Number(sample.duration);
            return Number.isFinite(cached) && cached > 0;
        });
        // Only block the transport when something actually has to be fetched.
        if (!everythingCached) setIsLoadingDurations(true);

        loadSampleDurations(projectSamples)
            .then(({ durations }) => { if (!cancelled) setSampleDurations(durations); })
            .catch(err => {
                console.error('Error loading clip durations:', err.message);
                if (!cancelled) setSampleDurations({});
            })
            .finally(() => { if (!cancelled) setIsLoadingDurations(false); });

        return () => { cancelled = true; };
    }, [projectSamples]);

    useEffect(() => {
        const calculateTimelineDuration = () => {
            const timeScale = 120 / bpm;
            let maxEndTime = 0;

            // maxEndTime is in timeline units: clip starts already are, but clip
            // and note lengths are real seconds and need converting first
            if (projectSamples.length > 0 && Object.keys(sampleDurations).length > 0) {
                maxEndTime = projectSamples.reduce((max, sample) => {
                    const duration = sampleDurations[sample.id] || 0;
                    const endTime = sample.start_time + realToUnits(duration, timeScale);
                    return Math.max(max, endTime);
                }, 0);
            }

            tracks.forEach(track => {
                if (track.track_type === 'midi' && track.midi_notes) {
                    const maxNoteEnd = track.midi_notes.reduce((max, note) => {
                        return Math.max(max, note.start_time + note.duration);
                    }, 0);
                    maxEndTime = Math.max(maxEndTime, maxNoteEnd);
                }
            });

            // Headroom and floor are musical (units), so the canvas length does
            // not jump around when the tempo changes
            const buffer = 10; // 5 bars
            const minDuration = 30; // 15 bars
            setTimelineDuration(Math.max(maxEndTime + buffer, minDuration));
        };

        calculateTimelineDuration();
    }, [projectSamples, sampleDurations, tracks, bpm]);

    useEffect(() => {
        const fetchProject = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/projects/${projectId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const { project, tracks, projectSamples, librarySamples } = response.data;
                const normalizedTracks = tracks.map(track => ({
                    ...track,
                    is_polyphonic: typeof track.is_polyphonic === 'undefined' ? false : !!track.is_polyphonic,
                    midi_notes: track.midi_notes == null ? [] : track.midi_notes,
                }));
                setProject(project || null);
                setTracks(Array.isArray(normalizedTracks) ? normalizedTracks : []);
                setProjectSamples(Array.isArray(projectSamples) ? projectSamples : []);
                setLibrarySamples(Array.isArray(librarySamples) ? librarySamples : []);
                setIsPublic(project.is_public || false);
                setEditTitle(project.title || '');
                setBpm(project.bpm || 120);
            } catch (err) {
                console.error('Fetch project error:', {
                    status: err.response?.status,
                    data: err.response?.data,
                    message: err.message,
                });
                const errorMessage = err.response?.status === 404
                    ? `Project with ID ${projectId} not found. It may not exist or you lack access.`
                    : err.response?.status === 403
                        ? `You do not have permission to access project ${projectId}.`
                        : 'Failed to fetch project: ' + (err.response?.data?.error || err.message);
                setLoadError(errorMessage);
            }
        };
        if (user) fetchProject();
    }, [projectId, user]);


    const handleEffectsChange = async (trackId, newEffectsSettings) => {
        const previousTrack = tracks.find(t => t.id === trackId);
        const previousSettings = {
            effects_settings: previousTrack?.effects_settings || {}
        };

        // Optimistically update local state
        setTracks(prev => {
            const updatedTracks = prev.map(t =>
                t.id === trackId ? { ...t, effects_settings: newEffectsSettings } : t
            );
            return updatedTracks;
        });

        try {
            const token = localStorage.getItem('token');
            const payload = { effects_settings: newEffectsSettings };
            const response = await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                payload,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            // Refresh project data
            const projectResponse = await axios.get(`${API_URL}/projects/${projectId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const { project, tracks: fetchedTracks, projectSamples, librarySamples } = projectResponse.data;
            const normalizedTracks = fetchedTracks.map(track => ({
                ...track,
                is_polyphonic: typeof track.is_polyphonic === 'undefined' ? false : !!track.is_polyphonic,
                midi_notes: track.midi_notes == null ? [] : track.midi_notes,
            }));
            setTracks(normalizedTracks);
            setProject(project);
            setProjectSamples(projectSamples);
            setLibrarySamples(librarySamples);
            setIsPublic(project.is_public);
            setBpm(project.bpm || 120);
            setEditTitle(project.title);

            setNotice(null);
        } catch (err) {
            console.error('Update effects settings error:', err.response?.data || err.message);
            setNotice(`Failed to save effects: ${err.response?.data?.error || err.message}`);
            // Revert optimistic update
            setTracks(prev => {
                const revertedTracks = prev.map(t =>
                    t.id === trackId ? { ...t, effects_settings: previousSettings.effects_settings } : t
                );
                return revertedTracks;
            });
        }
    };

    const toggleTrackMinimize = (trackId) => {
        setMinimizedTracks(prev => {
            const newState = {
                ...prev,
                [trackId]: prev[trackId] === undefined ? true : !prev[trackId], // Default to minimized
            };
            return newState;
        });
    };

    const handleSettingsChange = (trackId, settings) => {
        setTracks(prev =>
            prev.map(track =>
                track.id === trackId ? { ...track, synth_settings: settings } : track
            )
        );
    };

    const handleInstrumentChange = async (trackId, newInstrument) => {
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                { instrument_type: newInstrument },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setTracks(prev =>
                prev.map(track =>
                    track.id === trackId ? { ...track, instrument_type: newInstrument } : track
                )
            );
        } catch (err) {
            console.error('Update instrument error:', err.response?.data || err.message);
            setNotice(`Failed to save instrument: ${err.response?.data?.error || err.message}`);
        }
    };

    const handlePolyphonicChange = async (trackId, newPolyphonic) => {
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                { is_polyphonic: newPolyphonic },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setTracks(prev =>
                prev.map(track =>
                    track.id === trackId ? { ...track, is_polyphonic: newPolyphonic } : track
                )
            );
        } catch (err) {
            console.error('Update polyphonic error:', err.response?.data || err.message);
            setNotice(`Failed to save polyphonic setting: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleTrackSettingsChange = async (trackId, settings) => {
        const previousTrack = tracks.find(t => t.id === trackId);
        const previousSettings = {
            volume: trackVolumes[trackId] ?? 1,
            pan: trackPans[trackId] ?? 0,
            instrument_type: previousTrack?.instrument_type || 'synth',
            is_polyphonic: previousTrack?.is_polyphonic || false,
            synth_settings: previousTrack?.synth_settings || {}
        };

        // Optimistically update local state
        if (settings.volume !== undefined) {
            setTrackVolumes(prev => ({ ...prev, [trackId]: settings.volume }));
        }
        if (settings.pan !== undefined) {
            setTrackPans(prev => ({ ...prev, [trackId]: settings.pan }));
        }
        setTracks(prev =>
            prev.map(t =>
                t.id === trackId
                    ? {
                        ...t,
                        volume: settings.volume ?? t.volume,
                        pan: settings.pan ?? t.pan,
                        instrument_type: settings.instrument_type ?? t.instrument_type,
                        is_polyphonic: settings.is_polyphonic ?? t.is_polyphonic,
                        synth_settings: settings.synth_settings ?? t.synth_settings
                    }
                    : t
            )
        );

        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                settings,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setNotice(null);
        } catch (err) {
            console.error('Update track settings error:', err.response?.data || err.message);
            setNotice(`Failed to save settings: ${err.response?.data?.error || err.message}`);
            // Revert optimistic updates on error
            setTrackVolumes(prev => ({ ...prev, [trackId]: previousSettings.volume }));
            setTrackPans(prev => ({ ...prev, [trackId]: previousSettings.pan }));
            setTracks(prev =>
                prev.map(t =>
                    t.id === trackId
                        ? {
                            ...t,
                            volume: previousSettings.volume,
                            instrument_type: previousSettings.instrument_type,
                            is_polyphonic: previousSettings.is_polyphonic,
                            synth_settings: previousSettings.synth_settings
                        }
                        : t
                )
            );
        }
    };

    const handleSaveTitle = async () => {
        if (!editTitle.trim()) {
            setNotice('Project title cannot be empty');
            setSaveState('idle');
            return false;
        }
        // Clicking Save blurs the input, which already fires a save. Rather
        // than drop the second call (Save & Exit would then never leave) or
        // duplicate the PUT, later callers join the in-flight save.
        if (savingRef.current) return savingRef.current;

        const inFlight = (async () => {
            setSaveState('saving');
            try {
                const token = localStorage.getItem('token');
                await axios.put(
                    `${API_URL}/projects/${projectId}`,
                    { title: editTitle.trim(), is_public: project.is_public },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                setProject(prev => ({ ...prev, title: editTitle.trim() }));
                setNotice(null);
                setLastSavedAt(new Date());
                setSaveState('saved');
                return true;
            } catch (err) {
                console.error('Save title error:', err.response?.data || err.message);
                setNotice('Failed to save project title: ' + (err.response?.data?.error || err.message));
                setSaveState('idle');
                return false;
            }
        })();

        savingRef.current = inFlight;
        try {
            return await inFlight;
        } finally {
            savingRef.current = null;
        }
    };

    // Arrangement edits each persist as they happen, so this is a confirmation
    // affordance more than a flush: it commits the one genuinely pending edit
    // (the title) and gives an explicit "your work is stored" signal.
    const handleSaveProject = async () => {
        await handleSaveTitle();
    };

    const handleSaveAndExit = async () => {
        const ok = await handleSaveTitle();
        if (ok) navigate('/projects');
    };

    const handleVolumeChange = async (trackId, newVolume) => {
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                { volume: newVolume },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setTracks(prev =>
                prev.map(track =>
                    track.id === trackId ? { ...track, volume: newVolume } : track
                )
            );
            setTrackVolumes(prev => ({ ...prev, [trackId]: newVolume }));
        } catch (err) {
            console.error('Update volume error:', err.response?.data || err.message);
            setNotice(`Failed to save volume: ${err.response?.data?.error || err.message}`);
        }
    };

    // Persist the project tempo.
    //
    // The field keeps its own draft string rather than being driven straight
    // from `bpm`. Clamping on every keystroke made anything under 100
    // untypeable: "9" became 60 immediately, and the "0" that followed made
    // "600", which clamped to 240. Emptying the field to retype snapped it to
    // 120. The draft lets a half-typed number exist, and the clamp happens once
    // the value is committed.
    //
    // A value that is already valid still updates `bpm` live, so playback and
    // the grid follow along while typing, and still autosaves on the debounce.
    // Commit on blur or Enter covers everything else.
    const bpmSaveTimerRef = useRef(null);
    const pendingBpmRef = useRef(null);
    const [bpmDraft, setBpmDraft] = useState('');

    // Follow the project's tempo whenever it changes from anywhere but this
    // field: initial load, and the reset after a commit.
    useEffect(() => { setBpmDraft(String(bpm)); }, [bpm]);

    const saveBpm = (value) => {
        pendingBpmRef.current = value;
        if (bpmSaveTimerRef.current) clearTimeout(bpmSaveTimerRef.current);
        bpmSaveTimerRef.current = setTimeout(() => flushBpmSave(), 600);
    };

    const flushBpmSave = async () => {
        if (bpmSaveTimerRef.current) {
            clearTimeout(bpmSaveTimerRef.current);
            bpmSaveTimerRef.current = null;
        }
        const value = pendingBpmRef.current;
        if (value == null) return;
        pendingBpmRef.current = null;
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}`,
                { bpm: value },
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch (err) {
            console.error('Save BPM error:', err.response?.data || err.message);
            setNotice('Failed to save BPM: ' + (err.response?.data?.error || err.message));
        }
    };

    // While typing: accept anything, and only act on a value already in range.
    const handleBpmInput = (text) => {
        setBpmDraft(text);
        const parsed = Number(text);
        if (text.trim() === '' || !Number.isFinite(parsed)) return;
        if (parsed < 60 || parsed > 240) return;
        const value = Math.round(parsed);
        setBpm(value);
        setProject(prev => (prev ? { ...prev, bpm: value } : prev));
        saveBpm(value);
    };

    // On blur or Enter: clamp whatever is there and make it the tempo.
    const handleBpmCommit = () => {
        const parsed = Number(bpmDraft);
        const value = Number.isFinite(parsed) && bpmDraft.trim() !== ''
            ? Math.max(60, Math.min(240, Math.round(parsed)))
            : bpm;
        setBpmDraft(String(value));
        if (value !== bpm) {
            setBpm(value);
            setProject(prev => (prev ? { ...prev, bpm: value } : prev));
            saveBpm(value);
        }
    };

    // Flush rather than drop. Clearing the timer alone lost a tempo change made
    // within 600ms of clicking Save & Exit or any nav link.
    const flushBpmRef = useRef(flushBpmSave);
    flushBpmRef.current = flushBpmSave;
    useEffect(() => () => { flushBpmRef.current(); }, []);

    const handleTogglePublic = async () => {
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}`,
                { is_public: !isPublic },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setIsPublic(!isPublic);
            setProject(prev => ({ ...prev, is_public: !isPublic }));
        } catch (err) {
            console.error('Toggle public error:', err.response?.data || err.message);
            setNotice('Failed to update project visibility: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleExport = async () => {
        try {
            setIsExporting(true);
            const timeScale = 120 / bpm;
            let totalRealSeconds = unitsToReal(timelineDuration, timeScale);

            const sampleRate = 44100;
            const offlineContext = new OfflineAudioContext(2, Math.ceil(sampleRate * totalRealSeconds), sampleRate);

            for (const sample of projectSamples) {
                const track = tracks.find(t => t.id === sample.track_id);
                const trackGain = getEffectiveTrackGain(sample.track_id);
                if (trackGain <= 0) continue;

                const response = await fetch(sample.mp3_url);
                if (!response.ok) throw new Error(`Failed to fetch sample: ${sample.mp3_url}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await offlineContext.decodeAudioData(arrayBuffer);

                const { trimStart, effDuration } = getClipTimes(sample, audioBuffer.duration);
                if (effDuration <= 0) continue;

                const source = offlineContext.createBufferSource();
                source.buffer = audioBuffer;
                const gainNode = offlineContext.createGain();
                const panner = offlineContext.createStereoPanner();
                panner.pan.value = track?.pan ?? 0;

                const baseGain = (sample.volume ?? 1) * trackGain;
                const when = unitsToReal(sample.start_time, timeScale);
                const fadeIn = Math.min(sample.fade_in || 0, effDuration);
                const fadeOut = Math.min(sample.fade_out || 0, effDuration);
                if (fadeIn > 0) {
                    gainNode.gain.setValueAtTime(0, when);
                    gainNode.gain.linearRampToValueAtTime(baseGain, when + fadeIn);
                } else {
                    gainNode.gain.setValueAtTime(baseGain, when);
                }
                if (fadeOut > 0) {
                    const fadeOutStart = Math.max(when + effDuration - fadeOut, when + fadeIn);
                    gainNode.gain.setValueAtTime(baseGain, fadeOutStart);
                    gainNode.gain.linearRampToValueAtTime(0, when + effDuration);
                }

                source.connect(gainNode);
                gainNode.connect(panner);
                panner.connect(offlineContext.destination);
                source.start(when, trimStart, effDuration);
            }

            for (const track of tracks) {
                if (track.track_type === 'midi' && track.midi_notes) {
                    const trackGain = getEffectiveTrackGain(track.id);
                    if (trackGain <= 0) continue;
                    const instrumentType = track.instrument_type || 'synth';
                    if (instrumentType === 'drumsampler') {
                        continue;
                    }
                    const trackPanner = offlineContext.createStereoPanner();
                    trackPanner.pan.value = track.pan ?? 0;
                    trackPanner.connect(offlineContext.destination);
                    track.midi_notes.forEach(note => {
                        const oscillator = offlineContext.createOscillator();
                        const gainNode = offlineContext.createGain();
                        const frequency = Tone.Frequency(note.note).toFrequency();
                        oscillator.frequency.setValueAtTime(frequency, 0);
                        oscillator.type = 'sine';
                        gainNode.gain.setValueAtTime(trackGain * 0.5, 0);
                        oscillator.connect(gainNode);
                        gainNode.connect(trackPanner);
                        oscillator.start(unitsToReal(note.start_time, timeScale));
                        oscillator.stop(unitsToReal(note.start_time + note.duration, timeScale));
                    });
                }
            }

            const renderedBuffer = await offlineContext.startRendering();

            try {
                const mp3Encoder = new lamejs.Mp3Encoder(2, sampleRate, 192);
                const samplesLeft = renderedBuffer.getChannelData(0);
                const samplesRight = renderedBuffer.getChannelData(1);
                const sampleBlockSize = 1152;
                const mp3Data = [];

                for (let i = 0; i < samplesLeft.length; i += sampleBlockSize) {
                    const leftChunk = samplesLeft.subarray(i, i + sampleBlockSize);
                    const rightChunk = samplesRight.subarray(i, i + sampleBlockSize);
                    const left = new Int16Array(leftChunk.length);
                    const right = new Int16Array(rightChunk.length);

                    for (let j = 0; j < leftChunk.length; j++) {
                        left[j] = Math.max(-1, Math.min(1, leftChunk[j])) * 0x7FFF;
                        right[j] = Math.max(-1, Math.min(1, rightChunk[j] || 0)) * 0x7FFF;
                    }

                    const mp3buf = mp3Encoder.encodeBuffer(left, right);
                    if (mp3buf.length > 0) {
                        mp3Data.push(mp3buf);
                    }
                }

                const mp3buf = mp3Encoder.flush();
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }

                const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
                const url = URL.createObjectURL(mp3Blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${project.title || 'project'}.mp3`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (mp3Error) {
                console.warn('MP3 encoding failed:', mp3Error.message);
                const wavBuffer = bufferToWave(renderedBuffer);
                const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
                const url = URL.createObjectURL(wavBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${project.title || 'project'}.wav`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setNotice('MP3 encoding failed, exported as WAV instead');
            }

            setNotice(null);
        } catch (err) {
            console.error('Export error:', err.message);
            setNotice('Failed to export project: ' + err.message);
        } finally {
            setIsExporting(false);
        }
    };

    const pushToHistory = (action) => {
        setHistory(prev => [...prev.slice(0, historyIndex + 1), action]);
        setHistoryIndex(prev => prev + 1);
    };

    /**
     * Undo and redo, against the server.
     *
     * These used to change local state only. Everything except a MIDI edit was
     * a lie that a page reload exposed: undoing a delete showed a clip whose
     * row was gone, and undoing an add hid one the server still had. The label
     * above the timeline says changes save automatically, so undo has to save
     * too, or it should not be offered.
     *
     * Track add and delete are no longer recorded. A deleted track now takes
     * its clips with it through a foreign key, and an undo that restored the
     * track on screen while the rows stayed deleted was worse than no undo,
     * because it looked like it had worked. Bringing a track and all its clips
     * back is a real feature rather than a history entry, and is not attempted.
     *
     * Recreating a clip gives it a new id, so the history entry is rewritten
     * with the id that now exists. Without that a later redo would chase a row
     * that is not there.
     */
    const historyBusyRef = useRef(false);

    const authHeaders = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    /** Move a clip to a stored position, on screen and on the server. */
    const applyClipPosition = async (sampleId, position) => {
        setProjectSamples(prev => prev.map(s => (s.id === sampleId ? { ...s, ...position } : s)));
        await axios.put(
            `${API_URL}/projects/${projectId}/samples/${sampleId}`,
            position,
            authHeaders()
        );
    };

    /** Put a removed clip back, and hand back the id it returned with. */
    const recreateClip = async (sample) => {
        const response = await axios.post(
            `${API_URL}/projects/${projectId}/samples`,
            {
                track_id: sample.track_id,
                sample_id: sample.sample_id,
                start_time: sample.start_time,
                fade_in: sample.fade_in || 0,
                fade_out: sample.fade_out || 0,
                trim_start: sample.trim_start || 0,
                trim_end: sample.trim_end ?? null,
                volume: sample.volume ?? 1,
            },
            authHeaders()
        );
        setProjectSamples(prev => [...prev, response.data]);
        return response.data;
    };

    const removeClip = async (sampleId) => {
        setProjectSamples(prev => prev.filter(s => s.id !== sampleId));
        await axios.delete(`${API_URL}/projects/${projectId}/samples/${sampleId}`, authHeaders());
    };

    /** Rewrite a history entry after a recreate handed back a different id. */
    const rememberNewId = (index, sample) => {
        setHistory(prev => prev.map((entry, i) => (i === index ? { ...entry, data: sample } : entry)));
    };

    const runHistoryStep = async (action, index, forward) => {
        switch (action.type) {
            case 'addSample':
                if (forward) rememberNewId(index, await recreateClip(action.data));
                else await removeClip(action.data.id);
                break;
            case 'deleteSample':
                if (forward) await removeClip(action.data.id);
                else rememberNewId(index, await recreateClip(action.data));
                break;
            case 'dragSample':
                await applyClipPosition(action.data.sampleId, forward ? action.data.after : action.data.before);
                break;
            case 'midiChange':
                saveMidiNotes(action.data.trackId, forward ? action.data.newNotes : action.data.prevNotes);
                break;
            default:
                break;
        }
    };

    const stepHistory = async (direction) => {
        if (historyBusyRef.current) return;
        const forward = direction === 'redo';
        const index = forward ? historyIndex + 1 : historyIndex;
        if (forward ? index >= history.length : index < 0) return;

        historyBusyRef.current = true;
        try {
            await runHistoryStep(history[index], index, forward);
            setHistoryIndex(prev => (forward ? prev + 1 : prev - 1));
            setNotice(null);
        } catch (err) {
            console.error(`${direction} failed:`, err.response?.data || err.message);
            // The index stays put, so the same step can be retried rather than
            // the history quietly drifting out of step with the server.
            setNotice(`Could not ${direction}: ${err.response?.data?.error || err.message}`);
        } finally {
            historyBusyRef.current = false;
        }
    };

    const undo = () => stepHistory('undo');
    const redo = () => stepHistory('redo');

    // Grow the timeline when content lands near its end.
    // Both args are in timeline units. Audio clip lengths are real seconds, so
    // those callers convert with realToUnits() first. See the unit convention at
    // the top of this file.
    const extendTimelineIfNeeded = (startTime, durationUnits) => {
        const endTime = startTime + durationUnits;
        const threshold = 5; // units of headroom to keep ahead of content

        if (endTime >= timelineDuration - threshold) {
            setTimelineDuration(prev => prev + 10);
        }
    };

    const handleNotesChange = (trackId, newNotes) => {
        setTracks(prev => {
            const updatedTracks = prev.map(track => ({
                ...track,
                midi_notes: track.id === trackId ? newNotes : track.midi_notes,
            }));
            return updatedTracks;
        });
    };

    // Persist MIDI notes without touching history (used by undo/redo)
    const saveMidiNotes = async (trackId, notesToSave) => {
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}/midi`,
                { midi_notes: notesToSave },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            handleNotesChange(trackId, notesToSave);
        } catch (err) {
            console.error('Failed to save MIDI notes:', err.response?.data || err.message);
            setNotice('Failed to save MIDI notes: ' + (err.response?.data?.error || err.message));
        }
    };

    // PianoRoll already persisted the notes; record the edit for undo/redo
    const handlePianoRollNotesChange = (trackId, newNotes) => {
        const prevNotes = tracks.find(t => t.id === trackId)?.midi_notes || [];
        pushToHistory({ type: 'midiChange', data: { trackId, prevNotes, newNotes } });
        handleNotesChange(trackId, newNotes);
    };

    // Save generated MIDI notes to a track (used by the ✨ generate modal)
    const handleApplyGeneratedNotes = async (trackId, newNotes) => {
        const prevNotes = tracks.find(t => t.id === trackId)?.midi_notes || [];
        const token = localStorage.getItem('token');
        await axios.put(
            `${API_URL}/projects/${projectId}/tracks/${trackId}/midi`,
            { midi_notes: newNotes },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        pushToHistory({ type: 'midiChange', data: { trackId, prevNotes, newNotes } });
        handleNotesChange(trackId, newNotes);
    };

    // Place an AI-generated loop (already copied into the sample library by the
    // ✨ generate modal) onto a sample track at the playhead
    const handleApplyGeneratedLoop = async (trackId, librarySample) => {
        setLibrarySamples(prev => [...prev, librarySample]);

        const timeScale = 120 / bpm;
        let start_time = playheadPosition;
        if (isSnapping) {
            const snapIntervalScaled = realToUnits(15 / bpm, timeScale); // 1/16 note
            start_time = Math.round(start_time / snapIntervalScaled) * snapIntervalScaled;
        }
        start_time = Math.max(0, Math.round(start_time * 1000) / 1000);

        const token = localStorage.getItem('token');
        const response = await axios.post(
            `${API_URL}/projects/${projectId}/samples`,
            { track_id: trackId, sample_id: librarySample.id, start_time },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        setProjectSamples(prev => {
            pushToHistory({ type: 'addSample', data: response.data });
            extendTimelineIfNeeded(start_time, realToUnits(librarySample.duration || 0, timeScale));
            return [...prev, response.data];
        });
        setSelectedSampleId(response.data.id);
        setNotice(null);
    };

    // Play, pause, stop and seek all live in useProjectPlayback now, along with
    // the transport, the per-clip players, the synths and the playhead loop.
    // See hooks/useProjectPlayback.js: this page and the public player were
    // running two copies of it, and the copies had stopped agreeing.
    // Not gated on the duration probe. Clip length at play time comes from the
    // decoded buffer; the probe only feeds pre-play layout, and waiting on it
    // meant one stalled probe made the project unplayable.
    const handlePlayAllClick = () => toggle();

    playAllRef.current = handlePlayAllClick;
    stopRef.current = handleStop;

    const handleTopTimelineClick = (e) => {
        if (!topTimelineRef.current) return;
        const rect = topTimelineRef.current.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        let clickedTime = relativeX / zoom;
        const timeScale = 120 / bpm;

        if (isSnapping) {
            const snapIntervalReal = 15 / bpm; // 1/16 note
            const snapIntervalScaled = realToUnits(snapIntervalReal, timeScale);
            clickedTime = Math.round(clickedTime / snapIntervalScaled) * snapIntervalScaled;
        }

        // Four decimals, matching the drop handler, so a snapped seek lands on
        // the same grid line a snapped clip does.
        clickedTime = Math.max(0, Math.round(clickedTime * 10000) / 10000);
        handleSeek(clickedTime);
    };

    const handleAddTrack = async (e) => {
        e.preventDefault();
        if (!newTrackName) {
            setNotice('Track name is required');
            return;
        }
        try {
            const token = localStorage.getItem('token');
            const response = await axios.post(
                `${API_URL}/projects/${projectId}/tracks`,
                { name: newTrackName, track_type: newTrackType },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setTracks(prev => {
                const updatedTracks = [...prev, response.data];
                return updatedTracks;
            });
            setNewTrackName('');
            setNewTrackType('sample');
            setNotice(null);
        } catch (err) {
            console.error('Add track error:', err.message);
            setNotice('Failed to add track: ' + err.message);
        }
    };

    const handleDeleteTrack = async (trackId) => {
        try {
            const token = localStorage.getItem('token');
            // The clips go with it in the database, through
            // fk_project_samples_track, so the local state mirrors that rather
            // than deleting them one by one.
            await axios.delete(`${API_URL}/projects/${projectId}/tracks/${trackId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setTracks(prev => prev.filter(t => t.id !== trackId));
            setProjectSamples(prev => prev.filter(s => s.track_id !== trackId));
            setNotice(null);
        } catch (err) {
            console.error('Delete track error:', err.response?.data || err.message);
            setNotice('Failed to delete track: ' + (err.response?.data?.error || err.message));
        }
    };

    // Renaming a track.
    //
    // This used to PUT on every keystroke and only update state after the
    // response, using the `tracks` array captured when the handler was created.
    // Typed characters appeared a round trip late, responses arriving out of
    // order could revert text, and the empty-string guard meant the last
    // character could never be deleted.
    //
    // Now the field is local and immediate, and the save happens once, on blur
    // or Enter. The name held at focus is what an empty field reverts to.
    const renameOriginalRef = useRef({});

    const handleTrackNameFocus = (trackId, currentName) => {
        renameOriginalRef.current[trackId] = currentName;
    };

    const handleTrackNameInput = (trackId, newName) => {
        setTracks(prev => prev.map(track => (
            track.id === trackId ? { ...track, name: newName } : track
        )));
    };

    const handleTrackNameCommit = async (trackId) => {
        const original = renameOriginalRef.current[trackId];
        const current = (tracksRef.current.find(t => t.id === trackId)?.name ?? '').trim();

        // An empty name is not a rename, it is a half-finished edit.
        if (!current) {
            if (original != null) handleTrackNameInput(trackId, original);
            return;
        }
        if (current === original) return;

        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                { name: current },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            renameOriginalRef.current[trackId] = current;
        } catch (err) {
            console.error('Rename track error:', err.response?.data || err.message);
            setNotice('Failed to rename track: ' + (err.response?.data?.error || err.message));
            if (original != null) handleTrackNameInput(trackId, original);
        }
    };

    const handleFileUpload = async (e) => {
        const files = Array.from(e.target.files);
        const isWav = (file) => file.type.includes('audio/wav') || file.type.includes('audio/x-wav') || /\.wav$/i.test(file.name);
        const validFiles = files.filter(
            (file) =>
                (file.type.includes('audio/mpeg') && file.size <= 10 * 1024 * 1024) ||
                (isWav(file) && file.size <= 50 * 1024 * 1024)
        );
        if (validFiles.length !== files.length) {
            setNotice('Some files are invalid (MP3 max 10MB, WAV max 50MB)');
            return;
        }
        try {
            const token = localStorage.getItem('token');
            for (const file of validFiles) {
                const formData = new FormData();
                formData.append('mp3', file);
                const response = await axios.post(
                    `${API_URL}/sample-library`,
                    formData,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'multipart/form-data',
                        },
                    }
                );
                // Functional update: this runs inside the upload loop, and
                // spreading the captured array meant every iteration rebuilt the
                // list from its pre-upload state, keeping only the last file.
                setLibrarySamples(prev => [...prev, response.data]);
            }
            setNotice(null);
        } catch (err) {
            console.error('Upload samples error:', err.response?.data || err.message);
            setNotice('Failed to upload samples: ' + (err.response?.data?.error || err.message));
        }
        e.target.value = '';
    };

    const handleDeleteLibrarySample = async (sampleId) => {
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/sample-library/${sampleId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setLibrarySamples(prev => prev.filter((sample) => sample.id !== sampleId));
            setNotice(null);
        } catch (err) {
            console.error('Delete sample error:', err.response?.data || err.message);
            setNotice(err.response?.data?.error || 'Failed to delete sample');
        }
    };

    const handleDrop = async (trackId, start_time, sampleId) => {
        try {
            const track = tracks.find(t => t.id === trackId);
            if (track.track_type === 'midi') {
                setNotice('Cannot drop samples on MIDI tracks');
                return;
            }
            const token = localStorage.getItem('token');
            const response = await axios.post(
                `${API_URL}/projects/${projectId}/samples`,
                { track_id: trackId, sample_id: sampleId, start_time },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            // The new clip has no entry in sampleDurations yet, so take the
            // length from the library record it was placed from
            const droppedLength = librarySamples.find(s => s.id === sampleId)?.duration || 0;
            setProjectSamples(prev => {
                const updatedSamples = [...prev, response.data];
                pushToHistory({ type: 'addSample', data: response.data });
                extendTimelineIfNeeded(start_time, realToUnits(droppedLength, 120 / bpm));
                return updatedSamples;
            });
            setNotice(null);
        } catch (err) {
            console.error('Place sample error:', err.response?.data || err.message);
            setNotice('Failed to place sample: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleDeleteSample = async (sampleId) => {
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/projects/${projectId}/samples/${sampleId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setProjectSamples(prev => {
                const deletedSample = prev.find(s => s.id === sampleId);
                pushToHistory({ type: 'deleteSample', data: deletedSample });
                return prev.filter(s => s.id !== sampleId);
            });
            setNotice(null);
        } catch (err) {
            console.error('Remove sample error:', err.response?.data || err.message);
            setNotice('Failed to remove sample: ' + (err.response?.data?.error || err.message));
        }
    };

    // Duplicate a clip immediately after itself (Cmd/Ctrl+D or ⧉ button)
    const handleDuplicateSample = async (projectSampleId) => {
        const original = projectSamples.find(s => s.id === projectSampleId);
        if (!original) return;
        const fullDuration = sampleDurations[original.id] || 0;
        if (!fullDuration) {
            setNotice('Sample still loading — try again in a moment');
            return;
        }
        const { effDuration } = getClipTimes(original, fullDuration);
        const timeScale = 120 / bpm;
        // Butt-join: the copy starts exactly where the original ends so the audio
        // continues seamlessly — that is the whole point of duplicating a clip.
        // Deliberately NOT snapped to the 1/16 grid: any snap, however small,
        // leaves a gap or an overlap at the seam, and a clip whose length is not an
        // exact number of 1/16s would get one on every single copy. A loop that is
        // meant to sit on the grid should be trimmed to a musical length (the clip
        // trim controls), after which the exact join lands on the grid by itself.
        // Sub-millisecond rounding, since chained copies build on the previous
        // copy's stored start and coarse rounding would compound.
        let offset = realToUnits(effDuration, timeScale);
        if (isSnapping) {
            // Pull the join onto the grid, but only when it is already within a
            // breath of it. This absorbs the drift that survives encoding and
            // trimming, so a loop that measures 3.749s instead of 3.75 still
            // butt-joins on the beat. A clip that is genuinely an odd length
            // stays exactly where it lands: snapping that would be re-timing the
            // audio, not repairing it.
            const grid = 0.125; // a 1/16 note, in timeline units
            const snapped = Math.round(offset / grid) * grid;
            if (snapped > 0 && Math.abs(snapped - offset) <= 0.06) offset = snapped;
        }
        const newStartTime = Math.round((original.start_time + offset) * 10000) / 10000;
        try {
            const token = localStorage.getItem('token');
            const response = await axios.post(
                `${API_URL}/projects/${projectId}/samples`,
                {
                    track_id: original.track_id,
                    sample_id: original.sample_id,
                    start_time: newStartTime,
                    fade_in: original.fade_in || 0,
                    fade_out: original.fade_out || 0,
                    trim_start: original.trim_start || 0,
                    trim_end: original.trim_end ?? null,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProjectSamples(prev => {
                pushToHistory({ type: 'addSample', data: response.data });
                extendTimelineIfNeeded(newStartTime, realToUnits(effDuration, timeScale));
                return [...prev, response.data];
            });
            // Select the new copy so Cmd+D can be chained to keep extending
            setSelectedSampleId(response.data.id);
            setNotice(null);
        } catch (err) {
            console.error('Duplicate sample error:', err.response?.data || err.message);
            setNotice('Failed to duplicate sample: ' + (err.response?.data?.error || err.message));
        }
    };

    /**
     * Nudge the selected clip along the timeline with the arrow keys.
     *
     * Beat-matching a sample against a MIDI part is a job of small repeated
     * adjustments, and dragging with a mouse cannot do small: at 100 pixels to
     * the unit, one screen pixel is a hundredth of a beat and the pointer moves
     * in whole pixels only when your hand cooperates.
     *
     * Plain arrow moves by the grid, honouring the same Snap toggle the drag
     * handler uses, so a nudged clip lands where a dragged one would. Shift
     * moves by a hundredth of a unit, which is roughly ten milliseconds at 120
     * BPM: too small to see, which is the point.
     *
     * Saved with PUT rather than the delete-and-recreate the drag handler uses,
     * so the clip keeps its id and a failed save cannot lose it.
     */
    const nudgeSelectedSample = async (direction, fine) => {
        const sample = projectSamples.find(s => s.id === selectedSampleId);
        if (!sample) return;

        const step = fine ? 0.01 : (isSnapping ? 0.125 : 0.05); // 1/16 note is 0.125 units
        const previous = sample.start_time;
        const next = Math.max(0, Math.round((previous + direction * step) * 10000) / 10000);
        if (next === previous) return;

        setProjectSamples(prev => prev.map(s => (
            s.id === sample.id ? { ...s, start_time: next } : s
        )));

        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/samples/${sample.id}`,
                { start_time: next },
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch (err) {
            console.error('Nudge clip error:', err.response?.data || err.message);
            setNotice('Failed to move clip: ' + (err.response?.data?.error || err.message));
            setProjectSamples(prev => prev.map(s => (
                s.id === sample.id ? { ...s, start_time: previous } : s
            )));
        }
    };

    // Keep the keyboard shortcuts pointing at the latest closures. These sit
    // below the handlers they call so the reference is obvious; playAllRef and
    // stopRef are assigned next to playback for the same reason.
    duplicateSelectedRef.current = () => {
        if (selectedSampleId) handleDuplicateSample(selectedSampleId);
    };
    deleteSelectedRef.current = () => {
        if (selectedSampleId) {
            handleDeleteSample(selectedSampleId);
            setSelectedSampleId(null);
        }
    };
    nudgeSelectedRef.current = nudgeSelectedSample;

    // Repeat a MIDI track's pattern: append a copy of all notes one pattern-length later
    const handleRepeatMidiPattern = async (trackId) => {
        const track = tracks.find(t => t.id === trackId);
        const notes = Array.isArray(track?.midi_notes) ? track.midi_notes : [];
        if (notes.length === 0) {
            setNotice('No notes to repeat on this track');
            return;
        }
        const barLength = 2; // 4 beats in timeline units, at any tempo
        // Pattern length = end of the bar containing the last note START, so long
        // note tails ringing past the bar line don't push the copy out (gap bug)
        const maxStart = notes.reduce((max, n) => Math.max(max, n.start_time), 0);
        const patternLength = (Math.floor(maxStart / barLength + 1e-6) + 1) * barLength;
        const shifted = notes.map(n => ({
            ...n,
            start_time: Math.round((n.start_time + patternLength) * 1000) / 1000,
        }));
        const newNotes = [...notes, ...shifted];
        try {
            await handleApplyGeneratedNotes(trackId, newNotes);
            setNotice(null);
        } catch (err) {
            console.error('Repeat MIDI pattern error:', err.response?.data || err.message);
            setNotice('Failed to repeat pattern: ' + (err.response?.data?.error || err.message));
        }
    };

    /**
     * Move a clip: to a new position, a new track, or both.
     *
     * One PUT, keeping the clip's id. This used to delete the row and create
     * another, which meant a failed create lost the clip outright, and left
     * undo pointing at an id that no longer existed. The id surviving is what
     * makes undo below able to put the clip back by simply moving it again.
     */
    const handleDragSample = async (sampleId, newTrackId, newStartTime) => {
        const original = projectSamples.find(s => s.id === sampleId);
        if (!original) return;

        const newTrack = tracks.find(t => t.id === newTrackId);
        if (newTrack?.track_type === 'midi') {
            setNotice('Cannot drag samples to MIDI tracks');
            return;
        }

        const before = { track_id: original.track_id, start_time: original.start_time };
        const after = { track_id: newTrackId, start_time: newStartTime };
        if (before.track_id === after.track_id && before.start_time === after.start_time) return;

        // Trim and fade carry with the clip, so its on-screen length is the
        // effective length rather than the file's.
        const { effDuration } = getClipTimes(original, sampleDurations[sampleId] || 0);

        setProjectSamples(prev => prev.map(s => (s.id === sampleId ? { ...s, ...after } : s)));
        extendTimelineIfNeeded(newStartTime, realToUnits(effDuration, 120 / bpm));

        try {
            const token = localStorage.getItem('token');
            const response = await axios.put(
                `${API_URL}/projects/${projectId}/samples/${sampleId}`,
                after,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProjectSamples(prev => prev.map(s => (s.id === sampleId ? { ...s, ...response.data } : s)));
            pushToHistory({ type: 'dragSample', data: { sampleId, before, after } });
            setNotice(null);
        } catch (err) {
            console.error('Drag sample error:', err.response?.data || err.message);
            setNotice('Failed to reposition sample: ' + (err.response?.data?.error || err.message));
            setProjectSamples(prev => prev.map(s => (s.id === sampleId ? { ...s, ...before } : s)));
        }
    };

    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev + 25, 200));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev - 25, 50));
    };

    const bufferToWave = (abuffer) => {
        const numOfChan = abuffer.numberOfChannels;
        const length = abuffer.length * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const channels = [];
        let offset = 0;
        let pos = 0;

        const setUint16 = (data) => {
            view.setUint16(pos, data, true);
            pos += 2;
        };

        const setUint32 = (data) => {
            view.setUint32(pos, data, true);
            pos += 4;
        };

        setUint32(0x46464952);
        setUint32(length - 8);
        setUint32(0x45564157);
        setUint32(0x20746d66);
        setUint32(16);
        setUint16(1);
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * numOfChan * 2);
        setUint16(numOfChan * 2);
        setUint16(16);
        setUint32(0x61746164);
        setUint32(abuffer.length * numOfChan * 2);

        offset = pos;

        for (let i = 0; i < abuffer.numberOfChannels; i++) {
            channels.push(abuffer.getChannelData(i));
        }

        for (let i = 0; i < abuffer.length; i++, offset += 2) {
            for (let chan = 0; chan < numOfChan; chan++) {
                const sample = Math.max(-1, Math.min(1, channels[chan][i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }

        return buffer;
    };

    if (!user) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-lg">Please log in to edit projects.</p>
            </div>
        );
    }

    // Only a project that would not load takes the whole page.
    if (loadError) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-red-500 text-lg" role="alert">{loadError}</p>
                <Link to="/projects" className="retro-btn retro-btn--hot mt-4 inline-block py-2 px-4 text-xs">
                    Back to Projects
                </Link>
            </div>
        );
    }

    if (!project) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-lg">Loading...</p>
            </div>
        );
    }

    const timeScale = 120 / bpm;
    const beatIntervalScaled = realToUnits(60 / bpm, timeScale); // one beat = 0.5 units
    const numBeatMarkers = Math.ceil(timelineDuration / beatIntervalScaled);

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="w-full min-h-screen text-gray-100 pt-2 px-4">
                <div className="mb-6 flex flex-wrap items-center gap-3">
                    <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => { setEditTitle(e.target.value); setSaveState('idle'); }}
                        onBlur={handleSaveTitle}
                        onKeyPress={(e) => e.key === 'Enter' && handleSaveTitle()}
                        className="retro-display text-lg flex-1 min-w-[12rem] px-2 py-1 border border-cyan-400/25 bg-cyan-400/5 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500"
                        placeholder="Enter project title"
                    />
                    <button
                        onClick={handleSaveProject}
                        disabled={saveState === 'saving'}
                        title="Save this project"
                        className="retro-btn px-4 py-2 text-[0.6rem] whitespace-nowrap"
                    >
                        {saveState === 'saving' ? 'Saving...' : 'Save'}
                    </button>
                    <button
                        onClick={handleSaveAndExit}
                        disabled={saveState === 'saving'}
                        title="Save this project and return to your projects"
                        className="retro-btn retro-btn--hot px-4 py-2 text-[0.6rem] whitespace-nowrap"
                    >
                        Save &amp; Exit
                    </button>
                    <span
                        aria-live="polite"
                        className="retro-mono text-lg min-w-[9rem] text-right"
                    >
                        {saveState === 'saving' && <span className="text-cyan-300">Saving...</span>}
                        {saveState === 'saved' && (
                            <span className="text-emerald-300">
                                &#10003; Saved{lastSavedAt ? ` ${lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                            </span>
                        )}
                        {saveState === 'idle' && lastSavedAt && (
                            <span className="text-gray-500">
                                Last saved {lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                        )}
                        {saveState === 'idle' && !lastSavedAt && (
                            <span className="text-gray-500">Changes save automatically</span>
                        )}
                    </span>
                </div>
                {notice && (
                    <div
                        role="alert"
                        className="retro-panel retro-cut mb-4 flex items-start gap-3 p-3 border border-fuchsia-400/40"
                    >
                        <p className="retro-mono text-sm text-fuchsia-300 flex-1">{notice}</p>
                        <button
                            type="button"
                            onClick={() => setNotice(null)}
                            aria-label="Dismiss message"
                            className="retro-btn px-2 py-1 text-[0.6rem] shrink-0"
                        >
                            Dismiss
                        </button>
                    </div>
                )}
                <div className="retro-panel retro-cut mb-8 flex flex-wrap items-center gap-3 p-4">
                    <button
                        onClick={handlePlayAllClick}
                        disabled={isLoadingDurations}
                        className={`retro-btn min-w-[100px] px-4 py-2 text-[0.6rem]`}
                    >
                        {isPlaying ? 'Pause' : playheadPosition > 0 ? 'Resume' : 'Play All'}
                    </button>
                    <button
                        onClick={handleStop}
                        disabled={isLoadingDurations}
                        className={`retro-btn px-4 py-2 text-[0.6rem] !border-red-400 !text-red-300`}
                    >
                        Stop
                    </button>
                    <button
                        onClick={undo}
                        disabled={historyIndex < 0 || isLoadingDurations}
                        className={`retro-btn px-4 py-2 text-[0.6rem]`}
                    >
                        Undo
                    </button>
                    <button
                        onClick={redo}
                        disabled={historyIndex >= history.length - 1 || isLoadingDurations}
                        className={`retro-btn px-4 py-2 text-[0.6rem]`}
                    >
                        Redo
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={`retro-btn retro-btn--hot px-4 py-2 text-[0.6rem] disabled:opacity-50`}
                    >
                        {isExporting ? 'Exporting...' : 'Export MP3'}
                    </button>
                    <input
                        type="number"
                        value={bpmDraft}
                        onChange={(e) => handleBpmInput(e.target.value)}
                        onBlur={handleBpmCommit}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        className="w-20 px-2 py-1 bg-[#1d0a38] text-white border border-cyan-400/30 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50"
                        placeholder="BPM"
                        aria-label="Tempo in beats per minute"
                        min="60"
                        max="240"
                        disabled={isLoadingDurations}
                    />
                    <button
                        onClick={() => setMetronomeOn(prev => { metronomeRef.current = !prev; return !prev; })}
                        disabled={isLoadingDurations}
                        title="Metronome click during playback"
                        className={`retro-btn px-3 py-2 text-[0.6rem] disabled:opacity-50 disabled:cursor-not-allowed ${metronomeOn ? 'retro-btn--hot' : ''}`}
                    >
                        Click
                    </button>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleZoomOut}
                            disabled={isLoadingDurations}
                            className={`px-2 py-1 bg-[#1d0a38] text-gray-200 rounded-lg hover:bg-[#2a1152] hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            –
                        </button>
                        <span className="text-sm text-gray-300">Zoom: {zoom}px/s</span>
                        <button
                            onClick={handleZoomIn}
                            disabled={isLoadingDurations}
                            className={`px-2 py-1 bg-[#1d0a38] text-gray-200 rounded-lg hover:bg-[#2a1152] hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            +
                        </button>
                    </div>
                    <div className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            checked={isSnapping}
                            onChange={() => setIsSnapping(prev => !prev)}
                            disabled={isLoadingDurations}
                            id="snap-toggle"
                            className="h-4 w-4 text-purple-500 focus:ring-purple-500 border-cyan-400/30 bg-[#1d0a38] rounded disabled:opacity-50"
                        />
                        <label htmlFor="snap-toggle" className="text-sm text-gray-300">Snap to Grid (1/16)</label>
                    </div>
                    <span className="text-sm text-gray-300">
                        Playhead: {unitsToReal(playheadPosition, timeScale).toFixed(1)}s
                    </span>
                </div>
                <div className="flex mb-6">
                    {/* Track Settings Column (Static) */}
                    <div className="w-[256px] flex-shrink-0 sticky top-20 z-10 bg-[#0f0f0f] border-r border-cyan-400/25">
                        <div className="h-12"></div> {/* Empty div to align with top timeline */}
                        <div className="space-y-1">
                            {tracks.map((track) => {
                                const trackHeight = track.track_type === 'midi' ? (minimizedTracks[track.id] ? 80 : 540) : 48;
                                return (
                                    <div
                                        key={track.id}
                                        className="flex flex-col items-start space-y-0.5 p-2 rounded-lg bg-[#1d0a38] bg-opacity-50 backdrop-blur-md"
                                        style={{ height: `${trackHeight}px` }}
                                    >
                                        <div className="flex items-center space-x-2 w-full">
                                            <input
                                                type="text"
                                                value={track.name}
                                                aria-label={`Name of track ${track.name}`}
                                                onFocus={() => handleTrackNameFocus(track.id, track.name)}
                                                onChange={(e) => handleTrackNameInput(track.id, e.target.value)}
                                                onBlur={() => handleTrackNameCommit(track.id)}
                                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                className="w-24 px-2 py-1 bg-[#140628] text-gray-200 border border-cyan-400/30 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                                                disabled={isLoadingDurations}
                                            />
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleToggleMute(track.id);
                                                }}
                                                className={`w-6 h-6 text-xs font-bold rounded focus:outline-none focus:ring-2 focus:ring-red-300 transition-colors ${
                                                    track.is_muted
                                                        ? 'bg-red-500 text-white'
                                                        : 'bg-[#140628] text-gray-400 hover:bg-[#2a1152]'
                                                }`}
                                                title={track.is_muted ? 'Unmute' : 'Mute'}
                                                aria-label={track.is_muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                                            >
                                                M
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleToggleSolo(track.id);
                                                }}
                                                className={`w-6 h-6 text-xs font-bold rounded focus:outline-none focus:ring-2 focus:ring-yellow-300 transition-colors ${
                                                    soloTracks[track.id]
                                                        ? 'bg-yellow-500 text-black'
                                                        : 'bg-[#140628] text-gray-400 hover:bg-[#2a1152]'
                                                }`}
                                                title={soloTracks[track.id] ? 'Unsolo' : 'Solo'}
                                                aria-label={soloTracks[track.id] ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                                            >
                                                S
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedTrack(track);
                                                }}
                                                className="bg-[#1d0a38] text-gray-200 hover:bg-[#2a1152] rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={isLoadingDurations}
                                                title="Track Settings"
                                            >
                                                🎚️
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const currentTrack = tracks.find(t => t.id === track.id); // Get latest track
                                                    setSelectedTrackForEffects(currentTrack);
                                                }}
                                                className="bg-[#1d0a38] text-gray-200 hover:bg-[#2a1152] rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={isLoadingDurations}
                                                title="Effects Settings"
                                            >
                                                🎛️
                                            </button>
                                            {track.track_type === 'midi' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedTrackForGenerate(tracks.find(t => t.id === track.id));
                                                    }}
                                                    className="bg-[#1d0a38] text-gray-200 hover:bg-purple-600 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    disabled={isLoadingDurations}
                                                    title="Generate MIDI (AI)"
                                                    aria-label={`Generate MIDI for ${track.name}`}
                                                >
                                                    ✨
                                                </button>
                                            )}
                                            {track.track_type !== 'midi' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedTrackForLoop(tracks.find(t => t.id === track.id));
                                                    }}
                                                    className="bg-[#1d0a38] text-gray-200 hover:bg-purple-600 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    disabled={isLoadingDurations}
                                                    title="Generate Sample (AI)"
                                                    aria-label={`Generate AI sample for ${track.name}`}
                                                >
                                                    ✨
                                                </button>
                                            )}
                                        </div>
                                        {track.track_type === 'midi' && (
                                            <div className="flex items-center space-x-1">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleTrackMinimize(track.id);
                                                    }}
                                                    className="retro-action px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                                    disabled={isLoadingDurations}
                                                    title={minimizedTracks[track.id] ? 'Expand Piano Roll' : 'Minimize Piano Roll'}
                                                >
                                                    {minimizedTracks[track.id] ? '↔ Expand' : '↕ Minimize'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRepeatMidiPattern(track.id);
                                                    }}
                                                    className="retro-action px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                                    disabled={isLoadingDurations || !(Array.isArray(track.midi_notes) && track.midi_notes.length > 0)}
                                                    title="Repeat pattern: copy all notes after the last bar"
                                                    aria-label={`Repeat pattern on ${track.name}`}
                                                >
                                                    ⟳ Dupe Notes
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* Scrollable Grid */}
                    <div className="flex-1 overflow-x-auto">
                        <div className="min-w-[3200px]">
                            <div
                                ref={topTimelineRef}
                                className="h-12 bg-[#140628] relative border border-cyan-400/30"
                                style={{ width: `${timelineDuration * zoom}px` }}
                                onClick={handleTopTimelineClick}
                            >
                                {Array.from({ length: numBeatMarkers }, (_, i) => {
                                    const pixelPosition = i * beatIntervalScaled * zoom;
                                    const isBarStart = i % 4 === 0;
                                    return (
                                        <React.Fragment key={i}>
                                            {isBarStart && (
                                                <div
                                                    className="text-sm font-medium absolute text-gray-300"
                                                    style={{ left: `${pixelPosition + 2}px` }}
                                                >
                                                    {i / 4 + 1}
                                                </div>
                                            )}
                                            <div
                                                className={`absolute border-l ${isBarStart ? 'top-0 bottom-0 border-cyan-400/40' : 'bottom-0 h-1/3 border-cyan-400/30'}`}
                                                style={{ left: `${pixelPosition}px` }}
                                            />
                                        </React.Fragment>
                                    );
                                })}
                                <div
                                    className="absolute top-0 bottom-0 w-1 bg-red-500 z-20"
                                    ref={registerPlayhead}
                                    style={{ left: 0, transform: `translate3d(${playheadPosition * zoom}px, 0, 0)` }}
                                />
                            </div>
                            {tracks.map((track, index) => {
                                const waveformColor = [
                                    'bg-gradient-to-r from-pink-500 to-purple-500',
                                    'bg-gradient-to-r from-green-500 to-teal-500',
                                    'bg-gradient-to-r from-purple-500 to-primary-brand',
                                    'bg-gradient-to-r from-primary-brand to-cyan-500',
                                    'bg-gradient-to-r from-yellow-500 to-orange-500',
                                    'bg-gradient-to-r from-orange-500 to-red-500',
                                ][index % 6];
                                const trackHeight = track.track_type === 'midi' ? (minimizedTracks[track.id] ? 80 : 540) : 48;
                                return (
                                    <div
                                        key={track.id}
                                        className="relative"
                                        style={{ width: `${timelineDuration * zoom}px`, height: `${trackHeight}px` }}
                                    >
                                        {track.track_type === 'midi' ? (
                                            <PianoRoll
                                                track={track}
                                                projectId={projectId}
                                                playheadPosition={playheadPosition}
                                                registerPlayhead={registerPlayhead}
                                                zoom={zoom}
                                                bpm={bpm}
                                                isSnapping={isSnapping}
                                                timelineDuration={timelineDuration}
                                                onExtendTimeline={extendTimelineIfNeeded}
                                                onNotesChange={handlePianoRollNotesChange}
                                                isMinimized={minimizedTracks[track.id] ?? true}
                                            />
                                        ) : (
                                            <Timeline
                                                key={`track-${track.id}-${projectSamples.length}`}
                                                trackId={track.id}
                                                samples={projectSamples.filter(s => s.track_id === track.id)}
                                                onDrop={handleDrop}
                                                onDrag={handleDragSample}
                                                zoom={zoom}
                                                sampleDurations={sampleDurations}
                                                isLoadingDurations={isLoadingDurations}
                                                waveformColor={waveformColor}
                                                bpm={bpm}
                                                isSnapping={isSnapping}
                                                timelineDuration={timelineDuration}
                                                playheadPosition={playheadPosition}
                                                trackVolume={trackVolumes[track.id] || 1}
                                                onClipEdit={setSelectedClip}
                                                selectedSampleId={selectedSampleId}
                                                onSelectSample={setSelectedSampleId}
                                                onDuplicateClip={handleDuplicateSample}
                                                registerPlayhead={registerPlayhead}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <div className="mb-8">
                    <div className="flex items-center space-x-4 mb-4">
                        <form onSubmit={handleAddTrack} className="flex items-center space-x-2">
                            <input
                                type="text"
                                value={newTrackName}
                                onChange={(e) => setNewTrackName(e.target.value)}
                                placeholder="Track name"
                                className="w-64 px-3 py-2 border border-cyan-400/25 bg-cyan-400/5 text-white rounded-md shadow-sm focus:outline-none focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                disabled={isLoadingDurations}
                            />
                            <select
                                value={newTrackType}
                                onChange={(e) => setNewTrackType(e.target.value)}
                                className="px-3 py-2 border border-cyan-400/25 bg-cyan-400/5 text-white rounded-md shadow-sm focus:outline-none focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                disabled={isLoadingDurations}
                            >
                                <option value="sample">Sample</option>
                                <option value="midi">MIDI</option>
                            </select>
                            <button
                                type="submit"
                                className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                                disabled={isLoadingDurations}
                            >
                                +
                            </button>
                        </form>
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                checked={isPublic}
                                onChange={handleTogglePublic}
                                disabled={isLoadingDurations}
                                id="public-toggle"
                                className="h-4 w-4 text-primary-brand-400 focus:ring-primary-brand-500 border-cyan-400/35 bg-cyan-400/10 rounded disabled:opacity-50"
                            />
                            <label htmlFor="public-toggle" className="text-sm text-gray-200">Allow public to view</label>
                        </div>
                        <SampleDeleteDropZone onDelete={handleDeleteSample} isLoadingDurations={isLoadingDurations} />
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                        <h2 className="retro-display text-base retro-glow-cyan">Sample Library</h2>
                        <span className="retro-mono text-lg text-cyan-300">
                            {isSampleSearching
                                ? `${visibleLibrarySamples.length} of ${librarySamples.length} matching`
                                : `${librarySamples.length} sample${librarySamples.length === 1 ? '' : 's'}`}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <div className="flex items-stretch flex-1 min-w-[200px]">
                            <label htmlFor="sample-search" className="sr-only">Search samples by name</label>
                            <input
                                id="sample-search"
                                type="search"
                                value={sampleSearch}
                                onChange={(e) => setSampleSearch(e.target.value)}
                                placeholder="search samples..."
                                className="retro-field flex-1"
                            />
                            {isSampleSearching && (
                                <button
                                    type="button"
                                    onClick={() => setSampleSearch('')}
                                    className="retro-btn px-3 text-[0.6rem] shrink-0"
                                    aria-label="Clear sample search"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="sample-sort" className="retro-label mb-0">Sort</label>
                            <select
                                id="sample-sort"
                                value={sampleSort}
                                onChange={(e) => setSampleSort(e.target.value)}
                                className="retro-field w-auto"
                            >
                                <option value="newest">Newest first</option>
                                <option value="oldest">Oldest first</option>
                                <option value="name">Name A&ndash;Z</option>
                            </select>
                        </div>
                    </div>

                    {visibleLibrarySamples.length === 0 ? (
                        <p className="retro-mono text-xl text-gray-400 mb-4">
                            {librarySamples.length === 0
                                ? '> your sample library is empty. upload something below.'
                                : `> nothing matches "${sampleSearch.trim()}".`}
                        </p>
                    ) : (
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            {renderedLibrarySamples.map((sample) => (
                                <div key={sample.id} className="flex items-center space-x-2">
                                    <DraggableSample
                                        sample={sample}
                                        name={sample.name}
                                        sampleId={sample.id}
                                    />
                                    {formatSampleDuration(sample.duration) && (
                                        <span className="retro-mono text-base text-cyan-300/80 shrink-0 tabular-nums">
                                            {formatSampleDuration(sample.duration)}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => handleDeleteLibrarySample(sample.id)}
                                        className="retro-icon-btn px-1 shrink-0"
                                        aria-label={`Delete ${sample.name} from library`}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {hiddenSampleCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowAllSamples(true)}
                            className="retro-btn px-4 py-2 text-[0.6rem] mb-4"
                        >
                            Show {hiddenSampleCount} more
                        </button>
                    )}
                    <input
                        type="file"
                        accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,.wav"
                        multiple
                        onChange={handleFileUpload}
                        ref={fileInputRef}
                        className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-cyan-400/10 file:text-white hover:file:bg-cyan-400/15"
                    />
                </div>
                {selectedTrack && (
                    <TrackSettingsModal
                        track={selectedTrack}
                        projectId={projectId}
                        onClose={() => setSelectedTrack(null)}
                        onDelete={handleDeleteTrack}
                        onSettingsChange={handleTrackSettingsChange}
                        currentVolume={selectedTrack.volume ?? 1}
                        currentPan={selectedTrack.pan ?? 0}
                        currentInstrumentType={selectedTrack.instrument_type || 'synth'}
                        isPolyphonic={selectedTrack.is_polyphonic || false}
                        synthSettings={selectedTrack.synth_settings}
                    />
                )}
                {selectedTrackForEffects && (
                    <TrackEffectsModal
                        track={selectedTrackForEffects}
                        onClose={() => setSelectedTrackForEffects(null)}
                        onEffectsChange={handleEffectsChange}
                    />
                )}
                {selectedTrackForGenerate && (
                    <MidiGenerateModal
                        track={selectedTrackForGenerate}
                        bpm={bpm}
                        onClose={() => setSelectedTrackForGenerate(null)}
                        onApply={handleApplyGeneratedNotes}
                    />
                )}
                {selectedTrackForLoop && (
                    <LoopGenerateModal
                        track={selectedTrackForLoop}
                        bpm={bpm}
                        startTime={playheadPosition}
                        onClose={() => setSelectedTrackForLoop(null)}
                        onApply={handleApplyGeneratedLoop}
                    />
                )}
                {selectedClip && (
                    <ClipSettingsModal
                        clip={selectedClip}
                        fullDuration={sampleDurations[selectedClip.id] || 0}
                        onClose={() => setSelectedClip(null)}
                        onSave={handleClipSettingsSave}
                    />
                )}
            </div>
        </DndProvider>
    );
};

export default MultiTrackSampler;