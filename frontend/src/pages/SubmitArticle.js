import React, { useContext, useEffect, useState } from 'react';
import ArticleBodyEditor from '../components/ArticleBodyEditor';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';

/**
 * Member article submission.
 *
 * Submitting is not publishing. Everything written here lands in the editor's
 * queue, including an editor's own writing, so there is one path through the
 * system rather than a members' door and a staff door.
 *
 * The image is required, and the form says so up front rather than rejecting
 * the submission after someone has typed a thousand words. The article index
 * is a grid of cards that are mostly artwork, so a piece without one either
 * blocks its own publication later or ships a hole in the grid.
 */

const CATEGORIES = [
    ['guides', 'Guides', 'How-to and technique writing for producers.'],
    ['features', 'Features', 'Longer pieces, opinion, scene writing.'],
    ['interviews', 'Interviews', 'Conversations with artists.'],
    ['reviews', 'Reviews', 'Releases, gear, events.'],
    ['news', 'News', 'Something that just happened.'],
];

const MIN_BODY = 400;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Mirrors uploadToS3's allowlist. Checking here too means a wrong file is
// caught before an upload rather than after it.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

// `control` is false for fields whose input is not a form control - the body
// editor is a contenteditable with a toolbar, and a <label> wrapped round that
// has nothing to forward a click to.
const Field = ({ label, hint, children, required, control = true }) => {
    const Tag = control ? 'label' : 'div';
    return (
        <Tag className="block mb-6">
            <span className="retro-eyebrow block mb-2">
                {label}{required && <span className="text-fuchsia-400"> *</span>}
            </span>
            {hint && <span className="retro-mono text-lg text-gray-400 block mb-2">{hint}</span>}
            {children}
        </Tag>
    );
};

const inputClass = 'retro-input w-full px-3 py-2';

