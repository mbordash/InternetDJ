import React, { useContext, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { articleCoverUrl, shareSafeImage, usableHeroImage } from '../utils/articleCover';

/**
 * The article reader.
 *
 * Article bodies are rendered with dangerouslySetInnerHTML, which is only
 * defensible because of where the HTML comes from: it is sanitised twice before
 * it is ever stored — an allowlist of tags in the scraper, then a second pass
 * in backend/scripts/importArticles.js that repeats the tag stripping and
 * removes event handlers and javascript:/data: URLs. Nothing user-submitted
 * reaches this table; there is no authoring endpoint. If one is ever added,
 * that sanitiser is the thing it has to run through.
 */

const formatDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

function Article() {
    const { slug } = useParams();
    const { user } = useContext(AuthContext);
    const [article, setArticle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setNotFound(false);
        setArticle(null);
        axios.get(`${API_URL}/articles/${encodeURIComponent(slug)}`)
            .then(res => { if (!cancelled) setArticle(res.data); })
            .catch(err => { if (!cancelled) setNotFound(err.response?.status === 404); })
            .finally(() => { if (!cancelled) setLoading(false); });
        // Arriving from the index leaves the reader scrolled to wherever the
        // card was; an article should open at its own headline.
        window.scrollTo(0, 0);
        return () => { cancelled = true; };
    }, [slug]);

    if (loading) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <p className="retro-mono text-2xl text-cyan-200">&gt; pulling the article&hellip;</p>
            </div>
        );
    }

    if (notFound || !article) {
        return (
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen flex items-center justify-center">
                <div className="retro-panel retro-cut px-8 py-10 text-center">
                    <div className="retro-eyebrow mb-3">// 404 //</div>
                    <p className="retro-mono text-2xl text-gray-300 mb-5">
                        &gt; That article isn&rsquo;t here.
                    </p>
                    <Link to="/articles" className="retro-btn retro-btn--hot px-6 py-3 text-xs">
                        Back to Articles
                    </Link>
                </div>
            </div>
        );
    }

    const url = `${SITE_URL}/articles/${article.slug}`;
    const description = article.deck || `${article.title}, on InternetDJ.`;
    const hero = usableHeroImage(article.hero_image_url);
    const cover = articleCoverUrl(article.category, article.slug);

    // og:image must be absolute: artwork committed to this repo is a
    // site-relative path, and a share card given "/images/..." resolves it
    // against the crawler's own host and fetches nothing.
    //
    // The cover stands in when there is no picture, but as its PNG twin, not
    // the SVG the page uses. Facebook, Slack, Discord and X all refuse an SVG
    // og:image and render a blank card instead.
    const shareable = shareSafeImage(hero) || cover.replace(/\.svg$/, '.png');
    const shareImage = /^https?:\/\//i.test(shareable)
        ? shareable
        : `${SITE_URL}${shareable}`;

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>{article.title}</title>
                <meta name="description" content={description} />
                <link rel="canonical" href={url} />
                <meta property="og:type" content="article" />
                <meta property="og:title" content={article.title} />
                <meta property="og:description" content={description} />
                <meta property="og:url" content={url} />
                <meta property="og:site_name" content="InternetDJ" />
                {shareImage && <meta property="og:image" content={shareImage} />}
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={article.title} />
                <meta name="twitter:description" content={description} />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            <div className="container mx-auto px-4 py-10 max-w-4xl">
                {/* Editing starts from the article itself, because that is where
                    a mistake is noticed. Rendering this on is_admin only decides
                    what is shown; the API re-reads the flag from the database on
                    every request, so hiding the link is convenience, not
                    security. */}
                {/* Truthy, not === 1: /auth/me serialises the TINYINT(1) column
                    as a JSON boolean, so a strict comparison against 1 never
                    matched and the panel never rendered for anyone. */}
                {Boolean(user?.is_admin) && (
                    <div className="retro-panel retro-cut px-4 py-3 mb-6 flex flex-wrap items-center gap-3">
                        <span className="retro-eyebrow">// Editor //</span>
                        <Link
                            to={`/articles/queue?id=${article.id}`}
                            className="retro-btn px-5 py-2 text-xs"
                        >
                            Edit This Article
                        </Link>
                        <span className="retro-mono text-lg text-gray-500">
                            {article.is_legacy ? 'from the archive' : 'written on site'}
                        </span>
                    </div>
                )}

                <nav className="retro-mono text-lg text-gray-400 mb-6" aria-label="Breadcrumb">
                    <Link to="/articles" className="text-cyan-300 hover:text-fuchsia-300">Articles</Link>
                    {article.category && (
                        <>
                            {' '}&rsaquo;{' '}
                            <Link
                                to={`/articles?category=${article.category_slug}`}
                                className="text-cyan-300 hover:text-fuchsia-300"
                            >
                                {article.category}
                            </Link>
                        </>
                    )}
                </nav>

                <header className="mb-8">
                    <h1 className="retro-display retro-chrome text-2xl sm:text-4xl leading-tight mb-4">
                        {article.title}
                    </h1>
                    {article.deck && (
                        <p className="retro-mono text-2xl text-cyan-200 mb-4">{article.deck}</p>
                    )}
                    <div className="retro-mono text-lg text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {article.author_name && (
                            <span>
                                by{' '}
                                {article.author_profile
                                    ? <Link to={`/profile/${article.author_profile}`} className="text-cyan-300">{article.author_name}</Link>
                                    : <span className="text-gray-200">{article.author_name}</span>}
                            </span>
                        )}
                        {article.published_at && <span>{formatDate(article.published_at)}</span>}
                    </div>
                    <div className="retro-rule mt-5" />
                </header>

                {/* One masthead shape whatever artwork exists, so the page does
                    not change proportions between an article that kept its
                    picture and one that did not.

                    The generated cover is always the ground. A real picture
                    sits on it at its own size: most of what came back from the
                    Wayback Machine is a 100px index thumbnail, and blowing one
                    up to the width of the text would be worse than showing no
                    photograph at all. A large picture fills the frame by the
                    same rule, with no special case. */}
                <div className="relative w-full aspect-[16/9] mb-8 overflow-hidden
                                border border-cyan-400/30 bg-[#04010c]">
                    <img
                        src={cover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                    {hero && (
                        <img
                            src={hero}
                            alt=""
                            className="absolute inset-0 m-auto w-auto h-auto max-w-full max-h-full
                                       shadow-[0_0_40px_rgba(4,1,12,0.85)]"
                            // A submitted picture can still rot. If one has, the
                            // cover underneath is simply what remains.
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    )}
                </div>

                <div
                    className="retro-article retro-mono text-xl text-gray-200 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: article.body_html || '' }}
                />

                {article.is_legacy && (
                    <aside className="retro-panel retro-cut p-5 mt-10">
                        <div className="retro-eyebrow mb-2">// From the Archive //</div>
                        <p className="retro-mono text-lg text-gray-400">
                            This article was originally published on InternetDJ.com and was restored
                            from the Internet Archive.{' '}
                            {article.source_url && (
                                <a
                                    href={article.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow"
                                    className="text-cyan-300 underline"
                                >
                                    View the archived original
                                </a>
                            )}
                        </p>
                    </aside>
                )}

                {article.related?.length > 0 && (
                    <section className="mt-12">
                        <div className="retro-eyebrow mb-3">// More {article.category} //</div>
                        <div className="retro-rule mb-5" />
                        <ul className="space-y-2">
                            {article.related.map(r => (
                                <li key={r.id}>
                                    <Link
                                        to={`/articles/${r.slug}`}
                                        className="retro-mono text-xl text-gray-300 hover:text-cyan-200 block py-1"
                                    >
                                        {r.title}
                                        {r.published_at && (
                                            <span className="text-base text-gray-500 ml-2">
                                                {formatDate(r.published_at)}
                                            </span>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className="retro-panel retro-cut p-6 mt-12">
                    <h2 className="retro-display text-lg retro-glow-magenta mb-3">Make music?</h2>
                    <p className="retro-mono text-xl text-gray-300 mb-5">
                        Publish your tracks on InternetDJ for free and get written feedback from
                        other producers.
                    </p>
                    <Link to="/promote" className="retro-btn retro-btn--hot px-6 py-3 text-sm">
                        Promote Your Music
                    </Link>
                </section>
            </div>
        </div>
    );
}

export default Article;
