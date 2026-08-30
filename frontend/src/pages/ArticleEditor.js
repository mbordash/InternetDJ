import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';

/**
 * The editor's desk.
 *
 * Lists everything not yet published and edits it in place. The queue is
 * ordered oldest submission first, because a review queue that surfaces the
 * newest item is a queue where the first person to submit waits longest.
 *
 * Access is enforced by the API, not by this page. The admin check here only
 * decides what to render; hiding a button has never stopped anyone, so
 * /articles/queue re-reads is_admin from the database on every request.
 */

const CATEGORIES = ['guides', 'features', 'interviews', 'reviews', 'news'];

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const inputClass = 'retro-input w-full px-3 py-2';

function ArticleEditor() {
    const { user } = useContext(AuthContext);
    const [queue, setQueue] = useState([]);
    const [selected, setSelected] = useState(null);
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [forbidden, setForbidden] = useState(false);

    const loadQueue = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/articles/queue`, { headers: authHeaders() });
            setQueue(res.data || []);
            setForbidden(false);
        } catch (err) {
            if (err.response?.status === 403) setForbidden(true);
            else setError('Could not load the queue.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (user) loadQueue(); }, [user, loadQueue]);

    const open = async (id) => {
        setError(null);
        setNotice(null);
        try {
            const res = await axios.get(`${API_URL}/articles/queue/${id}`, { headers: authHeaders() });
            setSelected(res.data);
            setDraft({
                title: res.data.title || '',
                deck: res.data.deck || '',
                category: res.data.category_slug || 'news',
                author_name: res.data.author_name || '',
                body_html: res.data.body_html || '',
                editor_note: res.data.editor_note || '',
            });
            window.scrollTo(0, 0);
        } catch {
            setError('Could not open that article.');
        }
    };

    const save = async (status) => {
        setSaving(true);
        setError(null);
        try {
            const payload = { ...draft };
            if (status) payload.status = status;
            const res = await axios.patch(`${API_URL}/articles/queue/${selected.id}`, payload, { headers: authHeaders() });
            setNotice(status === 'published'
                ? 'Published.'
                : status === 'submitted' ? 'Sent back to the author.' : 'Saved.');
            // A published article leaves the queue, so the editing pane has
            // nothing left to point at.
            if (status === 'published') { setSelected(null); setDraft(null); }
            else setSelected(res.data);
            await loadQueue();
        } catch (err) {
            setError(err.response?.data?.error || 'Could not save.');
        } finally {
            setSaving(false);
        }
    };

    if (!user) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <div className="retro-panel retro-cut px-8 py-10 text-center">
                    <p className="retro-mono text-2xl text-gray-300 mb-5">&gt; Log in to reach the editor&rsquo;s desk.</p>
                    <Link to="/login" className="retro-btn retro-btn--hot px-6 py-3 text-xs">Log In</Link>
                </div>
            </div>
        );
    }

    if (forbidden) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <div className="retro-panel retro-cut px-8 py-10 text-center">
                    <div className="retro-eyebrow mb-3">// Editors Only //</div>
                    <p className="retro-mono text-2xl text-gray-300 mb-5">
                        &gt; This desk is for editors.
                    </p>
                    <Link to="/articles/submit" className="retro-btn px-6 py-3 text-xs">Submit an Article Instead</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>Editor&rsquo;s Desk</title>
                <meta name="robots" content="noindex" />
            </Helmet>

            <div className="container mx-auto px-4 py-10 max-w-6xl">
                <header className="mb-8">
                    <div className="retro-eyebrow mb-3">// Editor&rsquo;s Desk //</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-5xl">Article Queue</h1>
                    <div className="retro-rule mt-4" />
                </header>

                {notice && <p className="retro-mono text-xl text-cyan-300 mb-4">&gt; {notice}</p>}
                {error && <p className="retro-mono text-xl text-fuchsia-300 mb-4">{error}</p>}

                <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <aside>
                        <h2 className="retro-eyebrow mb-3">
                            // Waiting ({queue.length}) //
                        </h2>
                        {loading && <p className="retro-mono text-xl text-cyan-200">&gt; loading&hellip;</p>}
                        {!loading && queue.length === 0 && (
                            <p className="retro-mono text-xl text-gray-400">&gt; nothing waiting.</p>
                        )}
                        <ul className="space-y-2">
                            {queue.map(a => (
                                <li key={a.id}>
                                    <button
                                        onClick={() => open(a.id)}
                                        className={`retro-card retro-cut p-3 w-full text-left ${selected?.id === a.id ? 'border-fuchsia-400' : ''}`}
                                    >
                                        <span className="retro-eyebrow text-fuchsia-400 block mb-1">{a.status}</span>
                                        <span className="retro-mono text-lg text-gray-200 block">{a.title}</span>
                                        <span className="retro-mono text-base text-gray-500">
                                            {a.author_name || 'unknown'} &middot; {a.category}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <Link to="/articles/submit" className="retro-btn px-5 py-3 text-xs mt-5 inline-block">
                            Write One Yourself
                        </Link>
                    </aside>

                    <section>
                        {!draft && (
                            <p className="retro-mono text-xl text-gray-400">
                                &gt; Pick something from the queue to edit it.
                            </p>
                        )}

                        {draft && (
                            <div className="retro-panel retro-cut p-6">
                                {selected.hero_image_url && (
                                    <img
                                        src={selected.hero_image_url}
                                        alt=""
                                        className="max-h-40 mb-5 border border-cyan-400/40"
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                )}

                                <label className="block mb-4">
                                    <span className="retro-eyebrow block mb-2">Title</span>
                                    <input className={inputClass} value={draft.title}
                                        onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                                </label>

                                <label className="block mb-4">
                                    <span className="retro-eyebrow block mb-2">Standfirst</span>
                                    <input className={inputClass} value={draft.deck}
                                        onChange={(e) => setDraft({ ...draft, deck: e.target.value })} />
                                </label>

                                <div className="grid gap-4 sm:grid-cols-2 mb-4">
                                    <label className="block">
                                        <span className="retro-eyebrow block mb-2">Category</span>
                                        <select className={inputClass} value={draft.category}
                                            onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="retro-eyebrow block mb-2">Byline</span>
                                        <input className={inputClass} value={draft.author_name}
                                            onChange={(e) => setDraft({ ...draft, author_name: e.target.value })} />
                                    </label>
                                </div>

                                <label className="block mb-4">
                                    <span className="retro-eyebrow block mb-2">Body</span>
                                    <textarea className={`${inputClass} min-h-[28rem] font-mono`} value={draft.body_html}
                                        onChange={(e) => setDraft({ ...draft, body_html: e.target.value })} />
                                </label>

                                <label className="block mb-6">
                                    <span className="retro-eyebrow block mb-2">Note to the author</span>
                                    <span className="retro-mono text-lg text-gray-400 block mb-2">
                                        Shown to them on their submissions list. Use it when sending something back.
                                    </span>
                                    <input className={inputClass} value={draft.editor_note}
                                        onChange={(e) => setDraft({ ...draft, editor_note: e.target.value })} />
                                </label>

                                <div className="flex flex-wrap gap-3">
                                    <button onClick={() => save(null)} disabled={saving}
                                        className="retro-btn px-6 py-3 text-xs disabled:opacity-50">
                                        {saving ? 'Saving…' : 'Save Changes'}
                                    </button>
                                    <button onClick={() => save('published')} disabled={saving}
                                        className="retro-btn retro-btn--hot px-6 py-3 text-xs disabled:opacity-50">
                                        Publish
                                    </button>
                                    <button onClick={() => save('submitted')} disabled={saving}
                                        className="retro-btn px-6 py-3 text-xs disabled:opacity-50">
                                        Send Back to Author
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

export default ArticleEditor;
