import { Helmet } from 'react-helmet-async';
import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AudioPlayer from '../components/AudioPlayer';
import { SpeakerWaveIcon, PlusIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { HeartIcon as HeartIconOutline } from '@heroicons/react/24/outline';
import sanitizeHtml from 'sanitize-html';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';

// Feedback criteria
const feedbackCriteria = [
    'Melody', 'Harmony', 'Structure/Form', 'Lyrics', 'Vocal Technique',
    'Emotional Expression', 'Vocal Tone/Timbre', 'Instrumentation', 'Arrangement',
    'Mixing', 'Mastering', 'Sound Design', 'Originality', 'Innovation',
    'Emotional Impact', 'Audience Connection', 'Genre Fit', 'Marketability',
    'Consistency', 'Flow'
];

const Song = () => {
    const { songId } = useParams();
    const { user } = useContext(AuthContext);
    const isAuthenticated = !!user;
    const [song, setSong] = useState(null);
    const [isLoadingSong, setIsLoadingSong] = useState(true);
    const [reviews, setReviews] = useState([]);
    const [error, setError] = useState(null);
    const [reviewForm, setReviewForm] = useState({ review: '', feedback: {} });
    const [reviewError, setReviewError] = useState(null);
    const [showReviewDeleteConfirm, setShowReviewDeleteConfirm] = useState(false);
    const [reviewToDelete, setReviewToDelete] = useState(null);
    const [showPlaylistModal, setShowPlaylistModal] = useState(false);
    const [playlists, setPlaylists] = useState([]);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [playlistError, setPlaylistError] = useState(null);
    const [isLiked, setIsLiked] = useState(false);
    const [likeError, setLikeError] = useState(null);
    const [isFollowing, setIsFollowing] = useState(false);
    const [followError, setFollowError] = useState(null);
    const [otherSongs, setOtherSongs] = useState([]);
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [showFeedbackResultsModal, setShowFeedbackResultsModal] = useState(false);
    const [selectedFeedback, setSelectedFeedback] = useState(null);

    // Initialize feedback state
    const initialFeedback = feedbackCriteria.reduce((acc, criterion) => {
        acc[criterion] = 'Good'; // Default to 'Good'
        return acc;
    }, {});
    useEffect(() => {
        setReviewForm(prev => ({ ...prev, feedback: initialFeedback }));
    }, []);

    const audioPlayerProps = useMemo(
        () => ({
            songId,
            s3Url: song?.mp3_url || '',
            isOwner: user && song?.user_id && user.id === song.user_id,
        }),
        [songId, song?.mp3_url, song?.user_id, user?.id]
    );

    useEffect(() => {
        const fetchSong = async () => {
            try {
                const response = await axios.get(`${API_URL}/music/${songId}`);
                setSong(response.data.song);
                setError(null);
            } catch (err) {
                console.error('Error fetching song:', err);
                setError('Failed to load song: ' + (err.response?.data?.error || err.message));
            } finally {
                setIsLoadingSong(false);
            }
        };

        const fetchReviews = async () => {
            try {
                const response = await axios.get(`${API_URL}/reviews/${songId}`);
                setReviews(response.data || []);
            } catch (err) {
                setReviewError('Failed to load reviews: ' + (err.response?.data?.error || err.message));
            }
        };

        const fetchPlaylists = async () => {
            if (isAuthenticated) {
                try {
                    const response = await axios.get(`${API_URL}/playlists`, {
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                    });
                    setPlaylists(response.data || []);
                } catch (err) {
                    setPlaylistError('Failed to load playlists: ' + (err.response?.data?.error || err.message));
                }
            }
        };

        const checkIfLiked = async () => {
            if (isAuthenticated) {
                try {
                    const response = await axios.get(`${API_URL}/playlists`, {
                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                    });
                    const likesPlaylist = response.data.find(pl => pl.name.toLowerCase() === 'likes');
                    if (likesPlaylist) {
                        const songsResponse = await axios.get(`${API_URL}/playlists/${likesPlaylist.id}/songs`, {
                            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                        });
                        const isSongLiked = songsResponse.data.songs.some(s => s.id === Number(songId));
                        setIsLiked(isSongLiked);
                    }
                } catch (err) {
                    console.error('Failed to check like status:', err);
                }
            }
        };

        const fetchFollowStatus = async () => {
            if (isAuthenticated && song?.profile_id && user?.profile_id !== song.profile_id) {
                try {
                    const token = localStorage.getItem('token');
                    const followResponse = await axios.get(`${API_URL}/profile/${song.profile_id}/follow-status`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    setIsFollowing(followResponse.data.isFollowing);
                } catch (err) {
                    setFollowError(`Failed to load follow status: ${err.response?.data?.error || err.message}`);
                }
            }
        };

        const fetchOtherSongs = async () => {
            if (song?.profile_id) {
                try {
                    const response = await axios.get(`${API_URL}/profile/${song.profile_id}`);
                    const songs = response.data.songs || [];
                    const shuffledSongs = songs.filter(s => s.id !== Number(songId)).sort(() => Math.random() - 0.5).slice(0, 5);
                    setOtherSongs(shuffledSongs);
                } catch (err) {
                    console.error('Failed to fetch other songs:', err);
                }
            }
        };

        setIsLoadingSong(true);
        fetchSong();
        fetchReviews();
        fetchPlaylists();
        checkIfLiked();
        fetchFollowStatus();
        fetchOtherSongs();
    }, [songId, isAuthenticated, song?.profile_id, user?.profile_id]);

    const handleLikeSong = async () => {
        if (!isAuthenticated) {
            setLikeError('You must be logged in to like a song');
            return;
        }

        const token = localStorage.getItem('token');
        try {
            let likesPlaylist = playlists.find(pl => pl.name.toLowerCase() === 'likes');

            if (!likesPlaylist) {
                const response = await axios.post(
                    `${API_URL}/playlists`,
                    { name: 'Likes' },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                likesPlaylist = response.data.playlist;
                setPlaylists([likesPlaylist, ...playlists]);
            }

            const songsResponse = await axios.get(`${API_URL}/playlists/${likesPlaylist.id}/songs`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const isSongAlreadyLiked = songsResponse.data.songs.some(s => s.id === Number(songId));

            if (isSongAlreadyLiked) {
                await axios.delete(`${API_URL}/playlists/${likesPlaylist.id}/songs/${songId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setIsLiked(false);
                setSong(prev => ({ ...prev, likes_count: (prev.likes_count || 0) - 1 }));
                setOtherSongs(prev => prev.map(s => s.id === Number(songId) ? { ...s, likes_count: (s.likes_count || 0) - 1 } : s));
                setPlaylists(playlists.map(pl =>
                    pl.id === likesPlaylist.id ? { ...pl, song_count: pl.song_count - 1 } : pl
                ));
            } else {
                await axios.post(
                    `${API_URL}/playlists/${likesPlaylist.id}/songs`,
                    { songId: Number(songId) },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                setIsLiked(true);
                setSong(prev => ({ ...prev, likes_count: (prev.likes_count || 0) + 1 }));
                setOtherSongs(prev => prev.map(s => s.id === Number(songId) ? { ...s, likes_count: (s.likes_count || 0) + 1 } : s));
                setPlaylists(playlists.map(pl =>
                    pl.id === likesPlaylist.id ? { ...pl, song_count: pl.song_count + 1 } : pl
                ));
            }
            setLikeError(null);
        } catch (err) {
            setLikeError('Failed to like/unlike song: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleFollowToggle = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setFollowError('You must be logged in to follow/unfollow');
            return;
        }

        try {
            if (isFollowing) {
                await axios.delete(`${API_URL}/profile/${song.profile_id}/follow`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setIsFollowing(false);
            } else {
                await axios.post(`${API_URL}/profile/${song.profile_id}/follow`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setIsFollowing(true);
            }
            setFollowError(null);
        } catch (err) {
            setFollowError(`Failed to ${isFollowing ? 'unfollow' : 'follow'} artist: ${err.response?.data?.error || err.message}`);
        }
    };

    const navigate = useNavigate();

    const handleSongNavigation = (newSongId) => {
        navigate(`/song/${newSongId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleReviewInputChange = (e) => {
        const { name, value } = e.target;
        setReviewForm(prev => ({ ...prev, [name]: value }));
    };

    const handleFeedbackChange = (criterion, value) => {
        setReviewForm(prev => ({
            ...prev,
            feedback: { ...prev.feedback, [criterion]: value }
        }));
    };

    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            setReviewError('You must be logged in to submit a review');
            return;
        }

        try {
            const response = await axios.post(
                `${API_URL}/reviews`,
                {
                    song_id: Number(songId),
                    review: reviewForm.review,
                    feedback: reviewForm.feedback,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setReviews([response.data.review, ...reviews]);
            setReviewForm({ review: '', feedback: initialFeedback });
            setShowFeedbackModal(false);
            setReviewError(null);
        } catch (err) {
            setReviewError('Failed to submit review: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleDeleteReview = async (reviewId) => {
        setReviewToDelete(reviewId);
        setShowReviewDeleteConfirm(true);
    };

    const confirmDeleteReview = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setReviewError('You must be logged in to delete a review');
            setShowReviewDeleteConfirm(false);
            return;
        }

        try {
            await axios.delete(`${API_URL}/reviews/${reviewToDelete}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setReviews(reviews.filter((review) => review.id !== reviewToDelete));
            setReviewError(null);
        } catch (err) {
            setReviewError('Failed to delete review: ' + (err.response?.data?.error || err.message));
        } finally {
            setShowReviewDeleteConfirm(false);
            setReviewToDelete(null);
        }
    };

    const handleAddToPlaylist = async (playlistId) => {
        const token = localStorage.getItem('token');
        if (!token) {
            setPlaylistError('You must be logged in to add to a playlist');
            return;
        }

        try {
            await axios.post(
                `${API_URL}/playlists/${playlistId}/songs`,
                { songId: Number(songId) },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setPlaylists(playlists.map(pl =>
                pl.id === playlistId ? { ...pl, song_count: pl.song_count + 1 } : pl
            ));
            setShowPlaylistModal(false);
            setPlaylistError(null);
        } catch (err) {
            setPlaylistError('Failed to add song to playlist: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleCreatePlaylist = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            setPlaylistError('You must be logged in to create a playlist');
            return;
        }
        if (!newPlaylistName.trim()) {
            setPlaylistError('Playlist name is required');
            return;
        }

        try {
            const response = await axios.post(
                `${API_URL}/playlists`,
                { name: newPlaylistName.trim() },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const newPlaylist = response.data.playlist;
            setPlaylists([newPlaylist, ...playlists]);
            await handleAddToPlaylist(newPlaylist.id);
            setNewPlaylistName('');
            setPlaylistError(null);
        } catch (err) {
            setPlaylistError('Failed to create playlist: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleViewFeedback = (feedback) => {
        setSelectedFeedback(feedback);
        setShowFeedbackResultsModal(true);
    };

    const backgroundStyle = song?.background
        ? song.background.startsWith('http')
            ? { backgroundImage: `url(${song.background})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#f0f0f0' }
            : song.background
        : 'bg-default';

    const baseUrl = SITE_URL;
    const cleanDescription = song?.description
        ? sanitizeHtml(song.description, { allowedTags: [], allowedAttributes: {} })
        : 'Listen to this amazing song on InternetDJ.';

    // Map ratings to bar widths and colors
    const getBarStyle = (rating) => {
        switch (rating) {
            case 'Needs Work':
                return { width: '33%', color: 'bg-red-600' };
            case 'Good':
                return { width: '66%', color: 'bg-yellow-600' };
            case 'Perfect':
                return { width: '100%', color: 'bg-green-600' };
            default:
                return { width: '0%', color: 'bg-gray-300' };
        }
    };

    return (
        <div className="relative min-h-screen">
            <Helmet>
                <title>{song?.title || 'Song'} - InternetDJ</title>
                <meta
                    name="description"
                    content={
                        song?.description
                            ? sanitizeHtml(song.description, { allowedTags: [], allowedAttributes: {} })
                            : `Listen to ${song?.title || 'this song'} by ${song?.profile_name || 'an artist'} on InternetDJ. Explore reviews, genres, and more.`
                    }
                />
                <link rel="canonical" href={`${baseUrl}/song/${songId}`} />
                <meta property="og:type" content="music.song" />
                <meta property="og:title" content={song?.title || 'Song'} />
                <meta property="og:description" content={cleanDescription} />
                <meta property="og:image" content={song?.image_url || `${baseUrl}/default-song-image.jpg`} />
                <meta property="og:url" content={`${baseUrl}/song/${songId}`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={song?.title || 'Song'} />
                <meta name="twitter:description" content={cleanDescription} />
                <meta name="twitter:image" content={song?.image_url || `${baseUrl}/default-song-image.jpg`} />
                <meta name="twitter:site" content="@internetdjco" />
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "MusicRecording",  // Reverted to "MusicRecording" as "Song" is not a valid schema.org type
                        "name": song?.title || "Song",
                        "byArtist": {
                            "@type": "MusicGroup",
                            "name": song?.profile_name || "Artist",
                            "url": `${baseUrl}/profile/${song?.profile_id || 'default'}`
                        },
                        "description": cleanDescription, // Use the sanitized description
                        "url": `${baseUrl}/song/${songId}`,
                        "image": song?.image_url || `${baseUrl}/default-song-image.jpg`,
                        "audio": {
                            "@type": "AudioObject",
                            "contentUrl": song?.mp3_url || `${baseUrl}/default-audio.mp3`
                        },
                        "genre": song?.genre || "Unknown"
                    })}
                </script>
            </Helmet>

            <div
                className={`profile-background ${typeof backgroundStyle === 'string' ? backgroundStyle : ''}`}
                style={typeof backgroundStyle === 'object' ? backgroundStyle : {}}
            ></div>
            <div className="relative container mx-auto px-4 py-8 max-w-7xl text-gray-800 z-0 pt-20">
                {error ? (
                    <div className="text-center">
                        <p className="text-red-400 text-lg">{error}</p>
                    </div>
                ) : !song ? (
                    <div className="text-center">
                        <p className="text-lg">Loading...</p>
                    </div>
                ) : (
                    <>
                        {/* Top Section */}
                        <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md mb-8">
                            <div className="flex flex-col lg:flex-row lg:items-start gap-8">
                                {/* Left Column: Image, Buttons, Plays, Likes */}
                                <div className="flex flex-col gap-4 flex-shrink-0">
                                    {/* Song Image */}
                                    <div>
                                        {song?.image_url ? (
                                            <img
                                                src={song.image_url}
                                                alt={song.title}
                                                className="w-80 h-80 rounded-md object-cover"
                                                onError={(e) => console.error('Song image failed to load:', song.image_url)}
                                            />
                                        ) : (
                                            <div className="w-80 h-80 rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                                                No Image
                                            </div>
                                        )}
                                    </div>
                                    {/* Buttons */}
                                    <div className="flex flex-wrap gap-2">
                                        {isAuthenticated && (
                                            <button
                                                onClick={() => setShowPlaylistModal(true)}
                                                className="inline-flex items-center px-3 py-1.5 bg-primary-brand-500 text-white font-semibold rounded-md shadow-md hover:bg-primary-brand-700 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:ring-offset-2 transition-colors duration-200 whitespace-nowrap"
                                            >
                                                <PlusIcon className="w-4 h-4 mr-1" />
                                                Playlist
                                            </button>
                                        )}
                                        {isAuthenticated && (
                                            <button
                                                onClick={handleLikeSong}
                                                className={`inline-flex items-center px-3 py-1.5 ${
                                                    isLiked ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-brand-300 hover:bg-primary-brand-500'
                                                } text-white font-semibold rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200 whitespace-nowrap`}
                                            >
                                                {isLiked ? (
                                                    <HeartIconSolid className="w-4 h-4 mr-1" />
                                                ) : (
                                                    <HeartIconOutline className="w-4 h-4 mr-1 text-white" />
                                                )}
                                                {isLiked ? 'Unlike' : 'Like'}
                                            </button>
                                        )}
                                        {isAuthenticated && song?.profile_id && user?.id !== song?.user_id && (
                                            <button
                                                onClick={handleFollowToggle}
                                                className={`inline-flex items-center px-3 py-1.5 ${
                                                    isFollowing
                                                        ? 'bg-gray-500 text-white hover:bg-gray-600'
                                                        : 'bg-black text-white hover:bg-gray-800'
                                                } font-semibold rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700 transition-colors duration-200 whitespace-nowrap`}
                                            >
                                                {isFollowing ? 'Unfollow' : 'Follow'}
                                            </button>
                                        )}
                                    </div>
                                    {/* Plays, Likes */}
                                    <div className="space-y-2">
                                        <div className="text-sm text-gray-600 flex space-x-4">
                                            <span className="inline-flex items-center">
                                            {Number(song?.plays) || 0}
                                              <SpeakerWaveIcon
                                                  className={`w-4 h-4 ml-1 ${Number(song?.plays) > 0 ? 'text-black' : 'text-gray-300'}`}
                                              />
                                            </span>
                                            <span className="inline-flex items-center">
                                                {Number(song?.likes_count) || 0}
                                                <HeartIconSolid
                                                    className={`w-4 h-4 ml-1 ${Number(song?.likes_count) > 0 ? 'text-red-600' : 'text-gray-300'}`}
                                                />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {/* Right Column: Title, Audio Player, Description, Genre Tags */}
                                <div className="flex-1 flex flex-col gap-4 min-w-0">
                                    {/* Title and Profile Link */}
                                    <div>
                                        <h1 className="text-3xl font-bold break-words">{song?.title || 'Loading...'}</h1>
                                        <Link
                                            to={song?.profile_id ? `/profile/${song.profile_id}` : '#'}
                                            className={song?.profile_id ? 'text-black hover:underline text-lg' : 'text-gray-500 cursor-not-allowed text-lg'}
                                        >
                                            {song?.profile_name || 'Profile'}
                                        </Link>
                                    </div>
                                    {/* Audio Player */}
                                    <div>
                                        {isLoadingSong ? (
                                            <div className="text-center">
                                                <p className="text-lg">Loading audio...</p>
                                            </div>
                                        ) : (
                                            <AudioPlayer key={songId} {...audioPlayerProps} />
                                        )}
                                    </div>
                                    {/* Description and Genre Tags */}
                                    <div className="space-y-2">
                                        {song?.description && <p className="text-gray-600">{song.description}</p>}
                                        {song?.genre ? (
                                            <div className="flex flex-wrap gap-2">
                                                {song.genre
                                                    .split(',')
                                                    .filter(genre => genre.trim())
                                                    .map((genre, index) => (
                                                        <Link
                                                            key={index}
                                                            to={`/tag/${genre.trim()}`}
                                                            className="inline-block bg-primary-brand-100 text-primary-brand-800 text-sm font-semibold px-2 py-1 rounded-md hover:bg-primary-brand-200 transition-colors"
                                                        >
                                                            {genre.trim()}
                                                        </Link>
                                                    ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-600">No genres specified</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Two-Column Section */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Left Column: Review Form and Reviews */}
                            <div className="lg:col-span-2 space-y-6">
                                {isAuthenticated && (
                                    <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md">
                                        <h2 className="text-2xl font-bold mb-4">Submit a Review</h2>
                                        <form onSubmit={handleReviewSubmit} className="space-y-6">
                                            <div>
                                                <label className="block text-sm font-medium">Review</label>
                                                <textarea
                                                    name="review"
                                                    value={reviewForm.review}
                                                    onChange={handleReviewInputChange}
                                                    rows="4"
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                                />
                                            </div>
                                            <div className="flex space-x-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowFeedbackModal(true)}
                                                    className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
                                                >
                                                    Add Detailed Feedback
                                                </button>
                                                <button
                                                    type="submit"
                                                    className="py-2 px-4 bg-black text-white font-semibold rounded-md shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700"
                                                >
                                                    Submit Review
                                                </button>
                                            </div>
                                        </form>
                                        {reviewError && <p className="text-red-400 text-lg mt-4">{reviewError}</p>}
                                    </div>
                                )}

                                <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md">
                                    <h2 className="text-2xl font-bold mb-4">Reviews</h2>
                                    {reviews.length === 0 ? (
                                        <p>No reviews yet.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {reviews.map((review) => (
                                                <div
                                                    key={review.id}
                                                    className="p-4 bg-gray-50 rounded-lg shadow-sm border border-gray-200"
                                                >
                                                    <div className="flex items-start space-x-4">
                                                        <Link
                                                            to={review.profile_id ? `/profile/${review.profile_id}` : '#'}
                                                            className={review.profile_id ? 'hover:underline' : 'cursor-not-allowed'}
                                                        >
                                                            {review.picture_url ? (
                                                                <img
                                                                    src={review.picture_url}
                                                                    alt={review.user_name}
                                                                    className="w-10 h-10 rounded-full object-cover"
                                                                />
                                                            ) : (
                                                                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs">
                                                                    ?
                                                                </div>
                                                            )}
                                                        </Link>
                                                        <div className="flex-1">
                                                            <div className="flex items-center justify-between">
                                                                <Link
                                                                    to={review.profile_id ? `/profile/${review.profile_id}` : '#'}
                                                                    className={review.profile_id ? 'text-black hover:underline text-sm font-semibold' : 'text-gray-500 cursor-not-allowed text-sm font-semibold'}
                                                                >
                                                                    {review.user_name}
                                                                </Link>
                                                                <div className="flex items-center space-x-4">
                                                                    <p className="text-sm text-gray-500">
                                                                        {new Date(review.created_at).toLocaleDateString()}
                                                                    </p>
                                                                    {user && review.profile_id === user.profile_id && (
                                                                        <button
                                                                            onClick={() => handleDeleteReview(review.id)}
                                                                            className="text-red-600 hover:text-red-700 text-sm font-semibold"
                                                                        >
                                                                            Delete
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {review.review && (
                                                                <p className="mt-2 text-sm text-gray-600">{review.review}</p>
                                                            )}
                                                            {review.feedback && Object.keys(review.feedback).length > 0 && (
                                                                <div className="mt-2">
                                                                    <button
                                                                        type="button"
                                                                        className="px-2 py-1 bg-primary-brand-500 text-white text-xs font-semibold rounded-md shadow-sm hover:bg-primary-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
                                                                        onClick={() => handleViewFeedback(review.feedback)}
                                                                    >
                                                                        View Detailed Feedback
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: Other Songs */}
                            <div className="lg:col-span-1">
                                <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md sticky top-20">
                                    <h2 className="text-2xl font-bold mb-4">More by {song?.profile_name || 'Artist'}</h2>
                                    {otherSongs.length === 0 ? (
                                        <p className="text-sm text-gray-600">No other songs by this artist.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {otherSongs.map((otherSong) => (
                                                <div
                                                    key={otherSong.id}
                                                    className="flex items-start space-x-4 p-2 bg-gray-50 rounded-md shadow-sm cursor-pointer hover:bg-gray-100"
                                                    onClick={() => handleSongNavigation(otherSong.id)}
                                                >
                                                    {otherSong.image_url ? (
                                                        <img
                                                            src={otherSong.image_url}
                                                            alt={otherSong.title}
                                                            className="w-16 h-16 rounded-md object-cover"
                                                            onError={(e) => console.error('Song image failed to load:', otherSong.image_url)}
                                                        />
                                                    ) : (
                                                        <div className="w-16 h-16 rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-xs">
                                                            No Image
                                                        </div>
                                                    )}
                                                    <div className="flex-1">
                            <span className="text-sm font-semibold text-black hover:underline">
                              {otherSong.title}
                            </span>
                                                        <div className="text-xs text-gray-600 flex items-center gap-x-2">
                                                            {otherSong.genre && <span>{otherSong.genre}</span>}
                                                            {otherSong.genre && <span>|</span>}
                                                            <span className="inline-flex items-center">
                                {Number(otherSong.plays) || 0}
                                                                <SpeakerWaveIcon
                                                                    className={`w-3 h-3 ml-1 ${Number(otherSong.plays) > 0 ? 'text-black' : 'text-gray-500'}`}
                                                                />
                              </span>
                                                            <span>|</span>
                                                            <span className="inline-flex items-center">
                                {Number(otherSong.likes_count) || 0}
                                                                <HeartIconSolid
                                                                    className={`w-3 h-3 ml-1 ${Number(otherSong.likes_count) > 0 ? 'text-red-600' : 'text-gray-500'}`}
                                                                />
                              </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Feedback Input Modal */}
                        {showFeedbackModal && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                                    <h2 className="text-xl font-bold mb-4">Detailed Feedback</h2>
                                    <div className="space-y-4">
                                        {feedbackCriteria.map(criterion => (
                                            <div key={criterion} className="flex items-center space-x-4">
                                                <label className="w-1/3 text-sm font-medium">{criterion}</label>
                                                <div className="w-2/3">
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="2"
                                                        step="1"
                                                        value={['Needs Work', 'Good', 'Perfect'].indexOf(reviewForm.feedback[criterion])}
                                                        onChange={(e) => handleFeedbackChange(criterion, ['Needs Work', 'Good', 'Perfect'][e.target.value])}
                                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                                    />
                                                    <div className="flex justify-between text-xs mt-1">
                                                        <span>Needs Work</span>
                                                        <span>Good</span>
                                                        <span>Perfect</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end mt-6 space-x-4">
                                        <button
                                            onClick={() => setShowFeedbackModal(false)}
                                            className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-md hover:bg-gray-400"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => setShowFeedbackModal(false)}
                                            className="py-2 px-4 bg-primary-brand-500 text-white font-semibold rounded-md hover:bg-primary-brand-700"
                                        >
                                            Save Feedback
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Feedback Results Modal */}
                        {showFeedbackResultsModal && selectedFeedback && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                                    <h2 className="text-xl font-bold mb-4">Detailed Feedback Results</h2>
                                    <div className="space-y-4">
                                        {feedbackCriteria.map(criterion => (
                                            <div key={criterion} className="flex items-center space-x-4">
                                                <span className="w-1/3 text-sm font-medium">{criterion}</span>
                                                <div className="w-2/3">
                                                    <div className="text-sm text-gray-600 mb-1">
                                                        {selectedFeedback[criterion] || 'Not rated'}
                                                    </div>
                                                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                        <div
                                                            className={`h-2.5 rounded-full ${getBarStyle(selectedFeedback[criterion]).color}`}
                                                            style={{ width: getBarStyle(selectedFeedback[criterion]).width }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end mt-6">
                                        <button
                                            onClick={() => setShowFeedbackResultsModal(false)}
                                            className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-md hover:bg-gray-400"
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {likeError && <p className="text-red-400 text-lg mt-4">{likeError}</p>}
                        {followError && (
                            <p
                                className="text-red-400 text-lg mt-4"
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(followError) }}
                            />
                        )}

                        {showPlaylistModal && isAuthenticated && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
                                    <h2 className="text-xl font-bold mb-4">Add to Playlist</h2>
                                    {playlistError && <p className="text-red-400 text-sm mb-4">{playlistError}</p>}
                                    <div className="mb-4">
                                        <h3 className="text-lg font-semibold mb-2">Create New Playlist</h3>
                                        <form onSubmit={handleCreatePlaylist} className="flex space-x-2">
                                            <input
                                                type="text"
                                                value={newPlaylistName}
                                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                                placeholder="Playlist name"
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                            />
                                            <button
                                                type="submit"
                                                className="px-4 py-2 bg-black text-white font-semibold rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-700"
                                            >
                                                Create
                                            </button>
                                        </form>
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold mb-2">Favorite Playlists</h3>
                                        {playlists.length === 0 ? (
                                            <p className="text-sm text-gray-600">No playlists found. Create one above.</p>
                                        ) : (
                                            <ul className="space-y-2">
                                                {playlists.map((playlist) => (
                                                    <li key={playlist.id} className="flex justify-between items-center">
                                                        <span>{playlist.name} ({playlist.song_count} songs)</span>
                                                        <button
                                                            onClick={() => handleAddToPlaylist(playlist.id)}
                                                            className="px-3 py-1 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
                                                        >
                                                            Add
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <div className="flex justify-end mt-6">
                                        <button
                                            onClick={() => setShowPlaylistModal(false)}
                                            className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {showReviewDeleteConfirm && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
                                    <h2 className="text-xl font-bold mb-4">Confirm Delete Review</h2>
                                    <p className="mb-6 text-gray-600">
                                        Are you sure you want to delete this review? This action cannot be undone.
                                    </p>
                                    <div className="flex justify-end space-x-4">
                                        <button
                                            onClick={() => {
                                                setShowReviewDeleteConfirm(false);
                                                setReviewToDelete(null);
                                            }}
                                            className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={confirmDeleteReview}
                                            className="py-2 px-4 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-600"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default Song;