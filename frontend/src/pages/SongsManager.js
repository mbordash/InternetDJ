import React, { useEffect, useState, useContext, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { SpeakerWaveIcon, StarIcon, PencilIcon, TrashIcon, ChartBarIcon, XMarkIcon, ArrowDownTrayIcon, BoltIcon } from '@heroicons/react/24/solid';
import API_URL from '../utils/api';
import { MUSICAL_KEYS } from '../utils/musicalKeys';
import genreTags from '../utils/genreTags';
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
    const [songForm, setSongForm] = useState({
        title: '',
        description: '',
        genres: [],
        genreInput: '',
        mp3: null,
        image: null,
    });
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
    const editMp3InputRef = useRef(null);
    const editImageInputRef = useRef(null);
    const songGenreInputRef = useRef(null);
    // Existing genres, used to suggest what artists already use. This is what
    // actually stops new spelling variants appearing; typing something new is
    // still allowed.
    const [knownGenres, setKnownGenres] = useState([]);
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
            setSongForm({ title: '', description: '', genres: [], genreInput: '', mp3: null, image: null });
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
        setSongForm({ title: '', description: '', genres: [], genreInput: '', mp3: null, image: null });
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

        try {
            const response = await axios.put(`${API_URL}/music/${editSongId}`, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });
            setSongs(songs.map((song) =>
                song.id === editSongId ? { ...response.data.song, plays: Number(song.plays) || 0 } : song
            ));
            setEditSongId(null);
            setEditFormData(EMPTY_EDIT_FORM);
            setError(null);
            setFeatureNotice(
                editFormData.mp3
                    ? 'Saved. Tempo and key are being re-detected from the new audio.'
                    : 'Saved.'
            );
            if (editMp3InputRef.current) editMp3InputRef.current.value = '';
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

    const handleToggleDownload = async (song) => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to change download settings');
            return;
        }

        const nextValue = !song.allow_download;
        try {
            await axios.patch(
                `${API_URL}/music/${song.id}/allow-download`,
                { allow_download: nextValue },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setSongs((prevSongs) => prevSongs.map((s) =>
                s.id === song.id ? { ...s, allow_download: nextValue } : s
            ));
            setError(null);
        } catch (err) {
            setError(`Failed to update download setting: ${err.response?.data?.error || err.message}`);
        }
    };

    // A mastered track is saved as its own song rather than replacing the
    // original: reviews and ratings hang off the song row they were left on,
    // and a new master is meant to gather feedback of its own.
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
            <div className="container mx-auto px-4 py-8 max-w-4xl">
            <h1 className="retro-display retro-chrome text-3xl mb-6">Songs Manager</h1>

            {/* Upload Song Button */}
            {!showUploadForm && (
                <div className="mb-8">
                        <button
                        onClick={() => setShowUploadForm(true)}
                            className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-full shadow-sm  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
                    >
                        Upload New Song
                    </button>
                </div>
            )}

            {/* Song Upload Section */}
            {showUploadForm && (
                <div className="retro-panel retro-cut border border-white/10 p-6 rounded-xl shadow-md mb-8 text-gray-100">
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

            {/* Songs List */}
            <div className="retro-panel retro-cut border border-white/10 p-6 rounded-xl shadow-md text-gray-100">
                <h2 className="retro-display text-base retro-glow-cyan mb-4">Your Songs</h2>
                {songs.length === 0 ? (
                    <p className="retro-mono text-xl text-gray-300">No songs uploaded yet.</p>
                ) : (
                    <div className="space-y-6">
                        {songs.map((song) => (
                            <div key={song.id} className="p-4 bg-white/5 border border-white/10 rounded-xl shadow-sm">
                                <div className="flex items-center space-x-4">
                                    {song.image_url ? (
                                        <Link to={`/song/${song.id}`}>
                                            <img
                                                src={song.image_url}
                                                alt={song.title}
                                                className="w-16 h-16 rounded-md object-cover"
                                            />
                                        </Link>
                                    ) : (
                                        <div className="w-16 h-16 rounded-md bg-white/10 flex items-center justify-center text-gray-400 text-sm">
                                            No Image
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <Link
                                            to={`/song/${song.id}`}
                                            className="text-lg font-semibold text-white hover:underline"
                                        >
                                            {song.title}
                                        </Link>
                                        <div className="text-sm text-gray-300 flex items-center gap-x-2">
                                            {genreTags(song.genre).length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {genreTags(song.genre).slice(0, 3).map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="retro-chip inline-flex items-center px-2 py-0.5"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span>No genres</span>
                                            )}
                                            <span> | </span>
                                            <span className="inline-flex items-center">
                                                {Number(song.plays) || 0}
                                                <SpeakerWaveIcon
                                                    className={`w-4 h-4 ml-1 ${Number(song.plays) > 0 ? 'text-white' : 'text-gray-500'}`}
                                                />
                                            </span>
                                            <span> | </span>
                                            <span className="inline-flex items-center">
                                                {typeof song.avg_rating === 'number' && song.avg_rating > 0 ? (
                                                    <>
                                                        {song.avg_rating.toFixed(1)}
                                                        <StarIcon className="w-4 h-4 text-white ml-1" />
                                                    </>
                                                ) : (
                                                    <>
                                                        N/A
                                                        <StarIcon className="w-4 h-4 text-gray-500 ml-1" />
                                                    </>
                                                )}
                                            </span>
                                            {song.allow_download && (
                                                <>
                                                    <span> | </span>
                                                    <span className="inline-flex items-center text-primary-brand-300">
                                                        Downloadable
                                                        <ArrowDownTrayIcon className="w-4 h-4 ml-1" />
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => handleToggleDownload(song)}
                                            className={`p-2 ${song.allow_download ? 'text-primary-brand-300 hover:text-primary-brand-200' : 'text-gray-500 hover:text-gray-400'}`}
                                            title={song.allow_download ? 'Public downloads enabled — click to disable' : 'Public downloads disabled — click to enable'}
                                            aria-pressed={Boolean(song.allow_download)}
                                        >
                                            <ArrowDownTrayIcon className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => setSongToMaster(song)}
                                            className="p-2 text-cyan-400 hover:text-cyan-300"
                                            title="Auto Master — save a mastered copy as a new song"
                                        >
                                            <BoltIcon className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditSongId(song.id);
                                                setEditFormData({
                                                    ...EMPTY_EDIT_FORM,
                                                    title: song.title,
                                                    description: song.description || '',
                                                    genres: genreTags(song.genre).slice(0, 3),
                                                    // Numbers arrive as strings from a form; keep them
                                                    // that way so an empty field means "clear it".
                                                    bpm: song.bpm != null ? String(Math.round(Number(song.bpm))) : '',
                                                    musicalKey: song.musical_key || '',
                                                });
                                            }}
                                            className="p-2 text-blue-600 hover:text-blue-700"
                                            title="Edit Song"
                                        >
                                            <PencilIcon className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSongToDelete(song.id);
                                                setShowDeleteConfirm(true);
                                            }}
                                            className="p-2 text-red-600 hover:text-red-700"
                                            title="Delete Song"
                                        >
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setStatsSongId(song.id);
                                                setStartDate('');
                                                setEndDate('');
                                                setShowStatsModal(true);
                                            }}
                                            className="p-2 text-green-600 hover:text-green-700"
                                            title="View Stats"
                                        >
                                            <ChartBarIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                {editSongId === song.id && (
                                    <form onSubmit={handleEditSubmit} className="mt-4 space-y-6">
                                        <div>
                                                <label className="retro-label">Title</label>
                                            <input
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
                                            <div
                                                className="mt-1 w-full px-3 py-2 border border-white/10 rounded-md shadow-sm focus-within:ring-2 focus-within:ring-primary-brand-500 focus-within:border-primary-brand-500 flex flex-wrap items-center gap-1 min-h-[38px] bg-white/5"
                                            >
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
                                                    placeholder={editFormData.genres.length === 0 ? "e.g., Rock, Drum 'n' Bass, Electronic" : ""}
                                                    className="flex-1 outline-none border-none p-0 m-1 min-w-[100px] text-sm bg-transparent text-white placeholder:text-gray-500"
                                                    ref={editGenreInputRef}
                                                />
                                            </div>
                                            <p className="mt-1 text-sm text-gray-400">Enter genres and press comma to add (max 3).</p>
                                        </div>
                                        <div>
                                            <label className="retro-label">Description</label>
                                            <textarea
                                                name="description"
                                                value={editFormData.description}
                                                onChange={handleEditInputChange}
                                                rows="4"
                                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm"
                                            />
                                        </div>
                                        {/* Detected on upload, and wrong often
                                            enough to be worth correcting -- key
                                            especially, which cannot tell a key
                                            from its relative major or minor. */}
                                        <div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="retro-label" htmlFor={`edit-bpm-${editSongId}`}>BPM</label>
                                                    <input
                                                        id={`edit-bpm-${editSongId}`}
                                                        type="number"
                                                        name="bpm"
                                                        min="20"
                                                        max="300"
                                                        step="1"
                                                        value={editFormData.bpm}
                                                        onChange={handleEditInputChange}
                                                        disabled={!!editFormData.mp3}
                                                        placeholder="Not set"
                                                        className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm disabled:opacity-50"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="retro-label" htmlFor={`edit-key-${editSongId}`}>Key</label>
                                                    <select
                                                        id={`edit-key-${editSongId}`}
                                                        name="musicalKey"
                                                        value={editFormData.musicalKey}
                                                        onChange={handleEditInputChange}
                                                        disabled={!!editFormData.mp3}
                                                        className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-primary-brand-500 focus:border-primary-brand-500 sm:text-sm disabled:opacity-50"
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
                                                        {MUSICAL_KEYS.map(key => (
                                                            <option key={key} value={key}>{key}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            <p className="mt-1 text-sm text-gray-400">
                                                {editFormData.mp3
                                                    ? 'Both will be re-detected from the new audio file.'
                                                    : 'Detected automatically. Correct either one, or clear it to show nothing.'}
                                            </p>
                                        </div>
                                        <div>
                                            <label className="retro-label">MP3 File (Optional)</label>
                                            <input
                                                type="file"
                                                name="mp3"
                                                onChange={handleEditFileChange}
                                                accept="audio/mp3"
                                                ref={editMp3InputRef}
                                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                                            />
                                        </div>
                                        <div>
                                            <label className="retro-label">Song Image (Optional, JPEG or PNG)</label>
                                            <input
                                                type="file"
                                                name="image"
                                                onChange={handleEditFileChange}
                                                accept="image/jpeg,image/png"
                                                ref={editImageInputRef}
                                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/15"
                                            />
                                        </div>
                                        <div className="flex space-x-4">
                                            <button
                                                type="submit"
                                                className="retro-btn retro-btn--hot py-2 px-4 text-xs"
                                            >
                                                Save Changes
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditSongId(null);
                                                    setEditFormData(EMPTY_EDIT_FORM);
                                                    if (editMp3InputRef.current) editMp3InputRef.current.value = '';
                                                    if (editImageInputRef.current) editImageInputRef.current.value = '';
                                                }}
                                                className="py-2 px-4 bg-white/10 text-white font-semibold rounded-full shadow-sm hover:bg-white/15"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {songToMaster && (
                <AutoMasterModal
                    song={songToMaster}
                    onClose={() => setSongToMaster(null)}
                    onSaved={handleMasteredSaved}
                />
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