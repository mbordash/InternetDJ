import { useEffect, useState, useContext, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PlayIcon, PauseIcon, HeartIcon, XMarkIcon, ForwardIcon } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import {Helmet} from "react-helmet-async";

function Discover() {
    const { user } = useContext(AuthContext);
    const { currentSong, isPlaying } = useContext(AudioPlayerContext);
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
    const [autoplayBlocked, setAutoplayBlocked] = useState(false); // Track autoplay block

    useEffect(() => {
        console.log('AuthContext user:', user);
        console.log('Token:', localStorage.getItem('token'));

        const fetchPlaylists = async () => {
            if (!user || !user.id) return;
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    throw new Error('No authentication token found');
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

        const fetchSongs = async () => {
            setIsLoading(true);
            try {
                if (!user || !user.id) {
                    throw new Error('User not authenticated');
                }
                const token = localStorage.getItem('token');
                if (!token) {
                    throw new Error('No authentication token found');
                }
                const response = await axios.get(`${API_URL}/profile/${user.id}/recommended-songs`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (response.data.length === 0) {
                    setError('No songs available at the moment. Please try again.');
                } else {
                    setRecommendedSongs(response.data);
                    if (response.data.length > 0) {
                        await checkSongLikedStatus(response.data[0].id); // Check liked status, no auto-play
                    }
                }
            } catch (err) {
                setError('Failed to load songs: ' + (err.response?.data?.error || err.message));
            } finally {
                setIsLoading(false);
            }
        };

        if (user && user.id) {
            fetchPlaylists();
            fetchSongs();
        } else {
            const retry = setTimeout(() => {
                if (localStorage.getItem('token')) {
                    setError('Authenticating... Please wait.');
                    setIsLoading(true);
                } else {
                    setError('Please log in to discover songs.');
                    setIsLoading(false);
                }
            }, 1000);
            return () => clearTimeout(retry);
        }

        return () => {
            audioRef.current.pause();
            setIsPreviewPlaying(false);
        };
    }, [user]);

    const checkSongLikedStatus = async (songId) => {
        if (!user || !user.id || !songId) return;
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
            setLikeError('You must be logged in to like a song');
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
            await handleLikeSong(songId, isLiked);
            if (!isLiked) {
                audioRef.current.pause();
                setIsPreviewPlaying(false);

                const nextIndex = currentIndex + 1;
                if (nextIndex < recommendedSongs.length) {
                    setCurrentIndex(nextIndex);
                    await checkSongLikedStatus(recommendedSongs[nextIndex].id);
                    playSong(recommendedSongs[nextIndex]);
                } else {
                    setCurrentIndex(0);
                    setIsLoading(true);
                    const token = localStorage.getItem('token');
                    const response = await axios.get(`${API_URL}/profile/${user.id}/recommended-songs`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });

                    if (response.data.length === 0) {
                        setError('No more songs available. Please try again.');
                        setRecommendedSongs([]);
                    } else {
                        setRecommendedSongs(response.data);
                        await checkSongLikedStatus(response.data[0].id);
                        playSong(response.data[0]);
                    }
                    setIsLoading(false);
                }
            }
        } catch (err) {
            console.error('Error in handlePreference:', err);
            setError('Failed to process preference. Please try again.');
        }
    };

    const handleSkip = async () => {
        try {
            audioRef.current.pause();
            setIsPreviewPlaying(false);

            const nextIndex = currentIndex + 1;
            if (nextIndex < recommendedSongs.length) {
                setCurrentIndex(nextIndex);
                await checkSongLikedStatus(recommendedSongs[nextIndex].id);
                playSong(recommendedSongs[nextIndex]);
            } else {
                setCurrentIndex(0);
                setIsLoading(true);
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/profile/${user.id}/recommended-songs`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (response.data.length === 0) {
                    setError('No more songs available. Please try again.');
                    setRecommendedSongs([]);
                } else {
                    setRecommendedSongs(response.data);
                    await checkSongLikedStatus(response.data[0].id);
                    playSong(response.data[0]);
                }
                setIsLoading(false);
            }
        } catch (err) {
            console.error('Error in handleSkip:', err);
            setError('Failed to advance to next song. Please try again.');
        }
    };

    if (isLoading) {
        return (
            <div className="bg-white text-gray-800 pt-16 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center">
                    <p className="text-gray-600 text-lg">Loading songs...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white text-gray-800 pt-16 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center">
                    <p className="text-red-400 text-lg">{error}</p>
                    {likeError && <p className="text-red-400 text-sm mt-2">{likeError}</p>}
                    {!user ? (
                        <Link
                            to="/login"
                            className="inline-block bg-primary-brand-500 text-white px-4 py-2 rounded-md hover:bg-primary-brand-700 transition-colors mt-4"
                        >
                            Log In
                        </Link>
                    ) : (
                        <button
                            onClick={() => {
                                setError(null);
                                setLikeError(null);
                                setIsLoading(true);
                                const fetchSongs = async () => {
                                    try {
                                        const token = localStorage.getItem('token');
                                        const response = await axios.get(`${API_URL}/profile/${user.id}/recommended-songs`, {
                                            headers: { Authorization: `Bearer ${token}` },
                                        });

                                        if (response.data.length === 0) {
                                            setError('No songs available at the moment. Please try again.');
                                        } else {
                                            setRecommendedSongs(response.data);
                                            if (response.data.length > 0) {
                                                await checkSongLikedStatus(response.data[0].id);
                                            }
                                        }
                                    } catch (err) {
                                        setError('Failed to load songs: ' + (err.response?.data?.error || err.message));
                                    } finally {
                                        setIsLoading(false);
                                    }
                                };
                                fetchSongs();
                            }}
                            className="inline-block bg-primary-brand-500 text-white px-4 py-2 rounded-md hover:bg-primary-brand-700 transition-colors mt-4"
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
            <div className="bg-white text-gray-800 pt-16 min-h-screen flex items-center justify-center">
                <div className="container mx-auto px-4 py-8 text-center">
                    <p className="text-gray-600 text-lg">No songs available to discover.</p>
                    <button
                        onClick={() => {
                            setError(null);
                            setLikeError(null);
                            setIsLoading(true);
                            const fetchSongs = async () => {
                                try {
                                    const token = localStorage.getItem('token');
                                    const response = await axios.get(`${API_URL}/profile/${user.id}/recommended-songs`, {
                                        headers: { Authorization: `Bearer ${token}` },
                                    });

                                    if (response.data.length === 0) {
                                        setError('No songs available at the moment. Please try again.');
                                    } else {
                                        setRecommendedSongs(response.data);
                                        if (response.data.length > 0) {
                                            await checkSongLikedStatus(response.data[0].id);
                                        }
                                    }
                                } catch (err) {
                                    setError('Failed to load songs: ' + (err.response?.data?.error || err.message));
                                } finally {
                                    setIsLoading(false);
                                }
                            };
                            fetchSongs();
                        }}
                        className="inline-block bg-primary-brand-500 text-white px-4 py-2 rounded-md hover:bg-primary-brand-700 transition-colors mt-4"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const selectedSong = recommendedSongs[currentIndex];

    return (
        <div className="bg-white text-gray-800 pt-16 min-h-screen">
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
                <h1 className="text-3xl font-bold mb-8 text-black text-center">Discover New Music</h1>
                <div className="max-w-md mx-auto bg-gray-100 rounded-xl shadow-lg p-6">
                    <div className="relative mb-4">
                        <Link to={`/song/${selectedSong.id}`}>
                            {selectedSong.image_url ? (
                                <img
                                    src={selectedSong.image_url}
                                    alt={selectedSong.title}
                                    className="w-full h-auto aspect-square object-cover rounded-md"
                                    onError={(e) => console.error('Song image failed to load:', selectedSong.image_url)}
                                    loading="lazy"
                                />
                            ) : (
                                <div className="w-full h-auto aspect-square rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-xs">
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
                            className="text-xl font-semibold text-black hover:underline"
                        >
                            {selectedSong.title}
                        </Link>
                        <p className="text-gray-600">
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
                    {autoplayBlocked && (
                        <p className="text-yellow-600 text-sm mt-2 text-center">
                            Please click the play button to start the song.
                        </p>
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
                            className="p-4 bg-primary-brand rounded-full hover:bg-primary-brand-500"
                            aria-label="Skip to next song"
                        >
                            <ForwardIcon className="w-8 h-8 text-white" />
                        </button>
                        <button
                            onClick={() => handlePreference(selectedSong.id, !isSongLiked)}
                            className={`p-4 ${isSongLiked ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-500 hover:bg-gray-600'} rounded-full`}
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