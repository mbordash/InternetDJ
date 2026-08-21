import React, { useState, useEffect, useContext, useRef } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import { TrashIcon, PlayIcon, PlusIcon, ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { Link } from 'react-router-dom';

// Reusable ConfirmModal Component
const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    const modalRef = useRef(null);
    const firstFocusableRef = useRef(null);

    // Focus trapping
    useEffect(() => {
        if (isOpen && modalRef.current) {
            const focusableElements = modalRef.current.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const first = focusableElements[0];
            const last = focusableElements[focusableElements.length - 1];
            firstFocusableRef.current = first;

            const trapFocus = (e) => {
                if (e.key === 'Tab') {
                    if (e.shiftKey) {
                        if (document.activeElement === first) {
                            e.preventDefault();
                            last.focus();
                        }
                    } else {
                        if (document.activeElement === last) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                }
            };

            first?.focus();
            document.addEventListener('keydown', trapFocus);
            return () => document.removeEventListener('keydown', trapFocus);
        }
    }, [isOpen]);

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
            onClick={onClose}
        >
            <div
                ref={modalRef}
                className="retro-panel retro-cut p-6 max-w-md w-full mx-4"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-labelledby="modal-title"
                aria-modal="true"
            >
                <div className="flex justify-between items-center mb-4">
                    <h3 id="modal-title" className="retro-display text-base retro-glow-cyan">
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="retro-icon-btn p-1"
                        aria-label="Close modal"
                    >
                        <XMarkIcon className="w-5 h-5 text-white" />
                    </button>
                </div>
                <p className="retro-mono text-xl text-gray-300 mb-6">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button
                        onClick={onClose}
                        className="retro-btn px-4 py-2 text-xs"
                        aria-label="Cancel"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                        aria-label="Confirm deletion"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

const Playlists = () => {
    const { user, loading: authLoading } = useContext(AuthContext);
    const { playPlaylist } = useContext(AudioPlayerContext);
    const [playlists, setPlaylists] = useState([]);
    const [expandedPlaylists, setExpandedPlaylists] = useState({});
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalConfig, setModalConfig] = useState({
        title: '',
        message: '',
        onConfirm: () => {},
    });

    useEffect(() => {
        if (authLoading) {
            console.log('[DEBUG] Playlists: Waiting for authLoading');
            return;
        }
        if (!user) {
            console.log('[DEBUG] Playlists: No user found');
            setError('You must be logged in to view playlists');
            setLoading(false);
            return;
        }

        const fetchPlaylists = async () => {
            try {
                console.log('[DEBUG] Fetching playlists from:', `${API_URL}/playlists`);
                const response = await axios.get(`${API_URL}/playlists`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                });
                console.log('[DEBUG] Playlists response:', response.data);
                setPlaylists(response.data || []);
                setLoading(false);
            } catch (err) {
                console.error('[ERROR] Failed to fetch playlists:', err.response?.data || err.message);
                setError('Failed to load playlists: ' + (err.response?.data?.error || err.message));
                setLoading(false);
            }
        };

        fetchPlaylists();
    }, [user, authLoading]);

    const fetchPlaylistSongs = async (playlistId) => {
        try {
            console.log('[DEBUG] Fetching songs for playlist:', playlistId);
            const response = await axios.get(`${API_URL}/playlists/${playlistId}/songs`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            console.log('[DEBUG] fetchPlaylistSongs response:', response.data);
            const songs = response.data?.songs || [];
            setPlaylists(playlists.map(p =>
                p.id === playlistId ? { ...p, songs } : p
            ));
        } catch (err) {
            console.error('[ERROR] Failed to fetch playlist songs:', err.response?.data || err.message);
            setError('Failed to load playlist songs: ' + (err.response?.data?.error || err.message));
        }
    };

    const togglePlaylist = (playlistId) => {
        setExpandedPlaylists(prev => {
            const isExpanded = !!prev[playlistId];
            if (!isExpanded) {
                fetchPlaylistSongs(playlistId);
            }
            return { ...prev, [playlistId]: !isExpanded };
        });
    };

    const handleCreatePlaylist = async (e) => {
        e.preventDefault();
        if (!newPlaylistName.trim()) {
            setError('Playlist name is required');
            return;
        }

        try {
            console.log('[DEBUG] Creating playlist:', newPlaylistName);
            const response = await axios.post(
                `${API_URL}/playlists`,
                { name: newPlaylistName.trim() },
                { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
            );
            setPlaylists([response.data.playlist, ...playlists]);
            setNewPlaylistName('');
            setError(null);
        } catch (err) {
            console.error('[ERROR] Failed to create playlist:', err.response?.data || err.message);
            setError('Failed to create playlist: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleDeletePlaylist = async (playlistId) => {
        // Find playlist name for modal message
        const playlist = playlists.find(p => p.id === playlistId);
        setModalConfig({
            title: 'Delete Playlist',
            message: `Are you sure you want to delete the playlist "${playlist?.name}"? This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    console.log('[DEBUG] Deleting playlist:', playlistId);
                    await axios.delete(`${API_URL}/playlists/${playlistId}`, {
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                    });
                    setPlaylists(playlists.filter((p) => p.id !== playlistId));
                    setExpandedPlaylists(prev => {
                        const newExpanded = { ...prev };
                        delete newExpanded[playlistId];
                        return newExpanded;
                    });
                    setError(null);
                } catch (err) {
                    console.error('[ERROR] Failed to delete playlist:', err.response?.data || err.message);
                    setError('Failed to delete playlist: ' + (err.response?.data?.error || err.message));
                } finally {
                    setIsModalOpen(false);
                }
            },
        });
        setIsModalOpen(true);
    };

    const handleRemoveSong = async (playlistId, songId) => {
        // Find song title for modal message
        const playlist = playlists.find(p => p.id === playlistId);
        const song = playlist?.songs?.find(s => s.id === songId);
        setModalConfig({
            title: 'Remove Song',
            message: `Are you sure you want to remove "${song?.title}" from the playlist "${playlist?.name}"?`,
            onConfirm: async () => {
                try {
                    console.log('[DEBUG] Removing song:', songId, 'from playlist:', playlistId);
                    await axios.delete(`${API_URL}/playlists/${playlistId}/songs/${songId}`, {
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                    });
                    setPlaylists(
                        playlists.map((p) =>
                            p.id === playlistId
                                ? {
                                    ...p,
                                    songs: p.songs ? p.songs.filter((s) => s.id !== songId) : [],
                                    song_count: p.song_count - 1,
                                }
                                : p
                        )
                    );
                    setError(null);
                } catch (err) {
                    console.error('[ERROR] Failed to remove song:', err.response?.data || err.message);
                    setError('Failed to remove song: ' + (err.response?.data?.error || err.message));
                } finally {
                    setIsModalOpen(false);
                }
            },
        });
        setIsModalOpen(true);
    };

    const handlePlayPlaylist = async (playlistId) => {
        console.log('[DEBUG] handlePlayPlaylist called with playlistId:', playlistId);
        try {
            console.log('[DEBUG] Fetching songs for playlist:', playlistId);
            const response = await axios.get(`${API_URL}/playlists/${playlistId}/songs`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            });
            console.log('[DEBUG] API response:', response.data);
            const songs = response.data?.songs || [];
            if (songs.length > 0) {
                playPlaylist(songs);
            } else {
                setError('This playlist is empty');
            }
        } catch (err) {
            console.error('[ERROR] Failed to fetch playlist songs:', err.response?.data || err.message);
            setError('Failed to play playlist: ' + (err.response?.data?.error || err.message));
        }
    };

    if (authLoading) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <p className="retro-mono text-2xl text-cyan-200">&gt; loading&hellip;</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <div className="retro-panel retro-cut px-8 py-10 text-center">
                    <div className="retro-eyebrow mb-3">// Locked //</div>
                    <p className="retro-mono text-2xl text-gray-300">
                        &gt; Please <Link to="/login" className="retro-link">log in</Link> to manage your playlists.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <div className="container mx-auto px-4 py-8">
            <header className="mb-6">
                <div className="retro-eyebrow mb-3">// Your Crates //</div>
                <h1 className="retro-display retro-chrome text-3xl sm:text-4xl">Playlists</h1>
                <div className="retro-rule mt-4" />
            </header>
            {error && <p className="retro-mono text-xl text-fuchsia-400 mb-4">{error}</p>}
            {loading ? (
                <p className="retro-mono text-xl text-cyan-200">&gt; loading playlists&hellip;</p>
            ) : (
                <>
                    <form onSubmit={handleCreatePlaylist} className="mb-8 flex space-x-2">
                        <input
                            type="text"
                            value={newPlaylistName}
                            onChange={(e) => setNewPlaylistName(e.target.value)}
                            placeholder="New playlist name"
                            className="retro-field flex-1"
                            aria-label="New playlist name"
                        />
                        <button
                            type="submit"
                            className="retro-btn retro-btn--hot px-4 py-2 text-xs"
                            aria-label="Create playlist"
                        >
                            <PlusIcon className="w-5 h-5 mr-2" />
                            Create
                        </button>
                    </form>
                    {playlists.length === 0 ? (
                        <p className="retro-mono text-xl text-gray-400">&gt; no playlists yet. create one above.</p>
                    ) : (
                        <div className="space-y-6">
                            {playlists.map((playlist) => (
                                <div key={playlist.id} className="retro-panel retro-cut p-6">
                                    <div className="flex justify-between items-center mb-4">
                                        <div className="flex items-center space-x-4">
                                            <button
                                                onClick={() => togglePlaylist(playlist.id)}
                                                className="focus:outline-none"
                                                aria-label={expandedPlaylists[playlist.id] ? `Collapse playlist ${playlist.name}` : `Expand playlist ${playlist.name}`}
                                            >
                                                {expandedPlaylists[playlist.id] ? (
                                                    <ChevronUpIcon className="w-6 h-6 text-gray-400" />
                                                ) : (
                                                    <ChevronDownIcon className="w-6 h-6 text-gray-400" />
                                                )}
                                            </button>
                                            <h2 className="retro-display text-base retro-glow-cyan">{playlist.name}</h2>
                                        </div>
                                        <div className="flex space-x-4">
                                            <button
                                                onClick={() => handlePlayPlaylist(playlist.id)}
                                                className="retro-action p-2"
                                                aria-label={`Play playlist ${playlist.name}`}
                                            >
                                                <PlayIcon className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleDeletePlaylist(playlist.id)}
                                                className="p-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                aria-label={`Delete playlist ${playlist.name}`}
                                            >
                                                <TrashIcon className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-gray-400 mb-4">{playlist.song_count} song{playlist.song_count !== 1 ? 's' : ''}</p>
                                    {expandedPlaylists[playlist.id] && (
                                        <>
                                            {playlist.songs ? (
                                                playlist.songs.length > 0 ? (
                                                    <ul className="space-y-2">
                                                        {playlist.songs.map((song) => (
                                                            <li key={song.id} className="flex justify-between items-center">
                                                                <div>
                                                                    <Link
                                                                        to={`/song/${song.id}`}
                                                                        className="retro-link retro-mono text-xl"
                                                                    >
                                                                        {song.title}
                                                                    </Link>
                                                                    <span className="text-gray-400 ml-2">by {song.profile_name || 'Unknown'}</span>
                                                                </div>
                                                                <button
                                                                    onClick={() => handleRemoveSong(playlist.id, song.id)}
                                                                    className="p-1 text-red-400 hover:text-red-500 focus:outline-none"
                                                                    aria-label={`Remove ${song.title} from playlist`}
                                                                >
                                                                    <TrashIcon className="w-5 h-5" />
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="retro-mono text-xl text-gray-400">No songs in this playlist.</p>
                                                )
                                            ) : (
                                                <p className="retro-mono text-xl text-gray-400">Loading songs...</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
            <ConfirmModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
            />
            </div>
        </div>
    );
};

export default Playlists;