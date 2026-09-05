import { useContext, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import API_URL from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import profilePath from '../utils/profilePath';
import genreTags, { tagHref } from '../utils/genreTags';
import useDocumentTitle from '../utils/useDocumentTitle';

/**
 * One release: an album, an EP or a single, with its running order.
 *
 * This is the artist's own grouping of their own tracks, as opposed to a
 * mixtape, which is a listener collecting anyone's. The order means something
 * here, so the tracks are numbered and never shuffled.
 *
 * Every track still has its own page, its own comments and its own play count.
 * A release is a sleeve around them, not a container they moved into, and the
 * track titles link straight through so nothing is a dead end.
 */

const RELEASE_TYPE_LABELS = {
    album: 'Album',
    ep: 'EP',
    single: 'Single',
};

const formatDuration = (seconds) => {
    if (!Number.isFinite(Number(seconds))) return null;
    const total = Math.round(Number(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};

// A release date is a date, not a moment. Rendering it in the visitor's
// timezone would slide a midnight release back a day for half the world.
const formatReleaseDate = (value) => {
    if (!value) return null;
    const text = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const [year, month, day] = text.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
};

function Release() {
    const { releaseId } = useParams();
    const { user } = useContext(AuthContext);
    const audioPlayer = useContext(AudioPlayerContext);
    const [release, setRelease] = useState(null);
    useDocumentTitle(release?.title && `${release.title} by ${release.profile_name}`);
    const [tracks, setTracks] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(
                    `${API_URL}/releases/${releaseId}`,
                    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
                );
                if (cancelled) return;
                setRelease(response.data.release);
                setTracks(response.data.tracks || []);
                setError(null);
            } catch (err) {
                if (cancelled) return;
                setError(
                    err.response?.status === 404
                        ? 'That release is not here.'
                        : `Could not load this release: ${err.response?.data?.error || err.message}`
                );
                setRelease(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [releaseId, user?.id]);

    /**
     * Play the release from a given track onwards.
     *
     * playPlaylist rather than playSong, and from an index rather than one
     * track: the running order is the whole reason a release is not a pile of
     * songs, so starting at track four should carry on into five. playSong
     * resets the queue to a single song, which would stop the record dead at
     * the end of whatever was clicked.
     *
     * The footer player is used rather than an element on this page, because
     * this is published music being listened to in the ordinary way and taking
     * over playback is exactly what pressing play here means.
     */
    const playFrom = (index) => {
        if (!audioPlayer?.playPlaylist) return;
        const queue = tracks.slice(index).map((track) => ({
            id: track.id,
            title: track.title,
            mp3_url: track.mp3_url,
            image_url: track.image_url || release?.cover_url || null,
            profile_id: track.profile_id,
            profile_name: track.profile_name,
            profile_slug: track.profile_slug,
        }));
        if (queue.length) audioPlayer.playPlaylist(queue);
    };

    if (loading) {
        return (
            <div className="retro-page min-h-screen pt-24 pb-16 px-4">
                <p className="container mx-auto retro-mono text-xl text-gray-300">Loading...</p>
            </div>
        );
    }

    if (error || !release) {
        return (
            <div className="retro-page min-h-screen pt-24 pb-16 px-4">
                <div className="container mx-auto max-w-2xl retro-panel retro-cut p-6">
                    <h1 className="retro-display text-lg retro-glow-magenta mb-3">Release not found</h1>
                    <p className="retro-mono text-lg text-gray-300 mb-4">{error}</p>
                    <Link to="/browse" className="retro-btn retro-btn--hot px-5 py-2 text-xs">Browse music</Link>
                </div>
            </div>
        );
    }

    const typeLabel = RELEASE_TYPE_LABELS[release.release_type] || 'Release';
    const released = formatReleaseDate(release.release_date);

    return (
        <div className="retro-page min-h-screen pt-24 pb-16 px-4">
            <Helmet>
                <title>{`${release.title} by ${release.profile_name} | InternetDJ`}</title>
                <meta
                    name="description"
                    content={`${typeLabel} by ${release.profile_name} on InternetDJ`
                        + `${released ? `, released ${released}` : ''}`
                        + `. ${release.track_count} track${release.track_count === 1 ? '' : 's'}.`}
                />
                {/* A release the artist has hidden is reachable only by them, so
                    it must never be indexed while they are working on it. */}
                {release.visibility === 'private' && (
                    <meta name="robots" content="noindex, nofollow" />
                )}
            </Helmet>

            <div className="container mx-auto max-w-4xl space-y-6">
                <div className="retro-panel retro-cut p-6">
                    <div className="flex flex-col sm:flex-row gap-6">
                        {release.cover_url ? (
                            <img
                                src={release.cover_url}
                                alt=""
                                className="w-full sm:w-56 aspect-square object-cover border border-cyan-400/30 shrink-0"
                            />
                        ) : (
                            <div className="w-full sm:w-56 aspect-square shrink-0 border border-cyan-400/30 bg-fuchsia-900/25 flex items-center justify-center retro-pixel text-[0.6rem] text-cyan-300 text-center px-2">
                                {release.title.slice(0, 24)}
                            </div>
                        )}

                        <div className="min-w-0 flex-1">
                            <div className="retro-eyebrow">// {typeLabel} //</div>
                            <h1 className="retro-display text-xl retro-glow-cyan break-words mt-1">
                                {release.title}
                            </h1>
                            <p className="retro-mono text-xl text-gray-300 mt-2">
                                by{' '}
                                <Link to={profilePath(release)} className="retro-link">
                                    {release.profile_name}
                                </Link>
                            </p>
                            <p className="retro-mono text-lg text-gray-400 mt-1">
                                {release.track_count} track{release.track_count === 1 ? '' : 's'}
                                {released ? ` · ${released}` : ''}
                            </p>

                            {release.is_owner && release.visibility === 'private' && (
                                <p className="retro-chip inline-block mt-3 px-2 py-1 border-fuchsia-400 text-fuchsia-200">
                                    Hidden. Only you can see this.
                                </p>
                            )}

                            {release.description && (
                                <p className="retro-mono text-lg text-gray-300 mt-4 whitespace-pre-line break-words">
                                    {release.description}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="retro-panel retro-cut p-6">
                    <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                        <h2 className="retro-display text-lg retro-glow-magenta">Tracks</h2>
                        {tracks.length > 0 && (
                            <button
                                type="button"
                                onClick={() => playFrom(0)}
                                className="retro-btn retro-btn--hot px-5 py-2 text-xs"
                            >
                                Play {typeLabel.toLowerCase()}
                            </button>
                        )}
                    </div>

                    {tracks.length === 0 ? (
                        <p className="retro-mono text-lg text-gray-300">
                            {release.is_owner
                                ? 'Nothing on this release yet. Add tracks from your Songs Manager.'
                                : 'No tracks on this release yet.'}
                        </p>
                    ) : (
                        <ol className="space-y-2">
                            {tracks.map((track, index) => (
                                <li
                                    key={track.id}
                                    className="retro-card retro-cut flex items-center gap-3 p-3"
                                >
                                    <span className="retro-mono text-lg text-gray-500 w-6 shrink-0 tabular-nums">
                                        {track.track_no}
                                    </span>

                                    <button
                                        type="button"
                                        onClick={() => playFrom(index)}
                                        aria-label={`Play ${track.title} and the rest of the release`}
                                        className="retro-icon-btn p-2 shrink-0"
                                    >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </button>

                                    <div className="min-w-0 flex-1">
                                        <Link
                                            to={`/song/${track.id}`}
                                            className="retro-link retro-mono text-xl block truncate"
                                        >
                                            {track.title}
                                        </Link>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                                            {genreTags(track.genre).slice(0, 2).map((tag) => (
                                                <Link key={tag} to={tagHref(tag)} className="retro-chip px-2 py-0.5">
                                                    {tag}
                                                </Link>
                                            ))}
                                            {track.visibility === 'private' && (
                                                <span className="retro-chip px-2 py-0.5 border-fuchsia-400 text-fuchsia-200">
                                                    Hidden
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <span className="retro-mono text-lg text-gray-500 shrink-0 tabular-nums">
                                        {formatDuration(track.duration) || ''}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Release;
