import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

/* Where to send someone who landed on nothing. Ordered by how likely each one
   is to be what they were actually looking for, since a dead link into this
   site is usually a track that moved rather than a section that vanished. */
const DESTINATIONS = [
    { to: '/new', label: 'New tracks', note: 'The most recent uploads' },
    { to: '/browse', label: 'Browse', note: 'The full catalogue' },
    { to: '/discover', label: 'Discover', note: 'Picked out by genre and mood' },
    { to: '/articles', label: 'Articles', note: 'Writing about electronic music' },
    { to: '/forum', label: 'Forum', note: 'Ask the other producers' },
    { to: '/crates', label: 'Crates', note: 'Collections people have built' },
];

/*
 * Until this existed, an unmatched path fell through <Routes> and rendered
 * literally nothing: header, footer, and an empty middle. That blank body is
 * also what Googlebot rendered, which is half the reason these URLs were being
 * filed as soft 404s. The other half was the status code, fixed server side in
 * backend/middleware/notFound.js.
 *
 * noindex here is belt and braces. The 404 status is what actually keeps this
 * page out of the index, and it is already set by the time this renders, but a
 * status code is easy to regress silently and this tag is not.
 */
const NotFound = () => (
    <div className="max-w-4xl mx-auto px-4 py-16">
        <Helmet>
            <title>Page not found | InternetDJ</title>
            <meta name="robots" content="noindex" />
        </Helmet>

        <div className="retro-eyebrow mb-2">{'// 404 //'}</div>
        <h1 className="retro-display text-2xl sm:text-4xl retro-glow-magenta">
            Page not found
        </h1>
        <div className="retro-rule mt-4 mb-6" />

        <p className="text-gray-300 max-w-2xl leading-relaxed">
            Nothing lives at this address. The usual reason is a track that was
            taken down by the artist, or a link that picked up a stray character
            on its way here.
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DESTINATIONS.map(({ to, label, note }) => (
                <Link
                    key={to}
                    to={to}
                    className="retro-cut p-4 block hover:bg-white/5 transition-colors"
                >
                    <div className="retro-display text-sm text-cyan-200">{label}</div>
                    <div className="text-xs text-gray-400 mt-1">{note}</div>
                </Link>
            ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/" className="retro-btn retro-btn--hot">
                Back to the home page
            </Link>
            <Link to="/search" className="retro-btn">
                Search for it
            </Link>
        </div>
    </div>
);

export default NotFound;
