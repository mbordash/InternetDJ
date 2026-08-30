import React, { useEffect, useState, useContext, useMemo, useRef } from 'react';
import axios from 'axios';
import { Link, useSearchParams } from 'react-router-dom';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { Helmet } from "react-helmet-async";
import profilePath from '../utils/profilePath';
import TrackFilters, {
    hasActiveFilters, filtersToParams, paramsToFilters, TrackMetaChips,
} from '../components/TrackFilters';
import { tagHref } from '../utils/genreTags';

function Browse() {
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const baseUrl = SITE_URL;
    const [tags, setTags] = useState([]);
    const [featuredSong, setFeaturedSong] = useState(null);
    const [unreviewedSongs, setUnreviewedSongs] = useState([]);
    const [error, setError] = useState(null);
    const [genreQuery, setGenreQuery] = useState('');
    // Filters live in the URL as well as in state: that is what lets the BPM
    // and key on a song page link straight into a filtered browse, and what
    // makes a filtered view survive a reload or a share.
    const [searchParams, setSearchParams] = useSearchParams();
    const [filters, setFilters] = useState(() => paramsToFilters(searchParams));
    const [filterResults, setFilterResults] = useState([]);
    const [filterMissing, setFilterMissing] = useState(null);
    const [filterBusy, setFilterBusy] = useState(false);
    const [filterError, setFilterError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const tagResponse = await axios.get(`${API_URL}/music/by-tags`);
                // Tolerate both API shapes so the frontend and backend can be
                // deployed in either order: the slim response carries `count`
                // and `thumbs`, the old one carried a full `songs` array.
                const genres = (Array.isArray(tagResponse.data) ? tagResponse.data : []).map(tag => {
                    const songs = Array.isArray(tag.songs) ? tag.songs : [];
                    return {
                        tag: tag.tag,
                        label: tag.label || tag.tag,
                        count: typeof tag.count === 'number' ? tag.count : songs.length,
                        thumbs: Array.isArray(tag.thumbs)
                            ? tag.thumbs
                            : songs.map(song => song.image_url).filter(Boolean).slice(0, 3),
                    };
                });
                setTags(genres);

                const featuredResponse = await axios.get(`${API_URL}/music/featured`);
                setFeaturedSong(featuredResponse.data[0] || null);

                const unreviewedResponse = await axios.get(`${API_URL}/music/unreviewed?limit=5`);
                setUnreviewedSongs(Array.isArray(unreviewedResponse.data) ? unreviewedResponse.data : []);
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                    url: err.config?.url,
                });
                setError('Failed to load data: ' + (err.response?.data?.error || err.message));
            }
        };

        fetchData();
    }, []);

    // Mirror the filters into the URL, and adopt a URL we did not write
    // ourselves (a link followed while already here, or back/forward). The ref
    // is what tells those two apart: without it, a half-typed tempo would be
    // parsed back out of the URL and clear the box under the cursor.
    const filterQuery = useMemo(
        () => new URLSearchParams(filtersToParams(filters)).toString(),
        [filters]
    );
    const pushedQuery = useRef(null);

    useEffect(() => {
        if (filterQuery === searchParams.toString()) return;
        pushedQuery.current = filterQuery;
        setSearchParams(filterQuery, { replace: true });
        // searchParams is read, not tracked: reacting to it here is the other
        // effect's job, and depending on it would undo edits mid-keystroke.
    }, [filterQuery]);

    useEffect(() => {
        const query = searchParams.toString();
        if (query === pushedQuery.current) return;
        pushedQuery.current = query;
        setFilters(paramsToFilters(searchParams));
    }, [searchParams]);

    useEffect(() => {
        if (!hasActiveFilters(filters)) {
            setFilterResults([]);
            setFilterMissing(null);
            setFilterBusy(false);
            setFilterError(null);
            return undefined;
        }

        // Typing in a BPM box fires on every keystroke, so wait for a pause,
        // and drop the result if the filters moved on while it was in flight.
        let cancelled = false;
        setFilterBusy(true);
        const timer = setTimeout(async () => {
            try {
                const response = await axios.get(`${API_URL}/music/search`, {
                    params: { ...filtersToParams(filters), limit: 60 },
                });
                if (cancelled) return;
                setFilterResults(response.data.songs || []);
                setFilterMissing(response.data.missing || null);
                setFilterError(null);
            } catch (err) {
                if (cancelled) return;
                setFilterError(err.response?.data?.error || err.message);
                setFilterResults([]);
                setFilterMissing(null);
            } finally {
                if (!cancelled) setFilterBusy(false);
            }
        }, 350);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [filters]);

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
                if (featuredSong?.id === song.id) {
                    setFeaturedSong((prev) => ({
                        ...prev,
                        plays: (Number(prev.plays) || 0) + 1,
                    }));
                }
                setUnreviewedSongs((prevSongs) =>
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

    const toggleSong = (song) => {
        if (currentSong?.id === song.id) {
            togglePlayPause();
        } else {
            handleSongPlay(song);
        }
    };

    // Artwork plus its hover play control. Shared by the table, the mobile
    // cards, the featured slot and the review queue so they stay in sync.
    const SongThumb = ({ song, size, iconSize = 'w-5 h-5' }) => {
        const isLive = currentSong?.id === song.id;
        return (
            <div className={`relative flex-shrink-0 ${size} retro-scanlines overflow-hidden border border-cyan-400/30`}>
                {song.image_url ? (
                    <Link to={`/song/${song.id}`} tabIndex={0}>
                        <img
                            src={song.image_url}
                            alt={song.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                e.target.style.display = 'none';
                                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                            }}
                            loading="lazy"
                        />
                    </Link>
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-fuchsia-900/50 to-cyan-900/40 flex items-center justify-center retro-pixel text-cyan-300 text-[0.5rem]">
                        ?
                    </div>
                )}
                {isLive && isPlaying && (
                    <span className="retro-eq absolute bottom-1 right-1 z-10">
                        <span /><span /><span /><span />
                    </span>
                )}
                {song.mp3_url && (
                    <button
                        onClick={() => toggleSong(song)}
                        className="retro-play-overlay z-20"
                        aria-label={isLive && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                    >
                        {isLive && isPlaying ? <PauseIcon className={iconSize} /> : <PlayIcon className={iconSize} />}
                    </button>
                )}
            </div>
        );
    };

    const ArtistLink = ({ song, className = '' }) => (
        <Link
            to={song.profile_id ? profilePath(song) : '#'}
            className={`retro-mono text-lg truncate ${song.profile_id ? 'retro-link' : 'text-gray-500 cursor-not-allowed'} ${className}`}
            title={song.profile_name}
        >
            {song.profile_name}
        </Link>
    );

    const PlayCount = ({ song }) => (
        <span className="retro-mono text-lg text-cyan-300 inline-flex items-center gap-1">
            {Number(song.plays) || 0}
            <SpeakerWaveIcon className="w-4 h-4" />
        </span>
    );

    const LikeCount = ({ song }) => (
        <span className="retro-mono text-lg inline-flex items-center gap-1 text-gray-300">
            {Number(song.likes_count) || 0}
            <HeartIconSolid
                className={`w-4 h-4 ${Number(song.likes_count) > 0 ? 'text-fuchsia-400' : 'text-gray-500'}`}
            />
        </span>
    );

    const visibleGenres = useMemo(() => {
        const q = genreQuery.trim().toLowerCase();
        return q ? tags.filter(g => g.label.toLowerCase().includes(q)) : tags;
    }, [tags, genreQuery]);

    // A genre tile: three covers from the genre's top tracks, then name + count.
    const GenreCard = ({ genre }) => (
        <Link
            to={tagHref(genre.tag)}
            className="retro-card retro-cut p-3 flex flex-col gap-3 group"
            aria-label={`Browse ${genre.label} \u2014 ${genre.count} tracks`}
        >
            <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => {
                    const cover = genre.thumbs[i];
                    return (
                        <div
                            key={i}
                            className="relative flex-1 aspect-square overflow-hidden retro-scanlines border border-cyan-400/25"
                        >
                            {cover ? (
                                <img
                                    src={cover}
                                    alt=""
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            ) : (
                                <div className="w-full h-full bg-gradient-to-br from-fuchsia-900/40 to-cyan-900/30" />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="flex items-end justify-between gap-2 min-w-0">
                <div className="min-w-0">
                    <h2 className="retro-display text-sm text-white capitalize truncate group-hover:text-cyan-200 transition-colors">
                        {genre.label}
                    </h2>
                    <span className="retro-mono text-lg text-cyan-300">
                        {genre.count} track{genre.count === 1 ? '' : 's'}
                    </span>
                </div>
                <span className="retro-mono text-lg text-fuchsia-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    enter &raquo;&raquo;
                </span>
            </div>
        </Link>
    );

    if (error) {
        return (
            <div className="container mx-auto px-4 py-16 text-center">
                <p className="retro-pixel text-sm text-fuchsia-400">!! SIGNAL LOST !!</p>
                <p className="retro-mono text-2xl text-gray-300 mt-4">{error}</p>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100">
            <Helmet>
                <title>Browse Music Genres</title>
                <meta
                    name="description"
                    content="Browse house, trance, hip-hop, drum n bass, breaks and other electronic music"
                />
                <link rel="canonical" href={`${baseUrl}/browse`} />
                <meta property="og:title" content="About InternetDJ" />
                <meta property="og:description" content="Browse and stream house, trance, hip-hop, drum n bass, breaks and other electronic music." />
                <meta property="og:url" content={`${baseUrl}/browse`}/>
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Browse and stream InternetDJ Music" />
                <meta name="twitter:description" content="Browse and stream house, trance, hip-hop, drum n bass, breaks and other electronic music." />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            <div className="container mx-auto px-4 py-10">

                <header className="mb-10">
                    <div className="retro-eyebrow mb-3">&gt;&gt; The Record Crates</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-5xl">Browse by Genre</h1>
                    <div className="retro-rule mt-4" />
                </header>

                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="w-full lg:w-3/4 min-w-0">
                        <div className="mb-8">
                            <TrackFilters
                                filters={filters}
                                onChange={setFilters}
                                busy={filterBusy}
                                resultCount={hasActiveFilters(filters) && !filterBusy ? filterResults.length : null}
                                missing={filterMissing}
                            />

                            {filterError && (
                                <p className="retro-mono text-lg text-fuchsia-400 mt-3">
                                    &gt; {filterError}
                                </p>
                            )}

                            {hasActiveFilters(filters) && !filterBusy && filterResults.length > 0 && (
                                <ul className="mt-4 space-y-3">
                                    {filterResults.map((song) => (
                                        <li
                                            key={song.id}
                                            className="retro-panel retro-cut p-3 flex items-start gap-3"
                                        >
                                            <SongThumb song={song} size="w-14 h-14" iconSize="w-4 h-4" />
                                            <div className="flex-1 min-w-0">
                                                <Link
                                                    to={`/song/${song.id}`}
                                                    className="retro-display text-sm text-white hover:text-cyan-200 block truncate"
                                                >
                                                    {song.title}
                                                </Link>
                                                <ArtistLink song={song} className="block" />
                                                <TrackMetaChips
                                                    bpm={song.bpm}
                                                    musicalKey={song.musical_key}
                                                    rating={song.avg_rating}
                                                    className="mt-1"
                                                />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {hasActiveFilters(filters) && !filterBusy && filterResults.length === 0 && !filterError && (
                                <p className="retro-mono text-xl text-gray-400 mt-4">
                                    &gt; nothing matches those settings yet.
                                </p>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 mb-6">
                            <div className="flex items-stretch flex-1 min-w-[200px]">
                                <label htmlFor="genre-filter" className="sr-only">Filter genres by name</label>
                                <input
                                    id="genre-filter"
                                    type="search"
                                    value={genreQuery}
                                    onChange={(e) => setGenreQuery(e.target.value)}
                                    placeholder="filter genres..."
                                    className="retro-field flex-1"
                                />
                                {genreQuery.trim() && (
                                    <button
                                        type="button"
                                        onClick={() => setGenreQuery('')}
                                        className="retro-btn px-3 text-[0.6rem] shrink-0"
                                        aria-label="Clear genre filter"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <span className="retro-mono text-lg text-cyan-300 shrink-0">
                                {genreQuery.trim()
                                    ? `${visibleGenres.length} of ${tags.length} genres`
                                    : `${tags.length} genre${tags.length === 1 ? '' : 's'}`}
                            </span>
                        </div>

                        {tags.length === 0 ? (
                            <p className="retro-mono text-xl text-gray-400">&gt; no genres available yet.</p>
                        ) : visibleGenres.length === 0 ? (
                            <p className="retro-mono text-xl text-gray-400">
                                &gt; nothing matches "{genreQuery.trim()}".
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                {visibleGenres.map((genre) => (
                                    <GenreCard key={genre.tag} genre={genre} />
                                ))}
                            </div>
                        )}
                    </div>

                    <aside className="w-full lg:w-1/4 space-y-8">
                        <section className="retro-panel retro-cut p-4">
                            <h2 className="retro-eyebrow mb-3">// Featured Song //</h2>
                            {featuredSong ? (
                                <>
                                    <SongThumb song={featuredSong} size="w-full aspect-square" iconSize="w-10 h-10" />
                                    <div className="mt-3">
                                        <Link
                                            to={`/song/${featuredSong.id}`}
                                            className="retro-display text-sm text-white hover:text-cyan-200 block truncate"
                                        >
                                            {featuredSong.title}
                                        </Link>
                                        <ArtistLink song={featuredSong} className="block" />
                                        <div className="flex items-center gap-4 mt-2">
                                            <PlayCount song={featuredSong} />
                                            <LikeCount song={featuredSong} />
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <p className="retro-mono text-lg text-gray-400">&gt; no featured song.</p>
                            )}
                        </section>

                        <section className="retro-panel retro-cut p-4">
                            <h2 className="retro-eyebrow mb-3">// Awaiting Reviews //</h2>
                            {unreviewedSongs.length === 0 ? (
                                <p className="retro-mono text-lg text-gray-400">&gt; queue is empty.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {unreviewedSongs.map((song) => (
                                        <li key={song.id} className="flex items-start gap-3 pb-3 border-b border-white/5 last:border-0 last:pb-0">
                                            <SongThumb song={song} size="w-14 h-14" iconSize="w-4 h-4" />
                                            <div className="flex-1 min-w-0">
                                                <Link
                                                    to={`/song/${song.id}`}
                                                    className="retro-display text-[0.7rem] text-white hover:text-cyan-200 block truncate"
                                                >
                                                    {song.title}
                                                </Link>
                                                <ArtistLink song={song} className="block" />
                                                <Link
                                                    to={`/song/${song.id}#review`}
                                                    className="retro-mono text-lg text-fuchsia-400 hover:text-fuchsia-300"
                                                >
                                                    &gt; write a review
                                                </Link>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}

export default Browse;
