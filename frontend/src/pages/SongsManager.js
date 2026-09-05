import React, { useEffect, useState, useContext, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { StarIcon, XMarkIcon, ArrowDownTrayIcon, SparklesIcon, EyeSlashIcon } from '@heroicons/react/24/solid';
import API_URL from '../utils/api';
import { MUSICAL_KEYS } from '../utils/musicalKeys';
import genreTags from '../utils/genreTags';
import relativeDate from '../utils/relativeDate';
import { Line } from 'react-chartjs-2';
import Chart from 'chart.js/auto';
import ErrorBoundary from '../components/ErrorBoundary';
import AutoMasterModal from '../components/AutoMasterModal';
import {
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';

Chart.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

/**
 * Read-only state, shown only when it is worth noticing.
 *
 * These used to be three clickable pills sitting beside six action buttons, all
 * drawn at the same weight, so nothing told you which controls described the
 * track and which did something to it. Now the row reports and the Manage panel
 * operates, which is the split that makes a row of twenty scannable.
 *
 * A listed, undownloadable, unrevised track renders nothing at all. That is the
 * point: the eye should land on the exceptions, not read six labels per row to
 * discover there are none.
 */
const StatusChips = ({ song }) => {
    const chips = [];

    if (song.visibility === 'private') {
        chips.push(['hidden', 'Hidden', 'retro-chip border-amber-400/50 text-amber-300 bg-amber-400/10']);
    }
    if (song.share_token) {
        chips.push(['share', 'Private link', 'retro-chip']);
    }
    if (Number(song.current_version_no) > 1) {
        chips.push(['ver', `v${Number(song.current_version_no)}`, 'retro-chip border-green-400/45 text-green-300 bg-green-400/10']);
    }
    if (song.allow_download) {
        chips.push(['dl', 'Downloadable', 'retro-chip border-white/20 text-gray-400 bg-white/5']);
    }
    if (song.allow_ai_training) {
        chips.push(['ai', 'In training', 'retro-chip border-white/20 text-gray-400 bg-white/5']);
    }
    for (const title of song.releases || []) {
        chips.push([`rel-${title}`, title, 'retro-chip border-white/20 text-gray-400 bg-white/5']);
    }

    if (!chips.length) return null;

    return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
            {chips.map(([key, label, className]) => (
                <span key={key} className={`${className} px-2 py-0.5`}>{label}</span>
            ))}
        </div>
    );
};

/**
 * One tab in a song's Manage panel.
 *
 * Tabs rather than one long stacked form: the panel would otherwise be a wall
 * of six sections tall enough to bury the rows underneath it. Nothing is hidden
 * behind an anonymous menu - the group names are on screen, which is the part
 * the old ellipsis button got wrong.
 */
const ManageTab = ({ id, label, active, danger = false, onSelect }) => (
    <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onSelect(id)}
        className={`retro-label mb-0 px-3 py-2 border transition-colors ${
            active
                ? (danger
                    ? 'border-red-400 text-red-300 bg-red-500/10'
                    : 'border-cyan-400 text-cyan-300 bg-cyan-400/10')
                : 'border-cyan-400/25 text-gray-500 hover:text-gray-300'
        }`}
    >
        {label}
    </button>
);

// The two permissions an artist grants a track. They live on the upload and
// edit forms — not only behind the row icons — because deciding who may take
// the audio and whether it trains a model belongs next to the title and genre,
// where the artist is already thinking about the song. Both are one component
// so the wording and the defaults cannot drift between the two forms.
const SongPermissionFields = ({ idPrefix, allowDownload, allowAiTraining, onChange }) => (
    <div className="border border-cyan-400/25 bg-white/5 p-3 rounded-md space-y-4">
        <label className="flex items-start gap-3 cursor-pointer" htmlFor={`${idPrefix}-allow-download`}>
            <input
                id={`${idPrefix}-allow-download`}
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => onChange({ allowDownload: e.target.checked })}
                className="mt-1"
            />
            <span>
                <span className="retro-label inline-flex items-center gap-1">
                    <ArrowDownTrayIcon className="w-4 h-4 text-primary-brand-300" />
                    Let anyone download this track
                </span>
                <span className="retro-mono text-lg text-gray-400 block mt-1">
                    Off unless you tick it. Ticking it puts a download button on the
                    song page, so listeners can keep a copy of the audio file.
                </span>
            </span>
        </label>

        {/* Opt-in, not opt-out. The copy says plainly what agreeing to means,
            including the part that cannot be taken back. */}
        <label className="flex items-start gap-3 cursor-pointer" htmlFor={`${idPrefix}-allow-ai-training`}>
            <input
                id={`${idPrefix}-allow-ai-training`}
                type="checkbox"
                checked={allowAiTraining}
                onChange={(e) => onChange({ allowAiTraining: e.target.checked })}
                className="mt-1"
            />
            <span>
                <span className="retro-label inline-flex items-center gap-1">
                    <SparklesIcon className="w-4 h-4 text-cyan-300" />
                    Use this track to train the loop generator
                </span>
                <span className="retro-mono text-lg text-gray-400 block mt-1">
                    Your call, and it is off unless you tick it. Ticking it lets
                    InternetDJ use this audio to train the model that writes brand-new
                    bass, synth, drum and effects parts from a prompt. It is never taken
                    apart, reproduced or handed to anyone — it teaches the model, and
                    nothing more. You keep every right to your music, and you can change
                    your mind here any time — that takes the track out of future
                    training, though it cannot undo training that has already happened.
                </span>
            </span>
        </label>
    </div>
);

/**
 * Whether a track is listed.
 *
 * This sits on the forms rather than only behind the row pill, for the same
 * reason the download and training permissions do: deciding who can find a
 * track belongs next to its title, where the artist is already making
 * decisions about it. The row pill stays as the quick flip for a track that is
 * already up.
 *
 * The wording avoids "private", because the track is not sealed - a private
 * link still reaches it, and saying otherwise would be a promise the feature
 * does not keep.
 */
const SongVisibilityField = ({ idPrefix, hidden, onChange }) => (
    <div className="border border-cyan-400/25 bg-white/5 p-3 rounded-md">
        <label className="flex items-start gap-3 cursor-pointer" htmlFor={`${idPrefix}-hidden`}>
            <input
                id={`${idPrefix}-hidden`}
                type="checkbox"
                checked={hidden}
                onChange={(e) => onChange({ hidden: e.target.checked })}
                className="mt-1"
            />
            <span>
                <span className="retro-label inline-flex items-center gap-1">
                    <EyeSlashIcon className="w-4 h-4 text-cyan-300" />
                    Hide this track from the site
                </span>
                <span className="retro-mono text-lg text-gray-400 block mt-1">
                    A hidden track is off browse, search, the genre pages and your public
                    profile. Nothing is deleted: it keeps its plays, its comments and its
                    place in every mixtape it was added to, and unhiding it puts all of
                    that straight back. Anyone holding its private link can still play it.
                </span>
            </span>
        </label>
    </div>
);

// Same idea for the upload form: reset it from here, not from a literal
// repeated at each call site.
const EMPTY_SONG_FORM = {
    title: '',
    description: '',
    genres: [],
    genreInput: '',
    mp3: null,
    image: null,
    // Both permissions start off: a track is downloadable, or part of a
    // training set, only because the artist ticked the box for it.
    allowDownload: false,
    allowAiTraining: false,
    // Uploading publishes. Hiding is a deliberate choice on the way in, for a
    // work in progress meant only for a private link.
    hidden: false,
};

// One place to reset the edit form from, so a new field cannot be added to
// the form and forgotten in one of the three places that clear it.
const EMPTY_EDIT_FORM = {
    title: '',
    description: '',
    genres: [],
    genreInput: '',
    bpm: '',
    musicalKey: '',
    mp3: null,
    image: null,
    // Filled in from the song when the form opens, so the boxes always show
    // what is actually set rather than a default.
    allowDownload: false,
    allowAiTraining: false,
    hidden: false,
};

