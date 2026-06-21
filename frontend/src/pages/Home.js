import { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import { Helmet } from 'react-helmet-async'; // Added import for Helmet
import API_URL from '../utils/api';
import IDJCoinLogo from '../assets/idj-coin.png';
import { getDefaultAvatar } from '../utils/defaultAvatar';

function Home() {
    const { user } = useContext(AuthContext);
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [mostPlayed, setMostPlayed] = useState([]);
    const [highestRated, setHighestRated] = useState([]);
    const [latestSongs, setLatestSongs] = useState([]);
    const [latestProfiles, setLatestProfiles] = useState([]);
    const [popularProfiles, setPopularProfiles] = useState([]);
    const [followedSongs, setFollowedSongs] = useState([]);
    const [recentlyCommentedPosts, setRecentlyCommentedPosts] = useState([]);
    const [error, setError] = useState(null);

    // Define baseUrl for URLs
    const baseUrl = window.location.origin;

    // Updated description to highlight DAW, AI stem creation, and focus on music creators
    const description = "Discover, create, and share music on InternetDJ - the ultimate platform for music creators, DJs, and enthusiasts. Use our built-in DAW for music production, AI-powered stem creation tools, explore new releases, popular tracks, artist profiles, and join discussions in our forum.";

    const shuffleAndLimit = (array, limit) => {
        const shuffled = [...array].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(limit, shuffled.length));
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                console.log('API URL:', API_URL);
                const requests = [
                    axios.get(`${API_URL}/music/most-played`),
                    axios.get(`${API_URL}/music/highest-rated`),
                    axios.get(`${API_URL}/music/latest`),
                    axios.get(`${API_URL}/profile/latest`, {
                        headers: { Accept: 'application/json' },
                    }),
                    axios.get(`${API_URL}/profile/most-popular`, {
                        headers: { Accept: 'application/json' },
                    }),
                    axios.get(`${API_URL}/forum/recently-commented`),
                ];

                if (user) {
                    const token = localStorage.getItem('token');
                    requests.push(
                        axios.get(`${API_URL}/profile/${user.id}/followed-songs`, {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                Accept: 'application/json',
                            },
                        })
                    );
                }

                const [
                    mostPlayedRes,
                    highestRatedRes,
                    latestSongsRes,
                    latestProfilesRes,
                    popularProfilesRes,
                    recentlyCommentedRes,
                    followedSongsRes,
                ] = await Promise.all(requests);

                const normalizeProfiles = (data) => {
                    let profiles = data;
                    if (!Array.isArray(data)) {
                        if (data.profiles) profiles = data.profiles;
                        else if (data.profile) profiles = [data.profile];
                        else if (data && typeof data === 'object') profiles = [data];
                        else {
                            console.error('Invalid profile data:', data);
                            return [];
                        }
                    }
                    return profiles.map((profile) => ({
                        user_id: Number(profile.user_id || 0),
                        profile_id: Number(profile.profile_id || 0),
                        name: profile.name || profile.email || 'Unknown',
                        created_at: profile.created_at || null,
                        total_plays: Number(profile.total_plays) || 0,
                        picture_url: profile.picture_url || null,
                    }));
                };

                setMostPlayed(shuffleAndLimit(Array.isArray(mostPlayedRes.data) ? mostPlayedRes.data : [], 6));
                setHighestRated(shuffleAndLimit(Array.isArray(highestRatedRes.data) ? highestRatedRes.data : [], 6));
                setLatestSongs(shuffleAndLimit(Array.isArray(latestSongsRes.data) ? latestSongsRes.data : [], 6));
                setLatestProfiles(normalizeProfiles(latestProfilesRes.data));
                setPopularProfiles(normalizeProfiles(popularProfilesRes.data));
                setRecentlyCommentedPosts(recentlyCommentedRes.data.posts || []);
                if (user && followedSongsRes) {
                    setFollowedSongs(shuffleAndLimit(Array.isArray(followedSongsRes.data) ? followedSongsRes.data : [], 6));
                }
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                    url: err.config?.url,
                });
                setError('Failed to load data: ' + err.message);
            }
        };

        fetchData();
    }, [user]);

    const formatDate = (dateString) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Unknown';
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ];
        const day = date.getDate();
        const suffix = day === 1 || day === 21 || day === 31 ? 'st' :
            day === 2 || day === 22 ? 'nd' :
                day === 3 || day === 23 ? 'rd' : 'th';
        return `${monthNames[date.getMonth()]} ${day}${suffix}`;
    };

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
                const updateSongPlayCount = (songs) =>
                    songs.map((s) =>
                        s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s
                    );
                setMostPlayed(updateSongPlayCount);
                setHighestRated(updateSongPlayCount);
                setLatestSongs(updateSongPlayCount);
                setFollowedSongs(updateSongPlayCount);
            } catch (err) {
                console.error('Error recording play:', err);
            }
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

    const renderFollowedSongCard = (song) => {
        if (!song.profile_id || song.profile_id <= 0) {
            console.warn(`Invalid profile_id for song ${song.id}:`, song.profile_id);
        }
        return (
            <div
                key={song.id}
                className="bg-zinc-900/80 border border-white/10 rounded-xl p-3 flex items-start hover:bg-zinc-800 transition-colors duration-200 mb-2"
            >
                <div className="relative w-20 h-20 flex-shrink-0 mr-3">
                    {song.image_url ? (
                        <img
                            src={song.image_url}
                            alt={song.title}
                            className="w-full h-full rounded-md object-cover"
                            onError={(e) => {
                                console.error(`Failed to load song image for song ${song.id}:`, song.image_url);
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'block';
                            }}
                            loading="lazy"
                        />
                    ) : (
                        <div
                            className="w-full h-full rounded-md bg-zinc-800 flex items-center justify-center text-gray-400 text-base"
                            style={{ display: song.image_url ? 'none' : 'flex' }}
                        >
                            ?
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
                            aria-label={currentSong?.id === song.id && isPlaying ? 'Pause song' : 'Play song'}
                        >
                            {currentSong?.id === song.id && isPlaying ? (
                                <PauseIcon className="w-4 h-4 text-white" />
                            ) : (
                                <PlayIcon className="w-4 h-4 text-white" />
                            )}
                        </button>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <Link
                        to={`/song/${song.id}`}
                        className="text-base font-semibold text-white hover:underline line-clamp-2"
                    >
                        {song.title}
                    </Link>
                    <div className="text-sm text-gray-300">
                        {song.profile_id > 0 ? (
                            <Link
                                to={`/profile/${song.profile_id}`}
                                className="text-gray-100 hover:underline truncate block"
                            >
                                {song.profile_name || 'Unknown Artist'}
                            </Link>
                        ) : (
                            <span className="text-gray-500 cursor-not-allowed truncate block">
                                {song.profile_name || 'Unknown Artist'}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderSongCard = (song, size = 'default') => {
        if (!song.profile_id || song.profile_id <= 0) {
            console.warn(`Invalid profile_id for song ${song.id}:`, song.profile_id);
        }
        const isSmall = size === 'small';
        const imageSize = isSmall ? 'w-36 h-36' : 'w-48 h-48';
        const fontSize = isSmall ? 'text-base' : 'text-lg';
        const iconSize = isSmall ? 'w-8 h-8' : 'w-12 h-12';
        const containerWidth = isSmall ? 'w-36' : 'w-48';

        return (
            <div
                key={song.id}
                className="bg-zinc-900/80 border border-white/10 rounded-xl p-4 flex flex-col items-center hover:bg-zinc-800/90 transition-colors duration-200"
            >
                <div className={`relative ${imageSize} mb-4`}>
                    {song.image_url ? (
                        <img
                            src={song.image_url}
                            alt={song.title}
                            className="w-full h-full rounded-md object-cover"
                            onError={(e) => {
                                console.error(`Failed to load song image for song ${song.id}:`, song.image_url);
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'block';
                            }}
                            loading="lazy"
                        />
                    ) : (
                        <div
                            className="w-full h-full rounded-md bg-zinc-800 flex items-center justify-center text-gray-400 text-2xl"
                            style={{ display: song.image_url ? 'none' : 'flex' }}
                        >
                            ?
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
                            aria-label={currentSong?.id === song.id && isPlaying ? 'Pause song' : 'Play song'}
                        >
                            {currentSong?.id === song.id && isPlaying ? (
                                <PauseIcon className={`${iconSize} text-white`} />
                            ) : (
                                <PlayIcon className={`${iconSize} text-white`} />
                            )}
                        </button>
                    )}
                </div>
                <div className="text-center">
                    <Link
                        to={`/song/${song.id}`}
                        className={`${fontSize} font-semibold text-white hover:underline block truncate ${containerWidth}`}
                    >
                        {song.title}
                    </Link>
                    <div className="text-sm text-gray-300 mb-2">
                        {song.profile_id > 0 ? (
                            <Link
                                to={`/profile/${song.profile_id}`}
                                className="text-gray-100 hover:underline"
                            >
                                {song.profile_name || 'Unknown Artist'}
                            </Link>
                        ) : (
                            <span className="text-gray-500 cursor-not-allowed">
                                {song.profile_name || 'Unknown Artist'}
                            </span>
                        )}
                    </div>
                    <div className="flex justify-center space-x-4 text-sm">
                        <span className="inline-flex items-center">
                            {Number(song.plays) || 0}
                            <SpeakerWaveIcon className="w-4 h-4 text-gray-200 ml-1" />
                        </span>
                        <span className="inline-flex items-center">
                            {Number(song.likes_count) || 0}
                            <HeartIconSolid
                                className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-primary-brand-400' : 'text-gray-500'}`}
                            />
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    const renderSongRow = (song, index) => {
        if (!song.profile_id || song.profile_id <= 0) {
            console.warn(`Invalid profile_id for song ${song.id}:`, song.profile_id);
        }
        return (
            <tr
                key={song.id}
                className={`${index % 2 === 0 ? 'bg-transparent' : 'bg-white/5'} hover:bg-white/10 transition-colors duration-200`}
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
                            <PauseIcon className="w-8 h-8 text-white hover:text-gray-300" />
                        ) : (
                            <PlayIcon className="w-8 h-8 text-white hover:text-gray-300" />
                        )}
                    </button>
                    <div className="flex items-center space-x-2">
                        {song.image_url ? (
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
                        ) : (
                            <div
                                className="w-12 h-12 rounded-md bg-zinc-800 flex items-center justify-center text-gray-400 text-xs"
                                style={{ display: song.image_url ? 'none' : 'flex' }}
                            >
                                ?
                            </div>
                        )}
                        <div>
                            <Link to={`/song/${song.id}`} className="text-white hover:underline">
                                {song.title}
                            </Link>
                            <div className="text-sm text-gray-300">
                                {song.profile_id > 0 ? (
                                    <Link
                                        to={`/profile/${song.profile_id}`}
                                        className="text-gray-100 hover:underline"
                                    >
                                        {song.profile_name || 'Unknown Artist'}
                                    </Link>
                                ) : (
                                    <span className="text-gray-500 cursor-not-allowed">
                                        {song.profile_name || 'Unknown Artist'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </td>
                <td className="px-4 py-2">
                    <span className="inline-flex items-center">
                        {Number(song.plays) || 0}
                        <SpeakerWaveIcon className="w-4 h-4 text-gray-200 ml-1" />
                    </span>
                </td>
                <td className="px-4 py-2">
                    <span className="inline-flex items-center">
                        {Number(song.likes_count) || 0}
                        <HeartIconSolid
                            className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-primary-brand-400' : 'text-gray-500'}`}
                        />
                    </span>
                </td>
            </tr>
        );
    };

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-zinc-900/70 text-gray-100 rounded-xl border border-white/10">
                <p className="text-red-400 text-lg">{error}</p>
            </div>
        );
    }

    return (
        <>
            <Helmet>
                <title>InternetDJ - Discover, Create, and Share Music</title>
                <meta name="description" content={description} />
                <link rel="canonical" href={baseUrl} />
                <meta property="og:type" content="website" />
                <meta property="og:title" content="InternetDJ - Discover, Create, and Share Music" />
                <meta property="og:description" content={description} />
                <meta property="og:image" content={`${baseUrl}/default-home-image.jpg`} /> {/* Adjust to your default image */}
                <meta property="og:url" content={baseUrl} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="InternetDJ - Discover, Create, and Share Music" />
                <meta name="twitter:description" content={description} />
                <meta name="twitter:image" content={`${baseUrl}/default-home-image.jpg`} /> {/* Adjust to your default image */}
                <meta name="twitter:site" content="@internetdjco" />
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "WebSite",
                        "name": "InternetDJ",
                        "description": description,
                        "url": baseUrl,
                        "publisher": {
                            "@type": "Organization",
                            "name": "InternetDJ",
                            "logo": {
                                "@type": "ImageObject",
                                "url": `${baseUrl}/logo.png` // Adjust to your logo URL
                            }
                        },
                        "potentialAction": {
                            "@type": "SearchAction",
                            "target": `${baseUrl}/search?q={search_term_string}`,
                            "query-input": "required name=search_term_string"
                        }
                    })}
                </script>
            </Helmet>
            <div className="text-gray-100 pt-2">
                <div className="container mx-auto px-4 py-8 min-h-screen">
                    <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_360px] gap-8">
                        <aside className="hidden xl:block xl:sticky xl:top-24 h-fit">
                            <div className="spotify-surface p-4">
                                <h2 className="text-sm uppercase tracking-widest text-gray-300 mb-4">Explore</h2>
                                <div className="space-y-2">
                                    <Link to="/discover" className="block rounded-lg px-3 py-2 bg-white/10 text-white">Discover</Link>
                                    <Link to="/new" className="block rounded-lg px-3 py-2 hover:bg-white/10 text-gray-200">New Releases</Link>
                                    <Link to="/browse" className="block rounded-lg px-3 py-2 hover:bg-white/10 text-gray-200">Browse Artists</Link>
                                    <Link to="/collabs" className="block rounded-lg px-3 py-2 hover:bg-white/10 text-gray-200">Public Collabs</Link>
                                    <Link to="/projects" className="block rounded-lg px-3 py-2 hover:bg-white/10 text-gray-200">Studio / DAW</Link>
                                    <Link to="/stems" className="block rounded-lg px-3 py-2 hover:bg-white/10 text-gray-200">AI Stems</Link>
                                    <Link to="/forum" className="block rounded-lg px-3 py-2 hover:bg-white/10 text-gray-200">Community Forum</Link>
                                </div>
                                <div className="mt-5 border-t border-white/10 pt-4 text-sm text-gray-300">
                                    {user
                                        ? 'Your Discover and follow activity improves recommendations over time.'
                                        : 'Log in to personalize Discover using your likes and listening behavior.'}
                                </div>
                                {!user && (
                                    <Link to="/login" className="inline-block mt-4 spotify-pill px-4 py-2 rounded-full text-sm transition-colors">
                                        Log In
                                    </Link>
                                )}
                            </div>
                        </aside>

                        <div>

                            <section className="mb-12">
                                <h2 className="flex items-center text-2xl font-bold mb-4 font-semibold tracking-tight gap-2">
                                    New Releases
                                    <Link
                                        to="/new"
                                        className="inline-block spotify-pill px-2 py-1 rounded-full transition-colors text-xs"
                                    >
                                        More
                                    </Link>
                                </h2>
                                {latestSongs.length === 0 ? (
                                    <p>No songs available.</p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {latestSongs.map(renderSongCard)}
                                    </div>
                                )}
                            </section>

                            <section className="mb-12">
                                <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">
                                    Highly Liked Songs
                                </h2>
                                {highestRated.length === 0 ? (
                                    <p>No songs available.</p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {highestRated.map(renderSongCard)}
                                    </div>
                                )}
                            </section>

                            <section>
                                <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">
                                    Popular Songs
                                </h2>

                                {mostPlayed.length === 0 ? (
                                    <p>No songs available.</p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {mostPlayed.map(renderSongCard)}
                                    </div>
                                )}
                            </section>

                        </div>

                        <div className="xl:sticky xl:top-24 h-fit">
                            {user && (
                                <section className="mb-12 spotify-surface p-4">
                                    <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">
                                        Songs from Followed Artists
                                    </h2>
                                    {followedSongs.length === 0 ? (
                                        <p>No songs from followed artists.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {followedSongs.slice(0, 4).map(renderFollowedSongCard)}
                                        </div>
                                    )}
                                </section>
                            )}

                            <section className="mb-12 spotify-surface p-4">
                                <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">
                                    New Members
                                </h2>
                                {!Array.isArray(latestProfiles) || latestProfiles.length === 0 ? (
                                    <p>No profiles available.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                            <tbody>
                                            {latestProfiles.map((profile, index) => (
                                                <tr
                                                    key={profile.profile_id}
                                                    className={`${
                                                        index % 2 === 0 ? 'bg-transparent' : 'bg-white/5'
                                                    } hover:bg-white/10 transition-colors duration-200`}
                                                >
                                                    <td className="px-4 py-2 flex items-center space-x-2">
                                                        <img
                                                            src={profile.picture_url || getDefaultAvatar(profile.profile_id || profile.name)}
                                                            alt={profile.name}
                                                            className="w-12 h-12 rounded-md object-cover"
                                                            onError={(e) => {
                                                                e.currentTarget.src = getDefaultAvatar(profile.profile_id || profile.name);
                                                            }}
                                                            loading="lazy"
                                                        />
                                                        <Link
                                                            to={`/profile/${profile.profile_id}`}
                                                            className="text-gray-100 hover:underline"
                                                        >
                                                            {profile.name}
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </section>

                            <section className="mb-12 spotify-surface p-4">
                                <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">
                                    Popular Members
                                </h2>
                                {!Array.isArray(popularProfiles) || popularProfiles.length === 0 ? (
                                    <p>No profiles available.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                            <tbody>
                                            {popularProfiles.map((profile, index) => (
                                                <tr
                                                    key={profile.profile_id}
                                                    className={`${
                                                        index % 2 === 0 ? 'bg-transparent' : 'bg-white/5'
                                                    } hover:bg-white/10 transition-colors duration-200`}
                                                >
                                                    <td className="px-4 py-2 flex items-center space-x-2">
                                                        <img
                                                            src={profile.picture_url || getDefaultAvatar(profile.profile_id || profile.name)}
                                                            alt={profile.name}
                                                            className="w-12 h-12 rounded-md object-cover"
                                                            onError={(e) => {
                                                                e.currentTarget.src = getDefaultAvatar(profile.profile_id || profile.name);
                                                            }}
                                                            loading="lazy"
                                                        />
                                                        <Link
                                                            to={`/profile/${profile.profile_id}`}
                                                            className="text-gray-100 hover:underline"
                                                        >
                                                            {profile.name}
                                                        </Link>
                                                    </td>
                                                    <td className="px-4 py-2">
                                                            <span className="inline-flex items-center">
                                                                {Number(profile.total_plays) || 0}
                                                                <SpeakerWaveIcon className="w-4 h-4 text-gray-200 ml-1" />
                                                            </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                <div className="mt-4">
                                    <Link
                                        to="/browse"
                                        className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors"
                                    >
                                        Explore More Artists
                                    </Link>
                                </div>
                            </section>

                            <section className="mb-12 spotify-surface p-4">
                                <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">
                                    Recently Commented Posts
                                </h2>
                                {recentlyCommentedPosts.length === 0 ? (
                                    <p>No recently commented posts.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full">
                                            <tbody>
                                            {recentlyCommentedPosts.map((post, index) => (
                                                <tr
                                                    key={post.id}
                                                    className={`${
                                                        index % 2 === 0 ? 'bg-transparent' : 'bg-white/5'
                                                    } hover:bg-white/10 transition-colors duration-200`}
                                                >
                                                    <td className="px-4 py-2">
                                                        <Link
                                                            to={`/forum/post/${post.id}`}
                                                            className="text-gray-100 hover:underline"
                                                        >
                                                            {post.title}
                                                        </Link>
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        {formatDate(post.last_commented_at)}
                                                    </td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                <div className="mt-4">
                                    <Link
                                        to="/forum"
                                        className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors"
                                    >
                                        Visit Forum
                                    </Link>
                                </div>
                            </section>

                            <section className="spotify-surface p-4">
                                <div className="flex items-start space-x-4">
                                    <img
                                        src={IDJCoinLogo}
                                        alt="IDJ Coin"
                                        className="w-24 h-24 flex-shrink-0"
                                        onError={(e) => {
                                            console.error('Failed to load IDJ Coin logo');
                                            e.target.style.display = 'none';
                                        }}
                                    />
                                    <div className="flex-1">
                                        <h2 className="text-2xl font-bold mb-2 font-semibold tracking-tight">IDJ Coin</h2>
                                        <p className="text-gray-300 mb-4">
                                            Powering InternetDJ with decentralized rewards and community growth.
                                        </p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                                    <div className="bg-white/5 p-2 rounded-md">
                                        <span className="font-semibold">Total Initial Supply:</span> 1B
                                    </div>
                                    <div className="bg-white/5 p-2 rounded-md">
                                        <span className="font-semibold">Founders Grant:</span> 200M
                                    </div>
                                    <div className="bg-white/5 p-2 rounded-md">
                                        <span className="font-semibold">Liquidity Pool:</span> 100M
                                    </div>
                                    <div className="bg-white/5 p-2 rounded-md">
                                        <span className="font-semibold">Locked (1Y):</span> 500M
                                    </div>
                                </div>
                                <Link
                                    to="/idj-coin"
                                    className="inline-block spotify-pill px-4 py-2 rounded-full transition-colors"
                                >
                                    Learn More
                                </Link>
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default Home;