// src/components/PublicMultiTrackSampler.js
import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import WaveSurfer from 'wavesurfer.js';
import * as Tone from 'tone';
import ReadOnlyPianoRoll from '../components/ReadOnlyPianoRoll';
import synthConfigs from '../config/synthConfigs';
import API_URL from '../utils/api';

const SampleBlock = ({ sample, zoom, duration, waveformColor }) => {
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

    const blockWidth = duration * zoom;

    return (
        <div
            className="absolute h-12 flex items-center space-x-2 p-1 bg-white/5 border border-white/10 rounded-md shadow-sm"
            style={{
                left: `${sample.start_time * zoom}px`,
                width: `${Math.max(blockWidth, 100)}px`,
            }}
        >
            <div ref={waveformRef} className={`flex-1 h-10 ${waveformColor}`} />
        </div>
    );
};

const Timeline = ({ trackId, samples, playheadPosition, zoom, sampleDurations, waveformColor, bpm, timelineDuration }) => {
    const timeScale = 120 / bpm;
    const totalRealSeconds = timelineDuration / timeScale;
    const minorInterval = 0.1;
    const majorInterval = 1.0;
    const numMinorMarkers = Math.ceil(totalRealSeconds / minorInterval);

    return (
        <div
            className="relative h-12 border border-white/10 bg-white/5"
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
                        className={`absolute top-0 z-0 border-l ${isMajorMarker ? 'border-white/30 h-full' : 'border-white/15 h-1/2'}`}
                        style={{ left: `${pixelPosition}px` }}
                    />
                );
            })}
            <div
                className="absolute top-0 bottom-0 w-1 bg-red-500 z-10"
                style={{ left: `${playheadPosition * zoom}px` }}
            />
            {samples.map((sample) => (
                <SampleBlock
                    key={sample.id}
                    sample={sample}
                    zoom={zoom}
                    duration={sampleDurations[sample.id] || 0}
                    waveformColor={waveformColor}
                />
            ))}
        </div>
    );
};

