import { useEffect, useState, useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import API_URL from '../utils/api';
import { profilePath } from '../utils/profilePath';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import { getDefaultAvatar } from '../utils/defaultAvatar';

// Covers are assembled from the first four songs rather than uploaded, so a
// crate always looks like an object even though nobody made artwork for it.
const CoverMosaic = ({ art = [], name }) => {
    const tiles = art.slice(0, 4);
    if (tiles.length === 0) {
        return (
            <div className="retro-crate__art flex items-center justify-center bg-fuchsia-500/10">
                <span className="retro-display text-xs retro-glow-magenta px-2 text-center">
                    {name?.slice(0, 12) || 'MIXTAPE'}
                </span>
            </div>
        );
    }
    // One image fills the sleeve; two or more tile into a grid.
    if (tiles.length === 1) {
        return <img src={tiles[0]} alt="" className="retro-crate__art object-cover w-full h-full" />;
    }
    return (
        <div className="retro-crate__art grid grid-cols-2 grid-rows-2 gap-px w-full h-full">
            {[0, 1, 2, 3].map((i) => (
                tiles[i]
                    ? <img key={i} src={tiles[i]} alt="" className="w-full h-full object-cover" />
                    : <div key={i} className="w-full h-full bg-cyan-400/10" />
            ))}
        </div>
    );
};

const Crate = () => {
    const { crateId } = useParams();
    const { playPlaylist } = useContext(AudioPlayerContext);
    const [crate, setCrate] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const fetchCrate = async () => {
            setIsLoading(true);
            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(
                    `${API_URL}/playlists/crate/${crateId}`,
                    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
                );
                if (!cancelled) { setCrate(response.data); setError(null); }
            } catch (err) {
                // The API returns 404 for private mixtapes as well as missing
                // ones, so say the same thing here rather than leaking which.
                if (!cancelled) {
                    setError(err.response?.status === 404
                        ? 'This mixtape is private or no longer exists.'
                        : 'Could not load this mixtape: ' + (err.response?.data?.error || err.message));
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchCrate();
        return () => { cancelled = true; };
    }, [crateId]);

    if (isLoading) {
        return (
            <div className="retro-page container mx-auto px-4 py-16">
                <p className="retro-mono text-xl text-cyan-300">&gt; loading mixtape...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="retro-page container mx-auto px-4 py-16 text-center">
                <h1 className="retro-display text-2xl retro-glow-magenta mb-4">Mixtape Not Found</h1>
                <p className="retro-mono text-xl text-gray-400 mb-6">{error}</p>
                <Link to="/browse" className="retro-btn px-5 py-2 text-[0.6rem]">Browse Artists</Link>
            </div>
        );
    }

    const isDedicated = Boolean(crate.dedicated_to);
    const coverArt = crate.songs.map((s) => s.image_url).filter(Boolean);

    return (
        <div className="retro-page container mx-auto px-4 py-10">

            <div className="retro-panel retro-cut p-6 mb-8">
                <div className="flex flex-col sm:flex-row gap-6">

                    <div className="retro-crate__sleeve w-40 h-40 shrink-0">
                        <CoverMosaic art={coverArt} name={crate.name} />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="retro-eyebrow mb-2">// Mixtape //</div>
                        <h1 className="retro-display text-2xl retro-glow-cyan mb-2 break-words">
                            {crate.name}
                        </h1>

                        <p className="retro-mono text-xl text-gray-400 mb-4">
                            by{' '}
                            <Link to={profilePath(crate.owner)} className="retro-link">
                                {crate.owner.name}
                            </Link>
                            {' · '}
                            {crate.songs.length} track{crate.songs.length === 1 ? '' : 's'}
                            {!crate.is_public && (
                                <span className="retro-badge ml-3 text-amber-300">Private</span>
                            )}
                        </p>

                        <button
                            onClick={() => playPlaylist(crate.songs)}
                            disabled={crate.songs.length === 0}
                            className="retro-btn retro-btn--hot px-5 py-2 text-[0.6rem] disabled:opacity-50"
                        >
                            {crate.songs.length === 0 ? 'Empty Mixtape' : '▶ Play Mixtape'}
                        </button>
                    </div>
                </div>

                {/* The dedication is the whole point of a mixtape, so it gets
                    its own panel rather than a line of metadata. */}
                {isDedicated && (
                    <div className="mt-6 border-t border-cyan-400/20 pt-5">
                        <div className="flex items-center gap-3 mb-2">
                            <span className="retro-eyebrow">// Made for //</span>
                            <Link
                                to={profilePath(crate.dedicated_to)}
                                className="retro-display text-base retro-glow-magenta"
                            >
                                {crate.dedicated_to.name}
                            </Link>
                        </div>
                        {crate.dedication_note && (
                            <blockquote className="retro-mono text-xl text-gray-300 border-l-2 border-fuchsia-500/60 pl-4">
                                &ldquo;{crate.dedication_note}&rdquo;
                            </blockquote>
                        )}
                    </div>
                )}
            </div>

            <section className="retro-panel retro-cut p-6">
                <h2 className="retro-display text-lg retro-glow-magenta mb-4">Tracklist</h2>
                {crate.songs.length === 0 ? (
                    <p className="retro-mono text-xl text-gray-500">&gt; nothing in this crate yet</p>
                ) : (
                    <ol className="space-y-1">
                        {crate.songs.map((song, i) => (
                            <li key={song.id}>
                                <div className="flex items-center gap-3 py-2 px-2 hover:bg-cyan-400/10 transition-colors group">
                                    <span className="retro-pixel text-[0.5rem] text-fuchsia-400 w-6 shrink-0">
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                    <img
                                        src={song.image_url || getDefaultAvatar(song.profile_id)}
                                        alt=""
                                        className="w-10 h-10 object-cover border border-cyan-400/40 shrink-0"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <Link
                                            to={`/song/${song.id}`}
                                            className="retro-mono text-xl block truncate text-gray-200 group-hover:text-cyan-200"
                                        >
                                            {song.title}
                                        </Link>
                                        <Link
                                            to={profilePath(song)}
                                            className="retro-mono text-lg block truncate text-gray-500 hover:text-fuchsia-300"
                                        >
                                            {song.profile_name}
                                        </Link>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
            </section>
        </div>
    );
};

export default Crate;
