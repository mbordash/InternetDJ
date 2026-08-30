import React, { useEffect, useState, useContext, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { Helmet } from "react-helmet-async";
import { getDefaultAvatar } from '../utils/defaultAvatar';
import profilePath from '../utils/profilePath';
import { tagHref } from '../utils/genreTags';

const SORTS = [
    { id: 'random', label: 'Shuffle' },
    { id: 'listens', label: 'Most Played' },
    { id: 'likes', label: 'Most Liked' },
    { id: 'alpha', label: 'A–Z' },
    { id: 'deep', label: 'Deep Cuts' },
];

// How long the pointer must rest on a sleeve before the preview starts, and how
// long it plays. Long enough that skimming the page never triggers audio.
const PREVIEW_DELAY_MS = 600;
const PREVIEW_LENGTH_MS = 20000;

function TagSongs() {
    const { tag } = useParams();
    const { playSong, playPlaylist, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [songs, setSongs] = useState([]);
    const [overview, setOverview] = useState(null);
    const [sort, setSort] = useState('random');
    const [view, setView] = useState('list');
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [previewingId, setPreviewingId] = useState(null);
    const observerRef = useRef();
    const previewAudioRef = useRef(null);
    const previewTimersRef = useRef({ start: null, stop: null });
    const limit = 20;

    const baseUrl = SITE_URL;
    const decodedTag = decodeURIComponent(tag);
    const title = overview?.label || decodedTag;

    /* One genre is reachable under every spelling artists use — /tag/DnB,
       /tag/dnb, /tag/drum%20bass all render this page. The canonical URL is
       what tells search engines they are one page rather than three competing
       ones, so it has to be the same string whichever spelling was requested.
       overview.tag is the server's normalised key, which is also what the
       sitemap emits; before it loads, fall back to normalising the requested
       spelling ourselves so the tag is never self-referential. */
    const canonicalUrl = `${baseUrl}${tagHref(overview?.tag || decodedTag)}`;

    const fetchSongs = async (newSort = sort, reset = false) => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/music/by-tag/${encodeURIComponent(tag)}`, {
                params: {
                    limit,
                    offset: reset ? 0 : offset,
                    sort: newSort,
                },
            });
            const newSongs = Array.isArray(response.data.songs) ? response.data.songs : [];
            setSongs((prev) => (reset ? newSongs : [...prev, ...newSongs]));
            setHasMore(newSongs.length === limit);
            setOffset((prev) => (reset ? limit : prev + limit));
        } catch (err) {
            console.error('Fetch error:', err.response?.data || err.message);
            setError('Failed to load songs: ' + (err.response?.data?.error || err.message));
        } finally {
            setLoading(false);
        }
    };

    const handleSortChange = (newSort) => {
        setSort(newSort);
        setOffset(0);
        setSongs([]);
        setHasMore(true);
        fetchSongs(newSort, true);
    };

    const lastSongElementRef = (node) => {
        if (loading || !hasMore) return;
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                fetchSongs();
            }
        });
        if (node) observerRef.current.observe(node);
    };

    // ---------- Listening post ------------------------------------------------
    const stopPreview = useCallback(() => {
        clearTimeout(previewTimersRef.current.start);
        clearTimeout(previewTimersRef.current.stop);
        const audio = previewAudioRef.current;
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        setPreviewingId(null);
    }, []);

    const startPreview = (song) => {
        // Never talk over the main deck, and never preview without a source.
        if (isPlaying || !song.mp3_url) return;
        clearTimeout(previewTimersRef.current.start);
        previewTimersRef.current.start = setTimeout(() => {
            if (!previewAudioRef.current) {
                previewAudioRef.current = new Audio();
                previewAudioRef.current.volume = 0.55;
            }
            const audio = previewAudioRef.current;
            audio.src = song.mp3_url;
            audio.currentTime = 0;
            audio.play()
                .then(() => {
                    setPreviewingId(song.id);
                    previewTimersRef.current.stop = setTimeout(stopPreview, PREVIEW_LENGTH_MS);
                })
                .catch(() => setPreviewingId(null));  // autoplay blocked; not an error worth surfacing
        }, PREVIEW_DELAY_MS);
    };

    useEffect(() => () => stopPreview(), [stopPreview]);
    useEffect(() => { if (isPlaying) stopPreview(); }, [isPlaying, stopPreview]);

    useEffect(() => {
        setOverview(null);
        axios.get(`${API_URL}/music/tag/${encodeURIComponent(tag)}/overview`)
            .then(res => setOverview(res.data))
            .catch(() => setOverview(null));  // the page works without it
        fetchSongs('random', true);
        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
        // Intentionally keyed on `tag` alone: this is the "new genre, start over" reset.
    }, [tag]);

    const handleSongPlay = async (song) => {
        stopPreview();
        const playedKey = `played_${song.id}`;
        if (!sessionStorage.getItem(playedKey)) {
            try {
                const token = localStorage.getItem('token');
                await axios.post(`${API_URL}/music/play/${song.id}`, {}, {
                    headers: { Authorization: `Bearer ${token}` },
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

    // Queue everything loaded and hand it to the footer deck.
    const playCrate = () => {
        const playable = songs.filter(song => song.mp3_url);
        if (playable.length === 0) return;
        stopPreview();
        playPlaylist(playable.map(song => ({
            id: song.id,
            title: song.title,
            mp3_url: song.mp3_url,
            image_url: song.image_url,
            profile_id: song.profile_id,
            profile_slug: song.profile_slug || null,
            profile_name: song.profile_name || 'Unknown Artist',
        })));
    };

    const formatCount = (value) => Number(value || 0).toLocaleString();

    const PlayOverlay = ({ song, iconSize = 'w-4 h-4' }) => {
        const isLive = currentSong?.id === song.id;
        if (!song.mp3_url) return null;
        return (
            <button
                onClick={() => (isLive ? togglePlayPause() : handleSongPlay(song))}
                className="retro-play-overlay z-20"
                aria-label={isLive && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
            >
                {isLive && isPlaying ? <PauseIcon className={iconSize} /> : <PlayIcon className={iconSize} />}
            </button>
        );
    };

    if (error) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <div className="retro-panel retro-cut px-8 py-10 text-center">
                    <div className="retro-eyebrow mb-3">!! Signal Lost !!</div>
                    <p className="retro-mono text-2xl text-fuchsia-300">{error}</p>
                </div>
            </div>
        );
    }

    /* Every genre page used to carry the same sentence with one word swapped,
       which reads to a search engine as one page duplicated fifty times. Built
       from the genre's own counts instead, so each page describes itself, and
       carrying the promotion angle because "where do I put my techno track"
       is a search these pages can realistically win. */
    const metaDescription = overview?.total
        ? `Listen to ${overview.total} ${title} track${overview.total === 1 ? '' : 's'} from independent `
          + `producers on InternetDJ. Publish your own ${title} tracks free and get written feedback `
          + `from other producers.`
        : `${title} tracks from independent producers on InternetDJ. Publish your own ${title} tracks `
          + `free and get written feedback from other producers.`;

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100">
            <Helmet>
                <title>{`${title} Tracks by Independent Producers`}</title>
                <meta name="description" content={metaDescription} />
                <link rel="canonical" href={canonicalUrl} />
                <meta property="og:title" content={`${title} Tracks by Independent Producers`} />
                <meta property="og:description" content={metaDescription} />
                <meta property="og:url" content={canonicalUrl} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={`${title} Tracks by Independent Producers`} />
                <meta name="twitter:description" content={metaDescription} />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            <div className="container mx-auto px-4 py-10">

                {/* ==================== MASTHEAD ==================== */}
                <header className="mb-6">
                    <div className="retro-eyebrow mb-3">// The Crate //</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-5xl capitalize">{title}</h1>
                    {overview?.spellings?.length > 1 && (
                        <p className="retro-mono text-lg text-gray-500 mt-2">
                            also tagged: {overview.spellings.slice(0, 6).join(' · ')}
                        </p>
                    )}
                    <div className="retro-rule mt-4" />
                </header>

                {/* ==================== STATS ==================== */}
                {overview && overview.total > 0 && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                        <div className="retro-stat">
                            <span className="retro-stat__value">{formatCount(overview.total)}</span>
                            <span className="retro-stat__label">Tracks</span>
                        </div>
                        <div className="retro-stat">
                            <span className="retro-stat__value">{formatCount(overview.totalPlays)}</span>
                            <span className="retro-stat__label">Plays</span>
                        </div>
                        <div className="retro-stat">
                            <span className="retro-stat__value">{formatCount(overview.artistCount)}</span>
                            <span className="retro-stat__label">Artists</span>
                        </div>
                        <div className="retro-stat">
                            <span className="retro-stat__value">
                                {overview.newest ? new Date(overview.newest).toLocaleDateString() : '—'}
                            </span>
                            <span className="retro-stat__label">Latest Drop</span>
                        </div>
                    </div>
                )}

                {/* ==================== CONTROLS ==================== */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <button
                        onClick={playCrate}
                        disabled={songs.filter(s => s.mp3_url).length === 0}
                        className="retro-btn retro-btn--hot px-5 py-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <PlayIcon className="w-4 h-4" /> Play This Crate
                    </button>

                    <div className="flex items-center gap-1 ml-auto">
                        {['list', 'crate'].map((mode) => (
                            <button
                                key={mode}
                                onClick={() => { stopPreview(); setView(mode); }}
                                className={`retro-btn px-4 py-2 text-[0.6rem] ${view === mode ? 'retro-btn--hot' : ''}`}
                                aria-pressed={view === mode}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                    {SORTS.map(option => (
                        <button
                            key={option.id}
                            onClick={() => handleSortChange(option.id)}
                            className={`retro-btn px-4 py-2 text-[0.6rem] ${sort === option.id ? 'retro-btn--hot' : ''}`}
                            title={option.id === 'deep' ? 'Barely-heard tracks that the few who found them liked' : undefined}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {/* ==================== RELATED GENRES ==================== */}
                {overview?.related?.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-8">
                        <span className="retro-eyebrow mr-1">Heads To</span>
                        {overview.related.map(neighbour => (
                            <Link
                                key={neighbour.tag}
                                to={tagHref(neighbour.tag)}
                                className="retro-chip capitalize"
                            >
                                {neighbour.label} <span className="text-cyan-300/60">{neighbour.count}</span>
                            </Link>
                        ))}
                    </div>
                )}

                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="w-full lg:w-3/4 min-w-0">
                        {songs.length === 0 && !loading ? (
                            <div className="retro-panel retro-cut p-6">
                                <p className="retro-mono text-xl text-gray-400">
                                    &gt; nothing filed under "{decodedTag}" yet.
                                </p>
                                <Link to="/browse" className="retro-btn px-4 py-2 text-xs mt-4">
                                    Back to Browse
                                </Link>
                            </div>
                        ) : view === 'crate' ? (
                            /* ---------- CRATE ---------- */
                            <div className="retro-crate" onMouseLeave={stopPreview}>
                                {songs.map((song, index) => (
                                    <div
                                        key={song.id}
                                        ref={index === songs.length - 1 ? lastSongElementRef : null}
                                        className="retro-crate__sleeve"
                                        onMouseEnter={() => startPreview(song)}
                                        onMouseLeave={stopPreview}
                                    >
                                        <div className="retro-crate__art retro-scanlines">
                                            {song.image_url ? (
                                                <img
                                                    src={song.image_url}
                                                    alt={song.title}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center retro-pixel text-[0.5rem] text-cyan-200">
                                                    NO ART
                                                </div>
                                            )}
                                            {previewingId === song.id && (
                                                <span className="retro-preview-badge">
                                                    <span className="retro-eq" style={{ height: '0.5rem' }}>
                                                        <span /><span /><span /><span />
                                                    </span>
                                                    Previewing
                                                </span>
                                            )}
                                            <PlayOverlay song={song} iconSize="w-9 h-9" />
                                        </div>
                                        <div className="mt-3">
                                            <Link
                                                to={`/song/${song.id}`}
                                                className="retro-display text-[0.7rem] text-white hover:text-cyan-200 block truncate"
                                                title={song.title}
                                            >
                                                {song.title}
                                            </Link>
                                            <Link
                                                to={song.profile_id ? profilePath(song) : '#'}
                                                className="retro-mono text-lg retro-link block truncate"
                                            >
                                                {song.profile_name}
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            /* ---------- LIST ---------- */
                            <div className="overflow-x-auto">
                                <table className="retro-table table-fixed">
                                    <thead>
                                        <tr>
                                            <th className="w-[10%]">#</th>
                                            <th className="w-[54%]">Track</th>
                                            <th className="w-[18%]">Plays</th>
                                            <th className="w-[18%]">Likes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {songs.map((song, index) => (
                                            <tr
                                                key={song.id}
                                                ref={index === songs.length - 1 ? lastSongElementRef : null}
                                            >
                                                <td className="retro-pixel text-[0.5rem] text-fuchsia-400">
                                                    {String(index + 1).padStart(2, '0')}
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div
                                                            className="relative flex-shrink-0 w-12 h-12 retro-scanlines overflow-hidden border border-cyan-400/30"
                                                            onMouseEnter={() => startPreview(song)}
                                                            onMouseLeave={stopPreview}
                                                        >
                                                            {song.image_url ? (
                                                                <img
                                                                    src={song.image_url}
                                                                    alt={song.title}
                                                                    loading="lazy"
                                                                    className="w-full h-full object-cover"
                                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300">?</div>
                                                            )}
                                                            {previewingId === song.id && (
                                                                <span className="retro-eq absolute bottom-1 right-1 z-10">
                                                                    <span /><span /><span /><span />
                                                                </span>
                                                            )}
                                                            <PlayOverlay song={song} />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <Link
                                                                to={`/song/${song.id}`}
                                                                className="retro-display text-xs text-white hover:text-cyan-200 block truncate"
                                                                title={song.title}
                                                            >
                                                                {song.title}
                                                            </Link>
                                                            <Link
                                                                to={song.profile_id ? profilePath(song) : '#'}
                                                                className="retro-mono text-lg retro-link block truncate"
                                                            >
                                                                {song.profile_name}
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="retro-mono text-lg text-cyan-300 inline-flex items-center gap-1">
                                                        {formatCount(song.plays)}
                                                        <SpeakerWaveIcon className="w-4 h-4" />
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="retro-mono text-lg inline-flex items-center gap-1 text-gray-300">
                                                        {formatCount(song.likes_count)}
                                                        <HeartIconSolid
                                                            className={`w-4 h-4 ${Number(song.likes_count) > 0 ? 'text-fuchsia-400' : 'text-gray-500'}`}
                                                        />
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {loading && (
                            <p className="retro-mono text-xl text-cyan-200 mt-6">&gt; digging&hellip;</p>
                        )}
                    </div>

                    {/* ==================== TOP ARTISTS ==================== */}
                    <aside className="w-full lg:w-1/4">
                        <section className="retro-panel retro-cut p-4">
                            <h2 className="retro-eyebrow mb-3">// Top Artists //</h2>
                            {overview?.topArtists?.length > 0 ? (
                                <ul className="space-y-1">
                                    {overview.topArtists.map((artist, i) => (
                                        <li key={artist.profile_id}>
                                            <Link
                                                to={profilePath(artist)}
                                                className="flex items-center gap-3 py-1.5 px-2 hover:bg-cyan-400/10 border-l-2 border-transparent hover:border-fuchsia-500 transition-colors group"
                                            >
                                                <span className="retro-pixel text-[0.5rem] text-fuchsia-400 w-4 shrink-0">
                                                    {String(i + 1).padStart(2, '0')}
                                                </span>
                                                <img
                                                    src={artist.picture_url || getDefaultAvatar(artist.profile_id)}
                                                    alt=""
                                                    className="w-8 h-8 object-cover border border-cyan-400/40 group-hover:border-fuchsia-400 transition-colors"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="retro-mono text-lg text-gray-200 group-hover:text-cyan-200 block truncate">
                                                        {artist.name}
                                                    </span>
                                                    <span className="retro-mono text-base text-cyan-300/70">
                                                        {artist.tracks} track{artist.tracks === 1 ? '' : 's'}
                                                    </span>
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="retro-mono text-lg text-gray-500">&gt; no artists yet.</p>
                            )}
                        </section>
                    </aside>
                </div>

                {/* ==================== PRODUCER CTA ====================
                    Placed below the listing rather than above it: someone who
                    arrived here from a genre search came to hear the tracks,
                    and the ask reads better once they have. Its wording carries
                    the genre so the page says "publish your techno" rather than
                    a generic invitation. */}
                <section className="retro-panel retro-cut p-6 mt-10">
                    <h2 className="retro-display text-lg sm:text-xl retro-glow-magenta mb-3 capitalize">
                        Make {title}?
                    </h2>
                    <p className="retro-mono text-xl text-gray-300 mb-5">
                        Publish your own {title} tracks on InternetDJ for free and get written
                        feedback from other producers, not just a play count. You keep every
                        right to your music.
                    </p>
                    <div className="flex flex-col sm:flex-row flex-wrap gap-3">
                        <Link to="/promote" className="retro-btn retro-btn--hot px-6 py-3 text-sm">
                            Promote Your Music
                        </Link>
                        <Link to="/browse" className="retro-btn px-6 py-3 text-sm">
                            Browse Every Genre
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default TagSongs;