const SongsManager = () => {
    const { profileId } = useParams();
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const [songs, setSongs] = useState([]);
    const [error, setError] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadCompleted, setUploadCompleted] = useState(false);
    const [showUploadForm, setShowUploadForm] = useState(false);
    const [songForm, setSongForm] = useState(EMPTY_SONG_FORM);
    const [editSongId, setEditSongId] = useState(null);
    const [editFormData, setEditFormData] = useState(EMPTY_EDIT_FORM);
    const [featureNotice, setFeatureNotice] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [songToDelete, setSongToDelete] = useState(null);
    const [songToMaster, setSongToMaster] = useState(null);
    const [masteredNotice, setMasteredNotice] = useState(null);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [statsSongId, setStatsSongId] = useState(null);
    const [stats, setStats] = useState({ plays: [] });
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [loading, setLoading] = useState(true);
    const mp3InputRef = useRef(null);
    const imageInputRef = useRef(null);
    const editImageInputRef = useRef(null);
    const songGenreInputRef = useRef(null);
    // Existing genres, used to suggest what artists already use. This is what
    // actually stops new spelling variants appearing; typing something new is
    // still allowed.
    const [knownGenres, setKnownGenres] = useState([]);

    // Sharing and versions are panes in the Manage panel rather than modals.
    // A modal over a list you are working down loses your place; a pane opens
    // in the row it belongs to and closes back into it.
    const [shareLinkBusy, setShareLinkBusy] = useState(false);
    const [shareLinkCopied, setShareLinkCopied] = useState(false);
    const [versionForm, setVersionForm] = useState({ mp3: null, label: '', notes: '' });
    const [versionBusy, setVersionBusy] = useState(false);
    const [versionNotice, setVersionNotice] = useState(null);
    // Version history per song, fetched the first time the Audio pane is
    // opened. Loading it for every row up front would be one request per track
    // to render something almost nobody expands.
    const [versionsBySong, setVersionsBySong] = useState({});

    // Which row is expanded, and which pane of it. `editSongId` still holds the
    // song whose edit form is loaded, because Details and Permissions both save
    // through it; this is the open/closed state of the panel around them.
    const [manageSongId, setManageSongId] = useState(null);
    const [manageTab, setManageTab] = useState('details');

    // Selection for bulk actions, and the list filter. Both are page state
    // rather than per row, so they reset together when the list changes.
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [listFilter, setListFilter] = useState('all');
    const editGenreInputRef = useRef(null);

    useEffect(() => {
        axios.get(`${API_URL}/music/genres`)
            .then(res => setKnownGenres(Array.isArray(res.data) ? res.data : []))
            .catch(() => setKnownGenres([]));  // suggestions are optional
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to manage songs for this profile.');
            setLoading(false);
            return;
        }

        if (!user) {
            return;
        }

        const verifyOwnershipAndFetchSongs = async () => {
            try {
                // Fetch profile to verify ownership
                const profileResponse = await axios.get(`${API_URL}/profile/${profileId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                // Check if the profile's user_id matches the logged-in user's id
                if (profileResponse.data.profile.user_id !== user.id) {
                    setError('You are not authorized to manage songs for this profile.');
                    setLoading(false);
                    return;
                }

                // Fetch songs for the profile
                setSongs(profileResponse.data.songs || []);
                setError(null);
            } catch (err) {
                setError(`Failed to fetch profile or songs: ${err.response?.data?.error || err.message}`);
            } finally {
                setLoading(false);
            }
        };

        verifyOwnershipAndFetchSongs();
    }, [profileId, user]);

    const handleSongInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'genreInput') {
            if (value.endsWith(',')) {
                const newTag = value.slice(0, -1).trim();
                if (newTag && !songForm.genres.includes(newTag)) {
                    if (songForm.genres.length >= 3) {
                        setError('Maximum 3 genres allowed');
                    } else {
                        setSongForm({
                            ...songForm,
                            genres: [...songForm.genres, newTag],
                            genreInput: '',
                        });
                        setError(null);
                    }
                } else {
                    setSongForm({ ...songForm, genreInput: '' });
                }
            } else {
                setSongForm({ ...songForm, genreInput: value });
            }
        } else {
            setSongForm({ ...songForm, [name]: value });
        }
    };

    const handleSongFileChange = (e) => {
        const { name, files } = e.target;
        const file = files[0];
        if (!file) return;

        if (name === 'mp3') {
            if (file.size > 100 * 1024 * 1024) {
                setError('MP3 file size exceeds 100 MB limit');
                return;
            }
            if (file.size === 0) {
                setError('MP3 file is empty');
                return;
            }
            if (!file.type.includes('audio/mpeg')) {
                setError('MP3 file must be an audio/mpeg file');
                return;
            }
        } else if (name === 'image') {
            if (!['image/jpeg', 'image/png'].includes(file.type)) {
                setError('Image file must be JPEG or PNG');
                return;
            }
            if (file.size === 0) {
                setError('Image file is empty');
                return;
            }
        }

        setSongForm({ ...songForm, [name]: file });
        setError(null);
    };

    const handleSongSubmit = async (e, retryCount = 0) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to upload a song');
            return;
        }
        if (!songForm.mp3) {
            setError('Please select an MP3 file');
            return;
        }
        if (!songForm.title) {
            setError('Song title is required');
            return;
        }
        const finalGenres = [...songForm.genres];
        const leftover = songForm.genreInput.trim();
        if (leftover) {
            // Split a run-on entry rather than storing it as a single genre.
            (splitTypedGenres(leftover) || [leftover]).forEach(part => {
                if (finalGenres.length < 3 && !finalGenres.some(g => g.toLowerCase() === part.toLowerCase())) {
                    finalGenres.push(part);
                }
            });
        }
        if (finalGenres.length > 3) {
            setError('Maximum 3 genres allowed');
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);
        setError(null);

        const form = new FormData();
        form.append('title', songForm.title);
        form.append('description', songForm.description || '');
        form.append('genre', finalGenres.join(','));
        form.append('allow_download', songForm.allowDownload ? 'true' : 'false');
        form.append('allow_ai_training', songForm.allowAiTraining ? 'true' : 'false');
        form.append('visibility', songForm.hidden ? 'private' : 'public');
        form.append('mp3', songForm.mp3);
        if (songForm.image) {
            form.append('image', songForm.image);
        }

        try {
            const response = await axios.post(`${API_URL}/music/upload`, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                timeout: 180000,
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        setUploadProgress(percentCompleted);
                    }
                },
            });
            setSongs([...songs, { ...response.data.song, plays: Number(response.data.song.plays) || 0 }]);
            setSongForm(EMPTY_SONG_FORM);
            setUploadCompleted(true);
            setShowUploadForm(false);
            setError(null);
        } catch (err) {
            const errorMessage = err.response?.data?.error || `Failed to upload song: ${err.message}`;
            setError(errorMessage);
            if (errorMessage.includes('Unexpected end of form') && retryCount < 3) {
                setTimeout(() => handleSongSubmit(e, retryCount + 1), 5000);
            }
        } finally {
            if (!uploadCompleted) {
                setIsUploading(false);
                setUploadProgress(0);
            }
        }
    };

    const handleUploadMore = () => {
        setSongForm(EMPTY_SONG_FORM);
        setUploadCompleted(false);
        setError(null);
        if (mp3InputRef.current) mp3InputRef.current.value = '';
        if (imageInputRef.current) imageInputRef.current.value = '';
        setShowUploadForm(false);
    };

    // Punctuation is stripped from both sides so 'd&b' matches the alias stored
    // as 'd b'. This is only for ranking suggestions — the authoritative
    // normalisation stays on the server, and being approximate here is fine.
    const looseGenreKey = (text) => (text || '')
        .toLowerCase()
        .replace(/[`´'‘’.\-_/\\&+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(word => word && word !== 'and' && word !== 'n')
        .join(' ');

    // The form only used to commit a tag on a comma, so anything still in the box
    // at submit time became one giant genre — that's where entries like
    // "Trance Analog Trance Tech House" come from. Longest-match against the
    // genres already in use pulls those apart, while leaving real multi-word
    // genres ("Deep House") and brand-new ones alone.
    const splitTypedGenres = (text) => {
        const words = looseGenreKey(text).split(' ').filter(Boolean);
        if (words.length < 2 || knownGenres.length === 0) return null;

        const vocab = new Map();
        knownGenres.forEach(g => {
            const key = looseGenreKey(g.key || g.label);
            if (key && key.split(' ').length <= 3) vocab.set(key, g.label);
        });
        if (vocab.size === 0) return null;
        const maxWords = Math.max(...[...vocab.keys()].map(k => k.split(' ').length));

        const found = [];
        const gaps = [];
        let i = 0;
        while (i < words.length) {
            let matched = null;
            for (let n = Math.min(maxWords, words.length - i); n >= 1; n--) {
                const candidate = words.slice(i, i + n).join(' ');
                if (vocab.has(candidate)) { matched = { label: vocab.get(candidate), n }; break; }
            }
            if (matched) { found.push(matched.label); i += matched.n; }
            else { gaps.push(words[i]); i += 1; }
        }

        const unique = [...new Set(found)];
        const tolerance = Math.max(1, Math.floor(words.length * 0.25));
        return unique.length >= 2 && gaps.length <= tolerance ? unique : null;
    };

    // One place that turns whatever is in the box into chips, used by comma,
    // Enter, Tab, blur and submit alike.
    const commitSongGenreInput = () => {
        const typed = songForm.genreInput.trim();
        if (!typed) return;
        const parts = splitTypedGenres(typed) || [typed];
        const next = [...songForm.genres];
        parts.forEach(part => {
            if (next.length < 3 && !next.some(g => g.toLowerCase() === part.toLowerCase())) {
                next.push(part);
            }
        });
        if (next.length === songForm.genres.length && parts.length) {
            setError(songForm.genres.length >= 3 ? 'Maximum 3 genres allowed' : null);
        } else {
            setError(null);
        }
        setSongForm({ ...songForm, genres: next, genreInput: '' });
    };

    const genreSuggestions = (typed, chosen) => {
        const q = looseGenreKey(typed);
        if (!q) return [];
        const taken = new Set((chosen || []).map(t => t.toLowerCase()));
        // `aliases` comes from the API and carries the abbreviations artists
        // actually type, so 'dnb' finds Drum and Bass.
        return knownGenres
            .filter(g => !taken.has(g.label.toLowerCase()))
            .filter(g =>
                looseGenreKey(g.label).includes(q) ||
                looseGenreKey(g.key).includes(q) ||
                (g.aliases || []).some(alias => looseGenreKey(alias).includes(q))
            )
            .slice(0, 6);
    };

    const applySongGenreSuggestion = (label) => {
        if (songForm.genres.length >= 3) {
            setError('Maximum 3 genres allowed');
            return;
        }
        if (!songForm.genres.includes(label)) {
            setSongForm({ ...songForm, genres: [...songForm.genres, label], genreInput: '' });
            setError(null);
        } else {
            setSongForm({ ...songForm, genreInput: '' });
        }
        if (songGenreInputRef.current) songGenreInputRef.current.focus();
    };

    const removeSongGenreTag = (tagToRemove) => {
        setSongForm({
            ...songForm,
            genres: songForm.genres.filter(tag => tag !== tagToRemove),
        });
        setError(null);
        songGenreInputRef.current.focus();
    };

    const handleEditInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'genreInput') {
            if (value.endsWith(',')) {
                const newTag = value.slice(0, -1).trim();
                if (newTag && !editFormData.genres.includes(newTag)) {
                    if (editFormData.genres.length >= 3) {
                        setError('Maximum 3 genres allowed');
                    } else {
                        setEditFormData({
                            ...editFormData,
                            genres: [...editFormData.genres, newTag],
                            genreInput: '',
                        });
                        setError(null);
                    }
                } else {
                    setEditFormData({ ...editFormData, genreInput: '' });
                }
            } else {
                setEditFormData({ ...editFormData, genreInput: value });
            }
        } else {
            setEditFormData({ ...editFormData, [name]: value });
        }
    };

    const handleEditFileChange = (e) => {
        const { name, files } = e.target;
        const file = files[0];
        if (!file) return;

        if (name === 'mp3') {
            if (file.size > 100 * 1024 * 1024) {
                setError('MP3 file size exceeds 100 MB limit');
                return;
            }
            if (file.size === 0) {
                setError('MP3 file is empty');
                return;
            }
            if (!file.type.includes('audio/mpeg')) {
                setError('MP3 file must be an audio/mpeg file');
                return;
            }
        } else if (name === 'image') {
            if (!['image/jpeg', 'image/png'].includes(file.type)) {
                setError('Image file must be JPEG or PNG');
                return;
            }
            if (file.size === 0) {
                setError('Image file is empty');
                return;
            }
        }

        setEditFormData({ ...editFormData, [name]: file });
        setError(null);
    };

    // The toast confirms the save happened; it should not need dismissing.
    useEffect(() => {
        if (!featureNotice) return undefined;
        const timer = setTimeout(() => setFeatureNotice(null), 4000);
        return () => clearTimeout(timer);
    }, [featureNotice]);

    const handleEditSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to edit the song');
            return;
        }
        const finalGenres = [...editFormData.genres];
        const editLeftover = editFormData.genreInput.trim();
        if (editLeftover) {
            // Same run-on split as the upload form, so editing can't reintroduce
            // a genre like "Trance Analog Trance Tech House".
            (splitTypedGenres(editLeftover) || [editLeftover]).forEach(part => {
                if (finalGenres.length < 3 && !finalGenres.some(g => g.toLowerCase() === part.toLowerCase())) {
                    finalGenres.push(part);
                }
            });
        }
        if (finalGenres.length > 3) {
            setError('Maximum 3 genres allowed');
            return;
        }

        const form = new FormData();
        form.append('title', editFormData.title);
        form.append('description', editFormData.description);
        form.append('genre', finalGenres.join(','));
        if (editFormData.mp3) {
            form.append('mp3', editFormData.mp3);
        } else {
            // Only sent when the audio is unchanged. Replacing the file makes
            // the server re-detect both, and sending stale values alongside it
            // would just race the analysis worker.
            form.append('bpm', editFormData.bpm.trim());
            form.append('musical_key', editFormData.musicalKey);
        }
        if (editFormData.image) {
            form.append('image', editFormData.image);
        }
        form.append('allow_download', editFormData.allowDownload ? 'true' : 'false');
        form.append('allow_ai_training', editFormData.allowAiTraining ? 'true' : 'false');
        form.append('visibility', editFormData.hidden ? 'private' : 'public');

        try {
            const response = await axios.put(`${API_URL}/music/${editSongId}`, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });
            // Merged over the existing row, not swapped for the response.
            // PUT answers with `SELECT * FROM songs`, which has no avg_rating,
            // no release titles and a hardcoded likes_count of 0 - all of which
            // the list gets from the profile query. Replacing the object
            // wholesale blanked the rating and dropped the release chips the
            // moment anyone renamed a track.
            setSongs((prev) => prev.map((song) => (
                song.id === editSongId
                    ? { ...song, ...response.data.song, plays: Number(song.plays) || 0, likes_count: song.likes_count }
                    : song
            )));
            // Close the whole panel rather than just clearing editSongId: the
            // panel is keyed on manageSongId, so clearing the form underneath
            // an open Details tab emptied every field in front of the artist.
            // The row's status chips are the confirmation that it saved.
            closeManage();
            setError(null);
            setFeatureNotice('Saved.');
            if (editImageInputRef.current) editImageInputRef.current.value = '';
        } catch (err) {
            setError(`Failed to update song: ${err.response?.data?.error || err.message}`);
        }
    };

    const removeEditGenreTag = (tagToRemove) => {
        setEditFormData({
            ...editFormData,
            genres: editFormData.genres.filter(tag => tag !== tagToRemove),
        });
        setError(null);
        editGenreInputRef.current.focus();
    };

    // A mastered track is saved as its own song rather than replacing the
    // original: reviews and ratings hang off the song row they were left on,
    // and a new master is meant to gather feedback of its own.
    /**
     * Hide a track, or put it back.
     *
     * Optimistic, like the other two pills: the row flips at once and the
     * server's answer only matters when it disagrees.
     */
    const handleToggleVisibility = async (song) => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to change this');
            return;
        }
        const next = song.visibility === 'private' ? 'public' : 'private';
        try {
            await axios.patch(
                `${API_URL}/music/${song.id}/visibility`,
                { visibility: next },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, visibility: next } : s)));
            setFeatureNotice(
                next === 'private'
                    ? `"${song.title}" is hidden. Nothing was deleted, and your private link still works.`
                    : `"${song.title}" is visible again.`
            );
            setError(null);
        } catch (err) {
            setError(`Failed to change visibility: ${err.response?.data?.error || err.message}`);
        }
    };

    /** Mint the private link, or replace the one this track already has. */
    const handleCreateShareLink = async (song, rotate = false) => {
        const token = localStorage.getItem('token');
        if (!token || !song) return;
        setShareLinkBusy(true);
        setShareLinkCopied(false);
        try {
            const response = await axios.post(
                `${API_URL}/music/${song.id}/share-link${rotate ? '?rotate=1' : ''}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const shareToken = response.data?.share_token || null;
            setSongs((prev) => prev.map((s) => (
                s.id === song.id ? { ...s, share_token: shareToken, has_share_link: !!shareToken } : s
            )));
            setError(null);
        } catch (err) {
            setError(`Failed to create the link: ${err.response?.data?.error || err.message}`);
        } finally {
            setShareLinkBusy(false);
        }
    };

    const handleRevokeShareLink = async (song) => {
        const token = localStorage.getItem('token');
        if (!token || !song) return;
        setShareLinkBusy(true);
        try {
            await axios.delete(`${API_URL}/music/${song.id}/share-link`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setSongs((prev) => prev.map((s) => (
                s.id === song.id ? { ...s, share_token: null, has_share_link: false } : s
            )));
            setShareLinkCopied(false);
            setError(null);
        } catch (err) {
            setError(`Failed to revoke the link: ${err.response?.data?.error || err.message}`);
        } finally {
            setShareLinkBusy(false);
        }
    };

    const shareLinkUrl = (shareToken) =>
        (shareToken ? `${window.location.origin}/s/${shareToken}` : '');

    const copyShareLink = async (song) => {
        const url = shareLinkUrl(song?.share_token);
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setShareLinkCopied(true);
        } catch {
            // Clipboard access can be refused, and there is a readable input
            // holding the same text right above this button, so failing to copy
            // is not worth an error banner.
            setShareLinkCopied(false);
        }
    };

    /**
     * Upload a new version of an existing track.
     *
     * Deliberately not the same thing as uploading a song. The track keeps its
     * page, its plays and its comments and simply plays the new audio, and the
     * recording it replaced stays in the history.
     */
    // Checked before the upload rather than after it: a file that is too big
    // or the wrong type should be refused while the artist is still looking at
    // the picker, not a minute later as a server error.
    const handleVersionFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) {
            setVersionForm({ ...versionForm, mp3: null });
            return;
        }
        if (!file.type.includes('audio/mpeg')) {
            setError('A new version has to be an MP3.');
            return;
        }
        if (file.size === 0) {
            setError('That file is empty.');
            return;
        }
        if (file.size > 100 * 1024 * 1024) {
            setError('MP3 file size exceeds the 100 MB limit.');
            return;
        }
        setVersionForm({ ...versionForm, mp3: file });
        setError(null);
    };

    const handleVersionSubmit = async (e, song) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token || !song) return;
        if (!versionForm.mp3) {
            setError('Choose the new MP3 first');
            return;
        }

        setVersionBusy(true);
        const form = new FormData();
        form.append('mp3', versionForm.mp3);
        if (versionForm.label.trim()) form.append('label', versionForm.label.trim());
        if (versionForm.notes.trim()) form.append('notes', versionForm.notes.trim());

        try {
            const response = await axios.post(`${API_URL}/music/${song.id}/versions`, form, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 180000,
            });
            const versionNo = response.data?.current_version_no;
            setSongs((prev) => prev.map((s) => (
                s.id === song.id
                    ? { ...s, mp3_url: response.data?.version?.mp3_url || s.mp3_url, current_version_no: versionNo }
                    : s
            )));
            // The cached history is now a version short, so drop it and let the
            // pane refetch rather than showing a list missing what was just added.
            setVersionsBySong((prev) => {
                const next = { ...prev };
                delete next[song.id];
                return next;
            });
            await loadVersions(song.id);
            setVersionNotice(
                `"${song.title}" is now on version ${versionNo}. `
                + 'The previous one is kept in its history, and tempo and key are being re-detected.'
            );
            setVersionForm({ mp3: null, label: '', notes: '' });
            setError(null);
        } catch (err) {
            setError(`Failed to upload the new version: ${err.response?.data?.error || err.message}`);
        } finally {
            setVersionBusy(false);
        }
    };

    /**
     * Put an older version back as the one that plays.
     *
     * The reason to keep history is to be able to go back to it, so this sits
     * beside the list rather than behind a support request. Nothing is deleted
     * and no numbers are reused: the version being replaced stays in the list
     * at its own number.
     */
    const handleRestoreVersion = async (songId, versionNo) => {
        const token = localStorage.getItem('token');
        if (!token) return;
        try {
            const response = await axios.post(
                `${API_URL}/music/${songId}/versions/${versionNo}/restore`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setSongs((prev) => prev.map((s) => (
                s.id === songId
                    ? { ...s, mp3_url: response.data?.mp3_url || s.mp3_url, current_version_no: versionNo }
                    : s
            )));
            setVersionsBySong((prev) => ({
                ...prev,
                [songId]: (prev[songId] || []).map((v) => ({
                    ...v,
                    is_current: Number(v.version_no) === Number(versionNo),
                })),
            }));
            setVersionNotice(`Version ${versionNo} is playing again.`);
            setError(null);
        } catch (err) {
            setError(`Failed to restore that version: ${err.response?.data?.error || err.message}`);
        }
    };

    /**
     * Open a row's Manage panel, or close the one that is open.
     *
     * Opening seeds the edit form from the song, which is what the old Edit
     * button did - Details and Permissions are two views of that one form and
     * save through the same submit.
     */
    const openManage = (song, tab = 'details') => {
        if (manageSongId === song.id && manageTab === tab) {
            setManageSongId(null);
            setEditSongId(null);
            return;
        }
        setManageSongId(song.id);
        setManageTab(tab);
        setEditSongId(song.id);
        setEditFormData({
            ...EMPTY_EDIT_FORM,
            title: song.title,
            description: song.description || '',
            genres: genreTags(song.genre).slice(0, 3),
            // Numbers arrive as strings from a form; keep them that way so an
            // empty field means "clear it".
            bpm: song.bpm != null ? String(Math.round(Number(song.bpm))) : '',
            musicalKey: song.musical_key || '',
            allowDownload: Boolean(song.allow_download),
            allowAiTraining: Boolean(song.allow_ai_training),
            hidden: song.visibility === 'private',
        });
        setVersionForm({ mp3: null, label: '', notes: '' });
        setShareLinkCopied(false);
    };

    const closeManage = () => {
        setManageSongId(null);
        setEditSongId(null);
        setEditFormData(EMPTY_EDIT_FORM);
    };

    // Version history, fetched once per song and then cached for the session.
    const loadVersions = async (songId) => {
        if (versionsBySong[songId]) return;
        try {
            const response = await axios.get(`${API_URL}/music/${songId}/versions`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            setVersionsBySong((prev) => ({ ...prev, [songId]: response.data?.versions || [] }));
        } catch (err) {
            setError(`Could not load version history: ${err.response?.data?.error || err.message}`);
        }
    };

    const selectTab = (songId, tab) => {
        setManageTab(tab);
        if (tab === 'audio') loadVersions(songId);
    };

    /**
     * The list the artist is actually looking at.
     *
     * There was no sort, filter or search on this page at all. Now that a track
     * can be hidden and can belong to a release, finding the one you mean
     * matters more than reaching its buttons did.
     */
    const filteredSongs = songs.filter((song) => {
        if (listFilter === 'listed') return song.visibility !== 'private';
        if (listFilter === 'hidden') return song.visibility === 'private';
        if (listFilter === 'release') return (song.releases || []).length > 0;
        if (listFilter === 'noart') return !song.image_url;
        return true;
    });

    const toggleSelected = (songId) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(songId)) next.delete(songId); else next.add(songId);
            return next;
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    /**
     * Apply one change to every selected track.
     *
     * Hiding ten old tracks used to be ten trips through ten rows. These run
     * against the existing per-song endpoints rather than a new bulk route, so
     * there is one authorization path for a change whether it was made to one
     * track or twelve.
     *
     * AI-training consent is deliberately not offered here. Consent is given
     * per song and on purpose; a checkbox that sweeps a dozen tracks into a
     * training set as a side effect of a multi-select is a different act from
     * an artist agreeing to each one, and the whole point of that setting is
     * that it is never granted by accident.
     */
    const applyToSelected = async (label, request, patch) => {
        const token = localStorage.getItem('token');
        const ids = [...selectedIds];
        if (!token || !ids.length) return;

        setBulkBusy(true);
        try {
            const results = await Promise.allSettled(ids.map((id) => request(id, token)));
            const failed = results.filter((r) => r.status === 'rejected').length;
            const changed = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));

            setSongs((prev) => prev.map((s) => (changed.has(s.id) ? { ...s, ...patch } : s)));
            clearSelection();
            setFeatureNotice(
                failed
                    ? `${label} applied to ${changed.size} track${changed.size === 1 ? '' : 's'}. ${failed} could not be changed.`
                    : `${label} applied to ${changed.size} track${changed.size === 1 ? '' : 's'}.`
            );
            setError(null);
        } catch (err) {
            setError(`Bulk change failed: ${err.message}`);
        } finally {
            setBulkBusy(false);
        }
    };

    const bulkVisibility = (visibility) => applyToSelected(
        visibility === 'private' ? 'Hidden' : 'Unhidden',
        (id, token) => axios.patch(
            `${API_URL}/music/${id}/visibility`,
            { visibility },
            { headers: { Authorization: `Bearer ${token}` } }
        ),
        { visibility }
    );

    const bulkDownload = (allow) => applyToSelected(
        allow ? 'Downloads on' : 'Downloads off',
        (id, token) => axios.patch(
            `${API_URL}/music/${id}/allow-download`,
            { allow_download: allow },
            { headers: { Authorization: `Bearer ${token}` } }
        ),
        { allow_download: allow }
    );

    /**
     * A master saved onto the track it came from, rather than beside it.
     *
     * The row is patched rather than refetched so the list reflects it at once,
     * and the cached version history for that song is dropped so the Audio pane
     * refetches instead of showing a list that is one entry short.
     */
    const handleMasteredVersion = ({ songId, title, versionNo, mp3Url }) => {
        setSongs((prev) => prev.map((s) => (
            s.id === songId
                ? { ...s, mp3_url: mp3Url || s.mp3_url, current_version_no: versionNo }
                : s
        )));
        setVersionsBySong((prev) => {
            const next = { ...prev };
            delete next[songId];
            return next;
        });
        setVersionNotice(
            `"${title}" is now on version ${versionNo}. The version it replaced is kept in its history.`
        );
    };

    const handleMasteredSaved = (newSong) => {
        if (!newSong) return;
        setSongs((prevSongs) => [...prevSongs, { ...newSong, plays: Number(newSong.plays) || 0 }]);
        setMasteredNotice(newSong);
        setError(null);
    };

    const handleDelete = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to delete the song');
            return;
        }

        try {
            await axios.delete(`${API_URL}/music/${songToDelete}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            setSongs(songs.filter((song) => song.id !== songToDelete));
            setShowDeleteConfirm(false);
            setSongToDelete(null);
        } catch (err) {
            setError(`Failed to delete song: ${err.response?.data?.error || err.message}`);
        }
    };

    const fetchStats = async (songId) => {
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setError('Authentication required to fetch stats');
                return;
            }
            const params = {};
            if (startDate) params.start_date = startDate;
            if (endDate) params.end_date = endDate;
            const response = await axios.get(`${API_URL}/music/${songId}/stats`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                params,
            });
            setStats(response.data || { plays: [] });
        } catch (err) {
            setError(`Failed to load stats: ${err.response?.data?.error || err.message}`);
        }
    };

    useEffect(() => {
        if (showStatsModal && statsSongId) {
            fetchStats(statsSongId);
        }
    }, [showStatsModal, statsSongId]);

    const handleDateFilter = () => {
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            setError('Start date cannot be after end date');
            return;
        }
        if (statsSongId) {
            fetchStats(statsSongId);
        }
    };

    const chartDataAndOptions = {
        chartData: {
            labels: [...new Set(
                stats.plays
                    .filter(p => p.date && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
                    .map(p => p.date)
            )].sort(),
            datasets: [
                {
                    label: 'Cumulative Plays',
                    data: [...new Set(
                        stats.plays
                            .filter(p => p.date && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
                            .map(p => p.date)
                    )].sort().map((date, index) => {
                        const play = stats.plays.find(p => p.date === date);
                        if (play) {
                            if (typeof play.count !== 'number' || isNaN(play.count)) {
                                return index > 0 ? playsData[index - 1] : 0;
                            }
                            return play.count;
                        }
                        const lastPlay = stats.plays.find(p => p.date && new Date(p.date) < new Date(date));
                        return lastPlay && typeof lastPlay.count === 'number' && !isNaN(lastPlay.count)
                            ? lastPlay.count
                            : (index > 0 ? playsData[index - 1] : 0);
                    }),
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: false,
                    tension: 0.4,
                },
            ],
        },
        chartOptions: {
            responsive: true,
            plugins: {
                legend: { position: 'top' },
                title: { display: true, text: 'Cumulative Song Plays Over Time' },
            },
            scales: {
                x: { title: { display: true, text: 'Date' } },
                y: { title: { display: true, text: 'Cumulative Count' }, beginAtZero: true },
            },
        },
    };

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-lg">Loading...</p>
            </div>
        );
    }

    if (!user || error === 'You are not authorized to manage songs for this profile.') {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-red-500 text-lg">{error || 'Unauthorized access'}</p>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
            <h1 className="retro-display retro-chrome text-3xl mb-6">Songs Manager</h1>

            {/* Upload, and the way across to the other half of managing your
                music. Releases links both ways now: the Releases page already
                had a Songs Manager button, and a song row that says a track is
                on "Night Signal" with no way to reach it is a dead end.

                The row itself always renders, so navigation does not disappear
                the moment the upload form is open. Only the primary action is
                conditional, and only it is the hot variant - a second bright
                button beside it would make a page-to-page link look like
                something that acts on this page. */}
            <div className="flex flex-wrap items-center gap-3 mb-8">
                {!showUploadForm && (
                    <button
                        onClick={() => setShowUploadForm(true)}
                        className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                    >
                        Upload New Song
                    </button>
                )}
                <Link
                    to={`/profile/${profileId}/releases`}
                    className="retro-btn py-2 px-4 text-xs"
                >
                    Releases
                </Link>
            </div>

            {/* Song Upload Section */}
            {showUploadForm && (
                <div className="retro-panel retro-cut border border-white/10 p-6 rounded-xl shadow-md mb-8 text-gray-100 max-w-3xl">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="retro-display text-base retro-glow-cyan">Upload a Song</h2>
                        <button
                            onClick={() => setShowUploadForm(false)}
                            className="text-primary-brand-300 hover:text-primary-brand-200 focus:outline-none"
                            aria-label="Close upload form"
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                    {error && <p className="text-red-400 text-sm mb-4" aria-live="polite">{error}</p>}
                    {uploadCompleted ? (
                        <div className="text-center space-y-4">
                            <p className="text-lg text-emerald-400">Song uploaded successfully!</p>
                            <button
                                onClick={handleUploadMore}
                                className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                            >
                                Upload More
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSongSubmit} className="space-y-6">
                            <div>
                                <label className="retro-label">Song Title</label>
                                <input
                                    type="text"
                                    name="title"
                                    value={songForm.title}
                                    onChange={handleSongInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="retro-label">Genres (up to 3, comma-separated)</label>
                                <div
                                    className="mt-1 w-full px-3 py-2 border border-white/10 rounded-md shadow-sm focus-within:ring-2 focus-within:ring-primary-brand-500 focus-within:border-primary-brand-500 flex flex-wrap items-center gap-1 min-h-[38px] bg-white/5"
                                >
                                    {songForm.genres.map((tag, index) => (
                                        <span
                                            key={index}
                                            className="retro-chip inline-flex items-center px-2 py-0.5 mr-1 my-1"
                                        >
                                            {tag}
                                            <button
                                                type="button"
                                                onClick={() => removeSongGenreTag(tag)}
                                                className="ml-1 text-cyan-300 hover:text-fuchsia-300 focus:outline-none"
                                                aria-label={`Remove ${tag} genre`}
                                            >
                                                <XMarkIcon className="w-4 h-4" />
                                            </button>
                                        </span>
                                    ))}
                                    <input
                                        type="text"
                                        name="genreInput"
                                        value={songForm.genreInput}
                                        onChange={handleSongInputChange}
                                        placeholder={songForm.genres.length === 0 ? "e.g., Rock, Drum 'n' Bass, Electronic" : ""}
                                            className="flex-1 outline-none border-none p-0 m-1 min-w-[100px] text-sm bg-transparent text-white placeholder:text-gray-500"
                                        ref={songGenreInputRef}
                                        autoComplete="off"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === 'Tab') {
                                                if (songForm.genreInput.trim()) {
                                                    e.preventDefault();
                                                    commitSongGenreInput();
                                                }
                                            }
                                        }}
                                        onBlur={commitSongGenreInput}
                                    />
                                </div>
                                {genreSuggestions(songForm.genreInput, songForm.genres).length > 0 && (
                                    <ul className="retro-panel retro-cut mt-2 p-1">
                                        {genreSuggestions(songForm.genreInput, songForm.genres).map((g) => (
                                            <li key={g.key}>
                                                <button
                                                    type="button"
                                                    onClick={() => applySongGenreSuggestion(g.label)}
                                                    className="retro-menu-item flex items-center justify-between gap-3"
                                                >
                                                    <span>&gt; {g.label}</span>
                                                    <span className="retro-mono text-base text-cyan-300/70 shrink-0">
                                                        {g.count} track{g.count === 1 ? '' : 's'}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                        <p className="retro-mono text-lg text-gray-400 mt-1">Press comma to add, or pick a suggestion (max 3).</p>
                            </div>
                            <div>
                                        <label className="retro-label">Description</label>
                                <textarea
                                    name="description"
                                    value={songForm.description}
                                    onChange={handleSongInputChange}
                                    rows="4"
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="retro-label">MP3 (320kbps) File</label>
                                <input
                                    type="file"
                                    name="mp3"
                                    onChange={handleSongFileChange}
                                    accept="audio/mp3"
                                    required
                                    ref={mp3InputRef}
                                    className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                                />
                            </div>
                            <div>
                                <label className="retro-label">Song Image (Optional, JPEG or PNG)</label>
                                <input
                                    type="file"
                                    name="image"
                                    onChange={handleSongFileChange}
                                    accept="image/jpeg,image/png"
                                    ref={imageInputRef}
                                    className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                                />
                            </div>
                            <SongPermissionFields
                                idPrefix="upload"
                                allowDownload={songForm.allowDownload}
                                allowAiTraining={songForm.allowAiTraining}
                                onChange={(patch) => setSongForm({ ...songForm, ...patch })}
                            />
                            <SongVisibilityField
                                idPrefix="upload"
                                hidden={songForm.hidden}
                                onChange={(patch) => setSongForm({ ...songForm, ...patch })}
                            />
                            {isUploading && (
                                <div className="relative w-full bg-white/10 rounded-full h-6">
                                    <div
                                        className="bg-primary-brand-500 h-6 rounded-full flex items-center justify-center text-sm text-white px-2"
                                        style={{ width: `${uploadProgress}%` }}
                                    >
                                        {uploadProgress > 10 && uploadProgress < 100 && `${uploadProgress}%`}
                                        {uploadProgress === 100 && 'Processing on server...'}
                                    </div>
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={isUploading}
                                className={`retro-btn retro-btn--hot w-full py-2 px-4 text-xs ${
                                    isUploading
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ' focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand'
                                }`}
                            >
                                {isUploading ? 'Uploading...' : 'Upload Song'}
                            </button>
                        </form>
                    )}
                </div>
            )}

            {/* ==================================================================
                Your Songs.

                The row reports; the Manage panel operates. That split is the
                whole redesign. It used to carry nine controls of two different
                kinds at one visual weight -- three that described the track and
                six that did something to it -- so twenty tracks put 180
                controls on screen and nothing told you which was which.

                Now a row shows what the track IS (and only when that is worth
                noticing) behind one labelled door. Nothing hides behind an
                anonymous ellipsis, which is the thing that was tried here
                before and rightly rejected: the group names are on screen.
                ================================================================== */}
            <div className="retro-panel retro-cut border border-white/10 p-6 rounded-xl shadow-md text-gray-100">
                <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
                    <h2 className="retro-display text-base retro-glow-cyan">Your Songs</h2>
                    {songs.length > 0 && (
                        <span className="retro-label mb-0">
                            {filteredSongs.length === songs.length
                                ? `${songs.length} track${songs.length === 1 ? '' : 's'}`
                                : `${filteredSongs.length} of ${songs.length} tracks`}
                        </span>
                    )}
                </div>

                {/* No sort, filter or search existed on this page at all. Now
                    that a track can be hidden and can belong to a release,
                    finding the one you mean matters more than reaching its
                    buttons did. */}
                {songs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <span className="retro-label mb-0 mr-1">Show</span>
                        {[
                            ['all', 'All'],
                            ['listed', 'Listed'],
                            ['hidden', 'Hidden'],
                            ['release', 'On a release'],
                            ['noart', 'Needs artwork'],
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={listFilter === key}
                                onClick={() => { setListFilter(key); closeManage(); }}
                                className={`retro-mono text-lg px-3 py-0.5 border transition-colors ${
                                    listFilter === key
                                        ? 'border-cyan-400 bg-cyan-400/15 text-cyan-100'
                                        : 'border-cyan-400/25 text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}

                {songs.length === 0 ? (
                    <p className="retro-mono text-xl text-gray-300">No songs uploaded yet.</p>
                ) : filteredSongs.length === 0 ? (
                    <p className="retro-mono text-xl text-gray-300">
                        No tracks match that filter.{' '}
                        <button type="button" onClick={() => setListFilter('all')} className="retro-link underline">
                            Show all
                        </button>
                    </p>
                ) : (
                    <div className="space-y-3">
                        {filteredSongs.map((song) => {
                            const isOpen = manageSongId === song.id;
                            const isSelected = selectedIds.has(song.id);
                            const versions = versionsBySong[song.id] || [];

                            return (
                                <div
                                    key={song.id}
                                    className={`p-4 bg-white/5 border rounded-xl shadow-sm transition-colors ${
                                        isSelected ? 'border-fuchsia-400/60' : 'border-white/10'
                                    }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelected(song.id)}
                                            aria-label={`Select ${song.title}`}
                                            className="mt-1.5 w-4 h-4 shrink-0 accent-fuchsia-500 cursor-pointer"
                                        />

                                        {song.image_url ? (
                                            <Link to={`/song/${song.id}`} className="shrink-0">
                                                <img
                                                    src={song.image_url}
                                                    alt=""
                                                    className="w-16 h-16 rounded-md object-cover"
                                                />
                                            </Link>
                                        ) : (
                                            <div className="w-16 h-16 shrink-0 rounded-md bg-white/10 flex items-center justify-center text-gray-400 text-sm">
                                                No Image
                                            </div>
                                        )}

                                        <div className="flex-1 min-w-0">
                                            <Link
                                                to={`/song/${song.id}`}
                                                className="text-lg font-semibold text-white hover:underline block truncate"
                                            >
                                                {song.title}
                                            </Link>

                                            {genreTags(song.genre).length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {genreTags(song.genre).slice(0, 3).map((tag) => (
                                                        <span key={tag} className="retro-chip inline-flex items-center px-2 py-0.5">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Facts about the track, separated by dots rather than
                                                pipes: the row already carries enough vertical bars. */}
                                            <div className="retro-mono text-lg text-gray-400 flex flex-wrap items-center gap-x-2 mt-1">
                                                <span>{Number(song.plays) || 0} play{Number(song.plays) === 1 ? '' : 's'}</span>
                                                <span aria-hidden="true">·</span>
                                                <span className="inline-flex items-center gap-1">
                                                    {typeof song.avg_rating === 'number' && song.avg_rating > 0 ? (
                                                        <>
                                                            {song.avg_rating.toFixed(1)}
                                                            <StarIcon className="w-4 h-4 text-white" />
                                                        </>
                                                    ) : (
                                                        'unrated'
                                                    )}
                                                </span>
                                            </div>

                                            <StatusChips song={song} />
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => (isOpen ? closeManage() : openManage(song))}
                                                aria-expanded={isOpen}
                                                className="retro-btn retro-btn--hot px-4 py-2 text-xs"
                                            >
                                                {isOpen ? 'Close' : 'Manage'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStatsSongId(song.id);
                                                    setStartDate('');
                                                    setEndDate('');
                                                    setShowStatsModal(true);
                                                }}
                                                className="retro-btn px-4 py-2 text-xs"
                                            >
                                                Stats
                                            </button>
                                        </div>
                                    </div>

                                    {isOpen && (
                                        <div className="mt-4 border-t border-cyan-400/20 pt-4">
                                            <div role="tablist" className="flex flex-wrap gap-1.5 mb-4">
                                                {[
                                                    ['details', 'Details', false],
                                                    ['perms', 'Permissions', false],
                                                    ['audio', 'Audio', false],
                                                    ['share', 'Sharing', false],
                                                    ['tools', 'Tools', false],
                                                    ['danger', 'Danger', true],
                                                ].map(([id, label, danger]) => (
                                                    <ManageTab
                                                        key={id}
                                                        id={id}
                                                        label={label}
                                                        danger={danger}
                                                        active={manageTab === id}
                                                        onSelect={(tab) => selectTab(song.id, tab)}
                                                    />
                                                ))}
                                            </div>

                                            {/* ---------------- Details ---------------- */}
                                            {manageTab === 'details' && (
                                                <form onSubmit={handleEditSubmit} className="space-y-6 max-w-3xl">
                                                    <div>
                                                        <label className="retro-label" htmlFor={`edit-title-${song.id}`}>Title</label>
                                                        <input
                                                            id={`edit-title-${song.id}`}
                                                            type="text"
                                                            name="title"
                                                            value={editFormData.title}
                                                            onChange={handleEditInputChange}
                                                            required
                                                            className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                                        />
                                                    </div>

                                                    <div>
                                                        <label className="retro-label">Genres (up to 3, comma-separated)</label>
                                                        <div className="mt-1 w-full px-3 py-2 border border-white/10 rounded-md shadow-sm focus-within:ring-2 focus-within:ring-primary-brand-500 focus-within:border-primary-brand-500 flex flex-wrap items-center gap-1 min-h-[38px] bg-white/5">
                                                            {editFormData.genres.map((tag, index) => (
                                                                <span
                                                                    key={index}
                                                                    className="retro-chip inline-flex items-center px-2 py-0.5 mr-1 my-1"
                                                                >
                                                                    {tag}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeEditGenreTag(tag)}
                                                                        className="ml-1 text-cyan-300 hover:text-fuchsia-300 focus:outline-none"
                                                                        aria-label={`Remove ${tag} genre`}
                                                                    >
                                                                        <XMarkIcon className="w-4 h-4" />
                                                                    </button>
                                                                </span>
                                                            ))}
                                                            <input
                                                                type="text"
                                                                name="genreInput"
                                                                value={editFormData.genreInput}
                                                                onChange={handleEditInputChange}
                                                                placeholder={editFormData.genres.length === 0 ? "e.g., Rock, Drum 'n' Bass, Electronic" : ''}
                                                                className="flex-1 outline-none border-none p-0 m-1 min-w-[100px] text-sm bg-transparent text-white placeholder:text-gray-500"
                                                                ref={editGenreInputRef}
                                                            />
                                                        </div>
                                                        <p className="mt-1 text-sm text-gray-400">Enter genres and press comma to add (max 3).</p>
                                                    </div>

                                                    <div>
                                                        <label className="retro-label" htmlFor={`edit-desc-${song.id}`}>Description</label>
                                                        <textarea
                                                            id={`edit-desc-${song.id}`}
                                                            name="description"
                                                            value={editFormData.description}
                                                            onChange={handleEditInputChange}
                                                            rows="4"
                                                            className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                                        />
                                                    </div>

                                                    {/* Detected on upload, and wrong often enough to be
                                                        worth correcting -- key especially, which cannot
                                                        tell a key from its relative major or minor. */}
                                                    <div>
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div>
                                                                <label className="retro-label" htmlFor={`edit-bpm-${song.id}`}>BPM</label>
                                                                <input
                                                                    id={`edit-bpm-${song.id}`}
                                                                    type="number"
                                                                    name="bpm"
                                                                    min="20"
                                                                    max="300"
                                                                    step="1"
                                                                    value={editFormData.bpm}
                                                                    onChange={handleEditInputChange}
                                                                    placeholder="Not set"
                                                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="retro-label" htmlFor={`edit-key-${song.id}`}>Key</label>
                                                                <select
                                                                    id={`edit-key-${song.id}`}
                                                                    name="musicalKey"
                                                                    value={editFormData.musicalKey}
                                                                    onChange={handleEditInputChange}
                                                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                                                >
                                                                    <option value="">Not set</option>
                                                                    {/* A stored value missing from the list would
                                                                        render as the first option and silently save
                                                                        the wrong key, so carry it through. */}
                                                                    {editFormData.musicalKey
                                                                        && !MUSICAL_KEYS.includes(editFormData.musicalKey) && (
                                                                        <option value={editFormData.musicalKey}>
                                                                            {editFormData.musicalKey}
                                                                        </option>
                                                                    )}
                                                                    {MUSICAL_KEYS.map((key) => (
                                                                        <option key={key} value={key}>{key}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <p className="mt-1 text-sm text-gray-400">
                                                            Detected automatically. Correct either one, or clear it to show nothing.
                                                        </p>
                                                    </div>

                                                    <div>
                                                        <label className="retro-label" htmlFor={`edit-image-${song.id}`}>
                                                            Artwork (optional, JPEG or PNG)
                                                        </label>
                                                        <input
                                                            id={`edit-image-${song.id}`}
                                                            type="file"
                                                            name="image"
                                                            onChange={handleEditFileChange}
                                                            accept="image/jpeg,image/png"
                                                            ref={editImageInputRef}
                                                            className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                                                        />
                                                        {/* Replacing the audio lives in Audio, where the
                                                            version it creates is listed. Two doors to the
                                                            same act, one of which quietly made a version,
                                                            is how you lose track of which mix is up. */}
                                                        <p className="mt-1 text-sm text-gray-400">
                                                            To put up a new mix, use the Audio tab. It keeps this song&rsquo;s
                                                            page, plays and comments.
                                                        </p>
                                                    </div>

                                                    <div className="flex space-x-4">
                                                        <button type="submit" className="retro-btn retro-btn--hot py-2 px-4 text-xs">
                                                            Save Changes
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={closeManage}
                                                            className="retro-btn py-2 px-4 text-xs"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </form>
                                            )}

                                            {/* ---------------- Permissions ---------------- */}
                                            {manageTab === 'perms' && (
                                                <form onSubmit={handleEditSubmit} className="space-y-4 max-w-3xl">
                                                    <SongPermissionFields
                                                        idPrefix={`edit-${song.id}`}
                                                        allowDownload={editFormData.allowDownload}
                                                        allowAiTraining={editFormData.allowAiTraining}
                                                        onChange={(patch) => setEditFormData({ ...editFormData, ...patch })}
                                                    />
                                                    <SongVisibilityField
                                                        idPrefix={`edit-${song.id}`}
                                                        hidden={editFormData.hidden}
                                                        onChange={(patch) => setEditFormData({ ...editFormData, ...patch })}
                                                    />
                                                    <button type="submit" className="retro-btn retro-btn--hot py-2 px-4 text-xs">
                                                        Save Permissions
                                                    </button>
                                                </form>
                                            )}

                                            {/* ---------------- Audio ---------------- */}
                                            {manageTab === 'audio' && (
                                                <div className="space-y-5 max-w-3xl">
                                                    <div>
                                                        <span className="retro-label">Version history</span>
                                                        {versions.length === 0 ? (
                                                            <p className="retro-mono text-lg text-gray-400">Loading...</p>
                                                        ) : (
                                                            <ul className="space-y-2">
                                                                {versions.map((version) => (
                                                                    <li
                                                                        key={version.version_no}
                                                                        className={`flex flex-wrap items-center gap-3 p-2 border bg-white/5 ${
                                                                            version.is_current ? 'border-fuchsia-400/50' : 'border-cyan-400/20'
                                                                        }`}
                                                                    >
                                                                        <span className={`retro-chip px-2 py-0.5 ${
                                                                            version.is_current ? 'border-green-400/45 text-green-300 bg-green-400/10' : ''
                                                                        }`}>
                                                                            v{version.version_no}
                                                                        </span>
                                                                        <span className="retro-mono text-lg flex-1 min-w-0 truncate">
                                                                            {version.label || (version.version_no === 1 ? 'Original' : 'Untitled version')}
                                                                            {version.notes ? ` — ${version.notes}` : ''}
                                                                        </span>
                                                                        <span className="retro-mono text-lg text-gray-500">
                                                                            {version.is_current ? 'playing now' : relativeDate(version.created_at)}
                                                                        </span>
                                                                        {!version.is_current && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRestoreVersion(song.id, version.version_no)}
                                                                                className="retro-btn px-3 py-1 text-[0.6rem]"
                                                                            >
                                                                                Restore
                                                                            </button>
                                                                        )}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                    </div>

                                                    <form onSubmit={(e) => handleVersionSubmit(e, song)} className="space-y-4 border-t border-cyan-400/20 pt-4">
                                                        <p className="retro-mono text-lg text-gray-400">
                                                            A new version keeps this song&rsquo;s page, its address, its play count and
                                                            every comment on it, and simply plays the new audio. The version you
                                                            replace is kept here and you can go back to it.
                                                        </p>
                                                        <div>
                                                            <label className="retro-label" htmlFor={`ver-mp3-${song.id}`}>New MP3</label>
                                                            <input
                                                                id={`ver-mp3-${song.id}`}
                                                                type="file"
                                                                accept="audio/mpeg"
                                                                onChange={(e) => handleVersionFileChange(e)}
                                                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                                                            />
                                                        </div>
                                                        <div className="grid gap-4 sm:grid-cols-2">
                                                            <div>
                                                                <label className="retro-label" htmlFor={`ver-label-${song.id}`}>Name it (optional)</label>
                                                                <input
                                                                    id={`ver-label-${song.id}`}
                                                                    type="text"
                                                                    maxLength={120}
                                                                    value={versionForm.label}
                                                                    onChange={(e) => setVersionForm({ ...versionForm, label: e.target.value })}
                                                                    placeholder="Remaster, Radio edit..."
                                                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white placeholder:text-gray-500 sm:text-sm"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="retro-label" htmlFor={`ver-notes-${song.id}`}>What changed (optional)</label>
                                                                <input
                                                                    id={`ver-notes-${song.id}`}
                                                                    type="text"
                                                                    maxLength={500}
                                                                    value={versionForm.notes}
                                                                    onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })}
                                                                    placeholder="Tightened the low end."
                                                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white placeholder:text-gray-500 sm:text-sm"
                                                                />
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="submit"
                                                            disabled={versionBusy || !versionForm.mp3}
                                                            className="retro-btn retro-btn--hot py-2 px-4 text-xs disabled:opacity-50"
                                                        >
                                                            {versionBusy ? 'Uploading...' : 'Upload new version'}
                                                        </button>
                                                    </form>
                                                </div>
                                            )}

                                            {/* ---------------- Sharing ---------------- */}
                                            {manageTab === 'share' && (
                                                <div className="space-y-4 max-w-3xl">
                                                    <p className="retro-mono text-lg text-gray-400">
                                                        A secret address for this track. Anyone holding it can play the
                                                        song even while it is hidden, without an account. It is not listed
                                                        anywhere and search engines are told to leave it alone.
                                                    </p>

                                                    {song.share_token ? (
                                                        <>
                                                            <div>
                                                                <label className="retro-label" htmlFor={`share-${song.id}`}>Link</label>
                                                                <input
                                                                    id={`share-${song.id}`}
                                                                    type="text"
                                                                    readOnly
                                                                    value={shareLinkUrl(song.share_token)}
                                                                    onFocus={(e) => e.target.select()}
                                                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white retro-mono text-lg"
                                                                />
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => copyShareLink(song)}
                                                                    className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                                                                >
                                                                    {shareLinkCopied ? 'Copied' : 'Copy link'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCreateShareLink(song, true)}
                                                                    disabled={shareLinkBusy}
                                                                    title="Makes a new link and stops every copy of the old one working"
                                                                    className="retro-btn py-2 px-4 text-xs disabled:opacity-50"
                                                                >
                                                                    Replace link
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRevokeShareLink(song)}
                                                                    disabled={shareLinkBusy}
                                                                    className="retro-btn retro-action--danger py-2 px-4 text-xs disabled:opacity-50"
                                                                >
                                                                    Turn off
                                                                </button>
                                                            </div>
                                                            <p className="retro-mono text-lg text-gray-500">
                                                                Replacing or turning off the link stops every copy you have already
                                                                sent from working. There is no way to cut off one person and not
                                                                the others.
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCreateShareLink(song, false)}
                                                            disabled={shareLinkBusy}
                                                            className="retro-btn retro-btn--hot py-2 px-4 text-xs disabled:opacity-50"
                                                        >
                                                            {shareLinkBusy ? 'Creating...' : 'Create private link'}
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            {/* ---------------- Tools ---------------- */}
                                            {manageTab === 'tools' && (
                                                <div className="space-y-4 max-w-3xl">
                                                    <p className="retro-mono text-lg text-gray-400">
                                                        Master this track and save the result as a new song. The track you
                                                        are looking at is left exactly as it is, because the feedback on it
                                                        belongs to the version people already heard.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSongToMaster(song)}
                                                        className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                                                    >
                                                        Auto Master
                                                    </button>
                                                </div>
                                            )}

                                            {/* ---------------- Danger ---------------- */}
                                            {manageTab === 'danger' && (
                                                <div className="max-w-3xl border border-red-500/40 bg-red-500/5 p-4 rounded-md space-y-3">
                                                    <p className="retro-mono text-lg text-gray-200">
                                                        Deleting &ldquo;{song.title}&rdquo; is permanent. It takes its{' '}
                                                        {Number(song.plays) || 0} play{Number(song.plays) === 1 ? '' : 's'},
                                                        its comments and its version history with it.
                                                    </p>
                                                    {/* Delete and Hide used to sit next to each other at
                                                        the same weight. Offering the reversible one right
                                                        here is what stops the wrong one being chosen. */}
                                                    <p className="retro-mono text-lg text-gray-400">
                                                        To take it off the site without losing any of that, hide it instead.
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSongToDelete(song.id);
                                                                setShowDeleteConfirm(true);
                                                            }}
                                                            className="retro-btn retro-action--danger py-2 px-4 text-xs"
                                                        >
                                                            Delete for good
                                                        </button>
                                                        {song.visibility !== 'private' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleVisibility(song)}
                                                                className="retro-btn py-2 px-4 text-xs"
                                                            >
                                                                Hide it instead
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Bulk actions.
                    Hiding ten old tracks used to be ten trips through ten rows.
                    AI-training consent is deliberately absent: it is given per
                    song and on purpose, and a control that swept a dozen tracks
                    into a training set as a side effect of a multi-select would
                    be a different act from an artist agreeing to each one. */}
                {selectedIds.size > 0 && (
                    <div className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-2 p-3 retro-panel retro-cut border border-fuchsia-400/50">
                        <span className="retro-label mb-0">
                            {selectedIds.size} selected
                        </span>
                        <button type="button" disabled={bulkBusy} onClick={() => bulkVisibility('private')} className="retro-btn px-3 py-1 text-[0.6rem] disabled:opacity-50">Hide</button>
                        <button type="button" disabled={bulkBusy} onClick={() => bulkVisibility('public')} className="retro-btn px-3 py-1 text-[0.6rem] disabled:opacity-50">Unhide</button>
                        <button type="button" disabled={bulkBusy} onClick={() => bulkDownload(true)} className="retro-btn px-3 py-1 text-[0.6rem] disabled:opacity-50">Allow downloads</button>
                        <button type="button" disabled={bulkBusy} onClick={() => bulkDownload(false)} className="retro-btn px-3 py-1 text-[0.6rem] disabled:opacity-50">Downloads off</button>
                        <button type="button" onClick={clearSelection} className="retro-btn px-3 py-1 text-[0.6rem] ml-auto">Clear</button>
                    </div>
                )}
            </div>
            {songToMaster && (
                <AutoMasterModal
                    song={songToMaster}
                    onClose={() => setSongToMaster(null)}
                    onSaved={handleMasteredSaved}
                    onSavedVersion={handleMasteredVersion}
                />
            )}

            {versionNotice && (
                <div className="retro-panel retro-cut fixed top-4 right-4 p-4 retro-layer-toast flex items-start gap-3 retro-mono text-lg max-w-md">
                    <span>{versionNotice}</span>
                    <button
                        onClick={() => setVersionNotice(null)}
                        aria-label="Dismiss"
                        className="text-white hover:text-gray-200 shrink-0"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>
            )}

            {featureNotice && (
                <div className="retro-panel retro-cut fixed top-4 right-4 p-4 retro-layer-toast flex items-center space-x-3 retro-mono text-lg">
                    <span>{featureNotice}</span>
                    <button
                        onClick={() => setFeatureNotice(null)}
                        aria-label="Dismiss"
                        className="text-white hover:text-gray-200"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>
            )}

            {masteredNotice && (
                <div className="retro-panel retro-cut fixed top-4 right-4 p-4 retro-layer-toast flex items-center space-x-3 retro-mono text-lg">
                    <span>Saved &ldquo;{masteredNotice.title}&rdquo; to your songs.</span>
                    <Link to={`/song/${masteredNotice.id}`} className="retro-link underline">
                        View
                    </Link>
                    <button
                        onClick={() => setMasteredNotice(null)}
                        aria-label="Dismiss"
                        className="text-white hover:text-gray-200"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay">
                    <div className="retro-panel retro-cut p-6 max-w-md w-full text-gray-100">
                        <h2 className="text-xl font-bold mb-4 text-white">Confirm Deletion</h2>
                        <p className="mb-6 text-gray-300">Are you sure you want to delete this song? This action cannot be undone.</p>
                        <div className="flex justify-end space-x-4">
                            <button
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setSongToDelete(null);
                                }}
                                className="py-2 px-4 bg-white/10 text-white font-semibold rounded-md hover:bg-white/15"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                className="py-2 px-4 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Modal */}
            {showStatsModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay">
                    <div className="bg-[#111827] border border-white/10 p-6 rounded-xl shadow-xl max-w-3xl w-full text-gray-100">
                        <h2 className="text-xl font-bold mb-4 text-white">Song Statistics</h2>
                        <div className="mb-4 flex space-x-4">
                            <div>
                                <label className="retro-label">Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="retro-label">End Date</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                />
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleDateFilter}
                                    className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                                >
                                    Apply Filter
                                </button>
                            </div>
                        </div>
                        <div className="mb-6">
                            <ErrorBoundary>
                                {chartDataAndOptions.chartData.labels.length === 0 ? (
                                    <div className="text-center text-gray-600">
                                        <p>No play data available for this song.</p>
                                        <p>Try adjusting the date range or check if plays are recorded.</p>
                                    </div>
                                ) : (
                                    <Line data={chartDataAndOptions.chartData} options={chartDataAndOptions.chartOptions} />
                                )}
                            </ErrorBoundary>
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={() => {
                                    setShowStatsModal(false);
                                    setStatsSongId(null);
                                    setStats({ plays: [] });
                                }}
                                className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-md hover:bg-gray-400"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};

export default SongsManager;