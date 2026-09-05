import { useCallback, useContext, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import API_URL from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import profilePath from '../utils/profilePath';

/**
 * Where an artist groups their tracks into records.
 *
 * Deliberately a separate page from the Songs Manager rather than another
 * column in it. Managing tracks and assembling a record are different jobs done
 * at different times, and the songs list is already carrying six controls a row.
 *
 * The one thing this page has to keep saying, because it is the thing that
 * stops people trying the feature, is that grouping is a pointer and never a
 * move: a track put on an album stays on the artist's profile, keeps its own
 * page and its own comments, and deleting the release deletes the sleeve and
 * not the music.
 */

const RELEASE_TYPES = [
    { value: 'album', label: 'Album' },
    { value: 'ep', label: 'EP' },
    { value: 'single', label: 'Single' },
];

const RELEASE_TYPE_LABELS = Object.fromEntries(
    RELEASE_TYPES.map(({ value, label }) => [value, label])
);

const EMPTY_FORM = {
    title: '',
    release_type: 'album',
    description: '',
    release_date: '',
    // On by default: a release is created with no tracks on it, so publishing
    // at creation puts an empty record on the artist's public profile. The
    // card's Publish button is one tap once there is something to publish.
    hidden: true,
    cover: null,
};

function Releases() {
    const { profileId } = useParams();
    const { user, loading: authLoading } = useContext(AuthContext);
    const navigate = useNavigate();

    const [releases, setReleases] = useState([]);
    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    // Which release's track list is open, and which of the artist's songs is
    // selected in its "add a track" picker.
    const [openReleaseId, setOpenReleaseId] = useState(null);
    const [releaseTracks, setReleaseTracks] = useState({});
    const [trackPick, setTrackPick] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const authHeader = useCallback(() => {
        const token = localStorage.getItem('token');
        return token ? { Authorization: `Bearer ${token}` } : null;
    }, []);

    const load = useCallback(async () => {
        const headers = authHeader();
        if (!headers) return;
        setLoading(true);
        try {
            // The artist's own songs come from user-songs, which is the
            // owner-facing list and therefore includes hidden tracks: an artist
            // assembling an unreleased EP needs to be able to put unreleased
            // tracks on it.
            const [releasesResponse, songsResponse] = await Promise.all([
                axios.get(`${API_URL}/releases/by-profile/${profileId}`, { headers }),
                axios.get(`${API_URL}/music/user-songs`, { headers }),
            ]);
            setReleases(releasesResponse.data?.releases || []);
            setSongs(songsResponse.data || []);
            setError(null);
        } catch (err) {
            setError(`Could not load your releases: ${err.response?.data?.error || err.message}`);
        } finally {
            setLoading(false);
        }
    }, [authHeader, profileId]);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            navigate('/login');
            return;
        }
        load();
    }, [authLoading, user, load, navigate]);

    const openTracks = async (releaseId) => {
        if (openReleaseId === releaseId) {
            setOpenReleaseId(null);
            return;
        }
        setOpenReleaseId(releaseId);
        setTrackPick('');
        try {
            const headers = authHeader();
            const response = await axios.get(`${API_URL}/releases/${releaseId}`, { headers });
            setReleaseTracks((prev) => ({ ...prev, [releaseId]: response.data?.tracks || [] }));
        } catch (err) {
            setError(`Could not load that release: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        const headers = authHeader();
        if (!headers) return;
        if (!form.title.trim()) {
            setError('Give the release a title');
            return;
        }

        setSaving(true);
        const body = new FormData();
        body.append('title', form.title.trim());
        body.append('release_type', form.release_type);
        body.append('description', form.description.trim());
        if (form.release_date) body.append('release_date', form.release_date);
        body.append('visibility', form.hidden ? 'private' : 'public');
        if (form.cover) body.append('cover', form.cover);

        try {
            const response = await axios.post(`${API_URL}/releases`, body, { headers });
            setReleases((prev) => [response.data.release, ...prev]);
            setForm(EMPTY_FORM);
            setShowForm(false);
            setNotice(`Created "${response.data.release.title}". Add tracks to it below.`);
            setError(null);
        } catch (err) {
            setError(`Could not create the release: ${err.response?.data?.error || err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleVisibility = async (release) => {
        const headers = authHeader();
        if (!headers) return;
        const next = release.visibility === 'private' ? 'public' : 'private';
        try {
            await axios.put(`${API_URL}/releases/${release.id}`, { visibility: next }, { headers });
            setReleases((prev) => prev.map((r) => (r.id === release.id ? { ...r, visibility: next } : r)));
            setError(null);
        } catch (err) {
            setError(`Could not change visibility: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleAddTrack = async (releaseId) => {
        const headers = authHeader();
        if (!headers || !trackPick) return;
        try {
            await axios.post(
                `${API_URL}/releases/${releaseId}/songs`,
                { song_id: Number(trackPick) },
                { headers }
            );
            const response = await axios.get(`${API_URL}/releases/${releaseId}`, { headers });
            setReleaseTracks((prev) => ({ ...prev, [releaseId]: response.data?.tracks || [] }));
            setReleases((prev) => prev.map((r) => (
                r.id === releaseId ? { ...r, track_count: (response.data?.tracks || []).length } : r
            )));
            setTrackPick('');
            setError(null);
        } catch (err) {
            setError(`Could not add that track: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleRemoveTrack = async (releaseId, songId) => {
        const headers = authHeader();
        if (!headers) return;
        try {
            await axios.delete(`${API_URL}/releases/${releaseId}/songs/${songId}`, { headers });
            const remaining = (releaseTracks[releaseId] || []).filter((t) => t.id !== songId);
            // Renumbered locally to match what the server just did, so the
            // list does not read 1, 2, 4 until the next reload.
            setReleaseTracks((prev) => ({
                ...prev,
                [releaseId]: remaining.map((t, i) => ({ ...t, track_no: i + 1 })),
            }));
            setReleases((prev) => prev.map((r) => (
                r.id === releaseId ? { ...r, track_count: remaining.length } : r
            )));
            setError(null);
        } catch (err) {
            setError(`Could not remove that track: ${err.response?.data?.error || err.message}`);
        }
    };

    /**
     * Move a track up or down the running order.
     *
     * Buttons rather than drag and drop: this list is short, buttons work on a
     * phone and with a keyboard without any extra work, and the endpoint takes
     * the whole order anyway.
     */
    const handleMoveTrack = async (releaseId, index, direction) => {
        const headers = authHeader();
        const current = releaseTracks[releaseId] || [];
        const target = index + direction;
        if (!headers || target < 0 || target >= current.length) return;

        const reordered = [...current];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        const renumbered = reordered.map((t, i) => ({ ...t, track_no: i + 1 }));
        setReleaseTracks((prev) => ({ ...prev, [releaseId]: renumbered }));

        try {
            await axios.put(
                `${API_URL}/releases/${releaseId}/order`,
                { song_ids: renumbered.map((t) => t.id) },
                { headers }
            );
            setError(null);
        } catch (err) {
            setReleaseTracks((prev) => ({ ...prev, [releaseId]: current }));
            setError(`Could not save the new order: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleDelete = async (releaseId) => {
        const headers = authHeader();
        if (!headers) return;
        try {
            await axios.delete(`${API_URL}/releases/${releaseId}`, { headers });
            setReleases((prev) => prev.filter((r) => r.id !== releaseId));
            setConfirmDeleteId(null);
            setNotice('Release deleted. Every track on it is untouched and still on your profile.');
            setError(null);
        } catch (err) {
            setError(`Could not delete the release: ${err.response?.data?.error || err.message}`);
        }
    };

    // Tracks already on the open release are dropped from its picker, so the
    // list only offers things that can actually be added.
    const availableSongs = (releaseId) => {
        const taken = new Set((releaseTracks[releaseId] || []).map((t) => t.id));
        return songs.filter((song) => !taken.has(song.id));
    };

    return (
        <div className="retro-page min-h-screen pt-24 pb-16 px-4">
            <Helmet>
                <title>Your releases | InternetDJ</title>
                <meta name="robots" content="noindex, nofollow" />
            </Helmet>

            <div className="container mx-auto max-w-4xl space-y-6">
                <div className="retro-panel retro-cut p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <h1 className="retro-display text-lg retro-glow-cyan">Releases</h1>
                            <p className="retro-mono text-lg text-gray-400 mt-2 max-w-2xl">
                                Group your tracks into albums, EPs and singles. Adding a track to a
                                release does not move it: it stays on your profile, keeps its own
                                page and its own comments, and can be on more than one release.
                                Deleting a release deletes the grouping only.
                            </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <Link
                                to={`${profilePath({ id: profileId })}/songs-manager`}
                                className="retro-btn px-4 py-2 text-xs"
                            >
                                Songs Manager
                            </Link>
                            <button
                                type="button"
                                onClick={() => { setShowForm((open) => !open); setError(null); }}
                                className="retro-btn retro-btn--hot px-4 py-2 text-xs"
                            >
                                {showForm ? 'Cancel' : 'New release'}
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="retro-panel retro-cut p-4 retro-mono text-lg text-red-400">{error}</div>
                )}
                {notice && (
                    <div className="retro-panel retro-cut p-4 flex items-start justify-between gap-4 retro-mono text-lg">
                        <span>{notice}</span>
                        <button type="button" onClick={() => setNotice(null)} className="retro-link shrink-0">
                            Dismiss
                        </button>
                    </div>
                )}

                {showForm && (
                    <form onSubmit={handleCreate} className="retro-panel retro-cut p-6 space-y-4">
                        <h2 className="retro-display text-base retro-glow-magenta">New release</h2>

                        <div>
                            <label className="retro-label" htmlFor="release-title">Title</label>
                            <input
                                id="release-title"
                                type="text"
                                required
                                maxLength={255}
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white sm:text-sm"
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="retro-label" htmlFor="release-type">Type</label>
                                <select
                                    id="release-type"
                                    value={form.release_type}
                                    onChange={(e) => setForm({ ...form, release_type: e.target.value })}
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white sm:text-sm"
                                >
                                    {RELEASE_TYPES.map(({ value, label }) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="retro-label" htmlFor="release-date">
                                    Release date (optional)
                                </label>
                                <input
                                    id="release-date"
                                    type="date"
                                    value={form.release_date}
                                    onChange={(e) => setForm({ ...form, release_date: e.target.value })}
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white sm:text-sm"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="retro-label" htmlFor="release-description">
                                Description (optional)
                            </label>
                            <textarea
                                id="release-description"
                                rows={3}
                                maxLength={2000}
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white sm:text-sm"
                            />
                        </div>

                        <div>
                            <label className="retro-label" htmlFor="release-cover">
                                Cover (optional)
                            </label>
                            <input
                                id="release-cover"
                                type="file"
                                accept="image/jpeg,image/png"
                                onChange={(e) => setForm({ ...form, cover: e.target.files[0] || null })}
                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                            />
                            <p className="retro-mono text-lg text-gray-500 mt-1">
                                Without one, the release borrows the artwork of its first track.
                            </p>
                        </div>

                        <label className="flex items-start gap-3 cursor-pointer" htmlFor="release-hidden">
                            <input
                                id="release-hidden"
                                type="checkbox"
                                checked={form.hidden}
                                onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
                                className="mt-1"
                            />
                            <span>
                                <span className="retro-label">Keep this release hidden until it is ready</span>
                                <span className="retro-mono text-lg text-gray-400 block mt-1">
                                    On by default, because a new release has no tracks on it yet.
                                    Only you can see a hidden one. Publish it from the card below
                                    once the running order is right. The tracks on it keep whatever
                                    visibility they already have.
                                </span>
                            </span>
                        </label>

                        <button
                            type="submit"
                            disabled={saving}
                            className="retro-btn retro-btn--hot px-5 py-2 text-xs disabled:opacity-50"
                        >
                            {saving ? 'Creating...' : 'Create release'}
                        </button>
                    </form>
                )}

                <div className="retro-panel retro-cut p-6">
                    <h2 className="retro-display text-base retro-glow-magenta mb-4">Your releases</h2>

                    {loading ? (
                        <p className="retro-mono text-lg text-gray-300">Loading...</p>
                    ) : releases.length === 0 ? (
                        <p className="retro-mono text-lg text-gray-300">
                            No releases yet. Make one and start adding tracks to it.
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {releases.map((release) => (
                                <div key={release.id} className="retro-card retro-cut p-4">
                                    <div className="flex items-start gap-4">
                                        {release.cover_url ? (
                                            <img
                                                src={release.cover_url}
                                                alt=""
                                                className="w-16 h-16 object-cover border border-cyan-400/30 shrink-0"
                                            />
                                        ) : (
                                            <div className="w-16 h-16 shrink-0 border border-cyan-400/30 bg-fuchsia-900/25 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300">
                                                {RELEASE_TYPE_LABELS[release.release_type]}
                                            </div>
                                        )}

                                        <div className="min-w-0 flex-1">
                                            <Link
                                                to={`/release/${release.id}`}
                                                className="retro-link retro-mono text-xl block truncate"
                                            >
                                                {release.title}
                                            </Link>
                                            <p className="retro-mono text-lg text-gray-400 mt-1">
                                                {RELEASE_TYPE_LABELS[release.release_type]}
                                                {' · '}
                                                {release.track_count} track{release.track_count === 1 ? '' : 's'}
                                                {release.visibility === 'private' ? ' · hidden' : ''}
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-2 shrink-0 justify-end">
                                            <button
                                                type="button"
                                                onClick={() => openTracks(release.id)}
                                                aria-expanded={openReleaseId === release.id}
                                                className="retro-btn px-3 py-1 text-[0.6rem]"
                                            >
                                                {openReleaseId === release.id ? 'Done' : 'Edit tracks'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleVisibility(release)}
                                                className="retro-btn px-3 py-1 text-[0.6rem]"
                                            >
                                                {release.visibility === 'private' ? 'Publish' : 'Hide'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmDeleteId(release.id)}
                                                className="retro-btn retro-action--danger px-3 py-1 text-[0.6rem]"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>

                                    {confirmDeleteId === release.id && (
                                        <div className="mt-4 border border-red-500/40 bg-red-500/5 p-3 rounded-md">
                                            <p className="retro-mono text-lg text-gray-200">
                                                Delete &ldquo;{release.title}&rdquo;? This removes the
                                                release only. Every track on it stays exactly where it is,
                                                with its plays and its comments.
                                            </p>
                                            <div className="flex gap-2 mt-3">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(release.id)}
                                                    className="retro-btn retro-action--danger px-3 py-1 text-[0.6rem]"
                                                >
                                                    Delete release
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDeleteId(null)}
                                                    className="retro-btn px-3 py-1 text-[0.6rem]"
                                                >
                                                    Keep it
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {openReleaseId === release.id && (
                                        <div className="mt-4 border-t border-cyan-400/20 pt-4 space-y-4">
                                            {(releaseTracks[release.id] || []).length === 0 ? (
                                                <p className="retro-mono text-lg text-gray-400">
                                                    Nothing on this release yet.
                                                </p>
                                            ) : (
                                                <ol className="space-y-2">
                                                    {(releaseTracks[release.id] || []).map((track, index) => (
                                                        <li
                                                            key={track.id}
                                                            className="flex items-center gap-3 bg-white/5 p-2 rounded-md"
                                                        >
                                                            <span className="retro-mono text-lg text-gray-500 w-6 shrink-0 tabular-nums">
                                                                {track.track_no}
                                                            </span>
                                                            <Link
                                                                to={`/song/${track.id}`}
                                                                className="retro-link retro-mono text-lg flex-1 min-w-0 truncate"
                                                            >
                                                                {track.title}
                                                            </Link>
                                                            {track.visibility === 'private' && (
                                                                <span className="retro-chip px-2 py-0.5 shrink-0 border-fuchsia-400 text-fuchsia-200">
                                                                    Hidden
                                                                </span>
                                                            )}
                                                            <div className="flex gap-1 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleMoveTrack(release.id, index, -1)}
                                                                    disabled={index === 0}
                                                                    aria-label={`Move ${track.title} up`}
                                                                    className="retro-btn px-2 py-1 text-[0.6rem] disabled:opacity-30"
                                                                >
                                                                    &uarr;
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleMoveTrack(release.id, index, 1)}
                                                                    disabled={index === (releaseTracks[release.id] || []).length - 1}
                                                                    aria-label={`Move ${track.title} down`}
                                                                    className="retro-btn px-2 py-1 text-[0.6rem] disabled:opacity-30"
                                                                >
                                                                    &darr;
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveTrack(release.id, track.id)}
                                                                    aria-label={`Take ${track.title} off this release`}
                                                                    className="retro-btn retro-action--danger px-2 py-1 text-[0.6rem]"
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ol>
                                            )}

                                            <div className="flex flex-wrap items-end gap-2">
                                                <div className="flex-1 min-w-[14rem]">
                                                    <label className="retro-label" htmlFor={`add-track-${release.id}`}>
                                                        Add one of your tracks
                                                    </label>
                                                    <select
                                                        id={`add-track-${release.id}`}
                                                        value={trackPick}
                                                        onChange={(e) => setTrackPick(e.target.value)}
                                                        className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white sm:text-sm"
                                                    >
                                                        <option value="">Choose a track...</option>
                                                        {availableSongs(release.id).map((song) => (
                                                            <option key={song.id} value={song.id}>
                                                                {song.title}
                                                                {song.visibility === 'private' ? ' (hidden)' : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleAddTrack(release.id)}
                                                    disabled={!trackPick}
                                                    className="retro-btn retro-btn--hot px-4 py-2 text-xs disabled:opacity-50"
                                                >
                                                    Add track
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Releases;
