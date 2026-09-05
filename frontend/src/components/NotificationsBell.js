import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import API_URL from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import relativeDate from '../utils/relativeDate';
import { getDefaultAvatar } from '../utils/defaultAvatar';

/**
 * In-site notifications.
 *
 * The backend has written notification rows for a long time and mailed them
 * out, but nothing on the site ever showed them: the only way to learn that
 * somebody had reviewed your track was to find the email, or to go and look.
 * This is the missing half.
 *
 * Polling rather than sockets. The site already runs a socket server for the
 * DAW, but a bell that is a minute out of date is not a problem worth holding a
 * connection open on every page for every signed-in visitor. The poll pauses
 * entirely while the tab is hidden, so a browser left open overnight on a
 * background tab makes no requests at all.
 */

const POLL_MS = 60_000;

// Every type the backend can write, with the glyph that stands for it. An
// unknown type still renders, with a neutral mark, so a notification added
// server side is never invisible here while this file catches up.
const TYPE_GLYPHS = {
    song_reviewed: '💬',
    review_replied: '↩️',
    review_reaction: '👍',
    song_liked: '❤️',
    profile_followed: '👤',
    artist_song_uploaded: '🎵',
    song_version_added: '🔁',
    forum_post_replied: '🗨️',
    collab_track_added: '🎛️',
    playlist_dedication: '📼',
    idjc_received: '🪙',
    site_update: '📣',
};

/** Where clicking a notification should take you. */
const targetPath = (notification) => {
    const { entity_type: type, entity_id: id } = notification;
    if (!id) return null;
    if (type === 'song') return `/song/${id}`;
    if (type === 'forum_post') return `/forum/post/${id}`;
    if (type === 'profile') return `/profile/${id}`;
    if (type === 'playlist') return `/crate/${id}`;
    if (type === 'release') return `/release/${id}`;
    if (type === 'article') return `/articles/${id}`;
    return null;
};

/**
 * The stored `message` is written from the recipient's side and never names
 * anybody, so the actor's name has to be put back on the front here. A site
 * update has no meaningful actor, so it is left as written.
 */
const describe = (notification) => {
    if (notification.type === 'site_update') return notification.message;
    const actor = notification.actor_name && notification.actor_name !== 'Unknown'
        ? notification.actor_name
        : null;
    if (!actor) return notification.message;
    // "Someone posted a review on your uploaded song." reads far better as
    // "DJ Subspace posted a review on your uploaded song."
    const rewritten = notification.message.replace(/^Someone\b/, actor);
    if (rewritten !== notification.message) return rewritten;
    return `${actor}: ${notification.message}`;
};

