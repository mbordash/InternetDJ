import { useEffect, useState, useContext } from 'react';
import { useLocation, Link } from 'react-router-dom';
import axios from 'axios';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import { getDefaultAvatar } from '../utils/defaultAvatar';
import profilePath from '../utils/profilePath';
import TrackFilters, {
    EMPTY_FILTERS, hasActiveFilters, filtersToParams, TrackMetaChips,
} from '../components/TrackFilters';

function Search() {
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [songs, setSongs] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [missing, setMissing] = useState(null);
    const [busy, setBusy] = useState(false);
    const location = useLocation();

    const query = new URLSearchParams(location.search).get('q') || '';
    const filtersActive = hasActiveFilters(filters);

    useEffect(() => {
        // Either half is now enough on its own: a term, a tempo range, a key,
        // or any combination of them.
        if (!query.trim() && !filtersActive) {
            setSongs([]);
            setProfiles([]);
            setMissing(null);
            setBusy(false);
            return undefined;
        }

        // Debounced and cancellable, so typing in a BPM box does not fire a
        // request per keystroke or let a slow reply overwrite a newer one.
        let cancelled = false;
        setBusy(true);
        const timer = setTimeout(async () => {
            try {
                const response = await axios.get(`${API_URL}/music/search`, {
                    params: { q: query, ...filtersToParams(filters), limit: 50 },
                });
                if (cancelled) return;
                setSongs(Array.isArray(response.data.songs) ? response.data.songs : []);
                setProfiles(Array.isArray(response.data.profiles) ? response.data.profiles : []);
                setMissing(response.data.missing || null);
                setError(null);
            } catch (err) {
                if (cancelled) return;
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                    url: err.config?.url,
                });
                setError('Failed to load search results: ' + (err.response?.data?.error || err.message));
            } finally {
                if (!cancelled) setBusy(false);
            }
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, filters, filtersActive]);

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
            profile_slug: song.profile_slug || null,
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
            <div className="container mx-auto px-4 py-8 text-center text-gray-100">
                <p className="retro-mono text-2xl text-fuchsia-400">{error}</p>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100">
            <div className="container mx-auto px-4 py-8">
                <h1 className="retro-display retro-chrome text-3xl sm:text-4xl mb-8">
                    {query ? `Search Results for "${query}"` : 'Search'}
                </h1>

                <div className="mb-10">
                    <TrackFilters
                        filters={filters}
                        onChange={setFilters}
                        busy={busy}
                        resultCount={filtersActive && !busy ? songs.length : null}
                        missing={missing}
                    />
                </div>

                <section className="mb-12">
                    <h2 className="retro-display text-lg retro-glow-magenta mb-4">Songs</h2>
                    {songs.length === 0 ? (
                        <p className="retro-mono text-xl text-gray-300">
                            {busy
                                ? 'Searching\u2026'
                                : (query.trim() || filtersActive)
                                    ? 'No songs found.'
                                    : 'Search for a track, or filter by tempo and key above.'}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <tbody>
                                {songs.map((song, index) => (
                                    <tr
                                        key={song.id}
                                        className={index % 2 === 0 ? 'bg-transparent' : 'bg-white/5'}
                                    >
                                        <td className="px-4 py-2">
                                            <div className="flex items-center space-x-2 min-w-0">
                                                <button
                                                    onClick={() => {
                                                        if (currentSong?.id === song.id) {
                                                            togglePlayPause();
                                                        } else {
                                                            handleSongPlay(song);
                                                        }
                                                    }}
                                                    className="focus:outline-none shrink-0"
                                                >
                                                    {currentSong?.id === song.id && isPlaying ? (
                                                        <PauseIcon className="w-8 h-8 text-white hover:text-gray-300" />
                                                    ) : (
                                                        <PlayIcon className="w-8 h-8 text-white hover:text-gray-300" />
                                                    )}
                                                </button>
                                                <div className="flex items-center space-x-2 min-w-0">
                                                    {song.image_url ? (
                                                        <img
                                                            src={song.image_url}
                                                            alt={song.title}
                                                            className="w-12 h-12 rounded-md object-cover shrink-0"
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
                                                            className="w-12 h-12 shrink-0 border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300"
                                                            style={{ display: song.image_url ? 'none' : 'flex' }}
                                                        >
                                                            ?
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <Link
                                                            to={`/song/${song.id}`}
                                                            className="retro-link"
                                                        >
                                                            {song.title}
                                                        </Link>
                                                        <TrackMetaChips
                                                            bpm={song.bpm}
                                                            musicalKey={song.musical_key}
                                                            rating={song.avg_rating}
                                                            className="my-1"
                                                        />
                                                        <div className="retro-mono text-lg text-gray-400">
                                                            <Link
                                                                to={
                                                                    song.profile_id
                                                                        ? profilePath(song)
                                                                        : '#'
                                                                }
                                                                className={
                                                                    song.profile_id
                                                                            ? 'retro-link'
                                                                        : 'text-gray-500 cursor-not-allowed'
                                                                }
                                                            >
                                                                {song.profile_name || 'Unknown Artist'}
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                                            <td className="retro-mono text-lg text-gray-300 px-4 py-2">{song.genre || 'Unknown'}</td>
                                        <td className="px-4 py-2">
                        <span className="inline-flex items-center">
                          {Number(song.plays) || 0}
                            <SpeakerWaveIcon className="w-4 h-4 text-gray-300 ml-1" />
                        </span>
                                        </td>
                                        <td className="px-4 py-2">
                        <span className="inline-flex items-center">
                          {Number(song.likes_count) || 0}
                            <HeartIconSolid
                                className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-primary-brand-300' : 'text-gray-400'}`}
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
                    <h2 className="retro-display text-lg retro-glow-magenta mb-4">Profiles</h2>
                    {profiles.length === 0 ? (
                        <p className="retro-mono text-xl text-gray-300">No profiles found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full">
                                <tbody>
                                {profiles.map((profile, index) => (
                                    <tr
                                        key={profile.id}
                                        className={index % 2 === 0 ? 'bg-transparent' : 'bg-white/5'}
                                    >
                                        <td className="px-4 py-2">
                                            <div className="flex items-center space-x-2 min-w-0">
                                                <img
                                                    src={profile.picture_url || getDefaultAvatar(profile.id || profile.name)}
                                                    alt={profile.name}
                                                    className="w-12 h-12 rounded-md object-cover shrink-0"
                                                    onError={(e) => {
                                                        e.currentTarget.src = getDefaultAvatar(profile.id || profile.name);
                                                    }}
                                                    loading="lazy"
                                                />
                                                <Link
                                                    to={profilePath(profile)}
                                                    className="retro-link"
                                                >
                                                    {profile.name}
                                                </Link>
                                            </div>
                                        </td>
                                        <td className="retro-mono text-lg text-gray-300 px-4 py-2">{profile.genre || 'Unknown'}</td>
                                        <td className="retro-mono text-lg text-gray-300 px-4 py-2">{formatDate(profile.created_at)}</td>
                                        <td className="px-4 py-2">
                        <span className="inline-flex items-center">
                          {Number(profile.total_plays) || 0}
                            <SpeakerWaveIcon className="w-4 h-4 text-gray-300 ml-1" />
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