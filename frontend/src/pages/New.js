import { useEffect, useState, useContext, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import {Helmet} from "react-helmet-async";
import profilePath from '../utils/profilePath';
import genreTags, { tagHref } from '../utils/genreTags';
import relativeDate from '../utils/relativeDate';

const EMPTY_SECTIONS = { justAdded: [], playedLately: [], fromArchive: [] };

/* Artwork plus the hover play button. Shared by the table and the card layout
   so the two cannot drift apart; only the pixel size differs. */
function SongArtwork({ song, sizeClass, iconClass, currentSong, isPlaying, onPlay, togglePlayPause }) {
    return (
        <div className={`relative flex-shrink-0 ${sizeClass}`}>
            {song.image_url ? (
                <Link to={`/song/${song.id}`} tabIndex={0}>
                    <img
                        src={song.image_url}
                        alt={song.title}
                        className={`${sizeClass} rounded-md object-cover`}
                        onError={(e) => {
                            console.error(`Failed to load song image for song ${song.id}:`, song.image_url);
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'block';
                        }}
                        loading="lazy"
                    />
                </Link>
            ) : (
                <div
                    className={`${sizeClass} border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300`}
                    style={{ display: song.image_url ? 'none' : 'flex' }}
                >?
                </div>
            )}
            {song.mp3_url && (
                <button
                    onClick={() => {
                        if (currentSong?.id === song.id) {
                            togglePlayPause();
                        } else {
                            onPlay(song);
                        }
                    }}
                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                    aria-label={currentSong?.id === song.id && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                >
                    {currentSong?.id === song.id && isPlaying ? (
                        <PauseIcon className={`${iconClass} text-white`} />
                    ) : (
                        <PlayIcon className={`${iconClass} text-white`} />
                    )}
                </button>
            )}
        </div>
    );
}

/* genre is free-form and may hold several comma-separated tags, so each one
   links to its own tag page rather than the whole string linking to a single
   dead tag. */
function GenreLinks({ genre }) {
    return genreTags(genre).map((tag) => (
        <Link
            key={tag}
            to={tagHref(tag)}
            className="retro-link capitalize"
        >
            {tag}
        </Link>
    ));
}

function SongRow({ song, meta, currentSong, isPlaying, onPlay, togglePlayPause }) {
    return (
        <tr>
            {/* The flex lives on the inner div, never on the td. display:flex
                on a table cell takes it out of the table layout algorithm, so
                the table-fixed column width above stops constraining it and a
                long title pushes into the Genre column instead of truncating.
                min-w-0 is what actually lets the clamp work: a flex item's
                default min-width is auto, which refuses to shrink below its
                content.

                The title clamps at two lines rather than one, because a track
                name here routinely carries a remix or edit in brackets and one
                line cuts it off mid-parenthesis. line-clamp sets
                display:-webkit-box, so the `block` class it replaced had to
                go: two display utilities on one element is a coin toss decided
                by stylesheet order. break-words is for the one title that is a
                single unbroken string longer than the column: the clamp hides
                the overflow but will not break a word, so without it that
                title is hard-cut mid-glyph with no ellipsis. The artist below
                stays on one line. */}
            <td className="px-4 py-2">
                <div className="flex items-center space-x-2 min-w-0">
                    <SongArtwork
                        song={song}
                        sizeClass="w-12 h-12"
                        iconClass="w-4 h-4"
                        currentSong={currentSong}
                        isPlaying={isPlaying}
                        onPlay={onPlay}
                        togglePlayPause={togglePlayPause}
                    />
                    <div className="min-w-0 flex-1">
                        <Link
                            to={`/song/${song.id}`}
                            className="retro-display text-xs text-white hover:text-cyan-200 line-clamp-2 break-words"
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
                <div className="flex flex-wrap gap-2">
                    <GenreLinks genre={song.genre} />
                </div>
            </td>
            {meta !== null && (
                <td className="px-4 py-2 retro-mono text-cyan-300/80 whitespace-nowrap">{meta}</td>
            )}
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
    );
}

function SongCard({ song, metaLabel, meta, currentSong, isPlaying, onPlay, togglePlayPause }) {
    return (
        <div className="retro-card retro-cut p-4 rounded-md shadow-sm hover:bg-zinc-800 transition-colors">
            <div className="flex items-center space-x-4">
                <SongArtwork
                    song={song}
                    sizeClass="w-16 h-16"
                    iconClass="w-4 h-4"
                    currentSong={currentSong}
                    isPlaying={isPlaying}
                    onPlay={onPlay}
                    togglePlayPause={togglePlayPause}
                />
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
                                <GenreLinks genre={song.genre} />
                            </span>
                        </div>
                    )}
                    {meta !== null && (
                        <div className="retro-mono text-lg text-cyan-300/80 mt-1">
                            {metaLabel}: {meta}
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
    );
}

/* The narrow right column cannot carry the five-column table, and the mobile
   card is far too tall to stack twenty of. This is a third density: artwork,
   title, artist, and the one number that section is actually about. */
function RailRow({ song, meta, currentSong, isPlaying, onPlay, togglePlayPause }) {
    return (
        <li className="flex items-center gap-3 py-2 border-b border-cyan-400/10 last:border-b-0">
            <SongArtwork
                song={song}
                sizeClass="w-10 h-10"
                iconClass="w-4 h-4"
                currentSong={currentSong}
                isPlaying={isPlaying}
                onPlay={onPlay}
                togglePlayPause={togglePlayPause}
            />
            <div className="min-w-0 flex-1">
                <Link
                    to={`/song/${song.id}`}
                    className="retro-display text-[0.65rem] text-white hover:text-cyan-200 line-clamp-2 break-words"
                    title={song.title}
                >
                    {song.title}
                </Link>
                <div className="retro-mono text-base text-gray-400 truncate">
                    <Link
                        to={song.profile_id ? profilePath(song) : '#'}
                        className={song.profile_id ? 'retro-link' : 'text-gray-500 cursor-not-allowed'}
                        title={song.profile_name}
                    >
                        {song.profile_name}
                    </Link>
                </div>
            </div>
            <div className="retro-mono text-base text-cyan-300/80 whitespace-nowrap flex-shrink-0 text-right">
                {meta !== null ? meta : (
                    <span className="inline-flex items-center">
                        {Number(song.plays) || 0}
                        <SpeakerWaveIcon className="w-4 h-4 text-gray-300 ml-1" />
                    </span>
                )}
            </div>
        </li>
    );
}

function RailSection({ title, blurb, songs, metaLabel, renderMeta, playProps }) {
    if (!songs.length) {
        return null;
    }

    const hasMeta = typeof renderMeta === 'function';

    return (
        <section className="retro-panel retro-cut p-4">
            <header className="mb-3">
                <h2 className="retro-display retro-chrome text-lg">{title}</h2>
                {blurb && <p className="retro-mono text-base text-gray-400 mt-1">{blurb}</p>}
                <div className="retro-rule mt-2" />
                <div className="retro-eyebrow mt-2 text-right">{hasMeta ? metaLabel : 'Plays'}</div>
            </header>

            <ul>
                {songs.map((song) => (
                    <RailRow
                        key={song.id}
                        song={song}
                        meta={hasMeta ? renderMeta(song) : null}
                        {...playProps}
                    />
                ))}
            </ul>
        </section>
    );
}

function SongSection({ eyebrow, title, blurb, songs, metaLabel, renderMeta, playProps }) {
    if (!songs.length) {
        return null;
    }

    const hasMeta = typeof renderMeta === 'function';

    return (
        <section>
            <header className="mb-4">
                {eyebrow && <div className="retro-eyebrow mb-2">&gt;&gt; {eyebrow}</div>}
                <h2 className="retro-display retro-chrome text-2xl sm:text-3xl">{title}</h2>
                {blurb && <p className="retro-mono text-lg text-gray-400 mt-2">{blurb}</p>}
                <div className="retro-rule mt-3" />
            </header>

            <div className="md:overflow-x-auto">
                <table className="retro-table hidden md:table table-fixed">
                    <thead>
                    <tr>
                        <th className={`px-4 py-2 text-left ${hasMeta ? 'w-[34%]' : 'w-[40%]'}`}>Song</th>
                        <th className={`px-4 py-2 text-left ${hasMeta ? 'w-[18%]' : 'w-[20%]'}`}>Genre</th>
                        {hasMeta && <th className="px-4 py-2 text-left w-[16%]">{metaLabel}</th>}
                        <th className={`px-4 py-2 text-left ${hasMeta ? 'w-[16%]' : 'w-[20%]'}`}>Plays</th>
                        <th className={`px-4 py-2 text-left ${hasMeta ? 'w-[16%]' : 'w-[20%]'}`}>Likes</th>
                    </tr>
                    </thead>
                    <tbody>
                    {songs.map((song) => (
                        <SongRow
                            key={song.id}
                            song={song}
                            meta={hasMeta ? renderMeta(song) : null}
                            {...playProps}
                        />
                    ))}
                    </tbody>
                </table>

                <div className="md:hidden space-y-4">
                    {songs.map((song) => (
                        <SongCard
                            key={song.id}
                            song={song}
                            metaLabel={metaLabel}
                            meta={hasMeta ? renderMeta(song) : null}
                            {...playProps}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}

function New() {
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const baseUrl = SITE_URL;
    const [sections, setSections] = useState(EMPTY_SECTIONS);
    const [playedLatelyDays, setPlayedLatelyDays] = useState(30);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchRecent = async () => {
            try {
                const response = await axios.get(`${API_URL}/music/recent`);
                const data = response.data || {};
                setSections({
                    justAdded: Array.isArray(data.justAdded) ? data.justAdded : [],
                    playedLately: Array.isArray(data.playedLately) ? data.playedLately : [],
                    fromArchive: Array.isArray(data.fromArchive) ? data.fromArchive : [],
                });
                if (typeof data.playedLatelyDays === 'number') {
                    setPlayedLatelyDays(data.playedLatelyDays);
                }
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                });
                setError('Failed to load new songs: ' + (err.response?.data?.error || err.message));
            }
        };

        fetchRecent();
    }, []);

    const handleSongPlay = useCallback(async (song) => {
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
                // A song can sit in more than one section, so bump the count
                // wherever it appears rather than in one list.
                setSections((prev) => {
                    const bump = (list) => list.map((s) =>
                        s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s
                    );
                    return {
                        justAdded: bump(prev.justAdded),
                        playedLately: bump(prev.playedLately),
                        fromArchive: bump(prev.fromArchive),
                    };
                });
            } catch (err) {
                console.error('Error recording play:', err);
            }
        }

        playSong({
            id: song.id,
            title: song.title,
            mp3_url: song.mp3_url || '',
            image_url: song.image_url,
            profile_id: song.profile_id,
            profile_slug: song.profile_slug || null,
            profile_name: song.profile_name || 'Unknown Artist',
        });
    }, [playSong]);

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="retro-mono text-2xl text-fuchsia-400">{error}</p>
            </div>
        );
    }

    const playProps = { currentSong, isPlaying, onPlay: handleSongPlay, togglePlayPause };
    const isEmpty = !sections.justAdded.length && !sections.playedLately.length && !sections.fromArchive.length;

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
                <header className="mb-10">
                    <div className="retro-eyebrow mb-3">&gt;&gt; Straight Off The Wire</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-4xl">New Releases</h1>
                    <div className="retro-rule mt-4" />
                </header>

                {isEmpty ? (
                    <p className="retro-mono text-xl text-gray-300">No new songs available recently.</p>
                ) : (
                    /* Just Added is the reason people come to a page called New
                       Releases, so it keeps the wide column and the full table.
                       The other two ride a narrow rail beside it, which roughly
                       halves the scroll: ten rail rows each land about level
                       with the twenty table rows on the left. */
                    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem] lg:gap-10">
                        <div className="min-w-0">
                            <SongSection
                                title="Just Added"
                                blurb="The newest uploads on the site."
                                songs={sections.justAdded}
                                metaLabel="Added"
                                renderMeta={(song) => relativeDate(song.created_at)}
                                playProps={playProps}
                            />
                        </div>

                        <aside className="min-w-0 space-y-8">
                            <RailSection
                                title="Getting Played Lately"
                                blurb={`What people have actually been listening to over the last ${playedLatelyDays} days.`}
                                songs={sections.playedLately}
                                metaLabel="Recent plays"
                                renderMeta={(song) => Number(song.recent_plays) || 0}
                                playProps={playProps}
                            />

                            <RailSection
                                title="Dig This Up"
                                blurb="A different handful from the back catalogue every time you land here."
                                songs={sections.fromArchive}
                                playProps={playProps}
                            />
                        </aside>
                    </div>
                )}
            </div>
        </div>
    );
}

export default New;
