import { Helmet } from 'react-helmet-async';
import { Fragment, useState, useEffect, useContext, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AudioPlayer from '../components/AudioPlayer';
import IconActionButton from '../components/IconActionButton';
import { SpeakerWaveIcon, PlusIcon, HeartIcon as HeartIconSolid, LinkIcon, UserPlusIcon, UserMinusIcon, ArrowDownTrayIcon } from '@heroicons/react/24/solid';
import { HeartIcon as HeartIconOutline } from '@heroicons/react/24/outline';
import sanitizeHtml from 'sanitize-html';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { getDefaultAvatar } from '../utils/defaultAvatar';
import profilePath from '../utils/profilePath';

// Feedback criteria
const feedbackCriteria = [
    'Melody', 'Harmony', 'Structure/Form', 'Lyrics', 'Vocal Technique',
    'Emotional Expression', 'Vocal Tone/Timbre', 'Instrumentation', 'Arrangement',
    'Mixing', 'Mastering', 'Sound Design', 'Originality', 'Innovation',
    'Emotional Impact', 'Audience Connection', 'Genre Fit', 'Marketability',
    'Consistency', 'Flow'
];

// Detailed feedback used to store one of three labels. It now stores a 0-100
// number so reviewers can land between them — "somewhere between good and
// perfect" was the whole point of the request. Reviews written before this
// change still hold the old strings, so everything that reads a score goes
// through here and both shapes render on the same scale.
const LEGACY_FEEDBACK_SCORES = { 'Needs Work': 20, 'Good': 60, 'Perfect': 100 };
const DEFAULT_FEEDBACK_SCORE = 60;   // matches the old 'Good' default

function feedbackScore(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.min(100, Math.max(0, value));
    }
    if (typeof value === 'string' && value in LEGACY_FEEDBACK_SCORES) {
        return LEGACY_FEEDBACK_SCORES[value];
    }
    return null;   // genuinely not rated
}

// A word for the number, so the scale still reads in the reviewer's language.
function feedbackLabel(score) {
    if (score === null) return 'Not rated';
    if (score < 34) return 'Needs work';
    if (score < 67) return 'Good';
    if (score < 90) return 'Very good';
    return 'Excellent';
}

