import { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import {Helmet} from "react-helmet-async";
import profilePath from '../utils/profilePath';
import genreTags from '../utils/genreTags';

function New() {
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const baseUrl = SITE_URL;
    const [songs, setSongs] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchThisMonthSongs = async () => {
            try {
                const response = await axios.get(`${API_URL}/music/this-month`);
                setSongs(Array.isArray(response.data) ? response.data : []);
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                });
                setError('Failed to load new songs: ' + (err.response?.data?.error || err.message));
            }
        };

        fetchThisMonthSongs();
    }, []);

    const handleSongPlay = async (song) => {
        const playedKey = `played_${song.id}`;
        if (!sessionStorage.getItem(playedKey)) {
            try {
                const token = localStorage.getItem('token');
                await axios.post(`${API_URL}/music/play/${song.id}`, {}, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                sessionStorage.setItem(playedKey, 'true');
                setSongs((prevSongs) =>
                    prevSongs.map((s) =>
                        s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s
                    )
                );
            } catch (err) {
                console.error('Error recording play:', err);
            }
        }

        if (!song.mp3_url) {
            console.warn(`No mp3_url for song ID ${song.id}. Attempting to use fallback.`);
            song.mp3_url = song.mp3_url || '';
        }

        playSong({
            id: song.id,
            title: song.title,
            mp3_url: song.mp3_url,
            image_url: song.image_url,
            profile_id: song.profile_id,
            profile_slug: song.profile_slug || null,
            profile_name: song.profile_name || 'Unknown Artist',
        });
    };

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="retro-mono text-2xl text-fuchsia-400">{error}</p>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100">
            <Helmet>
                <title>InternetDJ New Music Recently Uploaded</title>
                <meta
                    name="description"
                    content="New electronic music uploaded recently"
                />
                <link rel="canonical" href={`${baseUrl}/new`} />
                <meta property="og:title" content="Recently Uploaded Music" />
                <meta property="og:description" content="New electronic music uploaded recently" />
                <meta property="og:url" content={`${baseUrl}/new`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Recently Uploaded Music" />
                <meta name="twitter:description" content="New electronic music uploaded recently" />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div className="container mx-auto px-4 py-8">
                <header className="mb-8">
                    <div className="retro-eyebrow mb-3">&gt;&gt; Straight Off The Wire</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-4xl">New Releases</h1>
                    <div className="retro-rule mt-4" />
                </header>
                {songs.length === 0 ? (
                    <p className="retro-mono text-xl text-gray-300">No new songs available recently.</p>
                ) : (
                    <div className="md:overflow-x-auto">
                        {/* Table for Desktop */}
                        <table className="retro-table hidden md:table table-fixed">
                            <thead>
                            <tr>
                                <th className="px-4 py-2 text-left w-[40%]">Song</th>
                                <th className="px-4 py-2 text-left w-[20%]">Genre</th>
                                <th className="px-4 py-2 text-left w-[20%]">Plays</th>
                                <th className="px-4 py-2 text-left w-[20%]">Likes</th>
                            </tr>
                            </thead>
                            <tbody>
                            {songs.map((song, index) => (
                                <tr
                                    key={song.id}
                                    
                                >
                                    <td className="px-4 py-2 flex items-center space-x-2">
                                        <div className="relative flex-shrink-0 w-12 h-12">
                                            {song.image_url ? (
                                                <Link to={`/song/${song.id}`} tabIndex={0}>
                                                    <img
                                                        src={song.image_url}
                                                        alt={song.title}
                                                        className="w-12 h-12 rounded-md object-cover"
                                                        onError={(e) => {
                                                            console.error(`Failed to load song image for song ${song.id}:`, song.image_url);
                                                            e.target.style.display = 'none';
                                                            e.target.nextSibling.style.display = 'block';
                                                        }}
                                                        loading="lazy"
                                                    />
                                                </Link>
                                            ) : (
                                                <div className="w-12 h-12 border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300" style={{ display: song.image_url ? 'none' : 'flex' }}>?
                                                </div>
                                            )}
                                            {song.mp3_url && (
                                                <button
                                                    onClick={() => {
                                                        if (currentSong?.id === song.id) {
                                                            togglePlayPause();
                                                        } else {
                                                            handleSongPlay(song);
                                                        }
                                                    }}
                                                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                                                    aria-label={currentSong?.id === song.id && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                                                >
                                                    {currentSong?.id === song.id && isPlaying ? (
                                                        <PauseIcon className="w-4 h-4 text-white" />
                                                    ) : (
                                                        <PlayIcon className="w-4 h-4 text-white" />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center space-x-2 flex-1">
                                            <div className="min-w-0 flex-1">
                                                <Link
                                                    to={`/song/${song.id}`}
                                                    className="retro-display text-xs text-white hover:text-cyan-200 block truncate"
                                                    title={song.title}
                                                >
                                                    {song.title}
                                                </Link>
                                                <div className="text-sm text-gray-300 truncate">
                                                    <Link
                                                        to={song.profile_id ? profilePath(song) : '#'}
                                                        className={song.profile_id ? 'retro-link' : 'text-gray-500 cursor-not-allowed'}
                                                        title={song.profile_name}
                                                    >
                                                        {song.profile_name}
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        {/* genre is free-form and may hold several comma-separated
                                            tags, so each one links to its own tag page rather than
                                            the whole string linking to a single dead tag. */}
                                        <div className="flex flex-wrap gap-2">
                                            {genreTags(song.genre).map((genre) => (
                                                <Link
                                                    key={genre}
                                                    to={`/tag/${encodeURIComponent(genre)}`}
                                                    className="retro-link capitalize"
                                                >
                                                    {genre}
                                                </Link>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                            <span className="inline-flex items-center">
                                                {Number(song.plays) || 0}
                                                <SpeakerWaveIcon className="w-4 h-4 text-gray-300 ml-1" />
                                            </span>
                                    </td>
                                    <td className="px-4 py-2">
                                            <span className="inline-flex items-center">
                                                {Number(song.likes_count) || 0}
                                                <HeartIconSolid className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-primary-brand-300' : 'text-gray-400'}`} />
                                            </span>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>

                        {/* Card Layout for Mobile */}
                        <div className="md:hidden space-y-4">
                            {songs.map((song) => (
                                <div key={song.id} className="retro-card retro-cut p-4 rounded-md shadow-sm hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center space-x-4">
                                        <div className="relative flex-shrink-0 w-16 h-16">
                                            {song.image_url ? (
                                                <Link to={`/song/${song.id}`} tabIndex={0}>
                                                    <img
                                                        src={song.image_url}
                                                        alt={song.title}
                                                        className="w-16 h-16 rounded-md object-cover"
                                                        onError={(e) => {
                                                            console.error(`Failed to load song image for song ${song.id}:`, song.image_url);
                                                            e.target.style.display = 'none';
                                                            e.target.nextSibling.style.display = 'block';
                                                        }}
                                                        loading="lazy"
                                                    />
                                                </Link>
                                            ) : (
                                                <div className="w-16 h-16 border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300" style={{ display: song.image_url ? 'none' : 'flex' }}>?
                                                </div>
                                            )}
                                            {song.mp3_url && (
                                                <button
                                                    onClick={() => {
                                                        if (currentSong?.id === song.id) {
                                                            togglePlayPause();
                                                        } else {
                                                            handleSongPlay(song);
                                                        }
                                                    }}
                                                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                                                    aria-label={currentSong?.id === song.id && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                                                >
                                                    {currentSong?.id === song.id && isPlaying ? (
                                                        <PauseIcon className="w-4 h-4 text-white" />
                                                    ) : (
                                                        <PlayIcon className="w-4 h-4 text-white" />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <Link
                                                to={`/song/${song.id}`}
                                                className="retro-display text-xs text-white hover:text-cyan-200"
                                            >
                                                {song.title}
                                            </Link>
                                            <div className="retro-mono text-lg text-gray-400">
                                                <Link
                                                    to={song.profile_id ? profilePath(song) : '#'}
                                                    className={song.profile_id ? 'retro-link' : 'text-gray-500 cursor-not-allowed'}
                                                >
                                                    {song.profile_name}
                                                </Link>
                                            </div>
                                            {genreTags(song.genre).length > 0 && (
                                                <div className="retro-mono text-lg text-gray-400 mt-1">
                                                    Genre:{' '}
                                                    <span className="inline-flex flex-wrap gap-2 align-bottom">
                                                        {genreTags(song.genre).map((genre) => (
                                                            <Link
                                                                key={genre}
                                                                to={`/tag/${encodeURIComponent(genre)}`}
                                                                className="retro-link capitalize"
                                                            >
                                                                {genre}
                                                            </Link>
                                                        ))}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="retro-mono text-lg text-gray-400 mt-1">
                                                Plays: {Number(song.plays) || 0}
                                                <SpeakerWaveIcon className="w-4 h-4 text-gray-300 inline ml-1" />
                                            </div>
                                            <div className="retro-mono text-lg text-gray-400">
                                                Likes: {Number(song.likes_count) || 0}
                                                <HeartIconSolid className={`w-4 h-4 inline ml-1 ${Number(song.likes_count) > 0 ? 'text-primary-brand-300' : 'text-gray-400'}`} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default New;