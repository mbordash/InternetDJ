import { useEffect, useState } from 'react';
import { useContext } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { getDefaultAvatar } from '../utils/defaultAvatar';
import { AuthContext } from '../context/AuthContext';

function Collabs() {
    const { user } = useContext(AuthContext);
    const [collabs, setCollabs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const baseUrl = SITE_URL;

    useEffect(() => {
        const loadPublicCollabs = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await axios.get(`${API_URL}/collabs/public`);
                setCollabs(Array.isArray(response.data?.collaborations) ? response.data.collaborations : []);
            } catch (err) {
                setError(`Failed to load collaborations: ${err.response?.data?.error || err.message}`);
            } finally {
                setIsLoading(false);
            }
        };

        loadPublicCollabs();
    }, []);

    return (
        <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>Public Collaborations | InternetDJ</title>
                <meta name="description" content="Explore public collaborations from InternetDJ members and jump into tracks from the community." />
                <link rel="canonical" href={`${baseUrl}/collabs`} />
            </Helmet>

            <div className="container mx-auto px-4 py-8 max-w-6xl">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold text-white tracking-tight">Public Collaborations</h1>
                    {user ? (
                        <Link
                            to={`/profile/${user.profile_id || user.id}/collaborations`}
                            className="spotify-pill px-4 py-2 rounded-full text-sm transition-colors"
                        >
                            Create/Manage Collabs
                        </Link>
                    ) : (
                        <Link
                            to="/login"
                            className="spotify-pill px-4 py-2 rounded-full text-sm transition-colors"
                        >
                            Log in to create or join
                        </Link>
                    )}
                </div>

                {isLoading && (
                    <div className="spotify-surface p-6 border border-white/10 rounded-xl text-gray-300">
                        Loading collaborations...
                    </div>
                )}

                {!isLoading && error && (
                    <div className="spotify-surface p-6 border border-white/10 rounded-xl text-red-400">
                        {error}
                    </div>
                )}

                {!isLoading && !error && collabs.length === 0 && (
                    <div className="spotify-surface p-6 border border-white/10 rounded-xl text-gray-300">
                        No public collaborations yet.
                    </div>
                )}

                {!isLoading && !error && collabs.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {collabs.map((collab) => (
                            <article key={collab.id} className="spotify-surface border border-white/10 rounded-xl p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-xl font-semibold text-white mb-2">{collab.title}</h2>
                                        <p className="text-gray-300 text-sm line-clamp-3">
                                            {collab.description || 'No description yet.'}
                                        </p>
                                    </div>
                                    <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-gray-200 whitespace-nowrap">
                                        {collab.track_count} track{collab.track_count === 1 ? '' : 's'}
                                    </span>
                                </div>

                                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between gap-3">
                                    <Link
                                        to={collab.profile_id ? `/profile/${collab.profile_id}` : '#'}
                                        className="flex items-center gap-2 min-w-0"
                                    >
                                        <img
                                            src={getDefaultAvatar(collab.owner_picture_url)}
                                            alt={collab.owner_name}
                                            className="w-8 h-8 rounded-full object-cover"
                                        />
                                        <span className="text-sm text-gray-200 truncate">{collab.owner_name}</span>
                                    </Link>

                                    <div className="flex items-center gap-2">
                                        {collab.allow_uploads && (
                                            <span className="text-xs px-2 py-1 rounded-full bg-primary-brand-500/20 text-primary-brand-200">
                                                Open to uploads
                                            </span>
                                        )}
                                        <Link
                                            to={collab.profile_id ? `/profile/${collab.profile_id}` : '#'}
                                            className="text-sm text-primary-brand-300 hover:text-primary-brand-200"
                                        >
                                            Open Profile
                                        </Link>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Collabs;




