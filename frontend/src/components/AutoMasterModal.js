import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { XMarkIcon } from '@heroicons/react/24/solid';
import API_URL from '../utils/api';

// The preset chain is fixed and finishes on the request; allow a generous
// window but never an unbounded one, so the modal can always recover.
const PRESET_TIMEOUT_MS = 3 * 60 * 1000;

const POLL_INTERVAL_MS = 3000;
// Jobs queue behind one another on a single worker, so a wait can legitimately
// be long. This is the point at which something has clearly gone wrong.
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TRANSIENT_POLL_FAILURES = 5;

const PRESETS = [
    { id: 'light', label: 'Light', blurb: 'Gentle lift. Keeps the original dynamics.' },
    { id: 'middle', label: 'Middle', blurb: 'Balanced. A little more punch and presence.' },
    { id: 'heavy', label: 'Heavy', blurb: 'Loud and forward. Squashes the quiet parts.' },
];

const ACTIVE_STATUSES = ['queued', 'analyzing', 'rendering'];

const STATUS_TEXT = {
    queued: 'Waiting in line',
    analyzing: 'Listening to your track',
    rendering: 'Mastering',
};

const IMAGE_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png' };

const SEVERITY_CLASS = {
    ok: 'text-cyan-300',
    info: 'text-gray-300',
    warn: 'text-fuchsia-400',
};

function isTransientPollError(err) {
    if (!err.response) return true;                    // network drop
    return err.response.status >= 500 || err.response.status === 408;
}

