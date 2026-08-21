import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import API_URL from '../utils/api';

const STEM_TYPES = ['bass', 'synth', 'effects', 'drums'];
const KEYS = [
    'C major', 'C minor', 'C# major', 'C# minor', 'D major', 'D minor',
    'D# major', 'D# minor', 'E major', 'E minor', 'F major', 'F minor',
    'F# major', 'F# minor', 'G major', 'G minor', 'G# major', 'G# minor',
    'A major', 'A minor', 'A# major', 'A# minor', 'B major', 'B minor',
];
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Generate an AI audio stem (same backend as the standalone /ai-stems page) and
// drop it straight onto a sample track without leaving the DAW.
const StemGenerateModal = ({ track, bpm, startTime, onClose, onApply }) => {
    const [type, setType] = useState('bass');
    const [prompt, setPrompt] = useState('');
    const [stemKey, setStemKey] = useState('C minor');
    const [duration, setDuration] = useState(4);
    const [stemBpm, setStemBpm] = useState(Math.round(bpm) || 128);
    const [dailyRemaining, setDailyRemaining] = useState(null);
    const [status, setStatus] = useState('idle'); // idle | generating | ready | applying
    const [readyStem, setReadyStem] = useState(null);
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
                const res = await axios.get(`${API_URL}/stems/my`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (isMountedRef.current) setDailyRemaining(res.data.dailyRemaining);
            } catch (err) {
                console.error('Failed to fetch stem allowance:', err.response?.data || err.message);
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
            setError('Daily limit of 10 stems reached.');
            return;
        }
        stopPolling();
        setError(null);
        setReadyStem(null);
        setStatus('generating');

        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(
                `${API_URL}/stems/generate`,
                { type, prompt, bpm: stemBpm, key: stemKey, duration },
                { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
            );
            const { stemId } = res.data;
            const startedAt = Date.now();

            pollRef.current = setInterval(async () => {
                if (!isMountedRef.current) {
                    stopPolling();
                    return;
                }
                if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    stopPolling();
                    setError('Generation timed out. Check the AI Stems page in a minute.');
                    setStatus('idle');
                    return;
                }
                try {
                    const statusRes = await axios.get(`${API_URL}/stems/${stemId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                        withCredentials: true,
                    });
                    const data = statusRes.data;
                    if (data.status === 'ready') {
                        stopPolling();
                        if (!isMountedRef.current) return;
                        setReadyStem({ id: stemId, url: data.url });
                        setStatus('ready');
                        setDailyRemaining(prev => (prev === null ? prev : Math.max(0, prev - 1)));
                    } else if (data.status === 'failed') {
                        stopPolling();
                        if (!isMountedRef.current) return;
                        setError('Generation failed. Please try again.');
                        setStatus('idle');
                    }
                } catch (pollErr) {
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

    // Convert the finished stem to an MP3 in the user's sample library, then let
    // the parent place it on this track at the playhead.
    const handleAddToTrack = async () => {
        if (!readyStem) return;
        setStatus('applying');
        setError(null);
        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(
                `${API_URL}/sample-library/from-stem`,
                { stemId: readyStem.id },
                { headers: { Authorization: `Bearer ${token}` }, withCredentials: true }
            );
            await onApply(track.id, res.data);
            onClose();
        } catch (err) {
            setError('Failed to add stem to track: ' + (err.response?.data?.error || err.message));
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
                    <h2 className="text-lg font-semibold">✨ Generate Sample — {track.name}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto">
                    <div>
                        <label className="retro-label" htmlFor="stem-gen-type">Stem Type</label>
                        <select
                            id="stem-gen-type"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            disabled={isBusy}
                            className="retro-field w-full disabled:opacity-50"
                        >
                            {STEM_TYPES.map(t => (
                                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="retro-label" htmlFor="stem-gen-prompt">Describe it</label>
                        <textarea
                            id="stem-gen-prompt"
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
                            <label className="retro-label" htmlFor="stem-gen-bpm">BPM</label>
                            <input
                                id="stem-gen-bpm"
                                type="number"
                                min="60"
                                max="180"
                                value={stemBpm}
                                onChange={(e) => setStemBpm(Number(e.target.value))}
                                disabled={isBusy}
                                className="retro-field w-full disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="stem-gen-key">Key</label>
                            <select
                                id="stem-gen-key"
                                value={stemKey}
                                onChange={(e) => setStemKey(e.target.value)}
                                disabled={isBusy}
                                className="retro-field w-full disabled:opacity-50"
                            >
                                {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="stem-gen-duration">Length (sec)</label>
                            <select
                                id="stem-gen-duration"
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
                        BPM defaults to this project&apos;s tempo so the stem lines up. It will drop at the playhead ({startSeconds.toFixed(1)}s).
                    </p>
                    {dailyRemaining !== null && (
                        <p className="text-sm text-gray-300">You have {dailyRemaining} stem{dailyRemaining === 1 ? '' : 's'} left today.</p>
                    )}
                    {status === 'generating' && (
                        <p className="text-sm text-purple-300">Generating your {type} stem — this usually takes 30–60 seconds…</p>
                    )}
                    {readyStem?.url && (
                        <div className="space-y-2">
                            <p className="retro-mono text-lg text-cyan-300">Stem ready — have a listen before you add it.</p>
                            <audio controls src={readyStem.url} className="w-full" />
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
                        {status === 'generating' ? 'Generating…' : readyStem ? '🎲 Regenerate' : '✨ Generate'}
                    </button>
                    <button
                        onClick={handleAddToTrack}
                        disabled={!readyStem || isBusy}
                        className="px-4 py-2 bg-gradient-to-r from-teal-500 to-green-500 rounded-lg text-sm font-semibold hover:from-teal-600 hover:to-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {status === 'applying' ? 'Adding…' : 'Add to Track'}
                    </button>
                </div>
            </div>
        </div>
    );
};

StemGenerateModal.propTypes = {
    track: PropTypes.object.isRequired,
    bpm: PropTypes.number.isRequired,
    startTime: PropTypes.number.isRequired,
    onClose: PropTypes.func.isRequired,
    onApply: PropTypes.func.isRequired,
};

export default StemGenerateModal;
