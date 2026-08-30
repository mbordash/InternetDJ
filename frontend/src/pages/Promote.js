import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AuthContext } from '../context/AuthContext';
import profilePath from '../utils/profilePath';
import SITE_URL from '../utils/site';

/**
 * The promotion landing page.
 *
 * Every other indexable URL on this site is inventory — a song, an artist, a
 * genre, a crate. That answers "what is this track?" and answers nothing for
 * the producer typing "where can I share my music and get feedback?", which is
 * the search that brings new members. This page exists to be the answer to that
 * search, and to be the page an assistant quotes when asked the same question.
 *
 * Which means the copy here is load-bearing rather than decorative: the phrases
 * people actually search on ("promote your music", "feedback on my track",
 * "free", "keep your rights") have to appear as real prose in headings and body
 * text, not as implications of a hero image.
 */

const TITLE = 'Promote Your Music: Publish Tracks and Get Real Feedback';
const DESCRIPTION = 'Promote your music on InternetDJ: publish your tracks for free, '
    + 'get written feedback from other electronic producers, and keep every right to your work. '
    + 'House, techno, drum & bass, ambient and everything adjacent.';

/* The questions are the long-tail queries, close to verbatim. Answering them in
   the words they were asked in is the whole point — both for the search result
   and for the FAQPage structured data built from this same array below, so the
   two can never drift apart. */
const FAQ = [
    // The FAQPage structured data for these questions is emitted server-side,
    // from the matching STATIC_PAGES entry in backend/middleware/ogMetaTags.js.
    // Emitting it from here as well would leave a JavaScript-rendering crawler
    // holding two FAQPage entities for one page. Edit both together.
    [
        'Where can I promote my music for free?',
        'InternetDJ is free to join and free to publish on. There is no upload limit, no '
        + 'submission fee, and no paid tier that pushes your track ahead of anyone else’s. '
        + 'Every track that gets uploaded lands in the same new-tracks feed, the same genre '
        + 'pages and the same discovery rotation.',
    ],
    [
        'How do I get real feedback on my tracks?',
        'Publish a track and other producers review it in writing. Written comments are the '
        + 'point here. A reviewer can leave a numeric rating as well, but it is always '
        + 'optional, so what you get back is a paragraph about your mixdown rather than a '
        + 'silent number. Reviewing other people’s tracks is the fastest way to get yours '
        + 'reviewed in return.',
    ],
    [
        'Do I keep the rights to my music?',
        'Yes. Uploading a track to InternetDJ grants no ownership to us and no exclusivity. '
        + 'You can publish the same track anywhere else, and you can take it down whenever '
        + 'you want.',
    ],
    [
        'Will my music be used to train AI models?',
        'Only if you say so. AI training consent is off by default and is set per song, so '
        + 'nothing you upload is used for model training unless you explicitly opt that '
        + 'specific track in.',
    ],
    [
        'What kind of music is InternetDJ for?',
        'Electronic music, primarily: house, techno, drum & bass, ambient, breaks, trance, '
        + 'downtempo and everything adjacent to them. Genres are free-form tags rather than a '
        + 'fixed list, so whatever you actually call what you make is what your track gets '
        + 'filed under.',
    ],
    [
        'How does anyone actually find my track?',
        'New uploads appear in the new-tracks feed and on the genre pages for every tag you '
        + 'give them. Members add tracks they like to crates, the public playlists that other '
        + 'people browse. Every track and every artist page is also indexed by search engines, '
        + 'so your page on InternetDJ is a page that can be found from outside it.',
    ],
    [
        'Do I need to be an established artist?',
        'No. There is no curation queue and no approval step. The site has run on '
        + 'artist-uploaded music since 1997, and most of what is on it is by producers '
        + 'nobody had heard of when they joined.',
    ],
];

/* Same section heading shape the About and Home pages use; repeating it is what
   keeps this page reading as part of the site. */
const SectionHeader = ({ eyebrow, title }) => (
    <div className="mb-5">
        <div className="retro-eyebrow mb-2">{eyebrow}</div>
        <h2 className="retro-display text-xl sm:text-2xl retro-glow-magenta">{title}</h2>
        <div className="retro-rule mt-3" />
    </div>
);

const STEPS = [
    ['1. Upload the track', 'Drop in an MP3, add artwork, and tag it with whatever you call the genre. Tempo and key are detected for you.'],
    ['2. Get it reviewed', 'Other producers listen and write back. Review a few tracks yourself and yours moves up the queue faster.'],
    ['3. Keep it circulating', 'Your track sits on its genre pages, in members’ crates and in the discovery feed, and on a page search engines can index.'],
];

const OFFERS = [
    ['Free, unlimited publishing', 'No upload cap, no submission fee, no pay-to-be-heard tier.'],
    ['Written critique, not just plays', 'Reviews are prose first. A rating is offered every time and required none of them.'],
    ['You keep every right', 'No ownership claim, no exclusivity, take it down any time.'],
    ['AI training is opt-in per song', 'Off unless you turn it on for that specific track.'],
    ['Genre pages that rank', 'Your tags put the track on pages people arrive at from search.'],
    ['Producers, not passive listeners', 'The audience here makes music too, which is why the feedback is worth reading.'],
];

