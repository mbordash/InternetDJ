import { useEffect, useState, useContext, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PlayIcon, PauseIcon, HeartIcon, XMarkIcon, ForwardIcon } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { Helmet } from 'react-helmet-async';
import profilePath from '../utils/profilePath';

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

    // Shared shell for the loading / error / empty states.
    const StatusScreen = ({ eyebrow, children }) => (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center text-gray-100">
            <div className="retro-panel retro-cut container mx-auto max-w-xl px-6 py-10 text-center">
                <div className="retro-eyebrow mb-3">{eyebrow}</div>
                {children}
            </div>
        </div>
    );

    if (isLoading) {
        return (
            <StatusScreen eyebrow="// Cueing Up //">
                <p className="retro-mono text-2xl text-cyan-200">&gt; loading the next track&hellip;</p>
            </StatusScreen>
        );
    }

    if (error) {
        return (
            <StatusScreen eyebrow="!! Signal Lost !!">
                <p className="retro-mono text-2xl text-fuchsia-300">{error}</p>
                {likeError && <p className="retro-mono text-lg text-fuchsia-400 mt-2">{likeError}</p>}
                {!user ? (
                    <Link to="/login" className="retro-btn retro-btn--hot px-6 py-3 text-xs mt-6">
                        Log In For Personalized Discover
                    </Link>
                ) : (
                    <button
                        onClick={() => {
                            setError(null);
                            setLikeError(null);
                            loadSongs();
                        }}
                        className="retro-btn retro-btn--hot px-6 py-3 text-xs mt-6"
                    >
                        Try Again
                    </button>
                )}
            </StatusScreen>
        );
    }

    if (recommendedSongs.length === 0) {
        return (
            <StatusScreen eyebrow="// Crate Empty //">
                <p className="retro-mono text-2xl text-gray-300">&gt; no songs available to discover.</p>
                <button
                    onClick={() => {
                        setError(null);
                        setLikeError(null);
                        loadSongs();
                    }}
                    className="retro-btn retro-btn--hot px-6 py-3 text-xs mt-6"
                >
                    Try Again
                </button>
            </StatusScreen>
        );
    }

    const selectedSong = recommendedSongs[currentIndex];

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen text-gray-100">
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

            <div className="container mx-auto px-4 py-10">
                <header className="text-center mb-8">
                    <div className="retro-eyebrow mb-3">&#10024; Auto A.I. DJ &#10024;</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-5xl">Discover</h1>
                    <p className="retro-mono text-xl text-cyan-200 mt-3">
                        One track at a time. Keep it, skip it, or kill it.
                    </p>
                </header>

                {isGuest && (
                    <div className="retro-panel retro-cut max-w-2xl mx-auto mb-8 px-5 py-4 text-center">
                        <p className="retro-mono text-xl text-gray-300">
                            &gt; preview mix. log in and the DJ starts learning your taste.
                        </p>
                        <Link to="/login" className="retro-btn px-5 py-2 text-[0.6rem] mt-3">
                            Log In For Better Results
                        </Link>
                    </div>
                )}

                <div className="retro-panel retro-cut max-w-md mx-auto p-5 sm:p-6">
                    {/* Now-playing artwork */}
                    <div className="relative mb-5 retro-scanlines overflow-hidden border border-cyan-400/40">
                        <Link to={`/song/${selectedSong.id}`}>
                            {selectedSong.image_url ? (
                                <img
                                    src={selectedSong.image_url}
                                    alt={selectedSong.title}
                                    className="w-full h-auto aspect-square object-cover"
                                    onError={() => console.error('Song image failed to load:', selectedSong.image_url)}
                                    loading="lazy"
                                />
                            ) : (
                                <div className="w-full aspect-square bg-gradient-to-br from-fuchsia-900/50 to-cyan-900/40 flex items-center justify-center retro-pixel text-cyan-300 text-xs">
                                    NO ART
                                </div>
                            )}
                        </Link>

                        {isPreviewPlaying && (
                            <span className="retro-eq absolute bottom-3 right-3 z-10">
                                <span /><span /><span /><span />
                            </span>
                        )}

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
                                className="retro-play-overlay z-20"
                                aria-label={isPreviewPlaying ? 'Pause song' : 'Play song'}
                            >
                                <span className="w-20 h-20 rounded-full border-2 border-cyan-300 bg-black/60 flex items-center justify-center shadow-[0_0_32px_rgba(0,240,255,0.6)]">
                                    {isPreviewPlaying
                                        ? <PauseIcon className="w-10 h-10 text-cyan-200" />
                                        : <PlayIcon className="w-10 h-10 text-cyan-200 ml-1" />}
                                </span>
                            </button>
                        )}
                    </div>

                    <div className="text-center">
                        <Link
                            to={`/song/${selectedSong.id}`}
                            className="retro-display text-base text-white hover:text-cyan-200 block break-words"
                        >
                            {selectedSong.title}
                        </Link>
                        <Link
                            to={profilePath(selectedSong)}
                            className="retro-link retro-mono text-2xl"
                        >
                            {selectedSong.profile_name}
                        </Link>

                        <div className="mt-3">
                            {selectedSong?.genre ? (
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {selectedSong.genre
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
                                <p className="retro-mono text-lg text-gray-500">&gt; no genres specified</p>
                            )}
                        </div>
                    </div>

                    {autoplayBlocked && (
                        <p className="retro-mono text-lg text-amber-300 mt-3 text-center">
                            &gt; hit play to start the track.
                        </p>
                    )}
                    {likeError && (
                        <p className="retro-mono text-lg text-fuchsia-400 mt-3 text-center">{likeError}</p>
                    )}

                    {/* Transport: kill it, skip it, keep it. */}
                    <div className="mt-7 flex justify-between items-start">
                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={() => handlePreference(selectedSong.id, false)}
                                className="retro-arcade retro-arcade--nope"
                                aria-label="Dislike song"
                            >
                                <XMarkIcon className="w-8 h-8" />
                            </button>
                            <span className="retro-arcade__cap">Nope</span>
                        </div>

                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={() => handleSkip()}
                                className="retro-arcade retro-arcade--skip"
                                aria-label="Skip to next song"
                            >
                                <ForwardIcon className="w-8 h-8" />
                            </button>
                            <span className="retro-arcade__cap">Skip</span>
                        </div>

                        <div className="flex flex-col items-center gap-2">
                            <button
                                onClick={() => handlePreference(selectedSong.id, !isSongLiked)}
                                className={`retro-arcade retro-arcade--yes ${(isSongLiked && !isGuest) ? 'retro-arcade--on' : ''}`}
                                aria-label={isSongLiked ? 'Unlike song' : 'Like song'}
                            >
                                <HeartIcon className="w-8 h-8" />
                            </button>
                            <span className="retro-arcade__cap">Keep</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Discover;
