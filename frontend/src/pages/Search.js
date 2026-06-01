import { useEffect, useState, useContext } from 'react';
import { useLocation, Link } from 'react-router-dom';
import axios from 'axios';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import { getDefaultAvatar } from '../utils/defaultAvatar';

function Search() {
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [songs, setSongs] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [error, setError] = useState(null);
    const location = useLocation();

    const query = new URLSearchParams(location.search).get('q') || '';

    useEffect(() => {
        const fetchData = async () => {
            try {
                console.log('API URL:', API_URL);
                const response = await axios.get(`${API_URL}/music/search`, {
                    params: { q: query },
                });
                console.log('Search API Response:', response.data);
                setSongs(Array.isArray(response.data.songs) ? response.data.songs : []);
                setProfiles(Array.isArray(response.data.profiles) ? response.data.profiles : []);
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                    url: err.config?.url,
                });
                setError('Failed to load search results: ' + (err.response?.data?.error || err.message));
            }
        };

        if (query.trim()) {
            fetchData();
        } else {
            setSongs([]);
            setProfiles([]);
        }
    }, [query]);

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
                console.log(`Play recorded for song ID: ${song.id}`);
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
            console.warn(`No mp3_url for song ID ${song.id}. Attempting to fetch or use fallback.`);
            song.mp3_url = song.mp3_url || '';
        }

        playSong({
            id: song.id,
            title: song.title,
            mp3_url: song.mp3_url,
            image_url: song.image_url,
            profile_id: song.profile_id,
            profile_name: song.profile_name || 'Unknown Artist',
        });
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Unknown';
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ];
        const day = date.getDate();
        const suffix =
            day === 1 || day === 21 || day === 31 ? 'st' :
                day === 2 || day === 22 ? 'nd' :
                    day === 3 || day === 23 ? 'rd' : 'th';
        return `${monthNames[date.getMonth()]} ${day}${suffix}`;
    };

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800">
                <p className="text-red-400 text-lg">{error}</p>
            </div>
        );
    }

    return (
        <div className="bg-white text-gray-800 pt-16">
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-8">
                    Search Results for "{query || 'No query'}"
                </h1>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4">Songs</h2>
                    {songs.length === 0 ? (
                        <p>No songs found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <tbody>
                                {songs.map((song, index) => (
                                    <tr
                                        key={song.id}
                                        className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                                    >
                                        <td className="px-4 py-2 flex items-center space-x-2">
                                            <button
                                                onClick={() => {
                                                    if (currentSong?.id === song.id) {
                                                        togglePlayPause();
                                                    } else {
                                                        handleSongPlay(song);
                                                    }
                                                }}
                                                className="focus:outline-none"
                                            >
                                                {currentSong?.id === song.id && isPlaying ? (
                                                    <PauseIcon className="w-8 h-8 text-black hover:text-gray-700" />
                                                ) : (
                                                    <PlayIcon className="w-8 h-8 text-black hover:text-gray-700" />
                                                )}
                                            </button>
                                            <div className="flex items-center space-x-2">
                                                {song.image_url ? (
                                                    <img
                                                        src={song.image_url}
                                                        alt={song.title}
                                                        className="w-12 h-12 rounded-md object-cover"
                                                        onError={(e) => {
                                                            console.error(
                                                                `Failed to load song image for song ${song.id}:`,
                                                                song.image_url
                                                            );
                                                            e.target.style.display = 'none';
                                                            e.target.nextSibling.style.display = 'block';
                                                        }}
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div
                                                        className="w-12 h-12 rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-xs"
                                                        style={{ display: song.image_url ? 'none' : 'flex' }}
                                                    >
                                                        ?
                                                    </div>
                                                )}
                                                <div>
                                                    <Link
                                                        to={`/song/${song.id}`}
                                                        className="text-black hover:underline"
                                                    >
                                                        {song.title}
                                                    </Link>
                                                    <div className="text-sm text-gray-600">
                                                        <Link
                                                            to={
                                                                song.profile_id
                                                                    ? `/profile/${song.profile_id}`
                                                                    : '#'
                                                            }
                                                            className={
                                                                song.profile_id
                                                                    ? 'text-black hover:underline'
                                                                    : 'text-gray-500 cursor-not-allowed'
                                                            }
                                                        >
                                                            {song.profile_name || 'Unknown Artist'}
                                                        </Link>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">{song.genre || 'Unknown'}</td>
                                        <td className="px-4 py-2">
                        <span className="inline-flex items-center">
                          {Number(song.plays) || 0}
                            <SpeakerWaveIcon className="w-4 h-4 text-black ml-1" />
                        </span>
                                        </td>
                                        <td className="px-4 py-2">
                        <span className="inline-flex items-center">
                          {Number(song.likes_count) || 0}
                            <HeartIconSolid
                                className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-red-600' : 'text-gray-300'}`}
                            />
                        </span>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                <section>
                    <h2 className="text-2xl font-bold mb-4">Profiles</h2>
                    {profiles.length === 0 ? (
                        <p>No profiles found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <tbody>
                                {profiles.map((profile, index) => (
                                    <tr
                                        key={profile.id}
                                        className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                                    >
                                        <td className="px-4 py-2 flex items-center space-x-2">
                                            <img
                                                src={profile.picture_url || getDefaultAvatar(profile.id || profile.name)}
                                                alt={profile.name}
                                                className="w-12 h-12 rounded-md object-cover"
                                                onError={(e) => {
                                                    e.currentTarget.src = getDefaultAvatar(profile.id || profile.name);
                                                }}
                                                loading="lazy"
                                            />
                                            <Link
                                                to={`/profile/${profile.id}`}
                                                className="text-black hover:underline"
                                            >
                                                {profile.name}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-2">{profile.genre || 'Unknown'}</td>
                                        <td className="px-4 py-2">{formatDate(profile.created_at)}</td>
                                        <td className="px-4 py-2">
                        <span className="inline-flex items-center">
                          {Number(profile.total_plays) || 0}
                            <SpeakerWaveIcon className="w-4 h-4 text-black ml-1" />
                        </span>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

export default Search;