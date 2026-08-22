import { useEffect, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import API_URL from '../utils/api';
import { profilePath } from '../utils/profilePath';
import { AuthContext } from '../context/AuthContext';

const SORTS = [
    { key: 'recent', label: 'Recently updated' },
    { key: 'newest', label: 'Newest' },
    { key: 'largest', label: 'Most tracks' },
];

// Shared sleeve. Covers are stitched from the first four tracks, so an empty
// slot falls back to a tinted tile rather than a broken image.
const Sleeve = ({ art = [], name }) => (
    <div className="retro-crate__sleeve aspect-square mb-2">
        {art.length > 0 ? (
            <div className="grid grid-cols-2 grid-rows-2 gap-px w-full h-full">
                {[0, 1, 2, 3].map((i) => (
                    art[i]
                        ? <img key={i} src={art[i]} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <div key={i} className="w-full h-full bg-cyan-400/10" />
                ))}
            </div>
        ) : (
            <div className="w-full h-full flex items-center justify-center bg-fuchsia-500/10">
                <span className="retro-display text-[0.6rem] retro-glow-magenta text-center px-1">
                    {name?.slice(0, 12)}
                </span>
            </div>
        )}
    </div>
);

const CrateCard = ({ crate }) => (
    <Link to={`/crate/${crate.id}`} className="retro-crate group">
        <Sleeve art={crate.cover_art || []} name={crate.name} />
        <div className="retro-mono text-lg text-gray-200 truncate group-hover:text-cyan-200">
            {crate.name}
        </div>
        <div className="retro-mono text-lg text-gray-500 truncate">
            by {crate.owner?.name}
        </div>
        <div className="retro-mono text-lg text-gray-600 truncate">
            {crate.dedicated_to_name
                ? `mixtape for ${crate.dedicated_to_name}`
                : `${crate.song_count} track${crate.song_count === 1 ? '' : 's'}`}
        </div>
    </Link>
);

const Crates = () => {
    const { user } = useContext(AuthContext);
    const [crates, setCrates] = useState([]);
    const [madeForMe, setMadeForMe] = useState([]);
    const [sort, setSort] = useState('recent');
    const [mixtapesOnly, setMixtapesOnly] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({ sort });
                if (mixtapesOnly) params.set('mixtapes', '1');
                const response = await axios.get(`${API_URL}/playlists/public?${params}`);
                if (!cancelled) { setCrates(response.data || []); setError(null); }
            } catch (err) {
                if (!cancelled) setError('Could not load crates: ' + (err.response?.data?.error || err.message));
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [sort, mixtapesOnly]);

    // Mixtapes addressed to you, including private ones that never appear in
    // the public directory - this is the only place they surface.
    useEffect(() => {
        if (!user) { setMadeForMe([]); return; }
        let cancelled = false;
        (async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/playlists/made-for-me`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!cancelled) setMadeForMe(Array.isArray(response.data) ? response.data : []);
            } catch {
                if (!cancelled) setMadeForMe([]);   // never block the directory
            }
        })();
        return () => { cancelled = true; };
    }, [user]);

    return (
        <div className="retro-page container mx-auto px-4 py-10">

            <div className="retro-eyebrow mb-2">// Crates &amp; Mixtapes //</div>
            <h1 className="retro-display text-2xl retro-glow-cyan mb-2">Dig Through the Crates</h1>
            <p className="retro-mono text-xl text-gray-400 mb-8">
                &gt; playlists put together by members. make one for someone and it becomes a mixtape.
            </p>

            {madeForMe.length > 0 && (
                <section className="retro-panel retro-cut p-6 mb-10">
                    <h2 className="retro-display text-lg retro-glow-magenta mb-1">Made For You</h2>
                    <p className="retro-mono text-lg text-gray-500 mb-4">
                        &gt; mixtapes other members put together for you
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {madeForMe.map((tape) => (
                            <Link key={tape.id} to={`/crate/${tape.id}`} className="retro-crate group">
                                <div className="retro-mono text-lg text-gray-200 truncate group-hover:text-cyan-200">
                                    {tape.name}
                                </div>
                                <div className="retro-mono text-lg text-fuchsia-300 truncate">
                                    from {tape.from_name}
                                </div>
                                {tape.dedication_note && (
                                    <div className="retro-mono text-lg text-gray-500 truncate">
                                        &ldquo;{tape.dedication_note}&rdquo;
                                    </div>
                                )}
                                <div className="retro-mono text-lg text-gray-600">
                                    {tape.song_count} track{tape.song_count === 1 ? '' : 's'}
                                    {!tape.is_public && ' · private'}
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            <div className="flex flex-wrap items-center gap-3 mb-6">
                {SORTS.map((option) => (
                    <button
                        key={option.key}
                        onClick={() => setSort(option.key)}
                        aria-pressed={sort === option.key}
                        className={`retro-chip px-3 py-1 retro-mono text-lg ${
                            sort === option.key ? 'border-cyan-400 text-cyan-200' : 'text-gray-400'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
                <button
                    onClick={() => setMixtapesOnly((on) => !on)}
                    aria-pressed={mixtapesOnly}
                    className={`retro-chip px-3 py-1 retro-mono text-lg ${
                        mixtapesOnly ? 'border-fuchsia-400 text-fuchsia-200' : 'text-gray-400'
                    }`}
                >
                    Mixtapes only
                </button>
            </div>

            {isLoading ? (
                <p className="retro-mono text-xl text-cyan-300">&gt; loading crates...</p>
            ) : error ? (
                <p className="retro-mono text-xl text-fuchsia-400">{error}</p>
            ) : crates.length === 0 ? (
                <div className="retro-panel retro-cut p-8 text-center">
                    <p className="retro-mono text-xl text-gray-400 mb-4">
                        {mixtapesOnly
                            ? '> no public mixtapes yet. be the first to make one for somebody.'
                            : '> no public crates yet. build one and share it.'}
                    </p>
                    <Link to="/playlists" className="retro-btn retro-btn--hot px-5 py-2 text-[0.6rem]">
                        Make a Crate
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
                    {crates.map((crate) => <CrateCard key={crate.id} crate={crate} />)}
                </div>
            )}
        </div>
    );
};

export default Crates;