function formatWait(seconds) {
    if (seconds === null || seconds === undefined) return null;
    if (seconds < 60) return 'less than a minute';
    const minutes = Math.round(seconds / 60);
    return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Auto Master saves its result as a brand new song and never overwrites the
 * original: reviews and ratings belong to the song row they were left on, and
 * a new master is meant to collect feedback of its own.
 *
 * Two paths share this modal. The presets run a fixed chain and answer on the
 * request. The analysed path measures the track first and picks its own
 * settings, which takes several ffmpeg passes, so it goes through a queue and
 * this component polls for it.
 */
const AutoMasterModal = ({ song, onClose, onSaved, onSavedVersion }) => {
    const [preset, setPreset] = useState(null);
    const [isMastering, setIsMastering] = useState(false);
    const [masteredUrl, setMasteredUrl] = useState(null);
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);

    const [job, setJob] = useState(null);
    const [matchLevels, setMatchLevels] = useState(true);

    const masteredBlobRef = useRef(null);
    const objectUrlRef = useRef(null);
    const isMountedRef = useRef(true);
    const pollRef = useRef(null);
    const pollDeadlineRef = useRef(null);
    const pollFailuresRef = useRef(0);
    const masteredAudioRef = useRef(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const releasePreview = useCallback(() => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
        masteredBlobRef.current = null;
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            stopPolling();
            releasePreview();
        };
    }, [releasePreview, stopPolling]);

    const isBusy = isMastering || isSaving || ACTIVE_STATUSES.includes(job?.status);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !isBusy) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose, isBusy]);

    // The analysed master is louder by design, and louder always wins a blind
    // comparison. Attenuating it back to the source's measured loudness is the
    // only way the A/B says anything about the mastering itself.
    useEffect(() => {
        const el = masteredAudioRef.current;
        if (!el) return;
        const sourceLufs = job?.analysis?.integratedLufs;
        const outputLufs = job?.plan?.verification?.integratedLufs;
        if (matchLevels && typeof sourceLufs === 'number' && typeof outputLufs === 'number') {
            el.volume = Math.min(1, Math.max(0, 10 ** ((sourceLufs - outputLufs) / 20)));
        } else {
            el.volume = 1;
        }
    }, [matchLevels, job, masteredUrl]);

    const resetResult = () => {
        stopPolling();
        releasePreview();
        setMasteredUrl(null);
        setPreset(null);
        setJob(null);
        setSaveError(null);
        setError(null);
    };

    // ---- Preset path ----------------------------------------------------

    const handlePreset = async (type) => {
        if (isBusy) return;

        setIsMastering(true);
        setError(null);
        setSaveError(null);
        setPreset(type);
        setJob(null);

        try {
            const token = localStorage.getItem('token');
            // The backend returns the audio itself instead of parking a file in
            // the bucket, so auditioning all three presets and keeping none
            // leaves nothing behind.
            const response = await axios.post(
                `${API_URL}/music/master/${song.id}`,
                { masteringType: type },
                {
                    headers: { Authorization: `Bearer ${token}` },
                    responseType: 'blob',
                    timeout: PRESET_TIMEOUT_MS,
                }
            );

            if (!isMountedRef.current) return;

            releasePreview();
            const blob = new Blob([response.data], { type: 'audio/mpeg' });
            masteredBlobRef.current = blob;
            objectUrlRef.current = URL.createObjectURL(blob);
            setMasteredUrl(objectUrlRef.current);
        } catch (err) {
            console.error('Error mastering audio:', err);
            if (!isMountedRef.current) return;
            if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
                setError('Mastering took too long and was cancelled. Please try again.');
            } else if (err.response?.status === 429) {
                setError('Too many mastering jobs running. Please try again in a moment.');
            } else if (err.response?.status === 403) {
                setError('You can only master your own songs.');
            } else {
                setError('Failed to master audio. Please try again.');
            }
        } finally {
            if (isMountedRef.current) setIsMastering(false);
        }
    };

    // ---- Analysed path --------------------------------------------------

    const pollJob = useCallback(async (jobId) => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get(`${API_URL}/music/master/job/${jobId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!isMountedRef.current) return;

            pollFailuresRef.current = 0;
            const next = res.data.job;
            setJob(next);

            if (next.status === 'ready') {
                stopPolling();
                setMasteredUrl(next.resultUrl);
            } else if (next.status === 'failed') {
                stopPolling();
                setError(next.error === 'Cancelled'
                    ? 'Mastering was cancelled.'
                    : 'Mastering failed. Please try again.');
            } else if (Date.now() > pollDeadlineRef.current) {
                stopPolling();
                setError('This is taking much longer than expected. Please try again later.');
            }
        } catch (err) {
            if (!isMountedRef.current) return;
            if (isTransientPollError(err)) {
                pollFailuresRef.current += 1;
                if (pollFailuresRef.current >= MAX_TRANSIENT_POLL_FAILURES) {
                    stopPolling();
                    setError('Lost contact with the server while mastering. Please try again.');
                }
                return;
            }
            stopPolling();
            setError('Could not check on the mastering job. Please try again.');
        }
    }, [stopPolling]);

    const handleAnalyze = async () => {
        if (isBusy) return;

        setError(null);
        setSaveError(null);
        setPreset(null);
        releasePreview();
        setMasteredUrl(null);

        try {
            const token = localStorage.getItem('token');
            const res = await axios.post(
                `${API_URL}/music/master/analyze/${song.id}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!isMountedRef.current) return;

            const queued = res.data.job;
            setJob(queued);

            pollFailuresRef.current = 0;
            pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
            stopPolling();
            pollRef.current = setInterval(() => pollJob(queued.id), POLL_INTERVAL_MS);
        } catch (err) {
            console.error('Error queueing analysis:', err);
            if (!isMountedRef.current) return;
            if (err.response?.status === 403) {
                setError('You can only master your own songs.');
            } else {
                setError('Could not start the analysis. Please try again.');
            }
        }
    };

    const handleCancel = async () => {
        if (!job?.id) return;
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/music/master/job/${job.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch (err) {
            console.error('Could not cancel mastering job:', err);
        }
        stopPolling();
        if (isMountedRef.current) resetResult();
    };

    // ---- Saving ---------------------------------------------------------

    // Best effort: reuse the original artwork so the new song does not land in
    // the library blank. The proxy is byte-agnostic and bucket-scoped despite
    // the /audio name. A failure here must not block the save.
    const fetchOriginalArtwork = async () => {
        if (!song.image_url) return null;
        try {
            const proxyUrl = `${API_URL}/proxy/audio?url=${encodeURIComponent(song.image_url)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) return null;
            const blob = await response.blob();
            const extension = IMAGE_EXTENSIONS[blob.type];
            if (!extension) return null;   // upload only accepts jpeg/png
            return { blob, filename: `cover-${Date.now()}${extension}` };
        } catch (err) {
            console.error('Could not carry over song artwork:', err);
            return null;
        }
    };

    // Presets hand back the audio directly; the queued path leaves it in the
    // bucket, so fetch it back before uploading it as a song of its own.
    const resolveMasteredBlob = async () => {
        if (masteredBlobRef.current) return masteredBlobRef.current;
        if (!masteredUrl) return null;
        const proxyUrl = `${API_URL}/proxy/audio?url=${encodeURIComponent(masteredUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Could not fetch mastered audio: ${response.statusText}`);
        return new Blob([await response.blob()], { type: 'audio/mpeg' });
    };

    /**
     * Save the render, either as a new version of this track or as its own song.
     *
     * A remaster is the same work corrected, so a version is usually what the
     * artist means: the song keeps its page, its address, its plays and every
     * comment, and the recording it replaced is archived rather than discarded.
     * That last part is why this is now offered at all - before versioning
     * existed, the only way to preserve the audio people had reviewed was to
     * make a separate song.
     *
     * A new song is still right when the master is meant to be its own artifact
     * with its own feedback, so it stays on offer rather than being removed.
     */
    const handleSave = async (mode = 'version') => {
        if (!masteredUrl || isSaving) return;

        setIsSaving(true);
        setSaveError(null);

        try {
            const token = localStorage.getItem('token');
            const blob = await resolveMasteredBlob();
            if (!blob) throw new Error('No mastered audio to save');

            const presetLabel = PRESETS.find(p => p.id === preset)?.label;
            const suffix = presetLabel ? `Auto Master — ${presetLabel}` : 'Auto Master';

            if (mode === 'version') {
                const versionForm = new FormData();
                versionForm.append('mp3', blob, `mastered-${Date.now()}.mp3`);
                versionForm.append('label', presetLabel ? `Auto Master, ${presetLabel}` : 'Auto Master');
                versionForm.append('notes', 'Mastered in the browser from the previous version.');

                const versionResponse = await axios.post(
                    `${API_URL}/music/${song.id}/versions`,
                    versionForm,
                    { headers: { Authorization: `Bearer ${token}` }, timeout: 180000 },
                );

                if (!isMountedRef.current) return;
                onSavedVersion?.({
                    songId: song.id,
                    title: song.title,
                    versionNo: versionResponse.data?.current_version_no,
                    mp3Url: versionResponse.data?.version?.mp3_url,
                });
                releasePreview();
                onClose();
                return;
            }

            const formData = new FormData();
            formData.append('title', `${song.title || 'Untitled Song'} (${suffix})`);
            formData.append('description', song.description || '');
            formData.append('genre', song.genre || '');
            formData.append('mp3', blob, `mastered-${Date.now()}.mp3`);

            const artwork = await fetchOriginalArtwork();
            if (artwork) formData.append('image', artwork.blob, artwork.filename);

            const uploadResponse = await axios.post(`${API_URL}/music/upload`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            if (!isMountedRef.current) return;
            // Hand the row straight back to the list instead of sleeping and
            // hoping the song has appeared by the time the toast is dismissed.
            onSaved(uploadResponse.data.song);
            releasePreview();
            onClose();
        } catch (err) {
            console.error('Error saving mastered song:', err);
            if (isMountedRef.current) setSaveError('Failed to save the mastered track. Please try again.');
        } finally {
            if (isMountedRef.current) setIsSaving(false);
        }
    };

    // ---- Render ---------------------------------------------------------

    const active = ACTIVE_STATUSES.includes(job?.status);
    const wait = formatWait(job?.estimatedSecondsRemaining);
    const findings = job?.plan?.findings || [];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay p-4">
            <div className="retro-panel retro-cut p-6 w-[520px] max-w-full max-h-[90vh] overflow-y-auto text-gray-100">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="retro-display text-sm retro-glow-cyan">Auto Master</h3>
                    <button
                        onClick={onClose}
                        disabled={isBusy}
                        aria-label="Close auto master"
                        className="p-1 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                <p className="retro-mono text-base text-gray-400 mb-4 truncate" title={song.title}>
                    {song.title}
                </p>

                {!masteredUrl && !active && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <button
                                onClick={handleAnalyze}
                                disabled={isBusy}
                                className="retro-btn retro-btn--hot w-full py-3 px-4 text-xs flex-col items-start gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <span>✨ Analyze My Mix</span>
                                <span className="retro-mono text-base normal-case tracking-normal opacity-90">
                                    Measures your track, then picks its own settings and explains them.
                                </span>
                            </button>
                            <p className="retro-mono text-base text-gray-400">
                                Takes a couple of minutes and waits in line behind other tracks.
                            </p>
                        </div>

                        <div className="border-t border-cyan-400/25 pt-4 space-y-2">
                            <p className="text-gray-300">Or apply a fixed preset — quick, no analysis:</p>
                            {PRESETS.map(({ id, label, blurb }) => (
                                <button
                                    key={id}
                                    onClick={() => handlePreset(id)}
                                    disabled={isBusy}
                                    className="retro-btn w-full py-2 px-4 text-xs flex-col items-start gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <span>{isMastering && preset === id ? `${label}…` : label}</span>
                                    <span className="retro-mono text-base normal-case tracking-normal opacity-80">
                                        {blurb}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {isMastering && (
                            <p className="retro-mono text-lg text-cyan-300">
                                Mastering your track — this can take a minute or two.
                            </p>
                        )}
                    </div>
                )}

                {active && (
                    <div className="space-y-3">
                        <p className="retro-mono text-lg text-cyan-300">
                            {STATUS_TEXT[job.status] || 'Working'}…
                        </p>
                        {job.status === 'queued' && job.queuePosition > 0 && (
                            <p className="text-gray-300">
                                {job.queuePosition} track{job.queuePosition === 1 ? '' : 's'} ahead of yours.
                            </p>
                        )}
                        {job.status === 'queued' && job.queuePosition === 0 && (
                            <p className="text-gray-300">Yours is next up.</p>
                        )}
                        {wait && (
                            <p className="retro-mono text-base text-gray-400">
                                Estimated wait: {wait}. You can close this and come back — it keeps running.
                            </p>
                        )}
                        <button
                            onClick={handleCancel}
                            className="retro-btn retro-btn--danger py-2 px-4 text-xs"
                        >
                            Cancel
                        </button>
                    </div>
                )}

                {masteredUrl && (
                    <div className="space-y-4">
                        {job?.plan?.summary && (
                            <p className="retro-mono text-lg text-cyan-300">{job.plan.summary}</p>
                        )}

                        {findings.length > 0 && (
                            <ul className="space-y-2">
                                {findings.map((finding, i) => (
                                    <li
                                        key={finding.key || i}
                                        className={`retro-mono text-base ${SEVERITY_CLASS[finding.severity] || SEVERITY_CLASS.info}`}
                                    >
                                        {finding.text}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="space-y-2">
                            <p className="text-gray-300">Mastered:</p>
                            <audio ref={masteredAudioRef} controls src={masteredUrl} className="w-full" />
                            {job?.analysis && job?.plan?.verification && (
                                <label className="flex items-center gap-2 retro-mono text-base text-gray-400">
                                    <input
                                        type="checkbox"
                                        checked={matchLevels}
                                        onChange={(e) => setMatchLevels(e.target.checked)}
                                    />
                                    Match levels for comparison (louder always sounds better otherwise)
                                </label>
                            )}
                        </div>

                        {song.mp3_url && (
                            <div className="space-y-2">
                                <p className="text-gray-300">Original:</p>
                                <audio
                                    controls
                                    src={`${API_URL}/proxy/audio?url=${encodeURIComponent(song.mp3_url)}`}
                                    className="w-full"
                                />
                            </div>
                        )}

                        <p className="retro-mono text-base text-gray-400">
                            A new version keeps this song&rsquo;s page, its address, its plays and every
                            comment on it, and the recording it replaces is kept in the song&rsquo;s
                            history so you can go back to it. Save it as its own song instead if you
                            want this master to collect feedback of its own.
                        </p>

                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => handleSave('version')}
                                disabled={isSaving}
                                className="retro-btn retro-btn--hot flex-1 py-2 px-4 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isSaving ? 'Saving…' : 'Save as New Version'}
                            </button>
                            <button
                                onClick={() => handleSave('song')}
                                disabled={isSaving}
                                className="retro-btn flex-1 py-2 px-4 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Save as New Song
                            </button>
                            <button
                                onClick={resetResult}
                                disabled={isSaving}
                                className="retro-btn flex-1 py-2 px-4 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Try Another
                            </button>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="retro-mono text-lg text-fuchsia-400 mt-3">
                        {error}
                        {preset && !isMastering && (
                            <button
                                onClick={() => handlePreset(preset)}
                                className="retro-link ml-2 underline"
                            >
                                Try Again
                            </button>
                        )}
                    </div>
                )}
                {saveError && <div className="retro-mono text-lg text-fuchsia-400 mt-3">{saveError}</div>}
            </div>
        </div>
    );
};

AutoMasterModal.propTypes = {
    song: PropTypes.shape({
        id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
        title: PropTypes.string,
        description: PropTypes.string,
        genre: PropTypes.string,
        image_url: PropTypes.string,
        mp3_url: PropTypes.string,
    }).isRequired,
    onClose: PropTypes.func.isRequired,
    onSaved: PropTypes.func.isRequired,
    onSavedVersion: PropTypes.func,
};

export default AutoMasterModal;
