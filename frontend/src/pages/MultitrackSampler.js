import React, { useEffect, useState, useContext, useRef } from 'react';
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

const SampleBlock = ({ sample, trackId, onDrag, volume, zoom, duration, isLoadingDurations, waveformColor, trackVolume }) => {
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
            wavesurfer.current.setVolume((sample.volume || 1) * trackVolume);

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
    };

    const blockWidth = duration * zoom;

    return (
        <div
            ref={drag}
            className={`absolute h-12 flex items-center p-1 bg-white/5 border border-white/10 rounded-md shadow-sm hover:bg-white/10 ${
                isDragging ? 'opacity-50' : 'opacity-100'
            } ${isLoadingDurations ? 'cursor-not-allowed' : 'cursor-move'}`}
            style={{
                left: `${sample.start_time * zoom}px`,
                width: `${Math.max(blockWidth, 100)}px`,
            }}
            onClick={handleClick}
        >
            {isLoadingDurations ? (
                <div className="flex-1 h-10 bg-white/10 animate-pulse" />
            ) : (
                <div ref={waveformRef} className={`flex-1 h-10 ${waveformColor}`} />
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
                    : 'border-white/20 bg-white/5 text-gray-300'
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
            className={`flex items-center space-x-2 p-2 bg-white/5 border border-white/10 rounded-md cursor-move ${
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

const Timeline = ({ trackId, samples, onDrop, onDrag, zoom, sampleDurations, isLoadingDurations, waveformColor, bpm, isSnapping, timelineDuration, playheadPosition, trackVolume }) => {
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
                const snapIntervalReal = 0.05;
                const snapIntervalScaled = snapIntervalReal * timeScale;
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
    const totalRealSeconds = timelineDuration / timeScale;
    const minorInterval = 0.1;
    const majorInterval = 1.0;
    const numMinorMarkers = Math.ceil(totalRealSeconds / minorInterval);

    return (
        <div
            ref={(node) => {
                timelineRef.current = node;
                drop(node);
            }}
            id={`timeline-${trackId}`}
            className={`relative h-12 border border-white/10 bg-white/5 ${isOver ? 'bg-white/10' : ''}`}
            style={{ width: `${timelineDuration * zoom}px` }}
        >
            {Array.from({ length: numMinorMarkers }, (_, i) => {
                const realTime = i * minorInterval;
                const scaledTime = realTime * timeScale;
                const pixelPosition = scaledTime * zoom;
                const isMajorMarker = Math.abs(realTime % majorInterval) < 0.001;

                return (
                    <div
                        key={`grid-${i}`}
                        className={`absolute top-0 z-0 border-l ${
                            isMajorMarker
                                ? 'border-gray-400 border-opacity-80 h-full'
                                : 'border-gray-200 border-opacity-50 h-1/2'
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
                    volume={sample.volume || 1}
                    zoom={zoom}
                    duration={sampleDurations[sample.id] || 0}
                    isLoadingDurations={isLoadingDurations}
                    waveformColor={waveformColor}
                    trackVolume={trackVolume}
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

const MultiTrackSampler = () => {
    const { projectId } = useParams();
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const [project, setProject] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const [tracks, setTracks] = useState([]);
    const [projectSamples, setProjectSamples] = useState([]);
    const [librarySamples, setLibrarySamples] = useState([]);
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
    const [selectedTrack, setSelectedTrack] = useState(null);
    const midiGains = useRef({});
    const [minimizedTracks, setMinimizedTracks] = useState({});
    const [selectedTrackForEffects, setSelectedTrackForEffects] = useState(null);
    const effectsNodes = useRef({});
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
        tracks.forEach(track => {
            initialVolumes[track.id] = track.volume || 1;
        });
        setTrackVolumes(initialVolumes);
    }, [tracks]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
            } else if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
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

            setIsLoadingDurations(true);
            const newSampleDurations = {};

            try {
                await Promise.all(projectSamples.map(async sample => {
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

            if (projectSamples.length > 0 && Object.keys(sampleDurations).length > 0) {
                maxEndTime = projectSamples.reduce((max, sample) => {
                    const duration = sampleDurations[sample.id] || 0;
                    const endTime = sample.start_time + duration;
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

            const buffer = 10;
            const scaledDuration = (maxEndTime + buffer) * timeScale;
            const minDuration = 30 * timeScale;
            setTimelineDuration(Math.max(scaledDuration, minDuration));
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
            volume: trackVolumes[trackId] || 1,
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
        }
        setTracks(prev =>
            prev.map(t =>
                t.id === trackId
                    ? {
                        ...t,
                        volume: settings.volume ?? t.volume,
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
            if (midiGains.current[trackId]) {
                midiGains.current[trackId].gain.setValueAtTime(previousSettings.volume, Tone.now());
            }
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
            if (midiGains.current[trackId]) {
                midiGains.current[trackId].gain.setValueAtTime(newVolume, Tone.now());
            }
        } catch (err) {
            console.error('Update volume error:', err.response?.data || err.message);
            setError(`Failed to save volume: ${err.response?.data?.error || err.message}`);
        }
    };

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
            let totalRealSeconds = timelineDuration / timeScale;

            const sampleRate = 44100;
            const offlineContext = new OfflineAudioContext(2, Math.ceil(sampleRate * totalRealSeconds), sampleRate);

            for (const sample of projectSamples) {
                const response = await fetch(sample.mp3_url);
                if (!response.ok) throw new Error(`Failed to fetch sample: ${sample.mp3_url}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await offlineContext.decodeAudioData(arrayBuffer);

                const source = offlineContext.createBufferSource();
                source.buffer = audioBuffer;
                const gainNode = offlineContext.createGain();
                gainNode.gain.setValueAtTime(1, 0);
                source.connect(gainNode);
                gainNode.connect(offlineContext.destination);
                source.start(sample.start_time * timeScale);
            }

            for (const track of tracks) {
                if (track.track_type === 'midi' && track.midi_notes) {
                    const instrumentType = track.instrument_type || 'synth';
                    if (instrumentType === 'drumsampler') {
                        continue;
                    }
                    track.midi_notes.forEach(note => {
                        const oscillator = offlineContext.createOscillator();
                        const gainNode = offlineContext.createGain();
                        const frequency = Tone.Frequency(note.note).toFrequency();
                        oscillator.frequency.setValueAtTime(frequency, 0);
                        oscillator.type = 'sine';
                        gainNode.gain.setValueAtTime((trackVolumes[track.id] || 1) * 0.5, 0);
                        oscillator.connect(gainNode);
                        gainNode.connect(offlineContext.destination);
                        oscillator.start(note.start_time * timeScale);
                        oscillator.stop((note.start_time + note.duration) * timeScale);
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
                default:
                    break;
            }
            setHistoryIndex(prev => prev + 1);
        }
    };

    const extendTimelineIfNeeded = (startTime, duration) => {
        const timeScale = 120 / bpm;
        const endTime = startTime + duration;
        const currentDurationRealTime = timelineDuration / timeScale;
        const threshold = 5;

        if (endTime >= currentDurationRealTime - threshold) {
            const extension = 10 * timeScale;
            setTimelineDuration(prev => prev + extension);
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
            let maxDuration = timelineDuration / timeScale;

            if (!isPaused) {
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

                    const trackVolume = trackVolumes[sample.track_id] || 1;
                    const gainNode = new Tone.Gain((sample.volume || 1) * trackVolume);

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
                    };

                    const promise = new Promise((resolve) => {
                        wsInstance.on('ready', () => {
                            try {
                                wavesurfersRef.current[sample.id].ready = true;
                                if (wsInstance.backend && wsInstance.backend.ac) {
                                    const source = wsInstance.backend.getSource();
                                    source.connect(gainNode);
                                } else {
                                    console.warn(`WaveSurfer backend not available for sample ${sample.id}`);
                                }

                                const duration = sampleDurations[sample.id] || wsInstance.getDuration();
                                const sampleStart = sample.start_time * timeScale;

                                if (sampleStart < maxDuration) {
                                    wsInstance.seekTo(0);
                                    if (sampleStart <= 0) {
                                        wsInstance.play().catch(err => {
                                            console.warn(`Error playing sample ${sample.id}:`, err);
                                        });
                                    }
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
                        const gainNode = midiGains.current[track.id] || new Tone.Gain(track.volume || 1);
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
                            synthParams = track.synth_settings
                                ? {
                                    ...track.synth_settings.synthParams,
                                    envelope: track.synth_settings.envelope,
                                    voice0: track.synth_settings.voice0,
                                    voice1: track.synth_settings.voice0 ? { detune: -track.synth_settings.voice0.detune } : undefined,
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

                        // Connect effects chain: synth -> effects -> gain -> destination
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
                        lastNode.toDestination();

                        track.midi_notes.forEach(note => {
                            toneTransportRef.current.schedule(time => {
                                synth.triggerAttackRelease(note.note, note.duration, time);
                            }, note.start_time * timeScale);
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

                startTimeRef.current = audioContextRef.current.currentTime;
                setPlayheadPosition(0);
                toneTransportRef.current.start();
            } else {
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (!ws.ready) return;
                        const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                        if (!sample) return;
                        const trackVolume = trackVolumes[sample.track_id] || 1;
                        ws.instance.setVolume((sample.volume || 1) * trackVolume);
                        const duration = sampleDurations[ws.instance.sampleId] || ws.instance.getDuration();
                        const startTime = sample.start_time * timeScale;
                        const endTime = startTime + duration;

                        if (playheadPosition >= startTime && playheadPosition < endTime) {
                            const playTime = (playheadPosition - startTime) / duration;
                            ws.instance.seekTo(playTime);
                            ws.instance.play().catch(err => {
                                console.warn(`Error resuming sample ${ws.instance.sampleId}:`, err);
                            });
                        }
                    } catch (err) {
                        console.warn('Error resuming WaveSurfer:', err);
                    }
                });

                toneTransportRef.current.cancel();
                tracks.forEach(track => {
                    if (track.track_type === 'midi' && Array.isArray(track.midi_notes)) {
                        if (!track.id) {
                            console.warn('Track missing ID:', track);
                            return;
                        }
                        const gainNode = midiGains.current[track.id] || new Tone.Gain(track.volume || 1);
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
                            synthParams = track.synth_settings
                                ? {
                                    ...track.synth_settings.synthParams,
                                    envelope: track.synth_settings.envelope,
                                    voice0: track.synth_settings.voice0,
                                    voice1: track.synth_settings.voice0 ? { detune: -track.synth_settings.voice0.detune } : undefined,
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
                        lastNode.toDestination();

                        track.midi_notes.forEach(note => {
                            if (note.start_time * timeScale >= playheadPosition) {
                                toneTransportRef.current.schedule(time => {
                                    synth.triggerAttackRelease(note.note, note.duration, time);
                                }, note.start_time * timeScale);
                            }
                        });
                    }
                });

                startTimeRef.current = audioContextRef.current.currentTime - (playheadPosition / timeScale);
                toneTransportRef.current.start('+' + (playheadPosition / timeScale));
                setIsPaused(false);
            }

            const updatePlayhead = () => {
                if (!isPlayingRef.current) return;

                let scaledElapsed;
                if (audioContextRef.current.state === 'running') {
                    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
                    scaledElapsed = elapsed * timeScale;
                    fallbackCounterRef.current = scaledElapsed;
                } else {
                    fallbackCounterRef.current += 0.016 * timeScale;
                    scaledElapsed = fallbackCounterRef.current;
                    console.warn('AudioContext suspended, using fallback counter:', scaledElapsed.toFixed(3), 's');
                }
                setPlayheadPosition(scaledElapsed);

                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (!ws.instance || !ws.ready) return;
                        const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                        if (!sample) return;
                        const duration = sampleDurations[ws.instance.sampleId] || ws.instance.getDuration();
                        const startTime = sample.start_time * timeScale;
                        const endTime = startTime + duration;

                        if (scaledElapsed >= startTime && scaledElapsed < endTime && !ws.instance.isPlaying()) {
                            const playTime = (scaledElapsed - startTime) / duration;
                            ws.instance.seekTo(playTime);
                            ws.instance.play().catch(err => {
                                console.warn(`Error playing sample ${ws.instance.sampleId}:`, err);
                            });
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
            const snapIntervalReal = 0.05;
            const snapIntervalScaled = snapIntervalReal * timeScale;
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
        const validFiles = files.filter(
            (file) =>
                file.type.includes('audio/mpeg') && file.size <= 10 * 1024 * 1024
        );
        if (validFiles.length !== files.length) {
            setError('Some files are invalid (must be MP3, max 10MB)');
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
            setProjectSamples(prev => {
                const updatedSamples = [...prev, response.data];
                pushToHistory({ type: 'addSample', data: response.data });
                extendTimelineIfNeeded(start_time, response.data.sample_id);
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

    const handleDragSample = async (sampleId, newTrackId, newStartTime) => {
        try {
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
            const response = await axios.post(
                `${API_URL}/projects/${projectId}/samples`,
                { track_id: newTrackId, sample_id: originalSample.sample_id, start_time: newStartTime },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProjectSamples(prev => {
                const updatedSamples = prev.filter(s => s.id !== sampleId).concat(response.data);
                pushToHistory({ type: 'dragSample', data: { originalSample, newSample: response.data } });
                extendTimelineIfNeeded(newStartTime, originalSample.sample_id);
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
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-20">
                <p className="text-lg">Please log in to edit projects.</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-20">
                <p className="text-red-500 text-lg">{error}</p>
                <Link to="/projects" className="mt-4 inline-block py-2 px-4 bg-primary-brand text-white font-semibold rounded-md hover:bg-primary-brand-500">
                    Back to Projects
                </Link>
            </div>
        );
    }

    if (!project) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-20">
                <p className="text-lg">Loading...</p>
            </div>
        );
    }

    const timeScale = 120 / bpm;
    const markerInterval = 5;
    const realTimeInterval = markerInterval / timeScale;
    const numMarkers = Math.ceil(timelineDuration / markerInterval);

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="w-full min-h-screen text-gray-100 pt-20 px-4">
                <div className="mb-6">
                    <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveTitle}
                        onKeyPress={(e) => e.key === 'Enter' && handleSaveTitle()}
                        className="text-3xl font-bold w-full px-2 py-1 border border-white/10 bg-white/5 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500"
                        placeholder="Enter project title"
                    />
                </div>
                {error && <p className="text-red-500 mb-4">{error}</p>}
                <div className="mb-8 flex items-center space-x-4 bg-gray-800 p-4 rounded-lg shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
                    <button
                        onClick={handlePlayAllClick}
                        disabled={isLoadingDurations}
                        className={`min-w-[100px] px-4 py-2 bg-gray-800 text-primary-brand font-semibold rounded-lg border border-primary-brand hover:bg-blue-900 hover:text-white hover:shadow-[0_0_10px_rgba(59,130,246,0.5)] focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-center`}
                    >
                        {isLoadingDurations ? 'Loading...' : isPlaying ? 'Pause' : playheadPosition > 0 ? 'Resume' : 'Play All'}
                    </button>
                    <button
                        onClick={handleStop}
                        disabled={isLoadingDurations}
                        className={`px-4 py-2 bg-gradient-to-r from-red-600 to-pink-600 text-white font-semibold rounded-lg hover:from-red-700 hover:to-pink-700 hover:scale-105 hover:shadow-[0_0_10px_rgba(239,68,68,0.5)] focus:outline-none focus:ring-4 focus:ring-red-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        Stop
                    </button>
                    <button
                        onClick={undo}
                        disabled={historyIndex < 0 || isLoadingDurations}
                        className={`px-4 py-2 bg-gradient-to-r from-gray-600 to-gray-500 text-white font-semibold rounded-lg hover:from-gray-700 hover:to-gray-600 hover:scale-105 hover:shadow-[0_0_10px_rgba(107,114,128,0.5)] focus:outline-none focus:ring-4 focus:ring-gray-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        Undo
                    </button>
                    <button
                        onClick={redo}
                        disabled={historyIndex >= history.length - 1 || isLoadingDurations}
                        className={`px-4 py-2 bg-gradient-to-r from-gray-600 to-gray-500 text-white font-semibold rounded-lg hover:from-gray-700 hover:to-gray-600 hover:scale-105 hover:shadow-[0_0_10px_rgba(107,114,128,0.5)] focus:outline-none focus:ring-4 focus:ring-gray-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        Redo
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isLoadingDurations}
                        className={`px-4 py-2 bg-gradient-to-r from-teal-500 to-green-500 text-white font-semibold rounded-lg hover:from-teal-600 hover:to-green-600 hover:scale-105 hover:shadow-[0_0_10px_rgba(20,184,166,0.5)] focus:outline-none focus:ring-4 focus:ring-teal-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        Export MP3
                    </button>
                    <input
                        type="number"
                        value={bpm}
                        onChange={(e) => setBpm(Math.max(60, Math.min(240, Number(e.target.value))))}
                        className="w-20 px-2 py-1 bg-gray-700 text-white border border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50"
                        placeholder="BPM"
                        min="60"
                        max="240"
                        disabled={isLoadingDurations}
                    />
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleZoomOut}
                            disabled={isLoadingDurations}
                            className={`px-2 py-1 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            –
                        </button>
                        <span className="text-sm text-gray-300">Zoom: {zoom}px/s</span>
                        <button
                            onClick={handleZoomIn}
                            disabled={isLoadingDurations}
                            className={`px-2 py-1 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed`}
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
                            className="h-4 w-4 text-purple-500 focus:ring-purple-500 border-gray-600 bg-gray-700 rounded disabled:opacity-50"
                        />
                        <label htmlFor="snap-toggle" className="text-sm text-gray-300">Snap to Grid (.05)</label>
                    </div>
                    <span className="text-sm text-gray-300">
                        Playhead: {(playheadPosition / (120 / bpm)).toFixed(1)}s
                    </span>
                </div>
                <div className="flex mb-6">
                    {/* Track Settings Column (Static) */}
                    <div className="w-[224px] flex-shrink-0 sticky top-20 z-10 bg-[#0f0f0f] border-r border-white/10">
                        <div className="h-12"></div> {/* Empty div to align with top timeline */}
                        <div className="space-y-1">
                            {tracks.map((track) => {
                                const trackHeight = track.track_type === 'midi' ? (minimizedTracks[track.id] ? 80 : 540) : 48;
                                return (
                                    <div
                                        key={track.id}
                                        className="flex flex-col items-start space-y-0.5 p-2 rounded-lg bg-gray-700 bg-opacity-50 backdrop-blur-md"
                                        style={{ height: `${trackHeight}px` }}
                                    >
                                        <div className="flex items-center space-x-2 w-full">
                                            <input
                                                type="text"
                                                value={track.name}
                                                onChange={(e) => handleRenameTrack(track.id, e.target.value)}
                                                className="w-36 px-2 py-1 bg-gray-800 text-gray-200 border border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
                                                disabled={isLoadingDurations}
                                            />
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    console.log('Opening track settings for track:', track.id);
                                                    setSelectedTrack(track);
                                                }}
                                                className="bg-gray-700 text-gray-200 hover:bg-gray-600 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                                                className="bg-gray-700 text-gray-200 hover:bg-gray-600 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={isLoadingDurations}
                                                title="Effects Settings"
                                            >
                                                🎛️
                                            </button>
                                        </div>
                                        {track.track_type === 'midi' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleTrackMinimize(track.id);
                                                }}
                                                className="bg-gray-700 text-gray-200 hover:bg-gray-600 rounded-md px-4 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={isLoadingDurations}
                                                title={minimizedTracks[track.id] ? 'Expand Piano Roll' : 'Minimize Piano Roll'}
                                            >
                                                {minimizedTracks[track.id] ? '↔ Expand' : '↕ Minimize'}
                                            </button>
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
                                className="h-12 bg-gray-800 relative border border-gray-600"
                                style={{ width: `${timelineDuration * zoom}px` }}
                                onClick={handleTopTimelineClick}
                            >
                                {Array.from({ length: numMarkers }, (_, i) => {
                                    const scaledTime = i * markerInterval;
                                    const realTime = scaledTime / timeScale;
                                    const pixelPosition = scaledTime * zoom;
                                    return (
                                        <React.Fragment key={i}>
                                            <div
                                                className="text-sm font-medium absolute text-gray-300"
                                                style={{ left: `${pixelPosition}px` }}
                                            >
                                                {realTime.toFixed(1)}s
                                            </div>
                                            <div
                                                className="absolute top-0 bottom-0 border-l border-gray-600"
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
                                                onNotesChange={handleNotesChange}
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
                                className="w-64 px-3 py-2 border border-white/10 bg-white/5 text-white rounded-md shadow-sm focus:outline-none focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                disabled={isLoadingDurations}
                            />
                            <select
                                value={newTrackType}
                                onChange={(e) => setNewTrackType(e.target.value)}
                                className="px-3 py-2 border border-white/10 bg-white/5 text-white rounded-md shadow-sm focus:outline-none focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                disabled={isLoadingDurations}
                            >
                                <option value="sample">Sample</option>
                                <option value="midi">MIDI</option>
                            </select>
                            <button
                                type="submit"
                                className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
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
                                className="h-4 w-4 text-primary-brand-400 focus:ring-primary-brand-500 border-white/20 bg-white/10 rounded disabled:opacity-50"
                            />
                            <label htmlFor="public-toggle" className="text-sm text-gray-200">Allow public to view</label>
                        </div>
                        <SampleDeleteDropZone onDelete={handleDeleteSample} isLoadingDurations={isLoadingDurations} />
                    </div>
                    <h2 className="text-xl font-semibold mb-4">Sample Library</h2>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                        {librarySamples.map((sample) => (
                            <div key={sample.id} className="flex items-center space-x-2">
                                <DraggableSample
                                    sample={sample}
                                    name={sample.name}
                                    sampleId={sample.id}
                                />
                                <button
                                    onClick={() => handleDeleteLibrarySample(sample.id)}
                                    className="text-red-500 hover:text-red-700 focus:outline-none"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                    <input
                        type="file"
                        accept="audio/mp3"
                        multiple
                        onChange={handleFileUpload}
                        ref={fileInputRef}
                        className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                    />
                </div>
                {selectedTrack && (
                    <TrackSettingsModal
                        track={selectedTrack}
                        projectId={projectId}
                        onClose={() => setSelectedTrack(null)}
                        onDelete={handleDeleteTrack}
                        onSettingsChange={handleTrackSettingsChange}
                        currentVolume={selectedTrack.volume || 1}
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
            </div>
        </DndProvider>
    );
};

export default MultiTrackSampler;