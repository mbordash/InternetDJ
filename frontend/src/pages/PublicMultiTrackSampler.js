// src/components/PublicMultiTrackSampler.js
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import ReadOnlyPianoRoll from '../components/ReadOnlyPianoRoll';
import API_URL from '../utils/api';
import useProjectPlayback from '../hooks/useProjectPlayback';
import { timeScaleFor, timelineLength, unitsToReal, realToUnits, getClipTimes } from '../utils/timeline';
import { loadSampleDurations } from '../utils/audioBuffers';
import ClipWaveform from '../components/ClipWaveform';
import profilePath from '../utils/profilePath';

const SampleBlock = ({ sample, zoom, duration, waveformColor }) => {
    const { trimStart, trimEnd } = getClipTimes(sample, duration);

    const blockWidth = duration * zoom;

    return (
        <div
            className="absolute h-12 flex items-center space-x-2 p-1 bg-cyan-400/5 border border-cyan-400/25 rounded-md shadow-sm"
            style={{
                left: `${sample.start_time * zoom}px`,
                width: `${Math.max(blockWidth, 100)}px`,
            }}
        >
            <ClipWaveform
                url={sample.mp3_url}
                from={trimStart}
                to={trimEnd}
                className={waveformColor}
            />
        </div>
    );
};