// Expressive reactions on reviews. These are never summed into a score or
// fed into Top Reviewers - the point is to let people register an opinion
// without creating a number worth farming.
const REVIEW_REACTIONS = [
    { key: 'thumbs_up', glyph: '\u{1F44D}', label: 'Agree' },
    { key: 'thumbs_down', glyph: '\u{1F44E}', label: 'Disagree' },
    { key: 'clown', glyph: '\u{1F921}', label: 'Clown' },
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
    const [showShareModal, setShowShareModal] = useState(false);
    const [selectedFeedback, setSelectedFeedback] = useState(null);
    const [activity, setActivity] = useState([]);
    const [isLoadingActivity, setIsLoadingActivity] = useState(false);
    const [similarSongs, setSimilarSongs] = useState([]);
    const [similarBasis, setSimilarBasis] = useState(null);
    const [isLoadingSimilar, setIsLoadingSimilar] = useState(false);
    const [shareStatus, setShareStatus] = useState('');

    // Initialize feedback state
    const initialFeedback = feedbackCriteria.reduce((acc, criterion) => {
        acc[criterion] = DEFAULT_FEEDBACK_SCORE;
        return acc;
    }, {});
    useEffect(() => {
        setReviewForm(prev => ({ ...prev, feedback: initialFeedback }));
    }, []);

    // Navigating between song pages changes songId a render before the new
    // song arrives, so `song` still holds the previous track. Handing that
    // stale mp3_url to the player is what loaded the wrong audio under the
    // new song's page.
    const isSongLoaded = song?.id === Number(songId);

    const audioPlayerProps = useMemo(
        () => ({
            songId,
            s3Url: isSongLoaded ? song.mp3_url : '',
            isOwner: Boolean(
                user?.id &&
                song?.user_id &&
                Number(user.id) === Number(song.user_id)
            ),
        }),
        [songId, isSongLoaded, song?.mp3_url, song?.user_id, user?.id]
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
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/reviews/${songId}`,
                    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
                );
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
                    setPlaylistError('Failed to load mixtapes: ' + (err.response?.data?.error || err.message));
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
                    const shuffledSongs = songs.filter(s => s.id !== Number(songId)).sort(() => Math.random() - 0.5).slice(0, 2);
                    setOtherSongs(shuffledSongs);
                } catch (err) {
                    console.error('Failed to fetch other songs:', err);
                }
            }
        };

        const fetchActivity = async () => {
            setIsLoadingActivity(true);
            try {
                // Sent with the token when there is one: crates you own or were
                // gifted are part of your feed, but nobody else's.
                const token = localStorage.getItem('token');
                const response = await axios.get(
                    `${API_URL}/music/${songId}/activity`,
                    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
                );
                setActivity(response.data.activity || []);
            } catch (err) {
                console.error('Failed to fetch activity:', err);
            } finally {
                setIsLoadingActivity(false);
            }
        };

        const fetchSimilar = async () => {
            setIsLoadingSimilar(true);
            try {
                const response = await axios.get(`${API_URL}/music/${songId}/similar`);
                setSimilarSongs(response.data.songs || []);
                setSimilarBasis(response.data.basis || null);
            } catch (err) {
                console.error('Failed to fetch similar songs:', err);
            } finally {
                setIsLoadingSimilar(false);
            }
        };

        setIsLoadingSong(true);
        fetchSong();
        fetchReviews();
        fetchPlaylists();
        checkIfLiked();
        fetchFollowStatus();
        fetchOtherSongs();
        fetchActivity();
        fetchSimilar();
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

    const handleDownloadSong = () => {
        const link = document.createElement('a');
        link.href = `${API_URL}/music/${songId}/download`;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCopyShareLink = async () => {
        try {
            await navigator.clipboard.writeText(songShareUrl);
            setShareStatus('Song link copied!');
        } catch (err) {
            console.error('Failed to copy song share link:', err);
            setShareStatus('Copy failed. You can still copy the link below.');
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

    const [reactingReviewId, setReactingReviewId] = useState(null);

    const handleReact = async (reviewId, reaction) => {
        if (!isAuthenticated) {
            navigate(`/login?return=${encodeURIComponent(`/song/${songId}`)}`);
            return;
        }
        if (reactingReviewId) return;          // one in flight at a time
        setReactingReviewId(reviewId);
        try {
            const token = localStorage.getItem('token');
            const response = await axios.post(
                `${API_URL}/reviews/${reviewId}/reactions`,
                { reaction },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setReviews((prev) => prev.map((r) => (
                r.id === reviewId
                    ? { ...r, reactions: response.data.reactions, my_reaction: response.data.my_reaction }
                    : r
            )));
        } catch (err) {
            setReviewError('Could not save your reaction: ' + (err.response?.data?.error || err.message));
        } finally {
            setReactingReviewId(null);
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
            setPlaylistError('You must be logged in to add to a mixtape');
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
            setPlaylistError('Failed to add song to mixtape: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleCreatePlaylist = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            setPlaylistError('You must be logged in to create a mixtape');
            return;
        }
        if (!newPlaylistName.trim()) {
            setPlaylistError('Mixtape name is required');
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
            setPlaylistError('Failed to create mixtape: ' + (err.response?.data?.error || err.message));
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

    const groupActivityByDay = (activities) => {
        const getLocalDayKey = (dateValue) => {
            const d = new Date(dateValue);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const grouped = {};
        activities.forEach(item => {
            // Group by actor + local calendar day so same-day actions collapse predictably for viewers.
            const dayKey = getLocalDayKey(item.created_at);
            const actorKey = item.actor_profile_id != null ? `p:${item.actor_profile_id}` : `n:${item.actor_name || 'unknown'}`;
            const key = `${actorKey}|${dayKey}`;
            if (!grouped[key]) {
                grouped[key] = {
                    actor_profile_id: item.actor_profile_id,
                    actor_name: item.actor_name,
                    actor_picture: item.actor_picture,
                    created_at: item.created_at,
                    types: new Set(),
                    crates: [],
                };
            }
            grouped[key].types.add(item.type);
            // Keep the crate's id alongside its name so the label can link to it.
            if (item.extra && !grouped[key].crates.some(c => c.id === item.extra_id && c.name === item.extra)) {
                grouped[key].crates.push({ id: item.extra_id ?? null, name: item.extra });
            }
            // Always update created_at to the most recent
            if (new Date(item.created_at) > new Date(grouped[key].created_at)) {
                grouped[key].created_at = item.created_at;
            }
        });
        return Object.values(grouped).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    };

    // Each clause carries its own direct object so the line reads as a sentence -
    // "added this song to X crate", not "added to X this song" - and every object
    // with a page of its own is rendered as a link to it.
    const renderActivityLabel = (groupedItem) => {
        const hasReview = hasType(groupedItem.types, 'song_reviewed');
        const hasLike = hasType(groupedItem.types, 'song_liked');
        const crates = (groupedItem.crates || []).filter(c => c.name);
        const hasPlaylistAdd = hasType(groupedItem.types, 'playlist_add') && crates.length > 0;
        const hasFollow = hasType(groupedItem.types, 'profile_followed');

        const clauses = [];

        // "reviewed and liked this song" - both verbs share the one direct object.
        if (hasReview || hasLike) {
            const verbs = [];
            if (hasReview) {
                verbs.push(
                    <button
                        key="reviewed"
                        type="button"
                        onClick={() => scrollToReview(groupedItem.actor_profile_id)}
                        className="cursor-pointer hover:text-fuchsia-300 hover:underline underline-offset-2"
                    >
                        reviewed
                    </button>
                );
            }
            if (hasLike) verbs.push(<span key="liked">liked</span>);
            clauses.push(
                <span key="song">
                    {verbs.map((verb, i) => (
                        <Fragment key={i}>{i > 0 ? ' and ' : ''}{verb}</Fragment>
                    ))}
                    {' this song'}
                </span>
            );
        }

        if (hasPlaylistAdd) {
            clauses.push(
                <span key="crates">
                    {/* "it" once the song is already the subject of an earlier clause. */}
                    {clauses.length > 0 ? 'added it to ' : 'added this song to '}
                    {crates.map((crate, i) => (
                        <Fragment key={crate.id ?? crate.name}>
                            {i === 0 ? '' : i === crates.length - 1 ? ' and ' : ', '}
                            {crate.id ? (
                                <Link to={`/crate/${crate.id}`} className="retro-link">
                                    &quot;{crate.name}&quot;
                                </Link>
                            ) : (
                                <span>&quot;{crate.name}&quot;</span>
                            )}
                        </Fragment>
                    ))}
                    {crates.length === 1 ? ' mixtape' : ' mixtapes'}
                </span>
            );
        }

        if (hasFollow) {
            const artistName = song?.profile_name || 'this artist';
            clauses.push(
                <span key="follow">
                    {'followed '}
                    {song?.profile_id
                        ? <Link to={profilePath(song)} className="retro-link">{artistName}</Link>
                        : artistName}
                </span>
            );
        }

        return clauses.map((clause, i) => (
            <Fragment key={i}>{i > 0 ? ' and ' : ''}{clause}</Fragment>
        ));
    };

    const hasType = (types, typeToCheck) => {
        if (types instanceof Set) {
            return types.has(typeToCheck);
        }
        return Array.isArray(types) && types.includes(typeToCheck);
    };

    const getActivityIcon = (types) => {
        // Prioritize icons in order of importance
        if (hasType(types, 'song_reviewed')) {
            return <SpeakerWaveIcon className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />;
        }
        if (hasType(types, 'song_liked')) {
            return <HeartIconSolid className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
        }
        if (hasType(types, 'playlist_add')) {
            return <PlusIcon className="w-3.5 h-3.5 text-primary-brand-300 flex-shrink-0" />;
        }
        if (hasType(types, 'profile_followed')) {
            return (
                <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M8 9a3 3 0 100-6 3 3 0 000 6zm6 2a2 2 0 11-4 0 2 2 0 014 0zm-9.5 5.5a.5.5 0 01-.5-.5v-1a4 4 0 018 0v1a.5.5 0 01-.5.5h-7zm11-2a3 3 0 00-3-3h-1.5a4.978 4.978 0 011.5 3.5v.5h3.5a.5.5 0 00.5-.5v-.5z" />
                </svg>
            );
        }
        return null;
    };

    const scrollToReview = (profileId) => {
        const reviewElements = document.querySelectorAll(`[data-review-profile-id="${profileId}"]`);
        if (reviewElements.length > 0) {
            reviewElements[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    const baseUrl = SITE_URL;
    const songShareUrl = `${baseUrl}/song/${songId}`;
    const cleanDescription = song?.description
        ? sanitizeHtml(song.description, { allowedTags: [], allowedAttributes: {} })
        : 'Listen to this amazing song on InternetDJ.';

    // Map ratings to bar widths and colors
    const getBarStyle = (rating) => {
        const score = feedbackScore(rating);
        if (score === null) return { width: '0%', color: 'bg-gray-500' };
        const color = score < 34 ? 'bg-fuchsia-500'
            : score < 67 ? 'bg-amber-400'
            : score < 90 ? 'bg-cyan-400'
            : 'bg-emerald-400';
        return { width: `${score}%`, color };
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
                            "url": song?.profile_id ? `${baseUrl}${profilePath(song)}` : undefined
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
            <div className="relative container mx-auto px-4 py-8 max-w-7xl text-gray-100 z-0 pt-2">
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
                        <div className="retro-panel retro-cut p-6 mb-8">
                            <div className="flex flex-col lg:flex-row lg:items-start gap-8">
                                {/* Left Column: Image, Buttons, Plays, Likes */}
                                <div className="flex flex-col gap-4 flex-shrink-0">
                                    {/* Song Image */}
                                    <div>
                                        {song?.image_url ? (
                                            <img
                                                src={song.image_url}
                                                alt={song.title}
                                                className="w-80 h-80 max-w-full object-cover border border-cyan-400/40"
                                                onError={() => console.error('Song image failed to load:', song.image_url)}
                                            />
                                        ) : (
                                            <div className="w-80 h-80 max-w-full border border-cyan-400/40 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.6rem] text-cyan-300">
                                                No Image
                                            </div>
                                        )}
                                    </div>
                                    {/* Buttons */}
                                    <div className="flex flex-wrap gap-2">
                                        <IconActionButton
                                            icon={LinkIcon}
                                            label="Share song"
                                            onClick={() => {
                                                setShareStatus('');
                                                setShowShareModal(true);
                                            }}
                                        />
                                        {song?.allow_download && (
                                            <IconActionButton
                                                icon={ArrowDownTrayIcon}
                                                label="Download song"
                                                onClick={handleDownloadSong}
                                            />
                                        )}
                                        {isAuthenticated && (
                                            <IconActionButton
                                                icon={PlusIcon}
                                                label="Add to mixtape"
                                                onClick={() => setShowPlaylistModal(true)}
                                            />
                                        )}
                                        {isAuthenticated && (
                                            <IconActionButton
                                                icon={isLiked ? HeartIconSolid : HeartIconOutline}
                                                label={isLiked ? 'Unlike song' : 'Like song'}
                                                onClick={handleLikeSong}
                                                className={isLiked ? 'retro-action--on' : ''}
                                            />
                                        )}
                                        {isAuthenticated && song?.profile_id && user?.id !== song?.user_id && (
                                            <IconActionButton
                                                icon={isFollowing ? UserMinusIcon : UserPlusIcon}
                                                label={isFollowing ? 'Unfollow artist' : 'Follow artist'}
                                                onClick={handleFollowToggle}
                                                className={isFollowing ? 'retro-action--on' : ''}
                                            />
                                        )}
                                    </div>
                                    {/* Plays, Likes */}
                                    <div className="space-y-2">
                                        <div className="retro-mono text-xl text-cyan-300 flex space-x-4">
                                            <span className="inline-flex items-center">
                                            {Number(song?.plays) || 0}
                                               <SpeakerWaveIcon
                                                   className={`w-4 h-4 ml-1 ${Number(song?.plays) > 0 ? 'text-gray-100' : 'text-gray-300'}`}
                                               />
                                            </span>
                                            <span className="inline-flex items-center">
                                                {Number(song?.likes_count) || 0}
                                                <HeartIconSolid
                                                    className={`w-4 h-4 ml-1 ${Number(song?.likes_count) > 0 ? 'text-red-500' : 'text-gray-300'}`}
                                                />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {/* Right Column: Title, Audio Player, Description, Genre Tags */}
                                <div className="flex-1 flex flex-col gap-4 min-w-0">
                                    {/* Title and Profile Link */}
                                    <div>
                                        <h1 className="retro-display text-2xl sm:text-3xl retro-chrome break-words">{song?.title || 'Loading...'}</h1>
                                        <Link
                                            to={song?.profile_id ? profilePath(song) : '#'}
                                             className={song?.profile_id ? 'retro-link retro-mono text-2xl' : 'text-gray-500 cursor-not-allowed retro-mono text-2xl'}
                                        >
                                            {song?.profile_name || 'Profile'}
                                        </Link>
                                    </div>
                                    {/* Audio Player */}
                                    <div>
                                        {isLoadingSong || !isSongLoaded ? (
                                            <div className="text-center">
                                                <p className="text-lg">Loading audio...</p>
                                            </div>
                                        ) : (
                                            <AudioPlayer key={songId} {...audioPlayerProps} />
                                        )}
                                    </div>
                                    {/* Detected tempo and key. Either can be absent:
                                        analysis stores nothing when it is not
                                        confident, which is the right answer for
                                        beatless or atonal tracks. */}
                                    {(song?.bpm || song?.musical_key) && (
                                        <div className="flex flex-wrap gap-2">
                                            {song?.bpm && (
                                                <span className="retro-chip" title="Detected tempo">
                                                    {Math.round(song.bpm)} BPM
                                                </span>
                                            )}
                                            {song?.musical_key && (
                                                <span className="retro-chip" title="Detected key">
                                                    {song.musical_key}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Description and Genre Tags */}
                                    <div className="space-y-2">
                                        {song?.description && (
                                            <p className="retro-mono text-xl text-gray-300 whitespace-pre-line">
                                                {sanitizeHtml(song.description, { allowedTags: [], allowedAttributes: {} })}
                                            </p>
                                        )}
                                        {song?.genre ? (
                                            <div className="flex flex-wrap gap-2">
                                                {song.genre
                                                    .split(',')
                                                    .filter(genre => genre.trim())
                                                    .map((genre, index) => (
                                                        <Link
                                                            key={index}
                                                            to={`/tag/${genre.trim()}`}
                                                            className="retro-chip"
                                                        >
                                                            {genre.trim()}
                                                        </Link>
                                                    ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-300">No genres specified</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Two-Column Section */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Left Column: Review Form and Reviews */}
                            <div className="space-y-6">
                                {isAuthenticated && (
                                    <div className="retro-panel retro-cut p-6">
                                        <h2 className="retro-display text-lg retro-glow-magenta mb-4">Post a Comment</h2>
                                        <form onSubmit={handleReviewSubmit} className="space-y-6">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-300">Comment</label>
                                                <textarea
                                                    name="review"
                                                    value={reviewForm.review}
                                                    onChange={handleReviewInputChange}
                                                    rows="4"
                                                    className="retro-field mt-1"
                                                />
                                            </div>
                                            <div className="flex space-x-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowFeedbackModal(true)}
                                                    className="retro-btn px-5 py-2 text-xs"
                                                >
                                                    Add Detailed Feedback
                                                </button>
                                                <button
                                                    type="submit"
                                                    className="retro-btn retro-btn--hot px-5 py-2 text-xs"
                                                >
                                                    Submit Review
                                                </button>
                                            </div>
                                        </form>
                                        {reviewError && <p className="text-red-400 text-lg mt-4">{reviewError}</p>}
                                    </div>
                                )}

                                <div className="retro-panel retro-cut p-6">
                                    <h2 className="retro-display text-lg retro-glow-magenta mb-4">Comments</h2>
                                    {reviews.length === 0 ? (
                                        <p className="text-gray-300">No comments yet.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {reviews.map((review) => (
                                                <div
                                                    key={review.id}
                                                    data-review-profile-id={review.profile_id}
                                                    className="retro-card retro-cut p-4"
                                                >
                                                    <div className="flex items-start space-x-4">
                                                        <Link
                                                            to={review.profile_id ? profilePath(review) : '#'}
                                                            className={review.profile_id ? 'hover:underline' : 'cursor-not-allowed'}
                                                        >
                                                            <img
                                                                src={review.picture_url || getDefaultAvatar(review.profile_id || review.user_name)}
                                                                alt={review.user_name}
                                                                className="w-10 h-10 rounded-full object-cover"
                                                                onError={(e) => {
                                                                    e.currentTarget.src = getDefaultAvatar(review.profile_id || review.user_name);
                                                                }}
                                                            />
                                                        </Link>
                                                        <div className="flex-1">
                                                            <div className="flex items-center justify-between">
                                                                <Link
                                                                    to={review.profile_id ? profilePath(review) : '#'}
                                                                    className={review.profile_id ? 'retro-link retro-mono text-lg' : 'text-gray-500 cursor-not-allowed text-sm font-semibold'}
                                                                >
                                                                    {review.user_name}
                                                                </Link>
                                                                <div className="flex items-center space-x-4">
                                                                    <p className="text-sm text-gray-400">
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
                                                                <p className="mt-2 text-sm text-gray-300">{review.review}</p>
                                                            )}
                                                            {review.feedback && Object.keys(review.feedback).length > 0 && (
                                                                <div className="mt-2">
                                                                    <button
                                                                        type="button"
                                                                        className="retro-btn px-3 py-1 text-[0.6rem]"
                                                                        onClick={() => handleViewFeedback(review.feedback)}
                                                                    >
                                                                        View Detailed Feedback
                                                                    </button>
                                                                </div>
                                                            )}
                                                            <div className="mt-3 flex items-center gap-2">
                                                                {REVIEW_REACTIONS.map(({ key, glyph, label }) => {
                                                                    const count = review.reactions?.[key] || 0;
                                                                    const active = review.my_reaction === key;
                                                                    return (
                                                                        <button
                                                                            key={key}
                                                                            type="button"
                                                                            onClick={() => handleReact(review.id, key)}
                                                                            disabled={reactingReviewId === review.id}
                                                                            aria-pressed={active}
                                                                            title={active ? `${label} \u2014 click to undo` : label}
                                                                            className={`retro-chip flex items-center gap-1.5 px-2 py-1 transition-colors disabled:opacity-50 ${
                                                                                active
                                                                                    ? 'border-cyan-400 text-cyan-200 bg-cyan-400/10'
                                                                                    : 'text-gray-400 hover:text-gray-200'
                                                                            }`}
                                                                        >
                                                                            <span aria-hidden="true">{glyph}</span>
                                                                            <span className="retro-mono text-lg tabular-nums">{count}</span>
                                                                            <span className="sr-only">{label}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: Other Songs + Activity Feed */}
                            <div className="space-y-6">
                                <div className="retro-panel retro-cut p-6">
                                    <h2 className="retro-display text-lg retro-glow-magenta mb-4">More by {song?.profile_name || 'Artist'}</h2>
                                    {otherSongs.length === 0 ? (
                                        <p className="text-sm text-gray-300">No other songs by this artist.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {otherSongs.map((otherSong) => (
                                                <div
                                                    key={otherSong.id}
                                                    className="retro-card retro-cut flex items-start space-x-4 p-2 cursor-pointer"
                                                    onClick={() => handleSongNavigation(otherSong.id)}
                                                >
                                                    {otherSong.image_url ? (
                                                        <img
                                                            src={otherSong.image_url}
                                                            alt={otherSong.title}
                                                            className="w-16 h-16 object-cover border border-cyan-400/30"
                                                            onError={() => console.error('Song image failed to load:', otherSong.image_url)}
                                                        />
                                                    ) : (
                                                        <div className="w-16 h-16 border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300">
                                                            No Image
                                                        </div>
                                                    )}
                                                    <div className="flex-1">
                            <span className="retro-display text-[0.7rem] text-white hover:text-cyan-200">
                              {otherSong.title}
                            </span>
                                                        <div className="retro-mono text-base text-cyan-300/80 flex items-center gap-x-2">
                                                            {otherSong.genre && <span>{otherSong.genre}</span>}
                                                            {otherSong.genre && <span>|</span>}
                                                            <span className="inline-flex items-center">
                                {Number(otherSong.plays) || 0}
                                                                <SpeakerWaveIcon
                                                                    className={`w-3 h-3 ml-1 ${Number(otherSong.plays) > 0 ? 'text-gray-100' : 'text-gray-500'}`}
                                                                />
                              </span>
                                                            <span>|</span>
                                                            <span className="inline-flex items-center">
                                {Number(otherSong.likes_count) || 0}
                                                                <HeartIconSolid
                                                                    className={`w-3 h-3 ml-1 ${Number(otherSong.likes_count) > 0 ? 'text-red-500' : 'text-gray-500'}`}
                                                                />
                              </span>
                                                        </div>
                                                    </div>
                                                 </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Activity Feed */}
                                <div className="retro-panel retro-cut p-6">
                                    <h2 className="retro-display text-base retro-glow-cyan mb-4">Activity</h2>
                                    {isLoadingActivity ? (
                                        <div className="space-y-3">
                                            {[...Array(4)].map((_, i) => (
                                                <div key={i} className="flex items-center gap-3 animate-pulse">
                                                    <div className="w-7 h-7 rounded-full bg-white/10 flex-shrink-0" />
                                                    <div className="flex-1 space-y-1">
                                                        <div className="h-2.5 bg-white/10 rounded w-3/4" />
                                                        <div className="h-2 bg-white/5 rounded w-1/3" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : activity.length === 0 ? (
                                        <p className="text-sm text-gray-400">No activity yet. Be the first to like or review!</p>
                                    ) : (
                                        <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                            {groupActivityByDay(activity).map((item) => {
                                                const dayKey = (() => {
                                                    const d = new Date(item.created_at);
                                                    const y = d.getFullYear();
                                                    const m = String(d.getMonth() + 1).padStart(2, '0');
                                                    const day = String(d.getDate()).padStart(2, '0');
                                                    return `${y}-${m}-${day}`;
                                                })();
                                                const actorKey = item.actor_profile_id != null ? `p:${item.actor_profile_id}` : `n:${item.actor_name || 'unknown'}`;
                                                const rowKey = `${actorKey}|${dayKey}`;

                                                return (
                                                <li key={rowKey} className="flex items-start gap-3">
                                                    <Link
                                                        to={item.actor_profile_id ? profilePath({ profile_slug: item.actor_profile_slug, profile_id: item.actor_profile_id }) : '#'}
                                                        className="flex-shrink-0"
                                                    >
                                                        <img
                                                            src={item.actor_picture || getDefaultAvatar(item.actor_profile_id || item.actor_name)}
                                                            alt={item.actor_name}
                                                            className="w-7 h-7 rounded-full object-cover"
                                                            onError={(e) => { e.currentTarget.src = getDefaultAvatar(item.actor_profile_id || item.actor_name); }}
                                                        />
                                                    </Link>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-gray-200 leading-snug">
                                                            <Link
                                                                to={item.actor_profile_id ? profilePath({ profile_slug: item.actor_profile_slug, profile_id: item.actor_profile_id }) : '#'}
                                                                className="retro-link retro-mono text-lg"
                                                            >
                                                                {item.actor_name}
                                                            </Link>
                                                            {' '}
                                                            <span className="inline-flex items-center gap-1">
                                                                {getActivityIcon(item.types)}
                                                                <span className="retro-mono text-lg text-gray-400">
                                                                    {renderActivityLabel(item)}
                                                                </span>
                                                            </span>
                                                        </p>
                                                    </div>
                                                </li>
                                            );})}
                                        </ul>
                                    )}
                                </div>

                                {/* You Might Also Like */}
                                {(isLoadingSimilar || similarSongs.length > 0) && (
                                    <div className="retro-panel retro-cut p-6">
                                        <h2 className="retro-display text-lg retro-glow-magenta mb-1">You might also like</h2>
                                        {/* Say what the picks were matched on, so the
                                            list reads as reasoning rather than as a
                                            guess. Absent when nothing was detected. */}
                                        {(similarBasis?.bpm || similarBasis?.camelot) && (
                                            <p className="retro-mono text-lg text-gray-400 mb-4">
                                                Matched against{' '}
                                                {[
                                                    similarBasis.bpm ? `${Math.round(similarBasis.bpm)} BPM` : null,
                                                    similarBasis.musical_key
                                                        ? `${similarBasis.musical_key} (${similarBasis.camelot})`
                                                        : null,
                                                ].filter(Boolean).join(' · ')}
                                            </p>
                                        )}
                                        {isLoadingSimilar ? (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {[...Array(6)].map((_, i) => (
                                                    <div key={i} className="animate-pulse space-y-2">
                                                        <div className="w-full aspect-square rounded-md bg-white/10" />
                                                        <div className="h-3 bg-white/10 rounded w-3/4" />
                                                        <div className="h-2.5 bg-white/5 rounded w-1/2" />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {similarSongs.slice(0, 4).map((s) => (
                                                    <div
                                                        key={s.id}
                                                        className="group cursor-pointer"
                                                        onClick={() => handleSongNavigation(s.id)}
                                                    >
                                                        <div className="relative aspect-square mb-2 overflow-hidden retro-scanlines border border-cyan-400/30">
                                                            {s.image_url ? (
                                                                <img
                                                                    src={s.image_url}
                                                                    alt={s.title}
                                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300">
                                                                    No Image
                                                                </div>
                                                            )}
                                                        </div>
                                                        <p className="retro-display text-[0.7rem] text-white group-hover:text-cyan-200 truncate leading-tight">
                                                            {s.title}
                                                        </p>
                                                        <Link
                                                            to={profilePath(s)}
                                                            className="retro-mono text-base retro-link truncate block"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {s.profile_name}
                                                        </Link>
                                                        {s.match_reasons?.length > 0 && (
                                                            <p className="retro-mono text-base text-cyan-300/80 truncate mt-0.5"
                                                               title={s.match_reasons.join(', ')}>
                                                                {s.match_reasons[0]}
                                                            </p>
                                                        )}
                                                        <div className="flex items-center gap-2 mt-1 retro-mono text-base text-gray-400">
                                                            <span className="inline-flex items-center gap-0.5">
                                                                {Number(s.plays) || 0}
                                                                <SpeakerWaveIcon className="w-3 h-3" />
                                                            </span>
                                                            <span className="inline-flex items-center gap-0.5">
                                                                {Number(s.likes_count) || 0}
                                                                <HeartIconSolid className={`w-3 h-3 ${Number(s.likes_count) > 0 ? 'text-red-500' : ''}`} />
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Feedback Input Modal */}
                        {showShareModal && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay px-4">
                                <div className="retro-panel retro-cut p-6 max-w-lg w-full text-gray-100">
                                    <h2 className="retro-display text-base retro-glow-cyan mb-2">Share Song</h2>
                                    <p className="text-sm text-gray-300 mb-4">Copy or open the direct link to this song.</p>
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <input
                                            type="text"
                                            value={songShareUrl}
                                            readOnly
                                            className="retro-field flex-1"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleCopyShareLink}
                                            className="retro-btn px-5 py-2 text-xs"
                                        >
                                            Copy Link
                                        </button>
                                    </div>
                                    {shareStatus && <p className="mt-3 text-sm text-primary-brand-200">{shareStatus}</p>}
                                    <div className="flex justify-end gap-3 mt-6">
                                        <a
                                            href={songShareUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="retro-btn px-5 py-2 text-xs"
                                        >
                                            Open Link
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowShareModal(false);
                                                setShareStatus('');
                                            }}
                                            className="retro-btn px-5 py-2 text-xs"
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {showFeedbackModal && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay">
                                <div className="retro-panel retro-cut p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto text-gray-100">
                                    <h2 className="retro-display text-base retro-glow-cyan mb-4">Detailed Feedback</h2>
                                    <div className="space-y-4">
                                        {feedbackCriteria.map(criterion => (
                                            <div key={criterion} className="flex items-center space-x-4">
                                                <label className="w-1/3 text-sm font-medium text-gray-300">{criterion}</label>
                                                <div className="w-2/3">
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="100"
                                                        step="1"
                                                        value={feedbackScore(reviewForm.feedback[criterion]) ?? DEFAULT_FEEDBACK_SCORE}
                                                        onChange={(e) => handleFeedbackChange(criterion, Number(e.target.value))}
                                                        aria-label={`${criterion} rating`}
                                                        aria-valuetext={`${feedbackScore(reviewForm.feedback[criterion]) ?? DEFAULT_FEEDBACK_SCORE} out of 100, ${feedbackLabel(feedbackScore(reviewForm.feedback[criterion]) ?? DEFAULT_FEEDBACK_SCORE)}`}
                                                        className="retro-slider w-full cursor-pointer"
                                                    />
                                                    <div className="flex justify-between items-baseline text-xs mt-1 text-gray-500">
                                                        <span>Needs work</span>
                                                        <span className="retro-mono text-cyan-300">
                                                            {feedbackLabel(feedbackScore(reviewForm.feedback[criterion]) ?? DEFAULT_FEEDBACK_SCORE)}
                                                            {' '}
                                                            <span className="tabular-nums text-gray-400">
                                                                {feedbackScore(reviewForm.feedback[criterion]) ?? DEFAULT_FEEDBACK_SCORE}
                                                            </span>
                                                        </span>
                                                        <span>Excellent</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end mt-6 space-x-4">
                                        <button
                                            onClick={() => setShowFeedbackModal(false)}
                                            className="retro-btn px-5 py-2 text-xs"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => setShowFeedbackModal(false)}
                                            className="retro-btn retro-btn--hot px-5 py-2 text-xs"
                                        >
                                            Save Feedback
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Feedback Results Modal */}
                        {showFeedbackResultsModal && selectedFeedback && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay">
                                <div className="retro-panel retro-cut p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto text-gray-100">
                                    <h2 className="retro-display text-base retro-glow-cyan mb-4">Detailed Feedback Results</h2>
                                    <div className="space-y-4">
                                        {feedbackCriteria.map(criterion => (
                                            <div key={criterion} className="flex items-center space-x-4">
                                                <span className="w-1/3 text-sm font-medium text-gray-300">{criterion}</span>
                                                <div className="w-2/3">
                                                    <div className="retro-mono text-lg text-gray-400 mb-1 flex justify-between">
                                                        <span>{feedbackLabel(feedbackScore(selectedFeedback[criterion]))}</span>
                                                        {feedbackScore(selectedFeedback[criterion]) !== null && (
                                                            <span className="text-cyan-300 tabular-nums">
                                                                {feedbackScore(selectedFeedback[criterion])}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="w-full bg-white/10 h-2.5">
                                                        <div
                                                            className={`h-2.5 ${getBarStyle(selectedFeedback[criterion]).color}`}
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
                                            className="retro-btn px-5 py-2 text-xs"
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
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay">
                                <div className="retro-panel retro-cut p-6 max-w-md w-full text-gray-100">
                                    <h2 className="retro-display text-base retro-glow-cyan mb-4">Add to Mixtape</h2>
                                    {playlistError && <p className="text-red-400 text-sm mb-4">{playlistError}</p>}
                                    <div className="mb-4">
                                        <h3 className="retro-eyebrow mb-2">New Mixtape</h3>
                                        <form onSubmit={handleCreatePlaylist} className="flex space-x-2">
                                            <input
                                                type="text"
                                                value={newPlaylistName}
                                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                                placeholder="Mixtape name"
                                                className="retro-field flex-1"
                                            />
                                            <button
                                                type="submit"
                                                className="retro-btn retro-btn--hot px-4 py-2 text-xs"
                                            >
                                                Create
                                            </button>
                                        </form>
                                    </div>
                                    <div>
                                        <h3 className="retro-eyebrow mb-2">Your Mixtapes</h3>
                                        {playlists.length === 0 ? (
                                            <p className="text-sm text-gray-300">No mixtapes yet. Make one above.</p>
                                        ) : (
                                            <ul className="space-y-2">
                                                {playlists.map((playlist) => (
                                                    <li key={playlist.id} className="flex justify-between items-center">
                                                        <span>{playlist.name} ({playlist.song_count} songs)</span>
                                                        <button
                                                            onClick={() => handleAddToPlaylist(playlist.id)}
                                                            className="retro-btn px-3 py-1 text-[0.6rem]"
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
                                            className="retro-btn px-5 py-2 text-xs"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {showReviewDeleteConfirm && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center retro-layer-overlay">
                                <div className="retro-panel retro-cut p-6 max-w-md w-full text-gray-100">
                                    <h2 className="retro-display text-base retro-glow-cyan mb-4">Confirm Delete Review</h2>
                                    <p className="mb-6 text-gray-300">
                                        Are you sure you want to delete this review? This action cannot be undone.
                                    </p>
                                    <div className="flex justify-end space-x-4">
                                        <button
                                            onClick={() => {
                                                setShowReviewDeleteConfirm(false);
                                                setReviewToDelete(null);
                                            }}
                                            className="retro-btn px-5 py-2 text-xs"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={confirmDeleteReview}
                                            className="retro-btn retro-btn--danger px-5 py-2 text-xs"
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