function NotificationsBell({ onNavigate }) {
    const { user } = useContext(AuthContext);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const panelRef = useRef(null);

    const authHeader = useCallback(() => {
        const token = localStorage.getItem('token');
        return token ? { Authorization: `Bearer ${token}` } : null;
    }, []);

    const load = useCallback(async () => {
        const headers = authHeader();
        if (!headers) return;
        try {
            const response = await axios.get(`${API_URL}/notifications`, { headers });
            setNotifications(response.data?.notifications || []);
            setUnreadCount(response.data?.unread_count || 0);
            setError(null);
        } catch (err) {
            // A failed poll is not worth an error message in the header. The
            // next one is a minute away, and the badge simply does not move.
            setError(err.response?.data?.error || 'Could not load notifications');
        }
    }, [authHeader]);

    // Poll while signed in and while the tab is actually being looked at.
    useEffect(() => {
        if (!user) {
            setNotifications([]);
            setUnreadCount(0);
            return undefined;
        }

        let timer = null;
        const tick = () => {
            if (!document.hidden) load();
        };

        load();
        timer = setInterval(tick, POLL_MS);

        // Coming back to the tab should show the current state immediately
        // rather than at the end of whatever was left of the interval.
        const onVisible = () => { if (!document.hidden) load(); };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            if (timer) clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [user, load]);

    // Dismiss on an outside click or Escape, matching the other menus in the
    // header so the whole bar behaves one way.
    useEffect(() => {
        if (!isOpen) return undefined;
        const onOutside = (event) => {
            if (panelRef.current && !panelRef.current.contains(event.target)) setIsOpen(false);
        };
        const onEscape = (event) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onOutside);
        document.addEventListener('keydown', onEscape);
        return () => {
            document.removeEventListener('mousedown', onOutside);
            document.removeEventListener('keydown', onEscape);
        };
    }, [isOpen]);

    const openPanel = async () => {
        const next = !isOpen;
        setIsOpen(next);
        if (next) {
            setLoading(true);
            await load();
            setLoading(false);
        }
    };

    const markRead = async (id) => {
        const headers = authHeader();
        if (!headers) return;
        // Moved locally first: the panel is already open and the row should
        // stop looking unread the moment it is clicked, not a round trip later.
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
        setUnreadCount((count) => Math.max(0, count - 1));
        try {
            await axios.patch(`${API_URL}/notifications/${id}/read`, {}, { headers });
        } catch {
            load();   // put the truth back if the write did not land
        }
    };

    const markAllRead = async () => {
        const headers = authHeader();
        if (!headers) return;
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
        try {
            await axios.patch(`${API_URL}/notifications/read-all`, {}, { headers });
        } catch {
            load();
        }
    };

    const dismiss = async (id) => {
        const headers = authHeader();
        if (!headers) return;
        const removed = notifications.find((n) => n.id === id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        if (removed && !removed.is_read) setUnreadCount((count) => Math.max(0, count - 1));
        try {
            await axios.delete(`${API_URL}/notifications/${id}`, { headers });
        } catch {
            load();
        }
    };

    const handleOpenItem = (notification) => {
        if (!notification.is_read) markRead(notification.id);
        setIsOpen(false);
        if (onNavigate) onNavigate();
    };

    if (!user) return null;

    const badge = unreadCount > 99 ? '99+' : String(unreadCount);

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                onClick={openPanel}
                aria-expanded={isOpen}
                aria-haspopup="true"
                aria-label={unreadCount > 0
                    ? `Notifications, ${unreadCount} unread`
                    : 'Notifications'}
                className="retro-icon-btn relative p-2"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                </svg>
                {unreadCount > 0 && (
                    <span
                        className="absolute -top-1 -right-1 min-w-[1.15rem] px-1 h-[1.15rem] flex items-center
                                   justify-center retro-pixel text-[0.5rem] bg-fuchsia-500 text-black
                                   border border-black leading-none"
                    >
                        {badge}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="retro-panel retro-cut absolute right-0 mt-3 w-[min(22rem,calc(100vw-2rem))] z-50">
                    <div className="flex items-center justify-between px-3 pt-2 pb-1">
                        <div className="retro-eyebrow">// Activity //</div>
                        {unreadCount > 0 && (
                            <button
                                type="button"
                                onClick={markAllRead}
                                className="retro-link retro-mono text-sm"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-[24rem] overflow-y-auto">
                        {loading && notifications.length === 0 && (
                            <p className="px-3 py-4 text-sm text-gray-400">Loading...</p>
                        )}

                        {!loading && notifications.length === 0 && (
                            <p className="px-3 py-4 text-sm text-gray-400">
                                Nothing yet. Reviews, follows and replies show up here.
                            </p>
                        )}

                        {error && notifications.length === 0 && (
                            <p className="px-3 pb-3 text-sm text-red-400">{error}</p>
                        )}

                        {notifications.map((notification) => {
                            const href = targetPath(notification);
                            const glyph = TYPE_GLYPHS[notification.type] || '•';
                            const text = describe(notification);

                            const body = (
                                <div className="flex items-start gap-3 min-w-0">
                                    <span
                                        className="shrink-0 text-base leading-none mt-0.5"
                                        aria-hidden="true"
                                    >
                                        {glyph}
                                    </span>
                                    {notification.actor_picture ? (
                                        <img
                                            src={notification.actor_picture}
                                            alt=""
                                            className="w-7 h-7 shrink-0 object-cover border border-cyan-400/40"
                                            onError={(e) => {
                                                e.currentTarget.src = getDefaultAvatar(
                                                    notification.actor_profile_id || notification.actor_name
                                                );
                                            }}
                                        />
                                    ) : null}
                                    <span className="min-w-0">
                                        <span className="block text-sm text-gray-200 break-words">{text}</span>
                                        <span className="block retro-mono text-sm text-gray-500 mt-0.5">
                                            {relativeDate(notification.created_at)}
                                        </span>
                                    </span>
                                </div>
                            );

                            return (
                                <div
                                    key={notification.id}
                                    className={`flex items-start gap-2 px-3 py-2 border-t border-cyan-400/15 ${
                                        notification.is_read ? '' : 'bg-fuchsia-500/10'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        {href ? (
                                            <Link
                                                to={href}
                                                onClick={() => handleOpenItem(notification)}
                                                className="block hover:opacity-80"
                                            >
                                                {body}
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleOpenItem(notification)}
                                                className="block w-full text-left hover:opacity-80"
                                            >
                                                {body}
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => dismiss(notification.id)}
                                        aria-label="Dismiss notification"
                                        title="Dismiss"
                                        className="shrink-0 text-gray-500 hover:text-fuchsia-300 px-1 leading-none"
                                    >
                                        &times;
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

export default NotificationsBell;