const Timeline = ({ trackId, samples, playheadPosition, zoom, sampleDurations, waveformColor, bpm, timelineDuration, registerPlayhead }) => {
    const timeScale = 120 / bpm;
    const totalRealSeconds = timelineDuration / timeScale;
    const minorInterval = 0.1;
    const majorInterval = 1.0;
    const numMinorMarkers = Math.ceil(totalRealSeconds / minorInterval);

    return (
        <div
            className="relative h-12 border border-cyan-400/25 bg-cyan-400/5"
            style={{ width: `${timelineDuration * zoom}px` }}
        >
            {Array.from({ length: numMinorMarkers }, (_, i) => {
                const realTime = i * minorInterval;
                const scaledTime = realToUnits(realTime, timeScale);
                const pixelPosition = scaledTime * zoom;
                const isMajorMarker = Math.abs(realTime % majorInterval) < 0.001;

                return (
                    <div
                        key={`grid-${i}`}
                        className={`absolute top-0 z-0 border-l ${isMajorMarker ? 'border-cyan-400/45 h-full' : 'border-cyan-400/30 h-1/2'}`}
                        style={{ left: `${pixelPosition}px` }}
                    />
                );
            })}
            <div
                className="absolute top-0 bottom-0 w-1 bg-red-500 z-10"
                ref={registerPlayhead}
                style={{ left: 0, transform: `translate3d(${playheadPosition * zoom}px, 0, 0)` }}
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

const PublicMultiTrackSampler = () => {
    const { projectId } = useParams();
    const [project, setProject] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [projectSamples, setProjectSamples] = useState([]);
    const [error, setError] = useState(null);
    const [bpm, setBpm] = useState(120);
    const [zoom] = useState(100);
    const [sampleDurations, setSampleDurations] = useState({});
    const [isLoadingDurations, setIsLoadingDurations] = useState(false);
    const [timelineDuration, setTimelineDuration] = useState(30);

    // The same engine the editor runs, in read-only mode.
    //
    // This page used to carry its own copy, forked before clip trimming, fades,
    // per-clip volume, pan and mute existed, and it had drifted rather than just
    // lagged: it multiplied where the editor divided, so the playhead ran at
    // timeScale squared and the samples and MIDI pulled apart at any tempo but
    // 120. Since every project on the site happens to be at 120, that looked
    // fine. It also ignored the whole mix, so a visitor heard muted tracks and
    // untrimmed clips at the wrong levels: not the arrangement the artist made.
    //
    // Track volume, pan and mute are read from the track rows by the hook, so
    // nothing has to be threaded through here.
    const { register: registerPlayhead, onFrame: movePlayheads } = usePlayheadLines(zoom);

    const { isPlaying, isPaused, playheadPosition, toggle, stop } = useProjectPlayback({
        tracks,
        projectSamples,
        sampleDurations,
        bpm,
        timelineDuration,
        readOnly: true,
        onError: setError,
        onFrame: movePlayheads,
    });

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

    // Clip lengths, from the row where it has one and from the shared buffer
    // cache otherwise. See utils/audioBuffers.js.
    useEffect(() => {
        let cancelled = false;
        if (projectSamples.length === 0) {
            setSampleDurations({});
            return undefined;
        }
        setIsLoadingDurations(true);
        loadSampleDurations(projectSamples)
            .then(({ durations }) => { if (!cancelled) setSampleDurations(durations); })
            .catch(err => {
                console.warn('Error loading clip durations:', err.message);
                if (!cancelled) setSampleDurations({});
            })
            .finally(() => { if (!cancelled) setIsLoadingDurations(false); });
        return () => { cancelled = true; };
    }, [projectSamples]);

    useEffect(() => {
        setTimelineDuration(timelineLength({
            projectSamples,
            tracks,
            sampleDurations,
            timeScale: timeScaleFor(bpm),
        }));
    }, [projectSamples, sampleDurations, tracks, bpm]);

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
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
                    className="retro-btn retro-btn--hot mt-4 inline-block py-2 px-4 text-xs"
                >
                    Retry
                </button>
                <Link
                    to="/projects"
                    className="mt-4 ml-4 inline-block py-2 px-4 bg-cyan-400/10 text-white font-semibold rounded-md hover:bg-cyan-400/15"
                >
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
    const markerInterval = 5;
    const numMarkers = Math.ceil(timelineDuration / markerInterval);

    return (
        <div className="container mx-auto px-4 py-8 max-w-6xl text-gray-100 pt-2">
            <h1 className="text-3xl font-bold mb-2">{project.title} (Listen Only)</h1>
            <p className="text-sm text-gray-300 mb-2">
                Created: {new Date(project.created_at).toLocaleDateString()}
            </p>
            {project.creator && project.user_id && (
                <p className="text-sm text-gray-300 mb-4">
                    Creator:{' '}
                    <Link
                        to={profilePath(project)}
                        className="text-primary-brand hover:underline"
                        aria-label={`View ${project.creator}'s profile`}
                    >
                        {project.creator}
                    </Link>
                </p>
            )}
            {error && <p className="text-red-500 mb-4">{error}</p>}
            <div className="mb-8 flex items-center space-x-4 bg-[#140628] p-4 rounded-lg shadow-[0_4px_10px_rgba(0,0,0,0.3)]">
                <button
                    onClick={toggle}
                    className={`w-24 px-4 py-2 bg-[#140628] text-primary-brand font-semibold rounded-lg border border-primary-brand hover:bg-blue-900 hover:text-white hover:shadow-[0_0_10px_rgba(59,130,246,0.5)] focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-center`}
                >
                    {isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}
                </button>
                <button
                    onClick={stop}
                    className={`w-24 px-4 py-2 bg-[#140628] text-red-400 font-semibold rounded-lg border border-red-500 hover:bg-red-900 hover:text-white hover:shadow-[0_0_10px_rgba(239,68,68,0.5)] focus:outline-none focus:ring-4 focus:ring-red-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed text-center`}
                >
                    Stop
                </button>
                <span className="text-sm text-gray-300">
          Playhead: {unitsToReal(playheadPosition, timeScaleFor(bpm)).toFixed(1)}s
        </span>
            </div>
            <div className="overflow-x-auto mb-8">
                <div className="grid grid-cols-[200px_1fr] gap-1 min-w-[3200px]">
                    <div className="h-12"></div>
                    <div
                        className="h-12 bg-[#140628] relative border-b border-cyan-400/30"
                        style={{ width: `${timelineDuration * zoom}px` }}
                    >
                        {Array.from({ length: numMarkers }, (_, i) => {
                            const scaledTime = i * markerInterval;
                            const realTime = unitsToReal(scaledTime, timeScale);
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
                                        className="absolute top-0 bottom-0 border-l border-cyan-400/30 z-0"
                                        style={{ left: `${pixelPosition}px` }}
                                    />
                                </React.Fragment>
                            );
                        })}
                        <div
                            className="absolute top-0 bottom-0 w-1 bg-red-500 z-10"
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
                        return (
                            <React.Fragment key={track.id}>
                                <div
                                    className={`flex items-start p-2 bg-[#1d0a38] bg-opacity-50 backdrop-blur-sm rounded-lg`}
                                    style={{ height: track.track_type === 'midi' ? '360px' : '48px' }}
                                >
                                    <span className="flex-1 text-sm text-gray-200">{track.name}</span>
                                </div>
                                {track.track_type === 'midi' ? (
                                    <ReadOnlyPianoRoll
                                        track={track}
                                        playheadPosition={playheadPosition}
                                        zoom={zoom}
                                        timelineDuration={timelineDuration}
                                        registerPlayhead={registerPlayhead}
                                    />
                                ) : (
                                    <Timeline
                                        trackId={track.id}
                                        samples={projectSamples.filter(s => s.track_id === track.id)}
                                        playheadPosition={playheadPosition}
                                        registerPlayhead={registerPlayhead}
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