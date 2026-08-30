import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import API_URL from '../utils/api';
import { MUSICAL_KEYS as KEYS } from '../utils/musicalKeys';

const LOOP_TYPES = ['bass', 'synth', 'effects', 'drums'];
const POLL_INTERVAL_MS = 4000;
const MAX_TRANSIENT_POLL_FAILURES = 5;

function isTransientPollError(err) {
    if (!err.response) return true;                    // network drop / connection refused
    return err.response.status >= 500 || err.response.status === 408;
}

const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Generate an AI audio loop (same backend as the standalone /loops page) and
// drop it straight onto a sample track without leaving the DAW.
const LoopGenerateModal = ({ track, bpm, startTime, onClose, onApply }) => {
    const [type, setType] = useState('bass');
    const [prompt, setPrompt] = useState('');
    const [loopKey, setLoopKey] = useState('C minor');
    const [duration, setDuration] = useState(4);
    const [loopBpm, setLoopBpm] = useState(Math.round(bpm) || 128);
    const [dailyRemaining, setDailyRemaining] = useState(null);
    const [status, setStatus] = useState('idle'); // idle | generating | ready | applying
    const [readyLoop, setReadyLoop] = useState(null);
    const [error, setError] = useState(null);

    const pollRef = useRef(null);
    const isMountedRef = useRef(true);

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    useEffect(() => {
        isMountedRef.current = true;
        const fetchRemaining = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get(`${API_URL}/loops/my`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (isMountedRef.current) setDailyRemaining(res.data.dailyRemaining);
            } catch (err) {
                console.error('Failed to fetch loop allowance:', err.response?.data || err.message);
            }
        };
        fetchRemaining();
        return () => {
            isMountedRef.current = false;
            stopPolling();
        };
    }, []);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError('Describe the sound you want first.');
            return;
        }
        if (dailyRemaining !== null && dailyRemaining <= 0) {
            setError('Daily limit of 10 loops reached.');
            return;
        }
        stopPolling();
        setError(null);
        setReadyLoop(null);
        setStatus('generating');

        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(
                `${API_URL}/loops/generate`,
                { type, prompt, bpm: loopBpm, key: loopKey, duration },
                { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
            );
            const { loopId } = res.data;
            const startedAt = Date.now();
            let transientFailures = 0;

            pollRef.current = setInterval(async () => {
                if (!isMountedRef.current) {
                    stopPolling();
                    return;
                }
                if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    stopPolling();
                    setError('Generation timed out. Check the AI Loops page in a minute.');
                    setStatus('idle');
                    return;
                }
                try {
                    const statusRes = await axios.get(`${API_URL}/loops/${loopId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                        withCredentials: true,
                    });
                    transientFailures = 0;
                    const data = statusRes.data;
                    if (data.status === 'ready') {
                        stopPolling();
                        if (!isMountedRef.current) return;
                        setReadyLoop({ id: loopId, url: data.url });
                        setStatus('ready');
                        setDailyRemaining(prev => (prev === null ? prev : Math.max(0, prev - 1)));
                    } else if (data.status === 'failed') {
                        stopPolling();
                        if (!isMountedRef.current) return;
                        setError('Generation failed. Please try again.');
                        setStatus('idle');
                    }
                } catch (pollErr) {
                    // A backend restart (deploy, machine wake) fails the poll
                    // that lands mid-restart even though the job is healthy.
                    // Ride out a few before declaring the generation dead.
                    if (isTransientPollError(pollErr) && ++transientFailures <= MAX_TRANSIENT_POLL_FAILURES) {
                        return;
                    }
                    stopPolling();
                    if (!isMountedRef.current) return;
                    setError('Failed to check status: ' + (pollErr.response?.data?.error || pollErr.message));
                    setStatus('idle');
                }
            }, POLL_INTERVAL_MS);
        } catch (err) {
            setError('Failed to start generation: ' + (err.response?.data?.error || err.message));
            setStatus('idle');
        }
    };

    // Convert the finished loop to an MP3 in the user's sample library, then let
    // the parent place it on this track at the playhead.
    const handleAddToTrack = async () => {
        if (!readyLoop) return;
        setStatus('applying');
        setError(null);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(
                `${API_URL}/sample-library/from-loop`,
                { loopId: readyLoop.id },
                { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
            );
            await onApply(track.id, res.data);
            onClose();
        } catch (err) {
            setError('Failed to add loop to track: ' + (err.response?.data?.error || err.message));
            setStatus('ready');
        }
    };

    const isBusy = status === 'generating' || status === 'applying';
    // startTime is in timeline units; realSeconds = units * timeScale
    const startSeconds = startTime * (120 / (bpm || 120));

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="retro-panel retro-cut w-full max-w-lg flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-400/25">
                    <h2 className="text-lg font-semibold">✨ Generate Loop — {track.name}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto">
                    <div>
                        <label className="retro-label" htmlFor="loop-gen-type">Loop Type</label>
                        <select
                            id="loop-gen-type"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            disabled={isBusy}
                            className="retro-field w-full disabled:opacity-50"
                        >
                            {LOOP_TYPES.map(t => (
                                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="retro-label" htmlFor="loop-gen-prompt">Describe it</label>
                        <textarea
                            id="loop-gen-prompt"
                            rows="3"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            disabled={isBusy}
                            placeholder="e.g. 'deep rolling line with sub hits'"
                            className="w-full px-3 py-2 bg-[#1d0a38] border border-cyan-400/30 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50"
                        />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="retro-label" htmlFor="loop-gen-bpm">BPM</label>
                            <input
                                id="loop-gen-bpm"
                                type="number"
                                min="60"
                                max="180"
                                value={loopBpm}
                                onChange={(e) => setLoopBpm(Number(e.target.value))}
                                disabled={isBusy}
                                className="retro-field w-full disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="loop-gen-key">Key</label>
                            <select
                                id="loop-gen-key"
                                value={loopKey}
                                onChange={(e) => setLoopKey(e.target.value)}
                                disabled={isBusy}
                                className="retro-field w-full disabled:opacity-50"
                            >
                                {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="loop-gen-duration">Length (sec)</label>
                            <select
                                id="loop-gen-duration"
                                value={duration}
                                onChange={(e) => setDuration(Number(e.target.value))}
                                disabled={isBusy}
                                className="retro-field w-full disabled:opacity-50"
                            >
                                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>
                    <p className="retro-mono text-base text-gray-400">
                        BPM defaults to this project&apos;s tempo so the loop lines up. It will drop at the playhead ({startSeconds.toFixed(1)}s).
                    </p>
                    {dailyRemaining !== null && (
                        <p className="text-sm text-gray-300">You have {dailyRemaining} loop{dailyRemaining === 1 ? '' : 's'} left today.</p>
                    )}
                    {status === 'generating' && (
                        <p className="text-sm text-purple-300">Generating your {type} loop — this usually takes 30–60 seconds…</p>
                    )}
                    {readyLoop?.url && (
                        <div className="space-y-2">
                            <p className="retro-mono text-lg text-cyan-300">Loop ready — have a listen before you add it.</p>
                            <audio controls src={readyLoop.url} className="w-full" />
                        </div>
                    )}
                    {error && <p className="retro-mono text-lg text-fuchsia-400">{error}</p>}
                </div>
                <div className="flex justify-end space-x-3 px-5 py-3 border-t border-cyan-400/25">
                    <button onClick={onClose} className="px-4 py-2 bg-[#1d0a38] rounded-lg text-sm hover:bg-gray-600">Cancel</button>
                    <button
                        onClick={handleGenerate}
                        disabled={isBusy || !prompt.trim() || (dailyRemaining !== null && dailyRemaining <= 0)}
                        className="px-4 py-2 bg-purple-600 rounded-lg text-sm font-semibold hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {status === 'generating' ? 'Generating…' : readyLoop ? '🎲 Regenerate' : '✨ Generate'}
                    </button>
                    <button
                        onClick={handleAddToTrack}
                        disabled={!readyLoop || isBusy}
                        className="px-4 py-2 bg-gradient-to-r from-teal-500 to-green-500 rounded-lg text-sm font-semibold hover:from-teal-600 hover:to-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {status === 'applying' ? 'Adding…' : 'Add to Track'}
                    </button>
                </div>
            </div>
        </div>
    );
};

LoopGenerateModal.propTypes = {
    track: PropTypes.object.isRequired,
    bpm: PropTypes.number.isRequired,
    startTime: PropTypes.number.isRequired,
    onClose: PropTypes.func.isRequired,
    onApply: PropTypes.func.isRequired,
};

export default LoopGenerateModal;
