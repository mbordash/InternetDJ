import React, { useEffect, useState, useContext, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import WaveSurfer from 'wavesurfer.js';
import { AuthContext } from '../context/AuthContext';
import * as lamejs from '@breezystack/lamejs';
import * as Tone from 'tone';
import PianoRoll from '../components/PianoRoll';
import TrackSettingsModal from '../components/TrackSettingsModal';
import TrackEffectsModal from '../components/TrackEffectsModal';
import MidiGenerateModal from '../components/MidiGenerateModal';
import StemGenerateModal from '../components/StemGenerateModal';
import synthConfigs from '../config/synthConfigs';
import API_URL from '../utils/api';

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
// Stored in UNITS: playheadPosition, timelineDuration, audio clip start_time.
// Stored in REAL SECONDS: audio file/clip durations, fade lengths, MIDI note
// start_time and duration, and anything handed to an AudioContext.
// Convert at the boundary; never add one to the other.
const unitsToReal = (timelineUnits, timeScale) => timelineUnits * timeScale;
const realToUnits = (realSeconds, timeScale) => realSeconds / timeScale;

const getClipTimes = (sample, fullDuration) => {
    const trimStart = Math.max(0, sample.trim_start || 0);
    const rawEnd = sample.trim_end != null ? sample.trim_end : (fullDuration || 0);
    const trimEnd = fullDuration ? Math.min(rawEnd, fullDuration) : rawEnd;
    return { trimStart, trimEnd, effDuration: Math.max(0, trimEnd - trimStart) };
};

const SampleBlock = ({ sample, trackId, onDrag, volume, zoom, duration, timeScale, isLoadingDurations, waveformColor, trackVolume, onClipEdit, isSelected, onSelect, onDuplicate }) => {
    const waveformRef = useRef(null);
    const wavesurfer = useRef(null);
    const abortController = useRef(new AbortController());

    useEffect(() => {
        if (sample && waveformRef.current) {
            wavesurfer.current = WaveSurfer.create({
                container: waveformRef.current,
                waveColor: '#4B5563',
                progressColor: '#1F2937',
                height: 40,
                barWidth: 2,
                normalize: true,
            });

            wavesurfer.current.load(sample.mp3_url, null, { signal: abortController.current.signal }).catch(err => {
                if (err.name !== 'AbortError') {
                    console.warn('Error loading WaveSurfer audio:', err.message);
                }
            });

            // Apply track volume (multiplied by sample volume if needed)
            wavesurfer.current.setVolume((sample.volume ?? 1) * trackVolume);

            return () => {
                if (wavesurfer.current) {
                    try {
                        abortController.current.abort();
                        wavesurfer.current.destroy();
                    } catch (err) {
                        console.warn('Error destroying WaveSurfer:', err.message);
                    }
                    wavesurfer.current = null;
                }
            };
        }
    }, [sample.id, volume, trackVolume]);


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

    const { effDuration } = getClipTimes(sample, duration);
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
            title="Double-click to edit fades and trim"
        >
            {isLoadingDurations ? (
                <div className="flex-1 h-10 bg-cyan-400/10 animate-pulse" />
            ) : (
                <div ref={waveformRef} className={`flex-1 h-10 ${waveformColor}`} />
            )}
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
    const waveformRef = useRef(null);
    const wavesurfer = useRef(null);
    const abortController = useRef(new AbortController());
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        if (sample && waveformRef.current) {
            wavesurfer.current = WaveSurfer.create({
                container: waveformRef.current,
                waveColor: '#4B5563',
                progressColor: '#1F2937',
                height: 40,
                barWidth: 2,
                normalize: true,
            });

            wavesurfer.current.load(sample.mp3_url, null, { signal: abortController.current.signal }).catch(err => {
                if (err.name !== 'AbortError') {
                    console.warn('Error loading WaveSurfer audio for library sample:', err.message);
                }
            });

            wavesurfer.current.on('play', () => setIsPlaying(true));
            wavesurfer.current.on('pause', () => setIsPlaying(false));

            return () => {
                if (wavesurfer.current) {
                    try {
                        abortController.current.abort();
                        wavesurfer.current.destroy();
                    } catch (err) {
                        console.warn('Error destroying WaveSurfer:', err.message);
                    }
                    wavesurfer.current = null;
                }
            };
        }
    }, [sample.id]);

    const handlePlay = () => {
        if (wavesurfer.current) {
            try {
                wavesurfer.current.playPause().catch(err => {
                    console.warn('Error playing/pausing WaveSurfer for library sample:', err.message);
                });
            } catch (err) {
                console.warn('Error playing/pausing WaveSurfer:', err.message);
            }
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
            <div ref={waveformRef} className="w-24 h-10" />
        </div>
    );
};

const Timeline = ({ trackId, samples, onDrop, onDrag, zoom, sampleDurations, isLoadingDurations, waveformColor, bpm, isSnapping, timelineDuration, playheadPosition, trackVolume, onClipEdit, selectedSampleId, onSelectSample, onDuplicateClip }) => {
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

            if (start_time < 0.05) {
                start_time = 0.0;
            } else {
                start_time = Math.round(start_time * 100) / 100;
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
                style={{ left: `${playheadPosition * zoom}px` }}
            />
        </div>
    );
};