const PublicMultiTrackSampler = () => {
    const { projectId } = useParams();
    const [project, setProject] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [projectSamples, setProjectSamples] = useState([]);
    const [error, setError] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [playheadPosition, setPlayheadPosition] = useState(0);
    const [bpm, setBpm] = useState(120);
    const [zoom] = useState(100);
    const [sampleDurations, setSampleDurations] = useState({});
    const [isLoadingDurations, setIsLoadingDurations] = useState(false);
    const [timelineDuration, setTimelineDuration] = useState(30 * (120 / 120));
    const wavesurfersRef = useRef({});
    const audioContextRef = useRef(null);
    const playbackTimerRef = useRef(null);
    const startTimeRef = useRef(0);
    const fallbackCounterRef = useRef(0);
    const isPlayingRef = useRef(false);
    const toneTransportRef = useRef(Tone.Transport);
    const synthsRef = useRef({});

    useEffect(() => {
        const fetchProject = async () => {
            try {
                const response = await axios.get(`${API_URL}/projects/public/${projectId}`);
                const { project, tracks, projectSamples } = response.data;
                setProject(project || null);
                setTracks(Array.isArray(tracks) ? tracks : []);
                setProjectSamples(Array.isArray(projectSamples) ? projectSamples : []);
                setBpm(project.bpm || 120);
            } catch (err) {
                console.error('Fetch public project error:', {
                    status: err.response?.status,
                    data: err.response?.data,
                    message: err.message,
                });
                const errorMessage = err.response?.status === 404
                    ? `Public project with ID ${projectId} not found.`
                    : 'Failed to fetch project: ' + (err.response?.data?.error || err.message);
                setError(errorMessage);
            }
        };
        fetchProject();
    }, [projectId]);

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
                if (track.track_type === 'midi' && Array.isArray(track.midi_notes) && track.midi_notes.length > 0) {
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
            Object.values(synthsRef.current).forEach(synth => {
                try {
                    synth.dispose();
                } catch (err) {
                    console.warn('Error disposing Tone.js synth:', err.message);
                }
            });
            synthsRef.current = {};
            toneTransportRef.current.cancel();
            Tone.context.close().catch(err => {
                console.warn('Error closing Tone.js context:', err.message);
            });
        };
    }, []);

    const handlePlayAll = async () => {
        if (isPlayingRef.current) {
            // Pause playback
            try {
                // Pause WaveSurfer instances
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (ws.instance && ws.instance.isPlaying()) {
                            ws.instance.pause();
                            console.log(`Paused WaveSurfer sample ${ws.instance.sampleId}`);
                        }
                    } catch (err) {
                        console.warn(`Error pausing WaveSurfer sample ${ws.instance?.sampleId}:`, err.message);
                    }
                });

                // Pause Tone.js synths by stopping active notes
                Object.values(synthsRef.current).forEach(synth => {
                    try {
                        synth.triggerRelease(Tone.now());
                        console.log('Released Tone.js synth notes');
                    } catch (err) {
                        console.warn('Error releasing Tone.js synth:', err.message);
                    }
                });

                // Suspend AudioContext
                if (audioContextRef.current && audioContextRef.current.state === 'running') {
                    await audioContextRef.current.suspend();
                    console.log('Suspended AudioContext');
                }

                // Pause Tone.js transport
                toneTransportRef.current.pause();
                console.log('Paused Tone.js transport');

                // Stop animation frame
                if (playbackTimerRef.current) {
                    cancelAnimationFrame(playbackTimerRef.current);
                    playbackTimerRef.current = null;
                    console.log('Stopped playhead animation');
                }

                setIsPlaying(false);
                isPlayingRef.current = false;
                setIsPaused(true);
                console.log('Paused: playheadPosition=', playheadPosition);
            } catch (err) {
                console.error('Error pausing playback:', err.message);
                setError('Failed to pause playback');
            }
        } else {
            // Start or resume playback
            setIsPlaying(true);
            isPlayingRef.current = true;
            await Tone.start();

            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContextRef.current.state === 'suspended') {
                try {
                    await audioContextRef.current.resume();
                    console.log('Resumed AudioContext');
                } catch (err) {
                    console.error('Error resuming AudioContext:', err.message);
                    setError('Failed to resume audio context');
                    setIsPlaying(false);
                    isPlayingRef.current = false;
                    setIsPaused(false);
                    return;
                }
            }

            const timeScale = 120 / bpm;
            const maxDuration = timelineDuration / timeScale;

            if (!isPaused) {
                // Fresh start
                wavesurfersRef.current = {};
                toneTransportRef.current.cancel();
                const playPromises = [];

                for (const sample of projectSamples) {
                    const ws = WaveSurfer.create({
                        container: document.createElement('div'),
                        waveColor: '#4B5563',
                        progressColor: '#1F2937',
                        height: 40,
                        barWidth: 2,
                        normalize: true,
                        audioContext: audioContextRef.current,
                    });
                    ws.sampleId = sample.id;
                    wavesurfersRef.current[sample.id] = { instance: ws, ready: false };

                    const promise = new Promise((resolve) => {
                        ws.on('ready', () => {
                            try {
                                wavesurfersRef.current[sample.id].ready = true;
                                const duration = sampleDurations[sample.id] || ws.getDuration();
                                const sampleStart = sample.start_time * timeScale;

                                if (sampleStart <= 0) {
                                    ws.play().catch(err => {
                                        console.warn(`Error playing sample ${sample.id}:`, err.message);
                                    });
                                }
                                resolve();
                            } catch (err) {
                                console.warn(`Error processing sample ${sample.id}:`, err.message);
                                resolve();
                            }
                        });
                        ws.on('error', err => {
                            console.warn(`WaveSurfer error for sample ${sample.id}:`, err.message);
                            resolve();
                        });

                        ws.load(sample.mp3_url).catch(err => {
                            console.warn(`Error loading sample ${sample.id}:`, err.message);
                            resolve();
                        });
                    });

                    playPromises.push(promise);
                }

                // Initialize MIDI playback
                synthsRef.current = {};
                tracks.forEach(track => {
                    if (track.track_type === 'midi' && Array.isArray(track.midi_notes)) {
                        const instrumentType = track.instrument_type || 'synth';
                        const isPolyphonic = track.is_polyphonic || false;
                        const config = synthConfigs[instrumentType] || synthConfigs.synth;
                        const { SynthClass } = config;
                        const params = track.synth_settings
                            ? {
                                ...track.synth_settings.synthParams,
                                envelope: track.synth_settings.envelope,
                                voice0: track.synth_settings.voice0,
                                voice1: track.synth_settings.voice0 ? { detune: -track.synth_settings.voice0.detune } : undefined,
                            }
                            : config.params;

                        const synth = isPolyphonic
                            ? new Tone.PolySynth(SynthClass, { maxPolyphony: 8, ...params }).toDestination()
                            : new SynthClass(params).toDestination();

                        synthsRef.current[track.id] = synth;

                        track.midi_notes.forEach(note => {
                            toneTransportRef.current.schedule(time => {
                                synth.triggerAttackRelease(note.note, note.duration, time);
                                console.log(`Scheduled MIDI note: track=${track.id}, note=${note.note}, time=${time}`);
                            }, note.start_time * timeScale);
                        });
                    }
                });

                try {
                    await Promise.all(playPromises);
                } catch (err) {
                    console.error('Error initializing samples:', err.message);
                    setError('Failed to initialize some samples');
                    setIsPlaying(false);
                    isPlayingRef.current = false;
                    setIsPaused(false);
                    return;
                }

                startTimeRef.current = audioContextRef.current.currentTime;
                setPlayheadPosition(0);
                toneTransportRef.current.start();
                console.log('Fresh start: startTimeRef=', startTimeRef.current, 'playheadPosition=0');
            } else {
                // Resume from pause
                Object.values(wavesurfersRef.current).forEach(ws => {
                    try {
                        if (!ws.ready || !ws.instance) return;
                        const sample = projectSamples.find(s => s.id === ws.instance.sampleId);
                        if (!sample) return;
                        const duration = sampleDurations[ws.instance.sampleId] || ws.instance.getDuration();
                        const startTime = sample.start_time * timeScale;
                        const endTime = startTime + duration;

                        if (playheadPosition * timeScale >= startTime && playheadPosition * timeScale < endTime) {
                            const offset = playheadPosition * timeScale - startTime;
                            ws.instance.play(offset).catch(err => {
                                console.warn(`Error resuming sample ${ws.instance.sampleId}:`, err.message);
                            });
                            console.log(`Resumed WaveSurfer sample ${ws.instance.sampleId} at offset=${offset}`);
                        }
                    } catch (err) {
                        console.warn('Error resuming WaveSurfer:', err.message);
                    }
                });

                // Reschedule MIDI notes
                toneTransportRef.current.cancel();
                tracks.forEach(track => {
                    if (track.track_type === 'midi' && Array.isArray(track.midi_notes)) {
                        const synth = synthsRef.current[track.id];
                        if (!synth) {
                            console.warn(`No synth found for track ${track.id}, skipping MIDI resume`);
                            return;
                        }

                        track.midi_notes.forEach(note => {
                            const noteStart = note.start_time * timeScale;
                            const noteEnd = (note.start_time + note.duration) * timeScale;
                            if (noteStart >= playheadPosition * timeScale) {
                                // Future notes
                                toneTransportRef.current.schedule(time => {
                                    synth.triggerAttackRelease(note.note, note.duration, time);
                                    console.log(`Scheduled future MIDI note: track=${track.id}, note=${note.note}, time=${time}`);
                                }, noteStart);
                            } else if (noteStart < playheadPosition * timeScale && noteEnd > playheadPosition * timeScale) {
                                // Active notes at resume point
                                const remainingDuration = (noteEnd - playheadPosition * timeScale) / timeScale;
                                synth.triggerAttackRelease(note.note, remainingDuration, Tone.now());
                                console.log(`Triggered active MIDI note: track=${track.id}, note=${note.note}, remainingDuration=${remainingDuration}`);
                            }
                        });
                    }
                });

                startTimeRef.current = audioContextRef.current.currentTime - (playheadPosition * timeScale);
                toneTransportRef.current.start(Tone.now(), playheadPosition * timeScale);
                setIsPaused(false);
                console.log('Resuming: startTimeRef=', startTimeRef.current, 'playheadPosition=', playheadPosition);
            }

            // Update playhead
            const updatePlayhead = () => {
                if (!isPlayingRef.current) {
                    Object.values(synthsRef.current).forEach(synth => {
                        try {
                            synth.dispose();
                        } catch (err) {
                            console.warn('Error disposing Tone.js synth:', err.message);
                        }
                    });
                    synthsRef.current = {};
                    return;
                }

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
                            ws.instance.play(scaledElapsed - startTime).catch(err => {
                                console.warn(`Error playing sample ${ws.instance.sampleId}:`, err.message);
                            });
                        } else if (ws.instance.isPlaying() && (scaledElapsed < startTime || scaledElapsed >= endTime)) {
                            ws.instance.pause();
                        }
                    } catch (err) {
                        console.warn('Error controlling WaveSurfer playback:', err.message);
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

    const handleStop = () => {
        try {
            // Stop and destroy WaveSurfer instances
            Object.values(wavesurfersRef.current).forEach(ws => {
                try {
                    if (ws.instance && ws.instance.isPlaying()) {
                        ws.instance.stop();
                    }
                    ws.instance.destroy();
                } catch (err) {
                    console.warn('Error stopping or destroying WaveSurfer:', err.message);
                }
            });
            wavesurfersRef.current = {};

            // Stop and dispose Tone.js synths
            Object.values(synthsRef.current).forEach(synth => {
                try {
                    synth.dispose();
                } catch (err) {
                    console.warn('Error disposing Tone.js synth:', err.message);
                }
            });
            synthsRef.current = {};

            // Stop Tone.js transport
            toneTransportRef.current.stop();
            toneTransportRef.current.cancel();

            // Suspend AudioContext
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.suspend().catch(err => {
                    console.warn('Error suspending AudioContext:', err.message);
                });
            }

            // Stop animation frame
            if (playbackTimerRef.current) {
                cancelAnimationFrame(playbackTimerRef.current);
                playbackTimerRef.current = null;
            }

            // Reset state
            setIsPlaying(false);
            isPlayingRef.current = false;
            setIsPaused(false);
            setPlayheadPosition(0);
            startTimeRef.current = 0;
            fallbackCounterRef.current = 0;
        } catch (err) {
            console.error('Error stopping playback:', err.message);
            setError('Failed to stop playback');
        }
    };

    const handlePlayAllClick = () => {
        if (!isLoadingDurations) {
            handlePlayAll();
        }
    };

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-20">
                <p className="text-red-500 text-lg">{error}</p>
                <button
                    onClick={() => {
                        setError(null);
                        const fetchProject = async () => {
                            try {
                                const response = await axios.get(`${API_URL}/projects/public/${projectId}`);
                                const { project, tracks, projectSamples } = response.data;
                                setProject(project || null);
                                setTracks(Array.isArray(tracks) ? tracks : []);
                                setProjectSamples(Array.isArray(projectSamples) ? projectSamples : []);
                                setBpm(project.bpm || 120);
                            } catch (err) {
                                console.error('Fetch public project error:', {
                                    status: err.response?.status,
                                    data: err.response?.data,
                                    message: err.message,
                                });
                                const errorMessage = err.response?.status === 404
                                    ? `Public project with ID ${projectId} not found.`
                                    : 'Failed to fetch project: ' + (err.response?.data?.error || err.message);
                                setError(errorMessage);
                            }
                        };
                        fetchProject();
                    }}
                    className="mt-4 inline-block py-2 px-4 bg-primary-brand text-white font-semibold rounded-md hover:bg-primary-brand-500"
                >
                    Retry
                </button>
                <Link
                    to="/projects"
                    className="mt-4 ml-4 inline-block py-2 px-4 bg-white/10 text-white font-semibold rounded-md hover:bg-white/15"
                >
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
        <div className="container mx-auto px-4 py-8 max-w-6xl text-gray-100 pt-20">
            <h1 className="text-3xl font-bold mb-2">{project.title} (Listen Only)</h1>
            <p className="text-sm text-gray-300 mb-2">
                Created: {new Date(project.created_at).toLocaleDateString()}
            </p>
            {project.creator && project.user_id && (
                <p className="text-sm text-gray-300 mb-4">
                    Creator:{' '}
                    <Link
                        to={`/profile/${project.user_id}`}
                        className="text-primary-brand hover:underline"
                        aria-label={`View ${project.creator}'s profile`}
                    >
                        {project.creator}
                    </Link>
                </p>
            )}
            {error && <p className="text-red-500 mb-4">{error}</p>}
            <div className="mb-8 flex items-center space-x-4 bg-gray-800 p-4 rounded-lg shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
                <button
                    onClick={handlePlayAllClick}
                    disabled={isLoadingDurations}
                    className={`w-24 px-4 py-2 bg-gray-800 text-primary-brand font-semibold rounded-lg border border-primary-brand hover:bg-blue-900 hover:text-white hover:shadow-[0_0_10px_rgba(59,130,246,0.5)] focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-center`}
                >
                    {isLoadingDurations ? 'Loading...' : isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}
                </button>
                <button
                    onClick={handleStop}
                    disabled={isLoadingDurations}
                    className={`w-24 px-4 py-2 bg-gray-800 text-red-400 font-semibold rounded-lg border border-red-500 hover:bg-red-900 hover:text-white hover:shadow-[0_0_10px_rgba(239,68,68,0.5)] focus:outline-none focus:ring-4 focus:ring-red-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-center`}
                >
                    Stop
                </button>
                <span className="text-sm text-gray-300">
          Playhead: {(playheadPosition / (120 / bpm)).toFixed(1)}s
        </span>
            </div>
            <div className="overflow-x-auto mb-8">
                <div className="grid grid-cols-[200px_1fr] gap-1 min-w-[3200px]">
                    <div className="h-12"></div>
                    <div
                        className="h-12 bg-gray-800 relative border-b border-gray-600"
                        style={{ width: `${timelineDuration * zoom}px` }}
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
                                        className="absolute top-0 bottom-0 border-l border-gray-600 z-0"
                                        style={{ left: `${pixelPosition}px` }}
                                    />
                                </React.Fragment>
                            );
                        })}
                        <div
                            className="absolute top-0 bottom-0 w-1 bg-red-500 z-10"
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
                        return (
                            <React.Fragment key={track.id}>
                                <div
                                    className={`flex items-start p-2 bg-gray-700 bg-opacity-50 backdrop-blur-sm rounded-lg`}
                                    style={{ height: track.track_type === 'midi' ? '360px' : '48px' }}
                                >
                                    <span className="flex-1 text-sm text-gray-200">{track.name}</span>
                                </div>
                                {track.track_type === 'midi' ? (
                                    <ReadOnlyPianoRoll
                                        track={track}
                                        playheadPosition={playheadPosition}
                                        zoom={zoom}
                                        bpm={bpm}
                                        timelineDuration={timelineDuration}
                                    />
                                ) : (
                                    <Timeline
                                        trackId={track.id}
                                        samples={projectSamples.filter(s => s.track_id === track.id)}
                                        playheadPosition={playheadPosition}
                                        zoom={zoom}
                                        sampleDurations={sampleDurations}
                                        waveformColor={waveformColor}
                                        bpm={bpm}
                                        timelineDuration={timelineDuration}
                                    />
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
            <Link to="/projects" className="inline-block py-2 px-4 bg-primary-brand text-white font-semibold rounded-md hover:bg-primary-brand-500">
                Back to Projects
            </Link>
        </div>
    );
};

export default PublicMultiTrackSampler;