import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import API_URL from '../utils/api';
import profilePath from '../utils/profilePath';
import genreTags from '../utils/genreTags';
import useDocumentTitle from '../utils/useDocumentTitle';

/**
 * A track played from its private link.
 *
 * The address is the credential. Anyone holding it can play the track without
 * an account and whatever the track's visibility says, which is the whole point
 * of handing a work in progress to a few people before it is finished.
 *
 * Three things follow from that and are deliberate:
 *
 *   - noindex, nofollow and noarchive, plus a robots.txt rule on /s/. A private
 *     link that turns up in a search result is not private. The meta tag is the
 *     one that actually keeps it out of the index; the robots rule only stops
 *     the fetch.
 *   - A plain audio element rather than the footer player. The footer player is
 *     keyed to song ids and counts plays, and a preview sent to three people
 *     should not move a public play count or push whatever the visitor was
 *     already listening to out of the way.
 *   - No download button, no comment box, no like. The artist shared a link,
 *     not a release. Everything else waits until they publish.
 */
function SharedSong() {
    const { token } = useParams();
    const [song, setSong] = useState(null);
    useDocumentTitle(song?.title && `${song.title} (private link)`);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const response = await axios.get(`${API_URL}/music/shared/${encodeURIComponent(token)}`);
                if (!cancelled) {
                    setSong(response.data.song);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    // A wrong, revoked or replaced token is all the same answer,
                    // and says nothing about whether the track exists.
                    setError(
                        err.response?.status === 404
                            ? 'This link is not valid any more. The artist may have replaced or turned it off.'
                            : 'Could not load this track. Try again in a moment.'
                    );
                    setSong(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [token]);

    const tags = genreTags(song?.genre || '');

    return (
        <div className="retro-page min-h-screen pt-24 pb-16 px-4">
            <Helmet>
                <title>{song ? `${song.title} (private link)` : 'Private link'} | InternetDJ</title>
                <meta name="robots" content="noindex, nofollow, noarchive" />
            </Helmet>

            <div className="container mx-auto max-w-2xl">
                {loading && (
                    <p className="retro-mono text-xl text-gray-300">Loading...</p>
                )}

                {!loading && error && (
                    <div className="retro-panel retro-cut p-6">
                        <h1 className="retro-display text-lg retro-glow-magenta mb-3">Link not valid</h1>
                        <p className="retro-mono text-lg text-gray-300 mb-4">{error}</p>
                        <Link to="/" className="retro-btn retro-btn--hot px-5 py-2 text-xs">
                            Go to InternetDJ
                        </Link>
                    </div>
                )}

                {!loading && song && (
                    <div className="retro-panel retro-cut p-6 space-y-5">
                        <div className="retro-eyebrow">// Private link //</div>

                        <div className="flex items-start gap-4">
                            {song.image_url ? (
                                <img
                                    src={song.image_url}
                                    alt=""
                                    className="w-24 h-24 object-cover border border-cyan-400/30 shrink-0"
                                />
                            ) : (
                                <div className="w-24 h-24 shrink-0 border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.45rem] text-cyan-300">
                                    No Image
                                </div>
                            )}
                            <div className="min-w-0">
                                <h1 className="retro-display text-lg retro-glow-cyan break-words">{song.title}</h1>
                                <p className="retro-mono text-xl text-gray-300 mt-1">
                                    by{' '}
                                    <Link to={profilePath(song)} className="retro-link">
                                        {song.profile_name}
                                    </Link>
                                </p>
                                {tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {tags.slice(0, 3).map((tag) => (
                                            <span key={tag} className="retro-chip px-2 py-0.5">{tag}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <audio controls preload="metadata" src={song.mp3_url} className="w-full">
                            <track kind="captions" />
                        </audio>

                        {song.description && (
                            <p className="retro-mono text-lg text-gray-300 whitespace-pre-line break-words">
                                {song.description}
                            </p>
                        )}

                        <p className="retro-mono text-lg text-gray-500 border-t border-cyan-400/20 pt-4">
                            {song.visibility === 'private'
                                ? 'This track is not published. You are hearing it because the artist sent you this link, so please keep it to yourself.'
                                : 'You are hearing this through a private link the artist shared with you.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SharedSong;