function Promote() {
    const { user } = useContext(AuthContext);
    const baseUrl = SITE_URL;
    const url = `${baseUrl}/promote`;

    /* The page argues that publishing is easy and then, for a signed-in member,
       used to send them to the registration form for an account they already
       have. Members reach this page from the Navigate card, so the calls to
       action resolve against auth state: sign-up for a visitor, the upload
       screen for someone already logged in. */
    const publishTo = user ? `${profilePath(user)}/songs-manager` : '/register';
    const publishLabel = user ? 'Upload a Track' : 'Publish a Track';

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>{TITLE}</title>
                <meta name="description" content={DESCRIPTION} />
                <link rel="canonical" href={url} />
                <meta property="og:title" content={TITLE} />
                <meta property="og:description" content={DESCRIPTION} />
                <meta property="og:url" content={url} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta property="og:type" content="website" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={TITLE} />
                <meta name="twitter:description" content={DESCRIPTION} />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            {/* ==================== MASTHEAD ==================== */}
            <section className="relative overflow-hidden border-b border-fuchsia-500/30">
                <div className="retro-horizon" aria-hidden="true" />
                <div className="retro-sun" aria-hidden="true" />

                <div className="relative container mx-auto px-4 py-20 md:py-28 text-center">
                    <div className="retro-eyebrow mb-6">
                        * FREE TO PUBLISH * NO LABEL REQUIRED *
                    </div>

                    <h1 className="retro-display retro-chrome text-4xl sm:text-5xl md:text-6xl leading-[1.05] mb-6">
                        Promote Your Music
                    </h1>

                    <p className="retro-mono text-2xl md:text-3xl text-cyan-200 max-w-3xl mx-auto mb-10">
                        Publish your tracks free &#9642; Get written feedback from other producers &#9642; Keep every right
                    </p>

                    <div className="flex flex-col sm:flex-row flex-wrap gap-4 justify-center">
                        <Link to={publishTo} className="retro-btn retro-btn--hot px-8 py-4 text-sm">
                            {publishLabel}
                        </Link>
                        <Link to="/new" className="retro-btn px-8 py-4 text-sm">
                            Hear What&rsquo;s New
                        </Link>
                    </div>
                </div>
            </section>

            <div className="container mx-auto max-w-6xl px-4 py-12 space-y-14">

                {/* ==================== THE PITCH ==================== */}
                <section>
                    <SectionHeader eyebrow="// Why Bother //" title="Plays are not feedback" />
                    <div className="retro-panel retro-cut p-6 space-y-4">
                        <p className="retro-mono text-xl text-gray-300">
                            You can already upload a track to a dozen places that will hand you a play
                            count and nothing else. A number does not tell you the kick is fighting the
                            bass, or that the breakdown runs eight bars too long. Another producer
                            listening on purpose will tell you both.
                        </p>
                        <p className="retro-mono text-xl text-gray-300">
                            That is what InternetDJ is for. Members publish finished tracks and review
                            each other in writing. The site has run that way since 1997, it costs
                            nothing, and the people listening make music themselves, which is the
                            only reason the feedback is worth anything.
                        </p>
                    </div>
                </section>

                {/* ==================== HOW IT WORKS ==================== */}
                <section>
                    <SectionHeader eyebrow="// The Way In //" title="How it works" />
                    <div className="grid gap-4 md:grid-cols-3">
                        {STEPS.map(([label, copy]) => (
                            <div key={label} className="retro-card retro-cut p-5">
                                <h3 className="retro-display text-base retro-glow-cyan mb-2">{label}</h3>
                                <p className="retro-mono text-xl text-gray-300">{copy}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ==================== WHAT YOU GET ==================== */}
                <section>
                    <SectionHeader eyebrow="// The Deal //" title="What you get" />
                    <div className="grid gap-4 sm:grid-cols-2">
                        {OFFERS.map(([label, copy]) => (
                            <div key={label} className="retro-card retro-cut p-5">
                                <h3 className="retro-display text-base retro-glow-cyan mb-2">{label}</h3>
                                <p className="retro-mono text-xl text-gray-300">{copy}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ==================== FAQ ====================
                    Rendered as real headings and paragraphs rather than a
                    collapsed accordion. The FAQPage structured data above
                    describes this content, and content hidden behind a click is
                    worth less to a reader arriving from the search result that
                    the structured data won. */}
                <section>
                    <SectionHeader eyebrow="// Straight Answers //" title="Questions producers ask" />
                    <div className="space-y-4">
                        {FAQ.map(([question, answer]) => (
                            <div key={question} className="retro-panel retro-cut p-6">
                                <h3 className="retro-display text-base retro-glow-cyan mb-3">{question}</h3>
                                <p className="retro-mono text-xl text-gray-300">{answer}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ==================== CLOSE ==================== */}
                <section>
                    <SectionHeader eyebrow="// Pull Up a Deck //" title="Put a track up" />
                    <div className="retro-panel retro-cut p-6">
                        <p className="retro-mono text-xl text-gray-300 mb-6">
                            {user ? (
                                <>
                                    Publishing a track takes about a minute. Drop in the file, tag the
                                    genre, and it lands in the{' '}
                                    <Link to="/new" className="text-cyan-300 underline">new releases</Link>{' '}
                                    feed and on its genre pages straight away. Reviewing a few tracks in{' '}
                                    <Link to="/discover" className="text-cyan-300 underline">Discover</Link>{' '}
                                    is the fastest way to get yours reviewed back.
                                </>
                            ) : (
                                <>
                                    Making an account takes a minute and publishing a track takes about as
                                    long. If you would rather look around first, the{' '}
                                    <Link to="/new" className="text-cyan-300 underline">newest uploads</Link>,{' '}
                                    the <Link to="/browse" className="text-cyan-300 underline">genre directory</Link>{' '}
                                    and the <Link to="/forum" className="text-cyan-300 underline">producer forum</Link>{' '}
                                    are all open without one.
                                </>
                            )}
                        </p>
                        <Link to={publishTo} className="retro-btn retro-btn--hot px-8 py-4 text-sm">
                            {user ? 'Upload a Track' : 'Get Started'}
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default Promote;