const ClipSettingsModal = ({ clip, fullDuration, onClose, onSave }) => {
    const [fadeIn, setFadeIn] = useState(clip.fade_in || 0);
    const [fadeOut, setFadeOut] = useState(clip.fade_out || 0);
    const [trimStart, setTrimStart] = useState(clip.trim_start || 0);
    const [trimEnd, setTrimEnd] = useState(clip.trim_end != null ? clip.trim_end : '');
    const [validationError, setValidationError] = useState(null);

    const handleSave = () => {
        const fi = Number(fadeIn) || 0;
        const fo = Number(fadeOut) || 0;
        const ts = Number(trimStart) || 0;
        const te = trimEnd === '' || trimEnd === null ? null : Number(trimEnd);
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
        onSave(clip.id, { fade_in: fi, fade_out: fo, trim_start: ts, trim_end: te });
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

const MultiTrackSampler = () => {
    const { projectId } = useParams();
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const [project, setProject] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const [tracks, setTracks] = useState([]);

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
    const [error, setError] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [playheadPosition, setPlayheadPosition] = useState(0);
    const [isSnapping, setIsSnapping] = useState(true);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [bpm, setBpm] = useState(120);
    const [zoom, setZoom] = useState(100);
    const [sampleDurations, setSampleDurations] = useState({});
    const [isLoadingDurations, setIsLoadingDurations] = useState(false);
    const [isPublic, setIsPublic] = useState(false);
    const [timelineDuration, setTimelineDuration] = useState(30 * (120 / 120));
    const fileInputRef = useRef(null);
    const wavesurfersRef = useRef({});
    const audioContextRef = useRef(null);
    const playbackTimerRef = useRef(null);
    const startTimeRef = useRef(0);
    const fallbackCounterRef = useRef(0);
    const isPlayingRef = useRef(false);
    const topTimelineRef = useRef(null);
    const synthRef = useRef(null);
    const toneTransportRef = useRef(Tone.Transport);
    const [trackVolumes, setTrackVolumes] = useState({});
    const [trackPans, setTrackPans] = useState({});
    const [soloTracks, setSoloTracks] = useState({});
    const [selectedClip, setSelectedClip] = useState(null);
    const [selectedSampleId, setSelectedSampleId] = useState(null);
    const midiPanners = useRef({});
    const [selectedTrack, setSelectedTrack] = useState(null);
    const midiGains = useRef({});
    const [minimizedTracks, setMinimizedTracks] = useState({});
    const [selectedTrackForEffects, setSelectedTrackForEffects] = useState(null);
    const [selectedTrackForGenerate, setSelectedTrackForGenerate] = useState(null);
    const [selectedTrackForStem, setSelectedTrackForStem] = useState(null);
    const effectsNodes = useRef({});
    const [metronomeOn, setMetronomeOn] = useState(false);
    const metronomeRef = useRef(false);
    const metronomeSynthRef = useRef(null);
    const metronomeNextBeatRef = useRef(0);
    const playAllRef = useRef(null);
    const stopRef = useRef(null);
    const duplicateSelectedRef = useRef(null);
    const deleteSelectedRef = useRef(null);
    const initializedTracks = useRef(new Set());

    // Initialize minimized state for MIDI tracks
    useEffect(() => {
        console.log('Initializing minimizedTracks, tracks:', tracks);
        setMinimizedTracks(prev => {
            const newMinimized = { ...prev };
            tracks.forEach(track => {
                if (track.track_type === 'midi' && newMinimized[track.id] === undefined) {
                    newMinimized[track.id] = track.instrument_type === 'drumsampler' ? false : true; // Default non-drum to minimized
                    initializedTracks.current.add(track.id);
                }
            });
            console.log('Initialized minimizedTracks:', newMinimized);
            return newMinimized;
        });
    }, [tracks]);

    useEffect(() => {
        const initialVolumes = {};
        const initialPans = {};
        tracks.forEach(track => {
            initialVolumes[track.id] = track.volume ?? 1;
            initialPans[track.id] = track.pan ?? 0;
        });
        setTrackVolumes(initialVolumes);
        setTrackPans(initialPans);
    }, [tracks]);

    // A track is audible unless muted, or another track is soloed and this one isn't
    const isTrackAudible = (trackId) => {
        const track = tracks.find(t => t.id === trackId);
        if (track?.is_muted) return false;
        const anySolo = Object.values(soloTracks).some(Boolean);
        if (anySolo && !soloTracks[trackId]) return false;
        return true;
    };

    const getEffectiveTrackGain = (trackId) => (isTrackAudible(trackId) ? (trackVolumes[trackId] ?? 1) : 0);

    // Schedule fade-in/out gain envelope for a clip that just started playing at clipOffset seconds into it
    const scheduleClipFades = (ws, sample, clipOffset, effDuration) => {
        if (!ws.fadeGain) return;
        const g = ws.fadeGain.gain;
        const now = ws.fadeGain.context.currentTime;
        const fadeIn = Math.min(sample.fade_in || 0, effDuration);
        const fadeOut = Math.min(sample.fade_out || 0, effDuration);
        const remaining = Math.max(0, effDuration - clipOffset);
        g.cancelScheduledValues(now);
        let startValue = 1;
        if (fadeIn > 0 && clipOffset < fadeIn) startValue = clipOffset / fadeIn;
        g.setValueAtTime(Math.max(0, Math.min(1, startValue)), now);
        const fadeInEnd = fadeIn > clipOffset ? now + (fadeIn - clipOffset) : now;
        if (fadeIn > 0 && clipOffset < fadeIn) {
            g.linearRampToValueAtTime(1, fadeInEnd);
        }
        if (fadeOut > 0 && remaining > 0) {
            const fadeOutStart = Math.max(now + remaining - fadeOut, fadeInEnd);
            g.setValueAtTime(1, fadeOutStart);
            g.linearRampToValueAtTime(0, now + remaining);
        }
    };

    // Live-apply mix changes (volume/pan/mute/solo) to any playing audio
    useEffect(() => {
        Object.values(wavesurfersRef.current).forEach(ws => {
            if (!ws.instance) return;
            const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
            if (!sample) return;
            const gain = (sample.volume ?? 1) * getEffectiveTrackGain(sample.track_id);
            ws.instance.setVolume(gain);
            if (ws.gainNode) ws.gainNode.gain.value = gain;
            if (ws.panner) ws.panner.pan.value = trackPans[sample.track_id] ?? 0;
        });
        Object.entries(midiGains.current).forEach(([trackId, gainNode]) => {
            gainNode.gain.value = getEffectiveTrackGain(Number(trackId));
        });
        Object.entries(midiPanners.current).forEach(([trackId, panner]) => {
            panner.pan.value = trackPans[Number(trackId)] ?? 0;
        });
    }, [tracks, soloTracks, trackVolumes, trackPans, projectSamples]);

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
            setError(null);
        } catch (err) {
            console.error('Toggle mute error:', err.response?.data || err.message);
            setTracks(prev => prev.map(t => (t.id === trackId ? { ...t, is_muted: !newMuted } : t)));
            setError('Failed to update mute: ' + (err.response?.data?.error || err.message));
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
            setError(null);
        } catch (err) {
            console.error('Update clip settings error:', err.response?.data || err.message);
            if (prevSample) {
                setProjectSamples(prev => prev.map(s => (s.id === sampleId ? prevSample : s)));
            }
            setError('Failed to update clip settings: ' + (err.response?.data?.error || err.message));
        }
    };


    useEffect(() => {
        const handleKeyDown = (e) => {
            const target = e.target;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
            } else if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
            } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && !e.altKey) {
                e.preventDefault();
                duplicateSelectedRef.current?.();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelectedRef.current?.();
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

    useEffect(() => {
        const loadDurations = async () => {
            if (projectSamples.length === 0) {
                setSampleDurations({});
                return;
            }

            const newSampleDurations = {};
            const missing = [];
            projectSamples.forEach(sample => {
                const cached = Number(sample.duration);
                if (Number.isFinite(cached) && cached > 0) {
                    newSampleDurations[sample.id] = cached;
                } else {
                    missing.push(sample);
                }
            });

            // All durations cached in the DB — no decoding needed
            if (missing.length === 0) {
                setSampleDurations(newSampleDurations);
                return;
            }

            setIsLoadingDurations(true);

            try {
                await Promise.all(missing.map(async sample => {
                    const ws = WaveSurfer.create({
                        container: document.createElement('div'),
                        waveColor: '#4B5563',
                        progressColor: '#1F2937',
                        height: 40,
                        barWidth: 2,
                        normalize: true,
                    });

                    try {
                        await ws.load(sample.mp3_url);
                        const duration = ws.getDuration();
                        newSampleDurations[sample.id] = duration;
                    } catch (err) {
                        console.warn(`Error loading duration for sample ${sample.id}:`, err.message);
                        newSampleDurations[sample.id] = 0;
                    } finally {
                        ws.destroy();
                    }
                }));

                setSampleDurations(newSampleDurations);
            } catch (err) {
                console.error('Error loading durations:', err.message);
                setSampleDurations(newSampleDurations);
            } finally {
                setIsLoadingDurations(false);
            }
        };

        loadDurations();
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
                console.log('Fetched tracks:', normalizedTracks);
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
                setError(errorMessage);
            }
        };
        if (user) fetchProject();
    }, [projectId, user]);

    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        return () => {
            if (audioContextRef.current) {
                try {
                    if (audioContextRef.current.state !== 'closed') {
                        audioContextRef.current.suspend();
                    }
                    audioContextRef.current.close();
                } catch (err) {
                    console.warn('Error closing AudioContext:', err.message);
                }
            }
            if (playbackTimerRef.current) {
                cancelAnimationFrame(playbackTimerRef.current);
            }
            Object.values(wavesurfersRef.current).forEach(ws => {
                try {
                    ws.instance.destroy();
                } catch (err) {
                    console.warn('Error destroying WaveSurfer:', err.message);
                }
            });
            wavesurfersRef.current = {};
            try {
                toneTransportRef.current.cancel();
            } catch (err) {
                console.warn('Error cancelling Tone transport:', err.message);
            }
            // NOTE: Do NOT close Tone.context here. It is a shared singleton used
            // across the whole app/page. Closing it (especially under React 18
            // StrictMode double-invoke in dev) leaves Tone with a permanently
            // closed AudioContext, which causes "Cannot resume a closed
            // AudioContext" on the next Tone.start() call.
        };
    }, []);

    const handleEffectsChange = async (trackId, newEffectsSettings) => {
        const previousTrack = tracks.find(t => t.id === trackId);
        const previousSettings = {
            effects_settings: previousTrack?.effects_settings || {}
        };
        console.log('handleEffectsChange called with:', { trackId, newEffectsSettings });

        // Optimistically update local state
        setTracks(prev => {
            const updatedTracks = prev.map(t =>
                t.id === trackId ? { ...t, effects_settings: newEffectsSettings } : t
            );
            console.log('Optimistic tracks update:', updatedTracks.find(t => t.id === trackId).effects_settings);
            return updatedTracks;
        });

        try {
            const token = localStorage.getItem('token');
            const payload = { effects_settings: newEffectsSettings };
            console.log('Sending payload to backend:', payload);
            const response = await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                payload,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log('Backend response:', response.data);

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
            console.log('Refreshed tracks:', normalizedTracks.find(t => t.id === trackId).effects_settings); // Debug log
            setTracks(normalizedTracks);
            setProject(project);
            setProjectSamples(projectSamples);
            setLibrarySamples(librarySamples);
            setIsPublic(project.is_public);
            setBpm(project.bpm || 120);
            setEditTitle(project.title);

            setError(null);
        } catch (err) {
            console.error('Update effects settings error:', err.response?.data || err.message);
            setError(`Failed to save effects: ${err.response?.data?.error || err.message}`);
            // Revert optimistic update
            setTracks(prev => {
                const revertedTracks = prev.map(t =>
                    t.id === trackId ? { ...t, effects_settings: previousSettings.effects_settings } : t
                );
                console.log('Reverted tracks update:', revertedTracks.find(t => t.id === trackId).effects_settings);
                return revertedTracks;
            });
        }
    };

    const toggleTrackMinimize = (trackId) => {
        console.log('Toggling minimize for trackId:', trackId, 'Current state:', minimizedTracks[trackId]);
        setMinimizedTracks(prev => {
            const newState = {
                ...prev,
                [trackId]: prev[trackId] === undefined ? true : !prev[trackId], // Default to minimized
            };
            console.log('New minimizedTracks:', newState);
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
            setError(`Failed to save instrument: ${err.response?.data?.error || err.message}`);
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
            setError(`Failed to save polyphonic setting: ${err.response?.data?.error || err.message}`);
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
            if (midiGains.current[trackId]) {
                midiGains.current[trackId].gain.setValueAtTime(settings.volume, Tone.now());
            }
            // Update volume for any active audio samples on this track
            Object.values(wavesurfersRef.current).forEach(ws => {
                if (ws.instance?.trackId === trackId) {
                    const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                    ws.instance.setVolume((sample?.volume ?? 1) * settings.volume);
                    if (ws.gainNode) {
                        ws.gainNode.gain.setValueAtTime((sample?.volume ?? 1) * settings.volume, Tone.now());
                    }
                }
            });
        }
        if (settings.pan !== undefined) {
            setTrackPans(prev => ({ ...prev, [trackId]: settings.pan }));
            if (midiPanners.current[trackId]) {
                midiPanners.current[trackId].pan.value = settings.pan;
            }
            Object.values(wavesurfersRef.current).forEach(ws => {
                if (ws.instance?.trackId === trackId && ws.panner) {
                    ws.panner.pan.value = settings.pan;
                }
            });
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
            setError(null);
        } catch (err) {
            console.error('Update track settings error:', err.response?.data || err.message);
            setError(`Failed to save settings: ${err.response?.data?.error || err.message}`);
            // Revert optimistic updates on error
            setTrackVolumes(prev => ({ ...prev, [trackId]: previousSettings.volume }));
            setTrackPans(prev => ({ ...prev, [trackId]: previousSettings.pan }));
            if (midiPanners.current[trackId]) {
                midiPanners.current[trackId].pan.value = previousSettings.pan;
            }
            if (midiGains.current[trackId]) {
                midiGains.current[trackId].gain.setValueAtTime(previousSettings.volume, Tone.now());
            }
            Object.values(wavesurfersRef.current).forEach(ws => {
                if (ws.gainNode && ws.instance?.trackId === trackId) {
                    ws.gainNode.gain.setValueAtTime(previousSettings.volume, Tone.now());
                }
            });
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
            setError('Project title cannot be empty');
            return;
        }
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}`,
                { title: editTitle.trim(), is_public: project.is_public },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProject(prev => ({ ...prev, title: editTitle.trim() }));
            setError(null);
        } catch (err) {
            console.error('Save title error:', err.response?.data || err.message);
            setError('Failed to save project title: ' + (err.response?.data?.error || err.message));
        }
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
            if (midiGains.current[trackId]) {
                midiGains.current[trackId].gain.setValueAtTime(newVolume, Tone.now());
            }
            // Apply live volume to any playing samples on this track
            Object.values(wavesurfersRef.current).forEach(ws => {
                if (ws.instance?.trackId === trackId) {
                    const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                    ws.instance.setVolume((sample?.volume ?? 1) * newVolume);
                    if (ws.gainNode) {
                        ws.gainNode.gain.setValueAtTime(newVolume, Tone.now());
                    }
                }
            });
        } catch (err) {
            console.error('Update volume error:', err.response?.data || err.message);
            setError(`Failed to save volume: ${err.response?.data?.error || err.message}`);
        }
    };

    // Persist the project tempo. Debounced because the number input fires on
    // every keystroke, and clamped to the same range the API accepts.
    const bpmSaveTimerRef = useRef(null);
    const handleBpmChange = (value) => {
        const clamped = Math.max(60, Math.min(240, Math.round(value || 0) || 120));
        setBpm(clamped);
        setProject(prev => (prev ? { ...prev, bpm: clamped } : prev));
        if (bpmSaveTimerRef.current) clearTimeout(bpmSaveTimerRef.current);
        bpmSaveTimerRef.current = setTimeout(async () => {
            try {
                const token = localStorage.getItem('token');
                await axios.put(
                    `${API_URL}/projects/${projectId}`,
                    { bpm: clamped },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
            } catch (err) {
                console.error('Save BPM error:', err.response?.data || err.message);
                setError('Failed to save BPM: ' + (err.response?.data?.error || err.message));
            }
        }, 600);
    };

    useEffect(() => () => {
        if (bpmSaveTimerRef.current) clearTimeout(bpmSaveTimerRef.current);
    }, []);

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
            setError('Failed to update project visibility: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleExport = async () => {
        try {
            setIsLoadingDurations(true);
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
                setError('MP3 encoding failed, exported as WAV instead');
            }

            setError(null);
        } catch (err) {
            console.error('Export error:', err.message);
            setError('Failed to export project: ' + err.message);
        } finally {
            setIsLoadingDurations(false);
        }
    };

    const pushToHistory = (action) => {
        setHistory(prev => [...prev.slice(0, historyIndex + 1), action]);
        setHistoryIndex(prev => prev + 1);
    };

    const undo = () => {
        if (historyIndex >= 0) {
            const action = history[historyIndex];
            switch (action.type) {
                case 'addSample':
                    setProjectSamples(prev => prev.filter(s => s.id !== action.data.id));
                    break;
                case 'deleteSample':
                    setProjectSamples(prev => [...prev, action.data]);
                    break;
                case 'dragSample':
                    setProjectSamples(prev =>
                        prev
                            .filter(s => s.id !== action.data.newSample.id)
                            .concat(action.data.originalSample)
                    );
                    break;
                case 'addTrack':
                    setTracks(prev => prev.filter(t => t.id !== action.data.id));
                    break;
                case 'deleteTrack':
                    setTracks(prev => [...prev, action.data.track]);
                    setProjectSamples(prev => [...prev, ...action.data.samples]);
                    break;
                case 'midiChange':
                    saveMidiNotes(action.data.trackId, action.data.prevNotes);
                    break;
                default:
                    break;
            }
            setHistoryIndex(prev => prev - 1);
        }
    };

    const redo = () => {
        if (historyIndex < history.length - 1) {
            const action = history[historyIndex + 1];
            switch (action.type) {
                case 'addSample':
                    setProjectSamples(prev => [...prev, action.data]);
                    break;
                case 'deleteSample':
                    setProjectSamples(prev => prev.filter(s => s.id !== action.data.id));
                    break;
                case 'dragSample':
                    setProjectSamples(prev =>
                        prev
                            .filter(s => s.id !== action.data.originalSample.id)
                            .concat(action.data.newSample)
                    );
                    break;
                case 'addTrack':
                    setTracks(prev => [...prev, action.data]);
                    break;
                case 'deleteTrack':
                    setTracks(prev => prev.filter(t => t.id !== action.data.track.id));
                    setProjectSamples(prev => prev.filter(s => !action.data.samples.some(ds => ds.id === s.id)));
                    break;
                case 'midiChange':
                    saveMidiNotes(action.data.trackId, action.data.newNotes);
                    break;
                default:
                    break;
            }
            setHistoryIndex(prev => prev + 1);
        }
    };

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
        console.log('handleNotesChange called for Track ID:', trackId, 'Notes:', newNotes);
        setTracks(prev => {
            const updatedTracks = prev.map(track => ({
                ...track,
                midi_notes: track.id === trackId ? newNotes : track.midi_notes,
            }));
            console.log('Updated tracks:', updatedTracks);
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
            setError('Failed to save MIDI notes: ' + (err.response?.data?.error || err.message));
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

    // Place an AI-generated stem (already copied into the sample library by the
    // ✨ generate modal) onto a sample track at the playhead
    const handleApplyGeneratedStem = async (trackId, librarySample) => {
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
        setError(null);
    };

    const handlePlayAll = async () => {
        if (isPlayingRef.current) {
            try {
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (ws.instance.isPlaying()) ws.instance.pause();
                    } catch (err) {
                        console.warn('Error pausing WaveSurfer:', err);
                    }
                });

                if (audioContextRef.current && audioContextRef.current.state === 'running') {
                    await audioContextRef.current.suspend();
                }

                toneTransportRef.current.pause();
                toneTransportRef.current.cancel();

                if (playbackTimerRef.current) {
                    cancelAnimationFrame(playbackTimerRef.current);
                    playbackTimerRef.current = null;
                }

                // Dispose of effect nodes
                Object.values(effectsNodes.current).forEach(trackEffects => {
                    Object.values(trackEffects).forEach(effect => effect.dispose());
                });
                effectsNodes.current = {};

                setIsPlaying(false);
                isPlayingRef.current = false;
                setIsPaused(true);
            } catch (err) {
                console.error('Error pausing playback:', err.message);
                setError('Failed to pause playback');
            }
        } else {
            setIsPlaying(true);
            isPlayingRef.current = true;

            // Defensive guard: if Tone's shared AudioContext has been closed
            // (e.g. by a prior unmount or React 18 StrictMode double-invoke),
            // calling Tone.start() will throw "Cannot resume a closed
            // AudioContext". Swap in a fresh Tone context before starting.
            try {
                const rawCtx = Tone.context && Tone.context.rawContext;
                if (!Tone.context || (rawCtx && rawCtx.state === 'closed')) {
                    Tone.setContext(new Tone.Context());
                }
            } catch (err) {
                console.warn('Error verifying Tone context, recreating:', err.message);
                try { Tone.setContext(new Tone.Context()); } catch (_) {}
            }

            try {
                await Tone.start();
            } catch (err) {
                console.warn('Tone.start() failed, recreating Tone context and retrying:', err.message);
                try {
                    Tone.setContext(new Tone.Context());
                    await Tone.start();
                } catch (err2) {
                    console.error('Failed to start Tone audio:', err2);
                    setError('Failed to start audio. Please click Play again.');
                    setIsPlaying(false);
                    isPlayingRef.current = false;
                    return;
                }
            }

            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContextRef.current.state === 'suspended') {
                try {
                    await audioContextRef.current.resume();
                } catch (err) {
                    console.error('Error resuming AudioContext:', err);
                    setError('Failed to resume audio context');
                    setIsPlaying(false);
                    isPlayingRef.current = false;
                    return;
                }
            }

            const timeScale = 120 / bpm;
            // Compared against the playhead below, so keep it in timeline units
            let maxDuration = timelineDuration;

            // A true resume requires loaded players; a seek from stopped state
            // (isPaused set but nothing loaded) must take the fresh-play path.
            const canResume = isPaused && Object.keys(wavesurfersRef.current).length > 0;
            const startPos = playheadPosition; // scaled timeline seconds

            if (!canResume) {
                wavesurfersRef.current = {};
                toneTransportRef.current.cancel();
                effectsNodes.current = {};
                const playPromises = [];

                for (const sample of projectSamples) {
                    const wsInstance = WaveSurfer.create({
                        container: document.createElement('div'),
                        waveColor: '#4B5563',
                        progressColor: '#1F2937',
                        height: 40,
                        barWidth: 2,
                        normalize: true,
                        backend: 'WebAudio',
                        audioContext: Tone.context.rawContext,
                    });
                    wsInstance.sampleId = sample.id;
                    wsInstance.trackId = sample.track_id;

                    const effectiveGain = (sample.volume ?? 1) * getEffectiveTrackGain(sample.track_id);
                    const gainNode = new Tone.Gain(effectiveGain);
                    // Track/sample volume via the player's own gain; fades and pan are
                    // inserted into the player's private AudioContext on 'ready'.
                    wsInstance.setVolume(effectiveGain);

                    // Initialize effects for the track
                    const trackEffects = {};
                    const track = tracks.find(t => t.id === sample.track_id);
                    const effectsSettings = track?.effects_settings || {};
                    if (effectsSettings.reverb) {
                        trackEffects.reverb = new Tone.Reverb({
                            decay: effectsSettings.reverb.decay,
                            wet: effectsSettings.reverb.wet
                        });
                    }
                    if (effectsSettings.delay) {
                        trackEffects.delay = new Tone.FeedbackDelay({
                            delayTime: effectsSettings.delay.delayTime,
                            wet: effectsSettings.delay.wet
                        });
                    }
                    if (effectsSettings.distortion) {
                        trackEffects.distortion = new Tone.Distortion({
                            distortion: effectsSettings.distortion.distortion,
                            wet: effectsSettings.distortion.wet
                        });
                    }
                    effectsNodes.current[sample.track_id] = trackEffects;

                    // Connect effects chain: source -> effects -> gain -> destination
                    let lastNode = gainNode;
                    if (trackEffects.reverb) {
                        gainNode.connect(trackEffects.reverb);
                        lastNode = trackEffects.reverb;
                    }
                    if (trackEffects.delay) {
                        lastNode.connect(trackEffects.delay);
                        lastNode = trackEffects.delay;
                    }
                    if (trackEffects.distortion) {
                        lastNode.connect(trackEffects.distortion);
                        lastNode = trackEffects.distortion;
                    }
                    lastNode.toDestination();

                    wavesurfersRef.current[sample.id] = {
                        instance: wsInstance,
                        ready: false,
                        gainNode,
                        fadeGain: null,
                        panner: null,
                        routed: false,
                    };

                    const promise = new Promise((resolve) => {
                        wsInstance.on('ready', () => {
                            try {
                                wavesurfersRef.current[sample.id].ready = true;
                                // WaveSurfer v7's WebAudio backend runs in its own private
                                // AudioContext, so fade/pan nodes must be created from that
                                // same context and terminate at its destination.
                                const media = wsInstance.getMediaElement();
                                if (media && typeof media.getGainNode === 'function') {
                                    const playerGain = media.getGainNode();
                                    const playerCtx = playerGain.context;
                                    const fadeGain = playerCtx.createGain();
                                    const panner = playerCtx.createStereoPanner();
                                    panner.pan.value = trackPans[sample.track_id] ?? 0;
                                    playerGain.disconnect();
                                    playerGain.connect(fadeGain);
                                    fadeGain.connect(panner);
                                    panner.connect(playerCtx.destination);
                                    wavesurfersRef.current[sample.id].fadeGain = fadeGain;
                                    wavesurfersRef.current[sample.id].panner = panner;
                                    wavesurfersRef.current[sample.id].routed = true;
                                } else {
                                    console.warn(`WaveSurfer output node not available for sample ${sample.id}; pan/fades disabled`);
                                }

                                const fullDuration = sampleDurations[sample.id] || wsInstance.getDuration();
                                const { trimStart, effDuration } = getClipTimes(sample, fullDuration);
                                const sampleStart = sample.start_time;

                                // Prep only — playback of t=0 clips begins after ALL
                                // samples are loaded, so audio and playhead start together.
                                if (sampleStart < maxDuration && effDuration > 0) {
                                    wsInstance.seekTo(fullDuration ? Math.min(trimStart / fullDuration, 1) : 0);
                                }
                                resolve();
                            } catch (err) {
                                console.warn(`Error processing sample ${sample.id}:`, err);
                                resolve();
                            }
                        });
                        wsInstance.on('error', err => {
                            console.warn(`WaveSurfer error for sample ${sample.id}:`, err);
                            resolve();
                        });

                        wsInstance.load(sample.mp3_url).catch(err => {
                            console.warn(`Error loading sample ${sample.id}:`, err);
                            resolve();
                        });
                    });

                    playPromises.push(promise);
                }

                tracks.forEach(track => {
                    if (track.track_type === 'midi' && Array.isArray(track.midi_notes)) {
                        if (!track.id) {
                            console.warn('Track missing ID:', track);
                            return;
                        }
                        const gainNode = midiGains.current[track.id] || new Tone.Gain(getEffectiveTrackGain(track.id));
                        gainNode.gain.value = getEffectiveTrackGain(track.id);
                        midiGains.current[track.id] = gainNode;

                        const instrumentType = track.instrument_type || 'synth';
                        const config = synthConfigs[instrumentType] || synthConfigs.synth;
                        const { SynthClass, params } = config;
                        let synthParams;
                        if (instrumentType === 'drumsampler') {
                            synthParams = {
                                urls: params.urls,
                                baseUrl: params.baseUrl || '',
                                onload: params.onload,
                            };
                        } else {
                            // Merge saved settings over the instrument's defaults so
                            // characteristic params (e.g. oscillator type) are kept
                            synthParams = track.synth_settings
                                ? {
                                    ...params,
                                    ...track.synth_settings.synthParams,
                                    envelope: { ...params.envelope, ...track.synth_settings.envelope },
                                    voice0: { ...params.voice0, ...track.synth_settings.voice0 },
                                    voice1: track.synth_settings.voice0 ? { ...params.voice1, detune: -track.synth_settings.voice0.detune } : params.voice1,
                                }
                                : params;
                        }

                        // Initialize effects for MIDI track
                        const trackEffects = {};
                        const effectsSettings = track.effects_settings || {};
                        if (effectsSettings.reverb) {
                            trackEffects.reverb = new Tone.Reverb({
                                decay: effectsSettings.reverb.decay,
                                wet: effectsSettings.reverb.wet
                            });
                        }
                        if (effectsSettings.delay) {
                            trackEffects.delay = new Tone.FeedbackDelay({
                                delayTime: effectsSettings.delay.delayTime,
                                wet: effectsSettings.delay.wet
                            });
                        }
                        if (effectsSettings.distortion) {
                            trackEffects.distortion = new Tone.Distortion({
                                distortion: effectsSettings.distortion.distortion,
                                wet: effectsSettings.distortion.wet
                            });
                        }
                        effectsNodes.current[track.id] = trackEffects;

                        // Connect effects chain: synth -> effects -> gain -> pan -> destination
                        let synth;
                        if (instrumentType === 'drumsampler') {
                            synth = new Tone.Sampler(synthParams).connect(gainNode);
                        } else {
                            const isPolyphonic = track.is_polyphonic || false;
                            synth = isPolyphonic
                                ? new Tone.PolySynth(SynthClass, { maxPolyphony: 8, ...synthParams }).connect(gainNode)
                                : new SynthClass(synthParams).connect(gainNode);
                        }

                        let lastNode = gainNode;
                        if (trackEffects.reverb) {
                            gainNode.connect(trackEffects.reverb);
                            lastNode = trackEffects.reverb;
                        }
                        if (trackEffects.delay) {
                            lastNode.connect(trackEffects.delay);
                            lastNode = trackEffects.delay;
                        }
                        if (trackEffects.distortion) {
                            lastNode.connect(trackEffects.distortion);
                            lastNode = trackEffects.distortion;
                        }
                        const midiPanner = midiPanners.current[track.id] || new Tone.Panner(trackPans[track.id] ?? 0);
                        midiPanner.pan.value = trackPans[track.id] ?? 0;
                        midiPanners.current[track.id] = midiPanner;
                        lastNode.connect(midiPanner);
                        midiPanner.toDestination();

                        // Note times are musical units; the transport is real seconds
                        track.midi_notes.forEach(note => {
                            toneTransportRef.current.schedule(time => {
                                synth.triggerAttackRelease(note.note, unitsToReal(note.duration, timeScale), time);
                            }, unitsToReal(note.start_time, timeScale));
                        });
                    }
                });

                try {
                    await Promise.all(playPromises);
                } catch (err) {
                    console.error('Error initializing samples:', err);
                    setError('Failed to initialize samples');
                    setIsPlaying(false);
                    isPlayingRef.current = false;
                    return;
                }

                startTimeRef.current = audioContextRef.current.currentTime - unitsToReal(startPos, timeScale);
                setPlayheadPosition(startPos);

                // Everything is loaded — start clips under the playhead in the same
                // instant the playhead clock starts, so audio and UI stay in sync.
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (!ws.ready) return;
                        const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                        if (!sample) return;
                        const fullDuration = sampleDurations[sample.id] || ws.instance.getDuration();
                        const { trimStart, effDuration } = getClipTimes(sample, fullDuration);
                        const clipStart = sample.start_time;
                        const clipLength = realToUnits(effDuration, timeScale);
                        if (clipStart <= startPos && startPos < clipStart + clipLength && effDuration > 0) {
                            // Offset into the audio file is real seconds, not units
                            const clipOffset = unitsToReal(startPos - clipStart, timeScale);
                            ws.instance.seekTo(fullDuration ? Math.min((trimStart + clipOffset) / fullDuration, 1) : 0);
                            ws.instance.play().catch(err => {
                                console.warn(`Error playing sample ${sample.id}:`, err);
                            });
                            scheduleClipFades(ws, sample, clipOffset, effDuration);
                        }
                    } catch (err) {
                        console.warn('Error starting sample at playhead:', err);
                    }
                });

                toneTransportRef.current.start(undefined, unitsToReal(startPos, timeScale));
            } else {
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (!ws.ready) return;
                        const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                        if (!sample) return;
                        const effGain = (sample.volume ?? 1) * getEffectiveTrackGain(sample.track_id);
                        ws.instance.setVolume(effGain);
                        if (ws.gainNode) ws.gainNode.gain.value = effGain;
                        if (ws.panner) ws.panner.pan.value = trackPans[sample.track_id] ?? 0;
                        const fullDuration = sampleDurations[ws.instance.sampleId] || ws.instance.getDuration();
                        const { trimStart, effDuration } = getClipTimes(sample, fullDuration);
                        const startTime = sample.start_time;
                        const endTime = startTime + realToUnits(effDuration, timeScale);

                        if (playheadPosition >= startTime && playheadPosition < endTime) {
                            const clipOffset = unitsToReal(playheadPosition - startTime, timeScale);
                            ws.instance.seekTo(fullDuration ? Math.min((trimStart + clipOffset) / fullDuration, 1) : 0);
                            ws.instance.play().catch(err => {
                                console.warn(`Error resuming sample ${ws.instance.sampleId}:`, err);
                            });
                            scheduleClipFades(ws, sample, clipOffset, effDuration);
                        }
                    } catch (err) {
                        console.warn('Error resuming WaveSurfer:', err);
                    }
                });

                // Re-initialize effects for audio sample tracks (disposed on pause)
                projectSamples.forEach(sample => {
                    const ws = wavesurfersRef.current[sample.id];
                    if (!ws?.gainNode) return;
                    const track = tracks.find(t => t.id === sample.track_id);
                    const effectsSettings = track?.effects_settings || {};
                    const gainNode = ws.gainNode;

                    // Disconnect from previous destination/effects before rewiring
                    gainNode.disconnect();

                    const trackEffects = {};
                    if (effectsSettings.reverb) {
                        trackEffects.reverb = new Tone.Reverb({
                            decay: effectsSettings.reverb.decay,
                            wet: effectsSettings.reverb.wet
                        });
                    }
                    if (effectsSettings.delay) {
                        trackEffects.delay = new Tone.FeedbackDelay({
                            delayTime: effectsSettings.delay.delayTime,
                            wet: effectsSettings.delay.wet
                        });
                    }
                    if (effectsSettings.distortion) {
                        trackEffects.distortion = new Tone.Distortion({
                            distortion: effectsSettings.distortion.distortion,
                            wet: effectsSettings.distortion.wet
                        });
                    }
                    effectsNodes.current[sample.track_id] = trackEffects;

                    let lastNode = gainNode;
                    if (trackEffects.reverb) {
                        gainNode.connect(trackEffects.reverb);
                        lastNode = trackEffects.reverb;
                    }
                    if (trackEffects.delay) {
                        lastNode.connect(trackEffects.delay);
                        lastNode = trackEffects.delay;
                    }
                    if (trackEffects.distortion) {
                        lastNode.connect(trackEffects.distortion);
                        lastNode = trackEffects.distortion;
                    }
                    lastNode.toDestination();
                });

                toneTransportRef.current.cancel();
                tracks.forEach(track => {
                    if (track.track_type === 'midi' && Array.isArray(track.midi_notes)) {
                        if (!track.id) {
                            console.warn('Track missing ID:', track);
                            return;
                        }
                        const gainNode = midiGains.current[track.id] || new Tone.Gain(getEffectiveTrackGain(track.id));
                        gainNode.gain.value = getEffectiveTrackGain(track.id);
                        midiGains.current[track.id] = gainNode;

                        const instrumentType = track.instrument_type || 'synth';
                        const config = synthConfigs[instrumentType] || synthConfigs.synth;
                        const { SynthClass, params } = config;
                        let synthParams;
                        if (instrumentType === 'drumsampler') {
                            synthParams = {
                                urls: params.urls,
                                baseUrl: params.baseUrl || '',
                                onload: params.onload,
                            };
                        } else {
                            // Merge saved settings over the instrument's defaults so
                            // characteristic params (e.g. oscillator type) are kept
                            synthParams = track.synth_settings
                                ? {
                                    ...params,
                                    ...track.synth_settings.synthParams,
                                    envelope: { ...params.envelope, ...track.synth_settings.envelope },
                                    voice0: { ...params.voice0, ...track.synth_settings.voice0 },
                                    voice1: track.synth_settings.voice0 ? { ...params.voice1, detune: -track.synth_settings.voice0.detune } : params.voice1,
                                }
                                : params;
                        }

                        // Reinitialize effects for MIDI track
                        const trackEffects = {};
                        const effectsSettings = track.effects_settings || {};
                        if (effectsSettings.reverb) {
                            trackEffects.reverb = new Tone.Reverb({
                                decay: effectsSettings.reverb.decay,
                                wet: effectsSettings.reverb.wet
                            });
                        }
                        if (effectsSettings.delay) {
                            trackEffects.delay = new Tone.FeedbackDelay({
                                delayTime: effectsSettings.delay.delayTime,
                                wet: effectsSettings.delay.wet
                            });
                        }
                        if (effectsSettings.distortion) {
                            trackEffects.distortion = new Tone.Distortion({
                                distortion: effectsSettings.distortion.distortion,
                                wet: effectsSettings.distortion.wet
                            });
                        }
                        effectsNodes.current[track.id] = trackEffects;

                        // Connect effects chain
                        let synth;
                        if (instrumentType === 'drumsampler') {
                            synth = new Tone.Sampler(synthParams).connect(gainNode);
                        } else {
                            const isPolyphonic = track.is_polyphonic || false;
                            synth = isPolyphonic
                                ? new Tone.PolySynth(SynthClass, { maxPolyphony: 8, ...synthParams }).connect(gainNode)
                                : new SynthClass(synthParams).connect(gainNode);
                        }

                        let lastNode = gainNode;
                        if (trackEffects.reverb) {
                            gainNode.connect(trackEffects.reverb);
                            lastNode = trackEffects.reverb;
                        }
                        if (trackEffects.delay) {
                            lastNode.connect(trackEffects.delay);
                            lastNode = trackEffects.delay;
                        }
                        if (trackEffects.distortion) {
                            lastNode.connect(trackEffects.distortion);
                            lastNode = trackEffects.distortion;
                        }
                        const midiPanner = midiPanners.current[track.id] || new Tone.Panner(trackPans[track.id] ?? 0);
                        midiPanner.pan.value = trackPans[track.id] ?? 0;
                        midiPanners.current[track.id] = midiPanner;
                        lastNode.connect(midiPanner);
                        midiPanner.toDestination();

                        // Note times are musical units; the transport is real seconds
                        track.midi_notes.forEach(note => {
                            if (note.start_time >= playheadPosition) {
                                toneTransportRef.current.schedule(time => {
                                    synth.triggerAttackRelease(note.note, unitsToReal(note.duration, timeScale), time);
                                }, unitsToReal(note.start_time, timeScale));
                            }
                        });
                    }
                });

                startTimeRef.current = audioContextRef.current.currentTime - unitsToReal(playheadPosition, timeScale);
                // Start the transport AT the playhead offset (a '+delay' start would
                // postpone MIDI instead of skipping to the right position)
                toneTransportRef.current.start(undefined, unitsToReal(playheadPosition, timeScale));
                setIsPaused(false);
            }

            const updatePlayhead = () => {
                if (!isPlayingRef.current) return;

                let scaledElapsed;
                if (audioContextRef.current.state === 'running') {
                    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
                    scaledElapsed = realToUnits(elapsed, timeScale);
                    fallbackCounterRef.current = scaledElapsed;
                } else {
                    fallbackCounterRef.current += realToUnits(0.016, timeScale);
                    scaledElapsed = fallbackCounterRef.current;
                    console.warn('AudioContext suspended, using fallback counter:', scaledElapsed.toFixed(3), 's');
                }
                setPlayheadPosition(scaledElapsed);

                // Metronome: fire clicks as the playhead crosses beat boundaries
                const beatScaled = realToUnits(60 / bpm, timeScale); // always 0.5 units
                while (scaledElapsed >= metronomeNextBeatRef.current * beatScaled) {
                    if (metronomeRef.current) {
                        try {
                            let clickSynth = metronomeSynthRef.current;
                            if (!clickSynth || clickSynth.disposed || clickSynth.context !== Tone.getContext()) {
                                try { clickSynth?.dispose(); } catch (_) {}
                                clickSynth = new Tone.Synth({
                                    oscillator: { type: 'square' },
                                    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
                                    volume: -10,
                                }).toDestination();
                                metronomeSynthRef.current = clickSynth;
                            }
                            const isBarStart = metronomeNextBeatRef.current % 4 === 0;
                            clickSynth.triggerAttackRelease(isBarStart ? 'C6' : 'C5', '32n');
                        } catch (err) {
                            console.warn('Metronome click error:', err.message);
                        }
                    }
                    metronomeNextBeatRef.current += 1;
                }

                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (!ws.instance || !ws.ready) return;
                        const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                        if (!sample) return;
                        const fullDuration = sampleDurations[ws.instance.sampleId] || ws.instance.getDuration();
                        const { trimStart, effDuration } = getClipTimes(sample, fullDuration);
                        const startTime = sample.start_time;
                        const endTime = startTime + realToUnits(effDuration, timeScale);

                        if (scaledElapsed >= startTime && scaledElapsed < endTime && !ws.instance.isPlaying()) {
                            const clipOffset = unitsToReal(scaledElapsed - startTime, timeScale);
                            ws.instance.seekTo(fullDuration ? Math.min((trimStart + clipOffset) / fullDuration, 1) : 0);
                            ws.instance.play().catch(err => {
                                console.warn(`Error playing sample ${ws.instance.sampleId}:`, err);
                            });
                            scheduleClipFades(ws, sample, clipOffset, effDuration);
                        } else if (ws.instance.isPlaying() && (scaledElapsed < startTime || scaledElapsed >= endTime)) {
                            ws.instance.pause();
                        }
                    } catch (err) {
                        console.warn('Error controlling WaveSurfer playback:', err);
                    }
                });

                if (scaledElapsed >= maxDuration) {
                    handleStop();
                    return;
                }

                playbackTimerRef.current = requestAnimationFrame(updatePlayhead);
            };

            // Initialize the next metronome beat index from the current playhead
            const beatScaledInit = realToUnits(60 / bpm, timeScale);
            metronomeNextBeatRef.current = Math.max(0, Math.ceil((playheadPosition / beatScaledInit) - 1e-6));

            playbackTimerRef.current = requestAnimationFrame(updatePlayhead);
        }
    };

    const handlePlayAllClick = () => {
        if (!isLoadingDurations) {
            handlePlayAll();
        }
    };

    const handleStop = () => {
        Object.values(wavesurfersRef.current).forEach(ws => {
            try {
                if (ws.instance.isPlaying()) {
                    ws.instance.stop();
                }
                ws.instance.destroy();
            } catch (err) {
                console.warn('Error pausing or destroying WaveSurfer:', err.message);
            }
        });
        wavesurfersRef.current = {};

        // Dispose of effect nodes
        Object.values(effectsNodes.current).forEach(trackEffects => {
            Object.values(trackEffects).forEach(effect => effect.dispose());
        });
        effectsNodes.current = {};

        setIsPlaying(false);
        isPlayingRef.current = false;
        setIsPaused(false);
        setPlayheadPosition(0);
        startTimeRef.current = 0;
        fallbackCounterRef.current = 0;
        if (playbackTimerRef.current) {
            cancelAnimationFrame(playbackTimerRef.current);
            playbackTimerRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.suspend().catch(err => {
                console.warn('Error suspending AudioContext:', err.message);
            });
        }
        toneTransportRef.current.stop();
        toneTransportRef.current.cancel();
    };

    // Keep keyboard shortcuts pointing at the latest closures
    playAllRef.current = handlePlayAllClick;
    stopRef.current = handleStop;
    duplicateSelectedRef.current = () => {
        if (selectedSampleId) handleDuplicateSample(selectedSampleId);
    };
    deleteSelectedRef.current = () => {
        if (selectedSampleId) {
            handleDeleteSample(selectedSampleId);
            setSelectedSampleId(null);
        }
    };

    const handleSeek = async (seekTime) => {
        if (isPlayingRef.current) {
            try {
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (ws.instance.isPlaying()) {
                            ws.instance.pause();
                        }
                    } catch (err) {
                        console.warn('Error pausing WaveSurfer:', err.message);
                    }
                });

                if (audioContextRef.current && audioContextRef.current.state === 'running') {
                    await audioContextRef.current.suspend();
                }

                if (playbackTimerRef.current) {
                    cancelAnimationFrame(playbackTimerRef.current);
                    playbackTimerRef.current = null;
                }

                setIsPlaying(false);
                isPlayingRef.current = false;
                setIsPaused(true);
                console.log('Paused: playheadPosition=', seekTime);
            } catch (err) {
                console.error('Error pausing playback:', err.message);
                setError('Failed to pause playback');
            }
        }

        setPlayheadPosition(seekTime);
        setIsPaused(true);
    };

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

        clickedTime = Math.max(0, Math.round(clickedTime * 100) / 100);
        handleSeek(clickedTime);
    };

    const handleAddTrack = async (e) => {
        e.preventDefault();
        if (!newTrackName) {
            setError('Track name is required');
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
                pushToHistory({ type: 'addTrack', data: response.data });
                return updatedTracks;
            });
            setNewTrackName('');
            setNewTrackType('sample');
            setError(null);
        } catch (err) {
            console.error('Add track error:', err.message);
            setError('Failed to add track: ' + err.message);
        }
    };

    const handleDeleteTrack = async (trackId) => {
        let samplesToDelete = projectSamples.filter(s => s.track_id === trackId);
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/projects/${projectId}/tracks/${trackId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setTracks(prev => {
                const deletedTrack = prev.find(t => t.id === trackId);
                if (deletedTrack) {
                    pushToHistory({ type: 'deleteTrack', data: { track: deletedTrack, samples: samplesToDelete } });
                    return prev.filter(t => t.id !== trackId);
                }
                return prev;
            });
            setProjectSamples(prev => prev.filter(s => s.track_id !== trackId));
            setError(null);
        } catch (err) {
            console.error('Delete track error:', err.response?.data || err.message);
            setError('Failed to delete track: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleRenameTrack = async (trackId, newName) => {
        if (!newName) return;
        try {
            const token = localStorage.getItem('token');
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${trackId}`,
                { name: newName },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setTracks(
                tracks.map((track) =>
                    track.id === trackId ? { ...track, name: newName } : track
                )
            );
            setError(null);
        } catch (err) {
            console.error('Rename track error:', err.response?.data || err.message);
            setError('Failed to rename track: ' + (err.response?.data?.error || err.message));
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
            setError('Some files are invalid (MP3 max 10MB, WAV max 50MB)');
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
                setLibrarySamples([...librarySamples, response.data]);
            }
            setError(null);
        } catch (err) {
            console.error('Upload samples error:', err.response?.data || err.message);
            setError('Failed to upload samples: ' + (err.response?.data?.error || err.message));
        }
        e.target.value = '';
    };

    const handleDeleteLibrarySample = async (sampleId) => {
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/sample-library/${sampleId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setLibrarySamples(librarySamples.filter((sample) => sample.id !== sampleId));
            setError(null);
        } catch (err) {
            console.error('Delete sample error:', err.response?.data || err.message);
            setError(err.response?.data?.error || 'Failed to delete sample');
        }
    };

    const handleDrop = async (trackId, start_time, sampleId) => {
        try {
            const track = tracks.find(t => t.id === trackId);
            if (track.track_type === 'midi') {
                setError('Cannot drop samples on MIDI tracks');
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
            setError(null);
        } catch (err) {
            console.error('Place sample error:', err.response?.data || err.message);
            setError('Failed to place sample: ' + (err.response?.data?.error || err.message));
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
            setError(null);
        } catch (err) {
            console.error('Remove sample error:', err.response?.data || err.message);
            setError('Failed to remove sample: ' + (err.response?.data?.error || err.message));
        }
    };

    // Duplicate a clip immediately after itself (Cmd/Ctrl+D or ⧉ button)
    const handleDuplicateSample = async (projectSampleId) => {
        const original = projectSamples.find(s => s.id === projectSampleId);
        if (!original) return;
        const fullDuration = sampleDurations[original.id] || 0;
        if (!fullDuration) {
            setError('Sample still loading — try again in a moment');
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
        const newStartTime = Math.round(
            (original.start_time + realToUnits(effDuration, timeScale)) * 10000
        ) / 10000;
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
            setError(null);
        } catch (err) {
            console.error('Duplicate sample error:', err.response?.data || err.message);
            setError('Failed to duplicate sample: ' + (err.response?.data?.error || err.message));
        }
    };

    // Repeat a MIDI track's pattern: append a copy of all notes one pattern-length later
    const handleRepeatMidiPattern = async (trackId) => {
        const track = tracks.find(t => t.id === trackId);
        const notes = Array.isArray(track?.midi_notes) ? track.midi_notes : [];
        if (notes.length === 0) {
            setError('No notes to repeat on this track');
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
            setError(null);
        } catch (err) {
            console.error('Repeat MIDI pattern error:', err.response?.data || err.message);
            setError('Failed to repeat pattern: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleDragSample = async (sampleId, newTrackId, newStartTime) => {        try {
            const newTrack = tracks.find(t => t.id === newTrackId);
            if (newTrack.track_type === 'midi') {
                setError('Cannot drag samples to MIDI tracks');
                return;
            }
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/projects/${projectId}/samples/${sampleId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const originalSample = projectSamples.find(s => s.id === sampleId);
            if (!originalSample) {
                throw new Error('Sample not found');
            }
            // Trim/fade settings carry over to the new clip, so its on-screen
            // length is the original's effective length
            const { effDuration: draggedLength } = getClipTimes(originalSample, sampleDurations[sampleId] || 0);
            const response = await axios.post(
                `${API_URL}/projects/${projectId}/samples`,
                {
                    track_id: newTrackId,
                    sample_id: originalSample.sample_id,
                    start_time: newStartTime,
                    fade_in: originalSample.fade_in || 0,
                    fade_out: originalSample.fade_out || 0,
                    trim_start: originalSample.trim_start || 0,
                    trim_end: originalSample.trim_end ?? null,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProjectSamples(prev => {
                const updatedSamples = prev.filter(s => s.id !== sampleId).concat(response.data);
                pushToHistory({ type: 'dragSample', data: { originalSample, newSample: response.data } });
                extendTimelineIfNeeded(newStartTime, realToUnits(draggedLength, 120 / bpm));
                return updatedSamples;
            });
            setError(null);
        } catch (err) {
            console.error('Drag sample error:', err.response?.data || err.message);
            setError('Failed to reposition sample: ' + (err.response?.data?.error || err.message));
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

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-red-500 text-lg">{error}</p>
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
                <div className="mb-6">
                    <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveTitle}
                        onKeyPress={(e) => e.key === 'Enter' && handleSaveTitle()}
                        className="retro-display text-lg w-full px-2 py-1 border border-cyan-400/25 bg-cyan-400/5 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500"
                        placeholder="Enter project title"
                    />
                </div>
                {error && <p className="retro-mono text-xl text-fuchsia-400 mb-4">{error}</p>}
                <div className="retro-panel retro-cut mb-8 flex flex-wrap items-center gap-3 p-4">
                    <button
                        onClick={handlePlayAllClick}
                        disabled={isLoadingDurations}
                        className={`retro-btn min-w-[100px] px-4 py-2 text-[0.6rem]`}
                    >
                        {isLoadingDurations ? 'Loading...' : isPlaying ? 'Pause' : playheadPosition > 0 ? 'Resume' : 'Play All'}
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
                        disabled={isLoadingDurations}
                        className={`retro-btn retro-btn--hot px-4 py-2 text-[0.6rem]`}
                    >
                        Export MP3
                    </button>
                    <input
                        type="number"
                        value={bpm}
                        onChange={(e) => handleBpmChange(Number(e.target.value))}
                        className="w-20 px-2 py-1 bg-[#1d0a38] text-white border border-cyan-400/30 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50"
                        placeholder="BPM"
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
                                                onChange={(e) => handleRenameTrack(track.id, e.target.value)}
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
                                                    console.log('Opening track settings for track:', track.id);
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
                                                    console.log('Opening effects modal for track:', currentTrack.id, 'effects_settings:', currentTrack.effects_settings); // Debug log
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
                                                        setSelectedTrackForStem(tracks.find(t => t.id === track.id));
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
                                    style={{ left: `${playheadPosition * zoom}px` }}
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
                {selectedTrackForStem && (
                    <StemGenerateModal
                        track={selectedTrackForStem}
                        bpm={bpm}
                        startTime={playheadPosition}
                        onClose={() => setSelectedTrackForStem(null)}
                        onApply={handleApplyGeneratedStem}
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