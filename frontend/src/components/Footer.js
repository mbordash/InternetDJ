import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import { AuthContext } from '../context/AuthContext';
import { PlayIcon, PauseIcon, XMarkIcon, ForwardIcon, BackwardIcon, HeartIcon as HeartIconSolid, InformationCircleIcon } from '@heroicons/react/24/solid';
import { HeartIcon as HeartIconOutline } from '@heroicons/react/24/outline';
import axios from 'axios';
import API_URL from '../utils/api';

const DiscordIcon = ({ className }) => (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.078.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.249.077.077 0 00-.078-.037A19.736 19.736 0 003.677 4.369a.069.069 0 00-.029.027C.533 9.045-.319 13.579.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.074.074 0 00-.041-.104 13.607 13.607 0 01-1.872-.878.075.075 0 01-.008-.125c.126-.094.252-.192.372-.292a.077.077 0 01.089-.011 15.269 15.269 0 0012.723 0 .077.077 0 01.09.011c.12.1.246.198.372.292a.075.075 0 01-.006.125 13.612 13.612 0 01-1.873.878.076.076 0 00-.04.104c.36.698.775 1.367 1.225 1.994a.076.076 0 00.084.028 19.831 19.831 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.673-3.548-13.66a.061.061 0 00-.028-.028zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.333-.956 2.419-2.157 2.419zm7.974 0c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.333-.946 2.419-2.157 2.419z"/>
    </svg>
);

const XIcon = ({ className }) => (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
);

