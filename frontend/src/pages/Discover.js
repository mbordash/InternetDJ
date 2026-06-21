import { useEffect, useState, useContext, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PlayIcon, PauseIcon, HeartIcon, XMarkIcon, ForwardIcon } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { Helmet } from 'react-helmet-async';

function Discover() {
    const { user } = useContext(AuthContext);
    const baseUrl = SITE_URL;
    const [recommendedSongs, setRecommendedSongs] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [likeError, setLikeError] = useState(null);
    const audioRef = useRef(new Audio());
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
    const [playlists, setPlaylists] = useState([]);
    const [isSongLiked, setIsSongLiked] = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const isGuest = !user || !user.id;

    const fetchPersonalizedSongs = async () => {
        const token = localStorage.getItem('token');
        if (!token || !user?.id) {
            throw new Error('No authentication token found');
        }
        const response = await axios.get(`${API_URL}/profile/${user.id}/recommended-songs`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return Array.isArray(response.data) ? response.data : [];
    };

    const fetchGuestSongs = async () => {
        const [highestRatedRes, latestRes] = await Promise.allSettled([
            axios.get(`${API_URL}/music/highest-rated`),
            axios.get(`${API_URL}/music/latest`),
        ]);

        const combined = [];

        if (highestRatedRes.status === 'fulfilled' && Array.isArray(highestRatedRes.value.data)) {
            combined.push(...highestRatedRes.value.data);
        }
        if (latestRes.status === 'fulfilled' && Array.isArray(latestRes.value.data)) {
            combined.push(...latestRes.value.data);
        }

        return Array.from(new Map(combined.map((song) => [song.id, song])).values());
    };

    const loadSongs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const songs = isGuest ? await fetchGuestSongs() : await fetchPersonalizedSongs();

            if (songs.length === 0) {
                setError(isGuest
                    ? 'No songs available to preview right now. Please try again.'
                    : 'No songs available at the moment. Please try again.');
                setRecommendedSongs([]);
                return;
            }

            setRecommendedSongs(songs);
            setCurrentIndex(0);

            if (!isGuest) {
                await checkSongLikedStatus(songs[0].id);
            } else {
                setIsSongLiked(false);
            }
        } catch (err) {
            setError('Failed to load songs: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsLoading(false);
        }
    };

    const advanceToNextSong = async () => {
        audioRef.current.pause();
        setIsPreviewPlaying(false);

        const nextIndex = currentIndex + 1;
        if (nextIndex < recommendedSongs.length) {
            const nextSong = recommendedSongs[nextIndex];
            setCurrentIndex(nextIndex);
            if (!isGuest) {
                await checkSongLikedStatus(nextSong.id);
            }
            playSong(nextSong);
            return;
        }

        await loadSongs();
    };

    useEffect(() => {
        const fetchPlaylists = async () => {
            if (!user || !user.id) return;
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    return;
                }
                const response = await axios.get(`${API_URL}/playlists`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const fetchedPlaylists = response.data.playlists || [];
                setPlaylists(fetchedPlaylists);
                const likesPlaylists = fetchedPlaylists.filter(pl => pl.name.toLowerCase() === 'likes');
                if (likesPlaylists.length > 1) {
                    console.warn(`Multiple "Likes" playlists found for user ${user.id}:`, likesPlaylists);
                }
            } catch (err) {
                console.error('Failed to fetch playlists:', err);
            }
        };

        if (user && user.id) {
            fetchPlaylists();
            loadSongs();
        } else {
            loadSongs();
        }

        return () => {
            audioRef.current.pause();
            setIsPreviewPlaying(false);
        };
    }, [user]);

    const checkSongLikedStatus = async (songId) => {
        if (!user || !user.id || !songId) {
            setIsSongLiked(false);
            return;
        }
        try {
            const token = localStorage.getItem('token');
            const likesPlaylist = playlists.find(pl => pl.name.toLowerCase() === 'likes');
            if (!likesPlaylist) {
                setIsSongLiked(false);
                return;
            }
            const songsResponse = await axios.get(`${API_URL}/playlists/${likesPlaylist.id}/songs`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const isLiked = songsResponse.data.songs.some(s => s.id === Number(songId));
            setIsSongLiked(isLiked);
        } catch (err) {
            console.error('Error checking song liked status:', err);
        }
    };

    const handleLikeSong = async (songId, isLiked) => {
        if (!user || !user.id) {
            setLikeError('Log in to save likes and get more accurate recommendations.');
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            setLikeError('Authentication token missing');
            return;
        }

        try {
            let likesPlaylist = playlists.find(pl => pl.name.toLowerCase() === 'likes');

            if (!likesPlaylist) {
                const response = await axios.post(
                    `${API_URL}/playlists`,
                    { name: 'Likes' },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                likesPlaylist = response.data.playlist;
                setPlaylists(prev => [likesPlaylist, ...prev.filter(pl => pl.name.toLowerCase() !== 'likes')]);
            }

            const songsResponse = await axios.get(`${API_URL}/playlists/${likesPlaylist.id}/songs`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const isSongAlreadyLiked = songsResponse.data.songs.some(s => s.id === Number(songId));

            if (isLiked && !isSongAlreadyLiked) {
                await axios.post(
                    `${API_URL}/playlists/${likesPlaylist.id}/songs`,
                    { songId: Number(songId) },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                setRecommendedSongs(prev =>
                    prev.map(s =>
                        s.id === Number(songId) ? { ...s, likes_count: (s.likes_count || 0) + 1 } : s
                    )
                );
                setPlaylists(prev =>
                    prev.map(pl =>
                        pl.id === likesPlaylist.id ? { ...pl, song_count: (pl.song_count || 0) + 1 } : pl
                    )
                );
                setIsSongLiked(true);
            } else if (!isLiked && isSongAlreadyLiked) {
                await axios.delete(`${API_URL}/playlists/${likesPlaylist.id}/songs/${songId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                setRecommendedSongs(prev =>
                    prev.map(s =>
                        s.id === Number(songId) ? { ...s, likes_count: (s.likes_count || 0) - 1 } : s
                    )
                );
                setPlaylists(prev =>
                    prev.map(pl =>
                        pl.id === likesPlaylist.id ? { ...pl, song_count: (pl.song_count || 0) - 1 } : pl
                    )
                );
                setIsSongLiked(false);
            }
            setLikeError(null);
        } catch (err) {
            setLikeError('Failed to like/unlike song: ' + (err.response?.data?.error || err.message));
        }
    };

    const playSong = (song) => {
        if (!song.mp3_url) {
            console.warn(`No mp3_url for song ID ${song.id}`);
            return;
        }

        audioRef.current.src = song.mp3_url;
        audioRef.current.currentTime = 0;
        audioRef.current.play()
            .then(() => {
                setIsPreviewPlaying(true);
                setAutoplayBlocked(false);
            })
            .catch(err => {
                console.error('Audio playback error:', err);
                setIsPreviewPlaying(false);
                setAutoplayBlocked(true);
            });

        audioRef.current.onended = () => {
            setIsPreviewPlaying(false);
            handlePreference(song.id, true);
        };
    };

    const handlePreference = async (songId, isLiked) => {
        try {
            if (isGuest) {
                if (isLiked) {
                    setLikeError('Log in to save likes and improve your Discover feed.');
                } else {
                    setLikeError(null);
                }
                await advanceToNextSong();
                return;
            }

            await handleLikeSong(songId, isLiked);
            if (!isLiked) {
                await advanceToNextSong();
            }
        } catch (err) {
            console.error('Error in handlePreference:', err);
            setError('Failed to process preference. Please try again.');
        }
    };

    const handleSkip = async () => {
        try {
            await advanceToNextSong();
        } catch (err) {
            console.error('Error in handleSkip:', err);
            setError('Failed to advance to next song. Please try again.');
        }
    };

    if (isLoading) {
        return (
            <div className="text-gray-100 pt-2 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center">
                    <p className="text-gray-300 text-lg">Loading songs...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-gray-100 pt-2 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center spotify-surface max-w-xl">
                    <p className="text-red-400 text-lg">{error}</p>
                    {likeError && <p className="text-red-400 text-sm mt-2">{likeError}</p>}
                    {!user ? (
                        <Link
                            to="/login"
                            className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors mt-4"
                        >
                            Log In For Personalized Discover
                        </Link>
                    ) : (
                        <button
                            onClick={() => {
                                setError(null);
                                setLikeError(null);
                                loadSongs();
                            }}
                            className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors mt-4"
                        >
                            Try Again
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (recommendedSongs.length === 0) {
        return (
            <div className="text-gray-100 pt-2 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center spotify-surface max-w-xl">
                    <p className="text-gray-300 text-lg">No songs available to discover.</p>
                    <button
                        onClick={() => {
                            setError(null);
                            setLikeError(null);
                            loadSongs();
                        }}
                        className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors mt-4"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const selectedSong = recommendedSongs[currentIndex];

    return (
        <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>Auto AI DJ Discover Music</title>
                <meta
                    name="description"
                    content="Auto AI DJ continuous music discovery"
                />
                <link rel="canonical" href={`${baseUrl}/discover`} />
                <meta property="og:title" content="Auto AI DJ Discover Music" />
                <meta property="og:description" content="Auto AI DJ continuous music discovery" />
                <meta property="og:url" content={`${baseUrl}/discover`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Auto AI DJ Discover Music" />
                <meta name="twitter:description" content="Auto AI DJ continuous music discovery" />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-6 text-white text-center">Discover New Music</h1>

                {isGuest && (
                    <div className="max-w-2xl mx-auto mb-6 spotify-surface px-4 py-3 text-center">
                        <p className="text-sm text-gray-200">
                            You are browsing a preview mix. Log in to unlock smarter recommendations based on your likes and skips.
                        </p>
                        <Link
                            to="/login"
                            className="inline-block mt-3 spotify-pill px-4 py-2 rounded-full text-sm transition-colors"
                        >
                            Log In For Better Discover Results
                        </Link>
                    </div>
                )}

                <div className="max-w-md mx-auto spotify-surface p-6">
                    <div className="relative mb-4">
                        <Link to={`/song/${selectedSong.id}`}>
                            {selectedSong.image_url ? (
                                <img
                                    src={selectedSong.image_url}
                                    alt={selectedSong.title}
                                    className="w-full h-auto aspect-square object-cover rounded-md"
                                    onError={() => console.error('Song image failed to load:', selectedSong.image_url)}
                                    loading="lazy"
                                />
                            ) : (
                                <div className="w-full h-auto aspect-square rounded-md bg-zinc-800 flex items-center justify-center text-gray-400 text-xs">
                                    No Image
                                </div>
                            )}
                        </Link>
                        {selectedSong.mp3_url && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isPreviewPlaying) {
                                        audioRef.current.pause();
                                        setIsPreviewPlaying(false);
                                        setAutoplayBlocked(false);
                                    } else {
                                        playSong(selectedSong);
                                    }
                                }}
                                className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                                aria-label={isPreviewPlaying ? 'Pause song' : 'Play song'}
                            >
                                {isPreviewPlaying ? (
                                    <PauseIcon className="w-12 h-12 text-white" />
                                ) : (
                                    <PlayIcon className="w-12 h-12 text-white" />
                                )}
                            </button>
                        )}
                    </div>
                    <div className="text-center">
                        <Link
                            to={`/song/${selectedSong.id}`}
                            className="text-xl font-semibold text-white hover:underline"
                        >
                            {selectedSong.title}
                        </Link>
                        <p className="text-gray-300">
                            <Link
                                to={`/profile/${selectedSong.profile_id}`}
                                className="hover:underline"
                            >
                                {selectedSong.profile_name}
                            </Link>
                        </p>
                        <div className="mt-1">
                            {selectedSong?.genre ? (
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {selectedSong.genre
                                        .split(',')
                                        .filter(genre => genre.trim())
                                        .map((genre, index) => (
                                            <Link
                                                key={index}
                                                to={`/tag/${genre.trim()}`}
                                                className="inline-block bg-white/10 text-gray-100 text-sm font-semibold px-2 py-1 rounded-md hover:bg-white/20 transition-colors"
                                            >
                                                {genre.trim()}
                                            </Link>
                                        ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400">No genres specified</p>
                            )}
                        </div>
                    </div>
                    {autoplayBlocked && (
                        <p className="text-yellow-400 text-sm mt-2 text-center">
                            Please click the play button to start the song.
                        </p>
                    )}
                    {likeError && (
                        <p className="text-primary-brand-300 text-sm mt-2 text-center">{likeError}</p>
                    )}
                    <div className="mt-6 flex justify-between">
                        <button
                            onClick={() => handlePreference(selectedSong.id, false)}
                            className="p-4 bg-red-500 rounded-full hover:bg-red-600"
                            aria-label="Dislike song"
                        >
                            <XMarkIcon className="w-8 h-8 text-white" />
                        </button>
                        <button
                            onClick={() => handleSkip()}
                            className="p-4 bg-primary-brand-500 rounded-full hover:bg-primary-brand-400"
                            aria-label="Skip to next song"
                        >
                            <ForwardIcon className="w-8 h-8 text-white" />
                        </button>
                        <button
                            onClick={() => handlePreference(selectedSong.id, !isSongLiked)}
                            className={`p-4 ${(isSongLiked && !isGuest) ? 'bg-primary-brand-500 hover:bg-primary-brand-600' : 'bg-gray-500 hover:bg-gray-600'} rounded-full`}
                            aria-label={isSongLiked ? 'Unlike song' : 'Like song'}
                        >
                            <HeartIcon className="w-8 h-8 text-white" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Discover;