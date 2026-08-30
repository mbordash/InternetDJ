import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';

/**
 * The article index.
 *
 * Most of what this lists is the recovered InternetDJ.com archive, roughly
 * 2001-2017 — news, features and the interviews the site ran with artists at
 * the time. Guides is the category the current site writes into.
 *
 * The category filter lives in the query string rather than component state so
 * that /articles?category=interviews is a real, linkable, indexable address.
 * A filter that only exists in memory gives search engines one page where there
 * should be five.
 */

const PAGE_SIZE = 24;

const formatDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const ArticleCard = ({ article }) => (
    <article className="retro-card retro-cut flex flex-col h-full overflow-hidden">
        {/* The band is always drawn, with a fallback behind the image rather
            than instead of it.

            Hiding the band when there is no artwork was the first attempt, and
            it looked broken: cards in a grid row stretch to the tallest one, so
            an imageless card became a full-height card with a hole above its
            text. Almost every legacy article hits this - their artwork still
            points at the old internetdj.com, which no longer serves it, so the
            image 404s and the band would vanish on most of the grid.

            So the fallback sits underneath and the image lies on top of it.
            When the image fails, onError hides only the <img>, the gradient
            shows through, and every card keeps the same shape. */}
        {/* The whole band is the link, fallback included: people click the
            picture, and a card where the artwork is inert while the headline
            beside it works reads as broken.

            tabIndex={-1} and aria-hidden keep it out of the keyboard order and
            off the accessibility tree, because the headline below is already a
            link to the same place - without that, every card would be two
            identical stops, the first of them unlabelled. */}
        <Link
            to={`/articles/${article.slug}`}
            tabIndex={-1}
            aria-hidden="true"
            className="relative block aspect-[16/9] overflow-hidden border-b border-cyan-400/25
                       bg-gradient-to-br from-[#1d0a38] via-[#140628] to-[#04010c] group"
        >
            <span
                className="absolute inset-0 flex items-center justify-center retro-display
                           text-xs tracking-widest text-fuchsia-400/40"
            >
                {article.category || 'InternetDJ'}
            </span>
            {article.hero_image_url && (
                <img
                    src={article.hero_image_url}
                    alt=""
                    loading="lazy"
                    className="relative w-full h-full object-cover transition-opacity
                               group-hover:opacity-80"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            )}
        </Link>
        <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-2">
            <span className="retro-eyebrow">{article.category || 'Article'}</span>
            {article.published_at && (
                <span className="retro-mono text-base text-gray-500">
                    {formatDate(article.published_at)}
                </span>
            )}
        </div>
        <h2 className="retro-display text-base retro-glow-cyan mb-2 leading-snug">
            <Link to={`/articles/${article.slug}`} className="hover:text-fuchsia-300">
                {article.title}
            </Link>
        </h2>
        {article.deck && (
            <p className="retro-mono text-xl text-gray-300 mb-3 flex-1">{article.deck}</p>
        )}
        {article.author_name && (
            <p className="retro-mono text-base text-cyan-300/70 mt-auto">
                by {article.author_name}
            </p>
        )}
        </div>
    </article>
);

function Articles() {
    const [searchParams, setSearchParams] = useSearchParams();
    const category = searchParams.get('category') || '';
    const query = searchParams.get('q') || '';

    const [articles, setArticles] = useState([]);
    const [categories, setCategories] = useState([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchDraft, setSearchDraft] = useState(query);

    useEffect(() => {
        axios.get(`${API_URL}/articles/categories`)
            .then(res => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    // Re-runs whenever the filter changes, and resets paging: appending page 2
    // of "news" onto page 1 of "interviews" would be nonsense.
    const load = useCallback(async (nextOffset, append) => {
        setLoading(true);
        setError(null);
        try {
            const res = await axios.get(`${API_URL}/articles`, {
                params: {
                    category: category || undefined,
                    q: query || undefined,
                    limit: PAGE_SIZE,
                    offset: nextOffset,
                },
            });
            const batch = res.data.articles || [];
            setArticles(prev => (append ? [...prev, ...batch] : batch));
            setTotal(res.data.total || 0);
            setOffset(nextOffset + batch.length);
        } catch (err) {
            setError('Could not load articles.');
        } finally {
            setLoading(false);
        }
    }, [category, query]);

    useEffect(() => {
        setSearchDraft(query);
        load(0, false);
    }, [load, query]);

    const setFilter = (next) => {
        const params = {};
        if (next.category) params.category = next.category;
        if (next.q) params.q = next.q;
        setSearchParams(params);
    };

    // Matches the crawler-rendered title in backend/middleware/ogMetaTags.js.
    // Neither names the site: injectOGMetaTags appends " | InternetDJ", so a
    // title carrying it already renders it twice.
    const title = category
        ? `${(categories.find(c => c.slug === category) || {}).name || category}: Electronic Music Articles`
        : 'Articles: Music News, Features, Interviews and Guides';
    const description = category === 'interviews'
        ? 'Interviews with DJs and electronic music producers from the InternetDJ archive, including Armin van Buuren, Pendulum, The Crystal Method and Faithless.'
        : 'News, features, interviews and production guides for electronic music producers, including the recovered InternetDJ archive going back to 2001.';

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>{title}</title>
                <meta name="description" content={description} />
                <link rel="canonical" href={`${SITE_URL}/articles${category ? `?category=${category}` : ''}`} />
                <meta property="og:title" content={title} />
                <meta property="og:description" content={description} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            <div className="container mx-auto px-4 py-10">
                <header className="mb-8">
                    <div className="retro-eyebrow mb-3">// The Archive //</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-5xl">Articles</h1>
                    <p className="retro-mono text-xl text-cyan-200 mt-3 max-w-3xl">
                        Music news, features, production guides, and the InternetDJ interview
                        archive, going back to 2001.
                    </p>
                    {/* The archive is the draw, but the section is not a museum:
                        the way in for someone who wants to write belongs at the
                        top of the page, not buried under 1,500 old articles. */}
                    <Link to="/articles/submit" className="retro-btn px-6 py-3 text-xs mt-5 inline-block">
                        Write for InternetDJ
                    </Link>
                    <div className="retro-rule mt-5" />
                </header>

                {/* ==================== FILTERS ==================== */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-8">
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setFilter({ q: query })}
                            className={`retro-btn px-4 py-2 text-xs ${!category ? 'retro-btn--hot' : ''}`}
                        >
                            All
                        </button>
                        {categories.map(c => (
                            <button
                                key={c.slug}
                                onClick={() => setFilter({ category: c.slug, q: query })}
                                className={`retro-btn px-4 py-2 text-xs ${category === c.slug ? 'retro-btn--hot' : ''}`}
                            >
                                {c.name} <span className="opacity-60">{c.total}</span>
                            </button>
                        ))}
                    </div>

                    {/* No gap between the field and its button, and the button
                        keeps its square edge: .retro-input sets border-right: 0
                        because it is drawn to sit flush against one. Same shape
                        as the navbar's search. */}
                    <form
                        className="flex items-stretch lg:ml-auto"
                        onSubmit={(e) => { e.preventDefault(); setFilter({ category, q: searchDraft.trim() }); }}
                    >
                        <label htmlFor="article-search" className="sr-only">Search articles</label>
                        <input
                            id="article-search"
                            type="text"
                            value={searchDraft}
                            onChange={(e) => setSearchDraft(e.target.value)}
                            placeholder="search articles..."
                            className="retro-input h-10 px-3 flex-1 w-full sm:w-72"
                        />
                        <button
                            type="submit"
                            className="retro-btn retro-btn--hot h-10 px-4 text-xs shrink-0"
                            style={{ clipPath: 'none' }}
                        >
                            Search
                        </button>
                    </form>
                </div>

                {query && (
                    <p className="retro-mono text-xl text-gray-300 mb-5">
                        &gt; {total} result{total === 1 ? '' : 's'} for &ldquo;{query}&rdquo;{' '}
                        <button onClick={() => setFilter({ category })} className="text-cyan-300 underline">clear</button>
                    </p>
                )}

                {error && <p className="retro-mono text-xl text-fuchsia-300 mb-6">{error}</p>}

                {!loading && articles.length === 0 && !error && (
                    <p className="retro-mono text-2xl text-gray-400">&gt; nothing here yet.</p>
                )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {articles.map(a => <ArticleCard key={a.id} article={a} />)}
                </div>

                {loading && (
                    <p className="retro-mono text-xl text-cyan-200 mt-8">&gt; digging through the crates&hellip;</p>
                )}

                {!loading && articles.length < total && (
                    <div className="mt-10 text-center">
                        <button
                            onClick={() => load(offset, true)}
                            className="retro-btn px-8 py-4 text-sm"
                        >
                            Load More ({articles.length} of {total})
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Articles;