const Footer = () => {
    const {
        currentSong,
        isPlaying,
        togglePlayPause,
        stopPlayback,
        pausePlayback,
        audioRef,
        songQueue,
        currentQueueIndex,
        nextSong,
        prevSong,
    } = useContext(AudioPlayerContext);

    // Add this to debug
    useEffect(() => {
        console.log('currentSong:', currentSong);
        console.log('isPlaying:', isPlaying);
    }, [currentSong, isPlaying]);

    console.log('Footer class:', currentSong ? 'fixed' : 'static');


    const { user } = useContext(AuthContext);
    const isAuthenticated = !!user;
    const [state, setState] = useState({
        progress: 0,
        currentTime: 0,
        duration: 0,
    });
    const [isLiked, setIsLiked] = useState(false);
    const [likeError, setLikeError] = useState(null);
    const [playlists, setPlaylists] = useState([]);
    const progressBarRef = useRef(null);
    const location = useLocation();

    const isSongPage = location.pathname.match(/^\/song\/[^/]+$/);

    useEffect(() => {
        if (isSongPage && isPlaying) {
            pausePlayback();
        }
    }, [isSongPage, isPlaying, pausePlayback]);

    const formatTime = (seconds) => {
        if (isNaN(seconds) || seconds === 0) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const updateProgress = useCallback(() => {
        const audio = audioRef.current;
        if (audio && audio.duration) {
            const progress = (audio.currentTime / audio.duration) * 100;
            setState({
                progress,
                currentTime: audio.currentTime,
                duration: audio.duration,
            });
        }
    }, [audioRef]);

    useEffect(() => {
        if (isSongPage) return;

        const audio = audioRef.current;
        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', () => {
            setState((prev) => ({ ...prev, duration: audio.duration }));
        });

        return () => {
            audio.removeEventListener('timeupdate', updateProgress);
            audio.removeEventListener('loadedmetadata', () => {});
        };
    }, [audioRef, isSongPage, updateProgress]);

    const handleSeek = (e) => {
        if (!progressBarRef.current) return;
        const rect = progressBarRef.current.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const progressPercent = Math.max(0, Math.min(100, (offsetX / rect.width) * 100));
        const audio = audioRef.current;
        const newTime = (progressPercent / 100) * audio.duration;
        audio.currentTime = newTime;
        setState((prev) => ({
            ...prev,
            progress: progressPercent,
            currentTime: newTime,
        }));
    };

    useEffect(() => {
        const fetchPlaylistsAndLikeStatus = async () => {
            if (!isAuthenticated || !currentSong?.id) return;

            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/playlists`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const fetchedPlaylists = response.data || [];
                setPlaylists(fetchedPlaylists);

                const likesPlaylist = fetchedPlaylists.find((pl) => pl.name.toLowerCase() === 'likes');
                if (likesPlaylist) {
                    const songsResponse = await axios.get(`${API_URL}/playlists/${likesPlaylist.id}/songs`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    const isSongLiked = songsResponse.data.songs.some((s) => s.id === Number(currentSong.id));
                    setIsLiked(isSongLiked);
                } else {
                    setIsLiked(false);
                }
            } catch (err) {
                console.error('Failed to fetch playlists or like status:', err);
                setLikeError('Failed to load like status');
            }
        };

        fetchPlaylistsAndLikeStatus();
    }, [isAuthenticated, currentSong?.id]);

    const handleLikeSong = async () => {
        if (!isAuthenticated) {
            setLikeError('You must be logged in to like a song');
            setTimeout(() => setLikeError(null), 3000);
            return;
        }

        const token = localStorage.getItem('token');
        try {
            let likesPlaylist = playlists.find((pl) => pl.name.toLowerCase() === 'likes');

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
                headers: { Authorization: `Bearer ${token}` },
            });
            const isSongAlreadyLiked = songsResponse.data.songs.some((s) => s.id === Number(currentSong.id));

            if (isSongAlreadyLiked) {
                await axios.delete(`${API_URL}/playlists/${likesPlaylist.id}/songs/${currentSong.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                setIsLiked(false);
                setPlaylists(playlists.map((pl) =>
                    pl.id === likesPlaylist.id ? { ...pl, song_count: pl.song_count - 1 } : pl
                ));
            } else {
                await axios.post(
                    `${API_URL}/playlists/${likesPlaylist.id}/songs`,
                    { songId: Number(currentSong.id) },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                setIsLiked(true);
                setPlaylists(playlists.map((pl) =>
                    pl.id === likesPlaylist.id ? { ...pl, song_count: pl.song_count + 1 } : pl
                ));
            }
            setLikeError(null);
        } catch (err) {
            setLikeError('Failed to like/unlike song: ' + (err.response?.data?.error || err.message));
            setTimeout(() => setLikeError(null), 3000);
        }
    };

    return (
        <footer className={`bg-gray-900 text-white py-6 w-full ${currentSong ? 'fixed bottom-0 left-0 z-50' : 'static'}`}>
            <div className="container mx-auto px-4">
                {currentSong ? (
                    <div className="flex items-center justify-between space-x-4 w-full mb-4">
                        {/* Album Cover */}
                        <Link to={`/song/${currentSong.id}`} className="flex-shrink-0">
                            {currentSong.image_url ? (
                                <img
                                    src={currentSong.image_url}
                                    alt={currentSong.title}
                                    className="w-12 h-12 rounded-md object-cover"
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        e.target.nextSibling.style.display = 'flex';
                                    }}
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-md bg-gray-600 flex items-center justify-center text-gray-400 text-sm">
                                    No Image
                                </div>
                            )}
                        </Link>
                        <div className="flex-1">
                            {/* Artist Name and Song Title */}
                            <div className="text-sm font-semibold truncate">
                                {currentSong.profile_id && currentSong.profile_name ? (
                                    <Link
                                        to={`/profile/${currentSong.profile_id}`}
                                        className="hover:underline"
                                        aria-label={`View profile of ${currentSong.profile_name}`}
                                    >
                                        {currentSong.profile_name}
                                    </Link>
                                ) : (
                                    <span>{currentSong.profile_name || 'Unknown Artist'}</span>
                                )}
                                {' - '}
                                <Link
                                    to={`/song/${currentSong.id}`}
                                    className="hover:underline"
                                    aria-label={`View song ${currentSong.title}`}
                                >
                                    {currentSong.title}
                                </Link>
                            </div>
                            {/* Time Display */}
                            <p className="text-xs text-gray-400">
                                {formatTime(state.currentTime)} / {formatTime(state.duration)}
                            </p>
                            {/* Progress Bar */}
                            <div
                                ref={progressBarRef}
                                className="w-full h-1 bg-gray-600 rounded-full mt-2 cursor-pointer relative"
                                onClick={handleSeek}
                                role="slider"
                                aria-label="Seek audio"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow={state.progress}
                            >
                                <div
                                    className="h-full bg-primary-brand rounded-full absolute top-0 left-0"
                                    style={{ width: `${state.progress}%`, transition: 'width 0.05s linear' }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            {/* Previous Song Button */}
                            <button
                                onClick={prevSong}
                                className={`p-2 rounded-full hover:bg-gray-700 focus:outline-none ${currentQueueIndex <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={currentQueueIndex <= 0}
                                aria-label="Previous song"
                            >
                                <BackwardIcon className="w-6 h-6" />
                            </button>
                            {/* Play/Pause Button */}
                            <button
                                onClick={togglePlayPause}
                                className="p-2 rounded-full hover:bg-gray-700 focus:outline-none"
                                aria-label={isPlaying ? 'Pause' : 'Play'}
                            >
                                {isPlaying ? (
                                    <PauseIcon className="w-6 h-6" />
                                ) : (
                                    <PlayIcon className="w-6 h-6" />
                                )}
                            </button>
                            {/* Next Song Button */}
                            <button
                                onClick={nextSong}
                                className={`p-2 rounded-full hover:bg-gray-700 focus:outline-none ${currentQueueIndex >= songQueue.length - 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={currentQueueIndex >= songQueue.length - 1}
                                aria-label="Next song"
                            >
                                <ForwardIcon className="w-6 h-6" />
                            </button>
                            {/* Stop Button */}
                            <button
                                onClick={stopPlayback}
                                className="p-2 rounded-full hover:bg-gray-700 focus:outline-none"
                                aria-label="Stop playback"
                            >
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                            {/* Like Button */}
                            {isAuthenticated && (
                                <button
                                    onClick={handleLikeSong}
                                    className={`p-2 rounded-full hover:bg-gray-700 focus:outline-none ${isLiked ? 'text-red-500' : 'text-white'}`}
                                    aria-label={isLiked ? 'Unlike song' : 'Like song'}
                                >
                                    {isLiked ? (
                                        <HeartIconSolid className="w-6 h-6" />
                                    ) : (
                                        <HeartIconOutline className="w-6 h-6" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-between items-center w-full">
                        <p>© {new Date().getFullYear()} InternetDJ.co - All rights reserved.</p>
                        <div className="flex items-center space-x-4">
                            <span>Serving Independent Music since 1997</span>
                            <Link
                                to="/about"
                                className="flex items-center text-white hover:text-gray-300 transition-colors"
                                aria-label="Learn more about InternetDJ"
                            >
                                <InformationCircleIcon className="w-6 h-6" />
                            </Link>
                            <a
                                href="https://discord.gg/AbebAd3yS8"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-white hover:text-gray-300 transition-colors"
                                aria-label="Join our Discord server"
                            >
                                <DiscordIcon className="w-6 h-6" />
                            </a>
                            <a
                                href="https://x.com/internetdjco"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-white hover:text-gray-300 transition-colors"
                                aria-label="Follow us on X"
                            >
                                <XIcon className="w-6 h-6" />
                            </a>
                        </div>
                    </div>
                )}
                {likeError && (
                    <div className="mt-2">
                        <p className="text-red-400 text-sm">{likeError}</p>
                    </div>
                )}
            </div>
        </footer>
    );
};

export default Footer;