function SubmitArticle() {
    const { user } = useContext(AuthContext);

    const [form, setForm] = useState({ title: '', deck: '', category: 'guides', body: '' });
    const [image, setImage] = useState(null);
    const [preview, setPreview] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(null);
    const [mine, setMine] = useState([]);

    useEffect(() => {
        if (!user) return;
        const token = localStorage.getItem('token');
        axios.get(`${API_URL}/articles/mine`, { headers: { Authorization: `Bearer ${token}` } })
            .then(res => setMine(res.data || []))
            .catch(() => setMine([]));
    }, [user, done]);

    // Revoking the object URL matters here because a submitter may swap the
    // image several times before sending; each preview otherwise leaks.
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const pickImage = (file) => {
        setError(null);
        if (!file) return;
        if (!IMAGE_TYPES.includes(file.type)) {
            setError('That file is not an image we can use. JPEG, PNG or GIF, please.');
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            setError(`That image is ${(file.size / 1048576).toFixed(1)}MB. The limit is 5MB.`);
            return;
        }
        if (preview) URL.revokeObjectURL(preview);
        setImage(file);
        setPreview(URL.createObjectURL(file));
    };

    // Counts what the server counts: text, not markup, so the number on screen
    // agrees with the one in a rejection message.
    const bodyTextLength = form.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;

    const submit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!image) return setError('An image is required.');
        if (bodyTextLength < MIN_BODY) {
            return setError(`The article is ${bodyTextLength} characters; at least ${MIN_BODY} are needed.`);
        }

        setSubmitting(true);
        try {
            const data = new FormData();
            data.append('title', form.title);
            data.append('deck', form.deck);
            data.append('category', form.category);
            data.append('body_html', form.body);
            data.append('image', image);

            const token = localStorage.getItem('token');
            const res = await axios.post(`${API_URL}/articles`, data, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setDone(res.data);
            setForm({ title: '', deck: '', category: 'guides', body: '' });
            setImage(null);
            if (preview) URL.revokeObjectURL(preview);
            setPreview(null);
            window.scrollTo(0, 0);
        } catch (err) {
            setError(err.response?.data?.error || 'Could not submit the article.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!user) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <div className="retro-panel retro-cut px-8 py-10 text-center max-w-md">
                    <div className="retro-eyebrow mb-3">// Members Only //</div>
                    <p className="retro-mono text-2xl text-gray-300 mb-6">
                        &gt; You need an account to write for InternetDJ.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Link to="/login" className="retro-btn retro-btn--hot px-6 py-3 text-xs">Log In</Link>
                        <Link to="/register" className="retro-btn px-6 py-3 text-xs">Sign Up Free</Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>Write for InternetDJ</title>
                {/* A submission form is a page for members, not a search
                    result: nothing here is worth indexing, and an indexed
                    form competes with /articles for the same query. */}
                <meta name="robots" content="noindex" />
            </Helmet>

            <div className="container mx-auto px-4 py-10 max-w-3xl">
                <header className="mb-8">
                    <div className="retro-eyebrow mb-3">// Contribute //</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-5xl">Write for InternetDJ</h1>
                    <p className="retro-mono text-xl text-cyan-200 mt-3">
                        Guides, features, interviews, reviews. Submissions go to the editor before
                        they run.
                    </p>
                    <div className="retro-rule mt-4" />
                </header>

                {done && (
                    <div className="retro-panel retro-cut p-6 mb-8">
                        <div className="retro-eyebrow mb-2">// Sent //</div>
                        <p className="retro-mono text-xl text-gray-200">{done.message}</p>
                        <p className="retro-mono text-lg text-gray-400 mt-2">
                            It will appear below as &ldquo;submitted&rdquo; until an editor publishes it.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="retro-panel retro-cut p-5 mb-6 border-l-4 border-fuchsia-500">
                        <p className="retro-mono text-xl text-fuchsia-300">{error}</p>
                    </div>
                )}

                <form onSubmit={submit} className="retro-panel retro-cut p-6 mb-10">
                    <Field label="Title" required>
                        <input
                            className={inputClass}
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            placeholder="How to promote your techno track in 2026"
                            required
                            minLength={6}
                        />
                    </Field>

                    <Field label="Standfirst" hint="One line under the headline. Optional, but it is what shows on the article card.">
                        <input
                            className={inputClass}
                            value={form.deck}
                            onChange={(e) => setForm({ ...form, deck: e.target.value })}
                            placeholder="What the piece is about, in a sentence."
                        />
                    </Field>

                    <Field label="Category" required>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {CATEGORIES.map(([slug, name, hint]) => (
                                <button
                                    type="button"
                                    key={slug}
                                    onClick={() => setForm({ ...form, category: slug })}
                                    className={`retro-card retro-cut p-3 text-left ${form.category === slug ? 'border-fuchsia-400' : ''}`}
                                >
                                    <span className={`retro-display text-sm block ${form.category === slug ? 'retro-glow-magenta' : 'text-gray-300'}`}>
                                        {name}
                                    </span>
                                    <span className="retro-mono text-base text-gray-400">{hint}</span>
                                </button>
                            ))}
                        </div>
                    </Field>

                    <Field
                        label="Image"
                        required
                        hint="Required. Every article needs artwork for its card. JPEG, PNG or GIF, up to 5MB."
                    >
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif"
                            onChange={(e) => pickImage(e.target.files?.[0])}
                            className="retro-mono text-lg text-gray-300 block w-full"
                            required
                        />
                        {preview && (
                            <img
                                src={preview}
                                alt="Selected artwork preview"
                                className="mt-3 max-h-48 border border-cyan-400/40"
                            />
                        )}
                    </Field>

                    <Field
                        label="The article"
                        required
                        control={false}
                        hint="Write it here and format it with the toolbar. Switch to HTML if you would rather work in markup."
                    >
                        <ArticleBodyEditor
                            value={form.body}
                            onChange={(body) => setForm({ ...form, body })}
                            placeholder="Open with the thing a producer actually needs to know..."
                            label="The article"
                        />
                        <span className={`retro-mono text-lg block mt-2 ${bodyTextLength < MIN_BODY ? 'text-fuchsia-300' : 'text-cyan-300'}`}>
                            {bodyTextLength} characters{bodyTextLength < MIN_BODY && `, ${MIN_BODY - bodyTextLength} more needed`}
                        </span>
                    </Field>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="retro-btn retro-btn--hot px-8 py-4 text-sm disabled:opacity-50"
                    >
                        {submitting ? 'Sending…' : 'Send to the Editor'}
                    </button>
                </form>

                {mine.length > 0 && (
                    <section>
                        <div className="retro-eyebrow mb-3">// Your Submissions //</div>
                        <div className="retro-rule mb-5" />
                        <ul className="space-y-3">
                            {mine.map(a => (
                                <li key={a.id} className="retro-card retro-cut p-4">
                                    <div className="flex flex-wrap items-center gap-3 mb-1">
                                        <span className={`retro-eyebrow ${a.status === 'published' ? 'text-cyan-300' : 'text-fuchsia-400'}`}>
                                            {a.status}
                                        </span>
                                        <span className="retro-mono text-base text-gray-500">{a.category}</span>
                                    </div>
                                    <p className="retro-mono text-xl text-gray-200">
                                        {a.status === 'published'
                                            ? <Link to={`/articles/${a.slug}`} className="text-cyan-300 hover:text-fuchsia-300">{a.title}</Link>
                                            : a.title}
                                    </p>
                                    {a.editor_note && (
                                        <p className="retro-mono text-lg text-fuchsia-300 mt-2">
                                            Editor: {a.editor_note}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </div>
    );
}

export default SubmitArticle;
