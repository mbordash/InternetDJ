/**
 * Server-rendered share cards and structured data.
 *
 * The frontend is a client-rendered SPA, so the HTML a crawler receives is an
 * empty <div id="root">. Social crawlers do not run JavaScript at all, which
 * means react-helmet-async can never reach them: without this middleware a
 * track shared to Discord or Bluesky renders as a bare URL with no artwork and
 * no title. Here we detect the crawler, look the entity up, and inject real
 * tags into the shell before it goes out.
 *
 * Two audiences, two formats:
 *   Open Graph / Twitter cards  -> chat apps and social networks
 *   JSON-LD                     -> search engines, for rich results
 *
 * Both are emitted for every entity type, because the same URL gets shared into
 * both kinds of place.
 */

const logger = require('../utils/logger');
const pool = require('../config/database');
const { normalizeGenre, expandGenreString } = require('../utils/genres');

const FALLBACK_IMAGE = '/idj-coin-200-nobg.png';
const { articleCoverPath, usableHeroImage, shareSafeImage } = require('../utils/articleCover');

/**
 * The share image for an article. Its own artwork if that artwork still exists,
 * otherwise the generated cover for its category.
 *
 * This matters more than the on-page fallback does. 957 archive articles carry
 * a hero_image_url on www.internetdj.com, a domain that stopped resolving years
 * ago, so until now every one of them advertised an og:image that 404s - which
 * is worse than advertising none, because a scraper that cannot fetch the image
 * it was promised renders the card without a picture at all.
 *
 * Always the PNG, never the SVG: Facebook, Slack, Discord and X all refuse an
 * SVG og:image.
 */
const articleShareImage = (article) => (
    shareSafeImage(usableHeroImage(article.hero_image_url))
    || articleCoverPath(article.category_slug || article.category, article.slug, 'png')
);

// Social networks, chat apps and classic search engines. These mostly want a
// share card, and the ones that matter for ranking (Googlebot, Bingbot) run
// JavaScript, so the injected <head> is all they need from us.
const SHARE_CRAWLER_AGENTS = [
    'facebookexternalhit',
    'meta-externalagent',
    'meta-externalfetcher',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegram',
    'discordbot',
    'pinterest',
    'slackbot',
    'slurp',
    'googlebot',
    'bingbot',
    'yandex',
    'baiduspider',
    'ia_archiver',
    'embedly',
    'redditbot',
    'mastodon',
    'bluesky',
    'applebot',
    'duckduckbot',
    'curl',
    'wget',
    'python-requests',
];

/**
 * Assistant and answer-engine crawlers.
 *
 * These are the agents behind "where can I share my house track for feedback?"
 * in ChatGPT, Claude, Perplexity and friends. Unlike Googlebot, almost none of
 * them execute JavaScript: they fetch the HTML once and read what is in it. So
 * until they were listed here they received index.html untouched — a generic
 * title and an empty <div id="root"> — and InternetDJ had literally no readable
 * content for an assistant to cite. Listing them here is only half the fix; the
 * other half is the crawler body rendered into #root further down.
 *
 * Names are matched as substrings of a lowercased UA, so 'claudebot' also
 * covers the versioned 'ClaudeBot/1.0' form.
 */
const AI_CRAWLER_AGENTS = [
    // OpenAI: training crawler, search index, and the live fetch ChatGPT makes
    // when a user pastes a link.
    'gptbot',
    'oai-searchbot',
    'chatgpt-user',
    // Anthropic.
    'claudebot',
    'claude-web',
    'claude-user',
    'claude-searchbot',
    'anthropic-ai',
    // Perplexity: index crawler and the per-question live fetch.
    'perplexitybot',
    'perplexity-user',
    // Others that feed assistant answers or training corpora. CCBot is Common
    // Crawl, which is an input to a large number of models rather than a
    // product of its own.
    'ccbot',
    'amazonbot',
    'bytespider',
    'youbot',
    'diffbot',
    'cohere-ai',
    'mistralai-user',
    'timpibot',
];

const CRAWLER_AGENTS = [...SHARE_CRAWLER_AGENTS, ...AI_CRAWLER_AGENTS];

const isCrawler = (userAgent) => {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    return CRAWLER_AGENTS.some(agent => ua.includes(agent));
};

/**
 * Hand-written pages worth their own card.
 *
 * Everything above answers a database lookup, but a few routes are features
 * rather than entities: there is no row behind /loops, and without an entry
 * here a crawler gets index.html's generic "InternetDJ" title for a page that
 * people search for by name. The copy mirrors the <Helmet> block on the page
 * itself so the JS-rendered and crawler-rendered versions agree.
 *
 * Keyed by path so adding the next one is a single entry.
 */
/**
 * The questions on /promote, and their answers.
 *
 * Mirrors the FAQ array in frontend/src/pages/Promote.js: that one renders the
 * visible page, this one is the only place the FAQPage structured data is
 * emitted from. Splitting it that way is deliberate — emitting the same
 * structured data from the page's <Helmet> as well would leave a crawler that
 * runs JavaScript holding two FAQPage entities for a single URL. Edit the two
 * lists together.
 */
const PROMOTE_FAQ = [
    ['Where can I promote my music for free?',
        'InternetDJ is free to join and free to publish on. There is no upload limit, no '
        + 'submission fee, and no paid tier that pushes your track ahead of anyone else\u2019s. '
        + 'Every track that gets uploaded lands in the same new-tracks feed, the same genre '
        + 'pages and the same discovery rotation.'],
    ['How do I get real feedback on my tracks?',
        'Publish a track and other producers review it in writing. Written comments are the '
        + 'point here \u2014 a reviewer can leave a numeric rating as well, but it is always '
        + 'optional, so what you get back is a paragraph about your mixdown rather than a '
        + 'silent number. Reviewing other people\u2019s tracks is the fastest way to get yours '
        + 'reviewed in return.'],
    ['Do I keep the rights to my music?',
        'Yes. Uploading a track to InternetDJ grants no ownership to us and no exclusivity. '
        + 'You can publish the same track anywhere else, and you can take it down whenever '
        + 'you want.'],
    ['Will my music be used to train AI models?',
        'Only if you say so. AI training consent is off by default and is set per song, so '
        + 'nothing you upload is used for model training unless you explicitly opt that '
        + 'specific track in.'],
    ['What kind of music is InternetDJ for?',
        'Electronic music, primarily \u2014 house, techno, drum & bass, ambient, breaks, trance, '
        + 'downtempo and everything adjacent to them. Genres are free-form tags rather than a '
        + 'fixed list, so whatever you actually call what you make is what your track gets '
        + 'filed under.'],
    ['How does anyone actually find my track?',
        'New uploads appear in the new-tracks feed and on the genre pages for every tag you '
        + 'give them. Members add tracks they like to crates \u2014 public playlists that other '
        + 'people browse. Every track and every artist page is also indexed by search engines, '
        + 'so your page on InternetDJ is a page that can be found from outside it.'],
    ['Do I need to be an established artist?',
        'No. There is no curation queue and no approval step. The site has run on '
        + 'artist-uploaded music since 1997, and most of what is on it is by producers '
        + 'nobody had heard of when they joined.'],
];

const STATIC_PAGES = {
    // The home page. It had no entry here at all, which meant the single most
    // important URL on the site was the one URL a non-JavaScript crawler learned
    // nothing from: extractMetadata returned null for '/', so the generic shell
    // went out untouched. This is also where the sitewide Organization and
    // WebSite entities are declared — the pair that search engines and
    // assistants read to decide what this domain *is*, as opposed to what any
    // one page on it says.
    '/': {
        title: 'Publish Your Music and Get Real Feedback',
        description: 'InternetDJ is a community for electronic music producers. Publish your tracks '
            + 'for free, get written feedback from other producers, dig through crates and find '
            + 'collaborators. House, techno, drum & bass, ambient and everything in between.',
        image: FALLBACK_IMAGE,
        url: '/',
        type: 'website',
        body: {
            heading: 'InternetDJ: a community for electronic music producers',
            paragraphs: [
                'InternetDJ is a community site where independent electronic music producers publish '
                + 'their finished tracks for free and get written feedback from other producers. It '
                + 'has been online since 1997.',
                'Publishing is free and unlimited, artists keep every right to their work, and music '
                + 'is only ever used for AI model training when the artist has opted that specific '
                + 'song in. The site also runs a producer forum, collaboration matching, a '
                + 'browser-based multitrack editor, and a free AI loop generator that writes new '
                + 'royalty-free loops from a text prompt.',
            ],
            facts: [
                { label: 'What it is', value: 'A place to publish electronic music and get written critique from other producers.' },
                { label: 'Online since', value: '1997' },
                { label: 'Cost', value: 'Free to join and free to publish.' },
                { label: 'Focus', value: 'House, techno, drum & bass, ambient, breaks, trance, downtempo.' },
            ],
            sections: [
                {
                    heading: 'Start here',
                    items: [
                        { text: 'Promote your music: publish tracks and get feedback', href: '/promote' },
                        { text: 'The newest uploads from members', href: '/new' },
                        { text: 'Browse music by genre', href: '/browse' },
                        { text: 'Discover tracks', href: '/discover' },
                        { text: 'Crates: playlists put together by members', href: '/crates' },
                        { text: 'The producer forum', href: '/forum' },
                        { text: 'Find a collaborator', href: '/collabs' },
                        { text: 'Free AI loop generator', href: '/loops' },
                        { text: 'About InternetDJ', href: '/about' },
                    ],
                },
            ],
        },
        jsonLd: (base) => ({
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'Organization',
                    '@id': `${base}/#organization`,
                    name: 'InternetDJ',
                    url: base,
                    logo: `${base}${FALLBACK_IMAGE}`,
                    foundingDate: '1997',
                    description: 'A community for independent electronic music producers to publish '
                        + 'their tracks and get written feedback from other producers.',
                    sameAs: ['https://twitter.com/internetdjco'],
                },
                {
                    '@type': 'WebSite',
                    '@id': `${base}/#website`,
                    name: 'InternetDJ',
                    url: base,
                    publisher: { '@id': `${base}/#organization` },
                    // Declares the site's own search so a result can carry a
                    // search box straight into the catalogue. /search is
                    // disallowed to crawlers as an infinite URL space, which is
                    // about crawling and does not conflict with pointing a user
                    // at it.
                    potentialAction: {
                        '@type': 'SearchAction',
                        target: {
                            '@type': 'EntryPoint',
                            urlTemplate: `${base}/search?q={search_term_string}`,
                        },
                        'query-input': 'required name=search_term_string',
                    },
                },
            ],
        }),
    },

    // The article index. Its own page rather than a bare listing because the
    // archive is a genuine draw: two decades of electronic music journalism,
    // including interviews an assistant may well be asked about by name.
    '/articles': {
        title: 'Articles \u2014 Music News, Features, Interviews and Guides',
        description: 'News, features, interviews and production guides for electronic music '
            + 'producers, including the recovered InternetDJ archive going back to 2001.',
        image: FALLBACK_IMAGE,
        url: '/articles',
        type: 'website',
        body: {
            heading: 'InternetDJ articles',
            paragraphs: [
                'Music news, features, production guides and interviews for electronic music '
                + 'producers. Alongside current writing, this section holds the restored '
                + 'InternetDJ.com editorial archive, published between 2001 and 2017 and '
                + 'recovered from the Internet Archive.',
                'The archive includes original InternetDJ interviews with Armin van Buuren, '
                + 'Pendulum, The Crystal Method, Faithless, Swedish House Mafia, Mauro Picotto '
                + 'and Paul Oakenfold, alongside years of news coverage of the electronic music '
                + 'scene.',
            ],
            sections: [
                {
                    heading: 'Browse by category',
                    items: [
                        { text: 'News', href: '/articles?category=news' },
                        { text: 'Interviews', href: '/articles?category=interviews' },
                        { text: 'Features', href: '/articles?category=features' },
                        { text: 'Reviews', href: '/articles?category=reviews' },
                        { text: 'Guides', href: '/articles?category=guides' },
                    ],
                },
                {
                    heading: 'Elsewhere on InternetDJ',
                    items: [{ text: 'Publish your music and get feedback', href: '/promote' }],
                },
            ],
        },
        jsonLd: (base) => ({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'InternetDJ Articles',
            url: `${base}/articles`,
            description: 'Music news, features, interviews and production guides for electronic '
                + 'music producers.',
            isPartOf: { '@type': 'WebSite', name: 'InternetDJ', url: base },
        }),
    },

    // The page built to be the answer to "where can I promote my music?". It is
    // the one static page an assistant is most likely to be asked to summarise,
    // so it carries the fullest crawler body on the site.
    '/promote': {
        title: 'Promote Your Music \u2014 Publish Tracks and Get Real Feedback',
        description: 'Promote your music on InternetDJ: publish your tracks for free, get written '
            + 'feedback from other electronic producers, and keep every right to your work. '
            + 'House, techno, drum & bass, ambient and everything adjacent.',
        image: FALLBACK_IMAGE,
        url: '/promote',
        type: 'website',
        body: {
            heading: 'Promote your music on InternetDJ',
            paragraphs: [
                'InternetDJ is a community site where independent electronic music producers '
                + 'publish their finished tracks for free and get written feedback from other '
                + 'producers. It has been running on artist-uploaded music since 1997.',
                'You can already upload a track to a dozen places that hand you a play count and '
                + 'nothing else. A number does not tell you the kick is fighting the bass, or that '
                + 'the breakdown runs eight bars too long. Another producer listening on purpose '
                + 'will tell you both. That is what this site is for.',
            ],
            facts: [
                { label: 'Cost', value: 'Free. No upload limit, no submission fee, no paid priority tier.' },
                { label: 'Feedback', value: 'Written reviews from other producers; a numeric rating is optional on every one.' },
                { label: 'Rights', value: 'You keep everything. No ownership claim, no exclusivity, remove it any time.' },
                { label: 'AI training', value: 'Off by default, opted in per song by the artist.' },
                { label: 'Genres', value: 'Electronic music: house, techno, drum & bass, ambient, breaks, trance, downtempo.' },
            ],
            sections: [
                {
                    heading: 'How it works',
                    items: [
                        { text: 'Upload an MP3, add artwork, and tag it with whatever you call the genre. Tempo and key are detected for you.' },
                        { text: 'Other producers listen and write back. Reviewing other tracks yourself is the fastest way to get yours reviewed.' },
                        { text: 'Your track stays on its genre pages, in members\u2019 crates and in the discovery feed, on a page search engines index.' },
                    ],
                },
                {
                    heading: 'Questions producers ask',
                    items: PROMOTE_FAQ.map(([question, answer]) => ({ text: `${question} ${answer}` })),
                },
                {
                    heading: 'Where to start',
                    items: [
                        { text: 'Create an account and publish a track', href: '/register' },
                        { text: 'The newest uploads', href: '/new' },
                        { text: 'Browse every genre', href: '/browse' },
                        { text: 'The producer forum', href: '/forum' },
                    ],
                },
            ],
        },
        jsonLd: (base) => ({
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'WebPage',
                    name: 'Promote Your Music on InternetDJ',
                    url: `${base}/promote`,
                    description: 'How independent electronic music producers publish tracks and get '
                        + 'written feedback on InternetDJ.',
                    isPartOf: { '@type': 'WebSite', name: 'InternetDJ', url: base },
                },
                {
                    '@type': 'FAQPage',
                    mainEntity: PROMOTE_FAQ.map(([question, answer]) => ({
                        '@type': 'Question',
                        name: question,
                        acceptedAnswer: { '@type': 'Answer', text: answer },
                    })),
                },
            ],
        }),
    },

    '/loops': {
        title: 'AI Music Loop Generator',
        description: 'Use our free AI music loop generator to create royalty-free AI bass loops, synth loops, effects and drum loops. Perfect for music producers importing into DAWs like Ableton or Logic Pro.',
        image: FALLBACK_IMAGE,
        url: '/loops',
        type: 'website',
        body: {
            heading: 'Free AI music loop generator',
            paragraphs: [
                'Generate brand-new, royalty-free bass, synth, effects and drum loops from a text '
                + 'prompt at a chosen BPM and key, then download them and drop them into any DAW: '
                + 'Ableton Live, Logic Pro, FL Studio, Bitwig or anything else.',
                'The generator writes original audio to your prompt. It is not a stem separation '
                + 'tool: it does not take an existing song apart, and nothing it produces is '
                + 'extracted from someone else\u2019s recording.',
            ],
            facts: [
                { label: 'Cost', value: 'Free' },
                { label: 'Licence', value: 'Royalty-free. Use the loops in your own tracks.' },
                { label: 'Controls', value: 'Text prompt, tempo in BPM, and musical key.' },
                { label: 'Output', value: 'Downloadable audio loops for any DAW.' },
            ],
            sections: [
                {
                    heading: 'Elsewhere on InternetDJ',
                    items: [
                        { text: 'Publish a finished track and get feedback', href: '/promote' },
                        { text: 'Browse music by genre', href: '/browse' },
                    ],
                },
            ],
        },
        jsonLd: (base) => ({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: 'AI Music Loop Generator',
            url: `${base}/loops`,
            // The generator writes new audio to a prompt; it does not pull
            // parts out of an existing track, and the description should not
            // let a search engine imply that it does.
            description: 'Generate brand-new, royalty-free bass, synth, effects and drum loops from a text prompt at a chosen BPM and key, then download them for any DAW.',
            applicationCategory: 'MultimediaApplication',
            operatingSystem: 'Web browser',
            isPartOf: { '@type': 'WebSite', name: 'InternetDJ', url: base },
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        }),
    },
};

// Trailing slashes and casing are the crawler's choice, not ours, so /Loops/
// and /loops have to reach the same entry.
const staticPageKey = (urlPath) => {
    const trimmed = String(urlPath || '').toLowerCase().replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
};

const fetchStaticPageMetadata = async (pathKey) => STATIC_PAGES[pathKey] || null;

/**
 * Which entity, if any, a path refers to.
 *
 * Profiles are the fiddly one: /profile/18 and /profile/dj-subspace are both
 * valid, so the id captured here can be numeric or a slug, and the fetcher
 * decides which column to look in. Matching only \d+ — as this did before —
 * meant every shared vanity URL fell through to the generic site card.
 */
// The article categories, mirroring the allowlist in routes/articles.js. Used
// to decide whether a ?category= value names a real section or is noise.
const ARTICLE_CATEGORIES = {
    news: 'News',
    interviews: 'Interviews',
    features: 'Features',
    reviews: 'Reviews',
    guides: 'Guides',
};

const extractMetadata = (urlPath, query = {}) => {
    // Checked first: a hand-written page is an exact-match map lookup, and
    // none of the entity patterns below can claim one of those paths anyway.
    const staticKey = staticPageKey(urlPath);

    // ...except /articles, which is one path serving six different pages. The
    // category lives in the query string, and this used to be handed only
    // req.path - so every category URL resolved to the same entry and served
    // byte-identical content. The sitemap lists those URLs, which made it five
    // advertised addresses for one document. Anything not in the allowlist
    // falls through to the plain index rather than inventing a section.
    if (staticKey === '/articles') {
        const category = String(query.category || '').toLowerCase();
        if (ARTICLE_CATEGORIES[category]) return { type: 'articleCategory', id: category };
    }

    if (STATIC_PAGES[staticKey]) return { type: 'staticPage', id: staticKey };

    const songMatch = urlPath.match(/^\/song\/(\d+)\/?$/);
    if (songMatch) return { type: 'song', id: songMatch[1] };

    // Anchored and single-segment so the owner-only /profile/:id/songs-manager
    // and /profile/:id/collaborations views do not claim the artist card.
    const profileMatch = urlPath.match(/^\/profile\/([^/]+)\/?$/);
    if (profileMatch) return { type: 'profile', id: decodeURIComponent(profileMatch[1]) };

    const crateMatch = urlPath.match(/^\/crate\/(\d+)\/?$/);
    if (crateMatch) return { type: 'crate', id: crateMatch[1] };

    const postMatch = urlPath.match(/^\/forum\/post\/(\d+)\/?$/);
    if (postMatch) return { type: 'forumPost', id: postMatch[1] };

    const tagMatch = urlPath.match(/^\/tag\/([^/]+)\/?$/);
    if (tagMatch) return { type: 'tag', id: decodeURIComponent(tagMatch[1]) };

    // /articles/submit and /articles/queue are tools, not articles. Without
    // this guard a crawler asking for either gets a database lookup for an
    // article slugged "submit", and the generic site card when it finds none.
    const ARTICLE_TOOL_PATHS = new Set(['submit', 'queue']);
    const articleMatch = urlPath.match(/^\/articles\/([^/]+)\/?$/);
    if (articleMatch && !ARTICLE_TOOL_PATHS.has(articleMatch[1].toLowerCase())) {
        return { type: 'article', id: decodeURIComponent(articleMatch[1]) };
    }

    return null;
};

// Descriptions come from user-authored fields that may contain HTML, and a
// share card wants one line of plain text, not markup or a wall of prose.
const toPlainText = (value, maxLength = 200) => {
    if (!value) return '';
    const text = String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
};

// Track length is stored as float seconds; a crawler body should read the way a
// tracklist does.
const formatDuration = (seconds) => {
    const total = Math.round(Number(seconds));
    if (!Number.isFinite(total) || total <= 0) return null;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Where a member's public page lives, preferring the slug so the pretty address
 * is the one that gets shared and indexed. Mirrors the frontend's profilePath().
 *
 * Returns null when there is no profile behind the row at all: a post whose
 * author has no profile has no author page, and inventing a link to one would
 * be worse than leaving it out.
 */
const profilePathFor = (slug, id) =>
    slug ? `/profile/${slug}` : (id ? `/profile/${id}` : null);

const fetchSongMetadata = async (songId) => {
    try {
        const songs = await pool.query(`
            SELECT s.id, s.title, s.description, s.image_url, s.mp3_url, s.genre,
                   s.created_at, s.plays, s.bpm, s.musical_key, s.duration,
                   p.id AS profile_id, p.name AS profile_name, p.slug AS profile_slug
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.id = ?
            LIMIT 1
        `, [songId]);

        if (!songs || songs.length === 0) {
            logger.debug(`OG: no song found for id ${songId}`);
            return null;
        }

        const song = songs[0];
        const artist = song.profile_name || 'InternetDJ';
        const title = song.title || 'Untitled';
        const genres = song.genre ? expandGenreString(song.genre).map(g => g.raw) : [];
        const profilePath = profilePathFor(song.profile_slug, song.profile_id);

        // The written feedback is the thing InternetDJ has that a file host
        // does not, so it belongs in the crawler body: an assistant asked where
        // a producer can get their track critiqued should be able to see that
        // critique actually happens here. Ratings are optional on this site, so
        // a review row with prose and no number is normal and still wanted.
        const reviews = await pool.query(`
            SELECT r.rating, r.review, p.name AS reviewer
            FROM reviews r
            LEFT JOIN profiles p ON p.user_id = r.user_id
            WHERE r.song_id = ?
            ORDER BY r.created_at DESC
            LIMIT 5
        `, [songId]);

        const written = reviews.filter(r => toPlainText(r.review));
        const rated = reviews.filter(r => r.rating !== null && r.rating !== undefined);
        const averageRating = rated.length
            ? rated.reduce((sum, r) => sum + Number(r.rating), 0) / rated.length
            : null;

        return {
            title: `${title} by ${artist}`,
            description: toPlainText(song.description)
                || `Listen to ${title} by ${artist} on InternetDJ${genres.length ? `: ${genres.slice(0, 3).join(', ')}` : ''}.`,
            image: song.image_url || FALLBACK_IMAGE,
            url: `/song/${song.id}`,
            type: 'music.song',
            audio: song.mp3_url || null,
            // music:musician wants a profile URL, and Facebook resolves it, so
            // a shared track links back to the artist page as well.
            musician: profilePath,
            body: {
                heading: `${title} by ${artist}`,
                paragraphs: [
                    toPlainText(song.description, 600) || null,
                    `${title} is a track by ${artist}${genres.length ? ` filed under ${genres.join(', ')}` : ''}, `
                        + 'published on InternetDJ, a community where electronic music producers upload their '
                        + 'tracks and get written feedback from other producers.',
                ],
                facts: [
                    { label: 'Artist', value: artist },
                    { label: 'Genre', value: genres.join(', ') },
                    { label: 'Tempo', value: song.bpm ? `${Math.round(Number(song.bpm))} BPM` : null },
                    { label: 'Key', value: song.musical_key || null },
                    { label: 'Length', value: formatDuration(song.duration) },
                    { label: 'Plays', value: song.plays ? String(Number(song.plays)) : null },
                    {
                        label: 'Rating',
                        value: averageRating ? `${averageRating.toFixed(1)} out of 10 from ${rated.length} producer${rated.length === 1 ? '' : 's'}` : null,
                    },
                ],
                sections: [
                    {
                        heading: `Producer feedback on ${title}`,
                        items: written.map(r => ({
                            text: `${r.reviewer || 'An InternetDJ member'}: ${toPlainText(r.review, 300)}`,
                        })),
                    },
                    {
                        heading: 'Elsewhere on InternetDJ',
                        items: [
                            profilePath ? { text: `More tracks by ${artist}`, href: profilePath } : null,
                            ...genres.slice(0, 3).map(g => ({
                                text: `Browse ${g} tracks`,
                                href: `/tag/${encodeURIComponent(normalizeGenre(g) || g)}`,
                            })),
                            { text: 'Upload your own track and get feedback', href: '/promote' },
                        ].filter(Boolean),
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'MusicRecording',
                name: title,
                url: `${base}/song/${song.id}`,
                image: absolute(song.image_url, base),
                description: toPlainText(song.description) || undefined,
                genre: genres.length ? genres : undefined,
                datePublished: song.created_at ? new Date(song.created_at).toISOString().slice(0, 10) : undefined,
                interactionStatistic: song.plays ? {
                    '@type': 'InteractionCounter',
                    interactionType: 'https://schema.org/ListenAction',
                    userInteractionCount: Number(song.plays),
                } : undefined,
                aggregateRating: averageRating ? {
                    '@type': 'AggregateRating',
                    ratingValue: Number(averageRating.toFixed(1)),
                    ratingCount: rated.length,
                    bestRating: 10,
                    worstRating: 0.5,
                } : undefined,
                byArtist: {
                    '@type': 'MusicGroup',
                    name: artist,
                    url: profilePath ? `${base}${profilePath}` : undefined,
                },
                audio: song.mp3_url ? {
                    '@type': 'AudioObject',
                    contentUrl: absolute(song.mp3_url, base),
                } : undefined,
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching song metadata:', err);
        return null;
    }
};

const fetchProfileMetadata = async (profileRef) => {
    try {
        // id is INT and slug is VARCHAR; letting one query handle both would
        // make the database cast a slug to a number and match profile 0.
        const isNumeric = /^\d+$/.test(profileRef);
        const profiles = await pool.query(
            isNumeric
                ? `SELECT p.id, p.name, p.slug, p.description, p.picture_url, p.location, p.genre
                   FROM profiles p WHERE p.id = ? LIMIT 1`
                : `SELECT p.id, p.name, p.slug, p.description, p.picture_url, p.location, p.genre
                   FROM profiles p WHERE p.slug = ? LIMIT 1`,
            [profileRef]
        );

        if (!profiles || profiles.length === 0) {
            logger.debug(`OG: no profile found for ref ${profileRef}`);
            return null;
        }

        const profile = profiles[0];
        const name = profile.name || 'InternetDJ artist';

        const counts = await pool.query(
            'SELECT COUNT(*) AS total FROM songs WHERE profile_id = ?',
            [profile.id]
        );
        const trackCount = counts && counts[0] ? Number(counts[0].total) : 0;

        // An artist page with no track titles on it is not an artist page to a
        // crawler that cannot run the app — it is a name and a bio.
        const topTracks = await pool.query(`
            SELECT s.id, s.title, s.genre
            FROM songs s
            WHERE s.profile_id = ?
            ORDER BY s.plays DESC, s.id DESC
            LIMIT 20
        `, [profile.id]);

        // The slug URL is the canonical one when it exists, so the numeric and
        // vanity URLs do not compete as duplicates in search results.
        const canonicalPath = profile.slug ? `/profile/${profile.slug}` : `/profile/${profile.id}`;

        return {
            title: `${name} on InternetDJ`,
            description: toPlainText(profile.description)
                || `${name} on InternetDJ: ${trackCount} track${trackCount === 1 ? '' : 's'}${profile.genre ? `, ${profile.genre}` : ''}${profile.location ? `, ${profile.location}` : ''}.`,
            image: profile.picture_url || FALLBACK_IMAGE,
            url: canonicalPath,
            type: 'profile',
            body: {
                heading: `${name} on InternetDJ`,
                paragraphs: [
                    toPlainText(profile.description, 600) || null,
                    `${name} is an independent producer on InternetDJ with `
                        + `${trackCount} track${trackCount === 1 ? '' : 's'} published`
                        + `${profile.genre ? `, working in ${profile.genre}` : ''}`
                        + `${profile.location ? `, based in ${profile.location}` : ''}. `
                        + 'Listen to their tracks and leave written feedback.',
                ],
                facts: [
                    { label: 'Tracks published', value: String(trackCount) },
                    { label: 'Genre', value: profile.genre || null },
                    { label: 'Location', value: profile.location || null },
                ],
                sections: [
                    {
                        heading: `Tracks by ${name}`,
                        items: topTracks.map(t => ({
                            text: t.title || 'Untitled',
                            href: `/song/${t.id}`,
                        })),
                    },
                    {
                        heading: 'Elsewhere on InternetDJ',
                        items: [{ text: 'Publish your own tracks and get feedback', href: '/promote' }],
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'MusicGroup',
                name,
                url: `${base}${canonicalPath}`,
                image: absolute(profile.picture_url, base),
                description: toPlainText(profile.description) || undefined,
                genre: profile.genre || undefined,
                location: profile.location || undefined,
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching profile metadata:', err);
        return null;
    }
};

const fetchCrateMetadata = async (crateId) => {
    try {
        const crates = await pool.query(`
            SELECT pl.id, pl.name, pl.is_public, pl.updated_at, pl.dedication_note,
                   owner.name AS owner_name,
                   dedicated.name AS dedicated_to_name
            FROM playlists pl
            LEFT JOIN profiles owner ON pl.profile_id = owner.id
            LEFT JOIN profiles dedicated ON pl.dedicated_to_profile_id = dedicated.id
            WHERE pl.id = ?
            LIMIT 1
        `, [crateId]);

        if (!crates || crates.length === 0) return null;

        const crate = crates[0];

        // A private crate must not leak its name or artwork through a share
        // card. Returning null falls through to the generic site card.
        if (!crate.is_public) {
            logger.debug(`OG: crate ${crateId} is private, skipping metadata`);
            return null;
        }

        const tracks = await pool.query(`
            SELECT s.title, s.image_url, p.name AS artist
            FROM playlist_songs ps
            JOIN songs s ON s.id = ps.song_id
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE ps.playlist_id = ?
            ORDER BY ps.added_at ASC
        `, [crateId]);

        const name = crate.name || 'Untitled crate';
        const owner = crate.owner_name || 'an InternetDJ member';
        const cover = tracks.find(t => t.image_url);
        const isMixtape = Boolean(crate.dedicated_to_name);

        const summary = tracks.length
            ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}: ${tracks.slice(0, 3).map(t => t.title).filter(Boolean).join(', ')}${tracks.length > 3 ? '…' : ''}`
            : 'An empty crate.';

        return {
            title: isMixtape
                ? `${name}: a mixtape for ${crate.dedicated_to_name}`
                : `${name}: a crate by ${owner}`,
            description: toPlainText(crate.dedication_note) || summary,
            image: cover ? cover.image_url : FALLBACK_IMAGE,
            url: `/crate/${crate.id}`,
            type: 'music.playlist',
            body: {
                heading: isMixtape
                    ? `${name}: a mixtape for ${crate.dedicated_to_name}`
                    : `${name}: a crate by ${owner}`,
                paragraphs: [
                    toPlainText(crate.dedication_note, 600) || null,
                    `A crate of ${tracks.length} track${tracks.length === 1 ? '' : 's'} assembled by `
                        + `${owner} on InternetDJ.`,
                ],
                facts: [
                    { label: 'Curator', value: owner },
                    { label: 'Tracks', value: String(tracks.length) },
                ],
                sections: [
                    {
                        heading: 'Tracklist',
                        items: tracks.slice(0, 50).map(t => ({
                            text: t.artist ? `${t.title || 'Untitled'} — ${t.artist}` : (t.title || 'Untitled'),
                        })),
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'MusicPlaylist',
                name,
                url: `${base}/crate/${crate.id}`,
                image: cover ? absolute(cover.image_url, base) : undefined,
                numTracks: tracks.length,
                track: tracks.slice(0, 25).map(t => ({
                    '@type': 'MusicRecording',
                    name: t.title || 'Untitled',
                    byArtist: t.artist ? { '@type': 'MusicGroup', name: t.artist } : undefined,
                })),
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching crate metadata:', err);
        return null;
    }
};

const fetchForumPostMetadata = async (postId) => {
    try {
        const posts = await pool.query(`
            SELECT fp.id, fp.title, fp.content, fp.created_at, fp.updated_at,
                   p.name AS author_name, p.picture_url AS author_image,
                   p.id AS author_profile_id, p.slug AS author_slug
            FROM forum_posts fp
            LEFT JOIN profiles p ON p.user_id = fp.user_id
            WHERE fp.id = ?
            LIMIT 1
        `, [postId]);

        if (!posts || posts.length === 0) return null;

        const post = posts[0];
        const author = post.author_name || 'an InternetDJ member';
        const title = post.title || 'Forum post';
        // Search engines want a link that identifies who wrote the post, and
        // the member's profile page is that link. Without it the posting is
        // still valid structured data, but every forum page reports a missing
        // author url, which is what Search Console flagged.
        const authorPath = profilePathFor(post.author_slug, post.author_profile_id);

        return {
            title,
            description: toPlainText(post.content) || `A discussion started by ${author} on InternetDJ.`,
            image: post.author_image || FALLBACK_IMAGE,
            url: `/forum/post/${post.id}`,
            type: 'article',
            body: {
                heading: title,
                paragraphs: [
                    toPlainText(post.content, 1500) || null,
                    `Posted by ${author} in the InternetDJ producer forum.`,
                ],
                facts: [{ label: 'Author', value: author }],
                sections: [
                    {
                        heading: 'Elsewhere on InternetDJ',
                        items: [
                            authorPath ? { text: `${author}'s tracks`, href: authorPath } : null,
                            { text: 'The InternetDJ forum', href: '/forum' },
                        ].filter(Boolean),
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'DiscussionForumPosting',
                headline: title,
                url: `${base}/forum/post/${post.id}`,
                text: toPlainText(post.content, 500) || undefined,
                datePublished: post.created_at ? new Date(post.created_at).toISOString() : undefined,
                dateModified: post.updated_at ? new Date(post.updated_at).toISOString() : undefined,
                author: {
                    '@type': 'Person',
                    name: author,
                    url: authorPath ? `${base}${authorPath}` : undefined,
                },
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching forum post metadata:', err);
        return null;
    }
};

const fetchTagMetadata = async (rawTag) => {
    try {
        const wanted = normalizeGenre(rawTag);
        if (!wanted) return null;

        // Genres are comma-separated free text, so an exact match is
        // impossible in SQL. LIKE narrows the scan cheaply and the normalised
        // comparison below does the real filtering — a crawler hit should not
        // cost a full table scan.
        const rows = await pool.query(`
            SELECT s.title, s.genre, s.image_url, p.name AS artist
            FROM songs s
            LEFT JOIN profiles p ON s.profile_id = p.id
            WHERE s.genre LIKE ?
            ORDER BY s.plays DESC
            LIMIT 100
        `, [`%${rawTag}%`]);

        const matches = rows.filter(row =>
            expandGenreString(row.genre).some(({ key }) => key === wanted)
        );

        if (!matches.length) return null;

        // Show the spelling artists actually use rather than the grouping key.
        const label = matches
            .flatMap(row => expandGenreString(row.genre))
            .filter(({ key }) => key === wanted)
            .map(({ raw }) => raw)[0] || rawTag;

        const cover = matches.find(m => m.image_url);
        const artists = [...new Set(matches.map(m => m.artist).filter(Boolean))].slice(0, 3);

        return {
            title: `${label} on InternetDJ`,
            description: `${matches.length >= 100 ? '100+' : matches.length} ${label} track${matches.length === 1 ? '' : 's'} from independent producers${artists.length ? ` including ${artists.join(', ')}` : ''}. Listen and review on InternetDJ.`,
            image: cover ? cover.image_url : FALLBACK_IMAGE,
            url: `/tag/${encodeURIComponent(wanted)}`,
            type: 'website',
            body: {
                heading: `${label} tracks on InternetDJ`,
                paragraphs: [
                    `${matches.length >= 100 ? 'Over 100' : matches.length} ${label} `
                        + `track${matches.length === 1 ? '' : 's'} from independent producers on InternetDJ. `
                        + 'Every track here was uploaded by the artist who made it, and every one can be '
                        + 'reviewed by other producers.',
                    `If you produce ${label}, you can publish your own tracks here for free and get `
                        + 'written feedback from other producers rather than silent plays.',
                ],
                facts: [
                    { label: 'Genre', value: label },
                    { label: 'Tracks', value: matches.length >= 100 ? '100+' : String(matches.length) },
                ],
                sections: [
                    {
                        heading: `${label} tracks`,
                        items: matches.slice(0, 50).map(m => ({
                            text: m.artist ? `${m.title || 'Untitled'} — ${m.artist}` : (m.title || 'Untitled'),
                        })),
                    },
                    {
                        heading: 'Elsewhere on InternetDJ',
                        items: [
                            { text: `Publish your ${label} tracks on InternetDJ`, href: '/promote' },
                            { text: 'Browse every genre', href: '/browse' },
                        ],
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: `${label} music on InternetDJ`,
                url: `${base}/tag/${encodeURIComponent(wanted)}`,
                about: { '@type': 'Thing', name: label },
                mainEntity: {
                    '@type': 'ItemList',
                    numberOfItems: matches.length,
                    itemListElement: matches.slice(0, 25).map((m, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        item: {
                            '@type': 'MusicRecording',
                            name: m.title || 'Untitled',
                            byArtist: m.artist ? { '@type': 'MusicGroup', name: m.artist } : undefined,
                        },
                    })),
                },
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching tag metadata:', err);
        return null;
    }
};

/**
 * One editorial article.
 *
 * The bodies here are long - a recovered interview runs to ten thousand
 * characters - and the crawler body deliberately carries a substantial chunk of
 * it rather than a summary. These are the pages with a real chance of being
 * cited by an assistant answering a question about an artist, and a citation
 * needs the text, not a description of it.
 */
const fetchArticleMetadata = async (slug) => {
    try {
        const rows = await pool.query(`
            SELECT a.id, a.slug, a.title, a.deck, a.body_text, a.category, a.category_slug,
                   a.author_name, a.hero_image_url, a.published_at, a.is_legacy
            FROM articles a
            WHERE a.slug = ? AND a.status = 'published'
            LIMIT 1
        `, [slug]);

        if (!rows || rows.length === 0) return null;

        const article = rows[0];
        const author = article.author_name || 'InternetDJ';
        const published = article.published_at
            ? new Date(article.published_at).toISOString().slice(0, 10)
            : null;

        const related = await pool.query(`
            SELECT a.slug, a.title
            FROM articles a
            WHERE a.status = 'published' AND a.category_slug = ? AND a.id != ?
            ORDER BY a.published_at IS NULL, a.published_at DESC
            LIMIT 5
        `, [article.category_slug, article.id]);

        return {
            title: article.title,
            description: toPlainText(article.deck) || toPlainText(article.body_text, 200),
            image: articleShareImage(article),
            url: `/articles/${article.slug}`,
            type: 'article',
            body: {
                heading: article.title,
                paragraphs: [
                    toPlainText(article.deck, 400) || null,
                    // 4000 characters is well past what a share card needs and
                    // roughly what an assistant needs to answer a question
                    // about the piece without fetching it twice.
                    toPlainText(article.body_text, 4000) || null,
                ],
                facts: [
                    { label: 'Author', value: author },
                    { label: 'Published', value: published },
                    { label: 'Category', value: article.category },
                    {
                        label: 'Source',
                        value: article.is_legacy
                            ? 'Originally published on InternetDJ.com and restored from the Internet Archive.'
                            : null,
                    },
                ],
                sections: [
                    {
                        heading: `More ${article.category || 'articles'}`,
                        items: related.map(r => ({ text: r.title, href: `/articles/${r.slug}` })),
                    },
                    {
                        heading: 'Elsewhere on InternetDJ',
                        items: [
                            { text: 'All articles', href: '/articles' },
                            { text: 'Publish your music and get feedback', href: '/promote' },
                        ],
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'Article',
                headline: article.title,
                url: `${base}/articles/${article.slug}`,
                description: toPlainText(article.deck) || undefined,
                image: absolute(articleShareImage(article), base),
                articleSection: article.category || undefined,
                datePublished: published || undefined,
                author: { '@type': 'Person', name: author },
                publisher: {
                    '@type': 'Organization',
                    name: 'InternetDJ',
                    url: base,
                    logo: `${base}${FALLBACK_IMAGE}`,
                },
                isPartOf: { '@type': 'WebSite', name: 'InternetDJ', url: base },
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching article metadata:', err);
        return null;
    }
};

/**
 * One article category: /articles?category=interviews and friends.
 *
 * Distinct enough to be worth its own page - "InternetDJ interviews" is a real
 * search - so it gets a real title, a description built from what is actually
 * in the category, and the headlines themselves rather than a summary of them.
 */
const fetchArticleCategoryMetadata = async (categorySlug) => {
    try {
        const name = ARTICLE_CATEGORIES[categorySlug];
        if (!name) return null;

        const rows = await pool.query(`
            SELECT a.slug, a.title, a.deck, a.author_name, a.published_at, a.hero_image_url
            FROM articles a
            WHERE a.status = 'published' AND a.category_slug = ?
            ORDER BY a.published_at IS NULL, a.published_at DESC, a.id DESC
            LIMIT 60
        `, [categorySlug]);

        if (!rows.length) return null;

        const [totals] = await pool.query(
            "SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND category_slug = ?",
            [categorySlug]);
        const total = Number(totals ? totals.n : rows.length);
        // The newest article in the section that still has a picture fronts the
        // category card, and its generated cover counts as a picture - so a
        // section where nothing survived gets section-appropriate art rather
        // than the site logo.
        const cover = rows.find(r => usableHeroImage(r.hero_image_url)) || rows[0];
        const years = rows.map(r => r.published_at).filter(Boolean).map(d => new Date(d).getFullYear());
        const span = years.length ? `${Math.min(...years)}\u2013${Math.max(...years)}` : null;

        return {
            title: `${name} \u2014 Electronic Music Articles`,
            description: `${total} ${name.toLowerCase()} article${total === 1 ? '' : 's'} for electronic `
                + `music producers on InternetDJ${span ? `, ${span}` : ''}.`,
            image: cover ? articleShareImage({ ...cover, category_slug: categorySlug }) : FALLBACK_IMAGE,
            url: `/articles?category=${encodeURIComponent(categorySlug)}`,
            type: 'website',
            body: {
                heading: `${name} on InternetDJ`,
                paragraphs: [
                    `${total} ${name.toLowerCase()} article${total === 1 ? '' : 's'} for electronic music `
                    + `producers${span ? `, published between ${span}` : ''}. Much of this is the restored `
                    + 'InternetDJ.com archive, recovered from the Internet Archive.',
                ],
                facts: [
                    { label: 'Section', value: name },
                    { label: 'Articles', value: String(total) },
                    { label: 'Published', value: span },
                ],
                sections: [
                    {
                        heading: `${name} articles`,
                        items: rows.map(r => ({
                            text: r.deck ? `${r.title} \u2014 ${toPlainText(r.deck, 140)}` : r.title,
                            href: `/articles/${r.slug}`,
                        })),
                    },
                    {
                        heading: 'Elsewhere on InternetDJ',
                        items: [
                            { text: 'All articles', href: '/articles' },
                            { text: 'Publish your music and get feedback', href: '/promote' },
                        ],
                    },
                ],
            },
            jsonLd: (base) => ({
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: `${name} \u2014 InternetDJ Articles`,
                url: `${base}/articles?category=${encodeURIComponent(categorySlug)}`,
                isPartOf: { '@type': 'WebSite', name: 'InternetDJ', url: base },
                mainEntity: {
                    '@type': 'ItemList',
                    numberOfItems: total,
                    itemListElement: rows.slice(0, 25).map((r, i) => ({
                        '@type': 'ListItem',
                        position: i + 1,
                        url: `${base}/articles/${r.slug}`,
                        name: r.title,
                    })),
                },
            }),
        };
    } catch (err) {
        logger.error('OG: error fetching article category metadata:', err);
        return null;
    }
};

const FETCHERS = {
    staticPage: fetchStaticPageMetadata,
    song: fetchSongMetadata,
    profile: fetchProfileMetadata,
    crate: fetchCrateMetadata,
    forumPost: fetchForumPostMetadata,
    tag: fetchTagMetadata,
    article: fetchArticleMetadata,
    articleCategory: fetchArticleCategoryMetadata,
};

/**
 * Metadata cache.
 *
 * Every crawler hit costs at least one query and, for a song, two — the track
 * and its reviews. That was affordable while the crawler list was social
 * networks fetching a link someone had just pasted. It is a different shape of
 * traffic now that the assistant crawlers are on the list: they walk the
 * sitemap, which is one request per song in the catalogue, and several of them
 * do it independently of each other.
 *
 * Fifteen minutes is far shorter than the interval any of these recrawl a page
 * on, so nothing goes stale in a way a crawler would notice, and it collapses a
 * burst from a dozen bots into one round of queries.
 *
 * The entry holds the in-flight promise rather than the settled value, for the
 * same reason the sitemap cache does: crawlers arrive in parallel, and caching
 * only settled values lets a stampede past the cache before the first result
 * lands.
 */
const METADATA_CACHE_TTL_MS = 15 * 60 * 1000;
const METADATA_CACHE_MAX_ENTRIES = 2000;
const metadataCache = new Map();

/** Single entry point, so server.js does not grow a branch per entity type. */
const fetchMetadata = async ({ type, id }) => {
    const fetcher = FETCHERS[type];
    if (!fetcher) return null;

    const key = `${type}:${id}`;
    const hit = metadataCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;

    const promise = fetcher(id);
    metadataCache.set(key, { promise, expires: Date.now() + METADATA_CACHE_TTL_MS });

    // A failure must not be cached for the window: the next crawl should retry
    // rather than be handed the same rejection.
    promise.catch(() => {
        const current = metadataCache.get(key);
        if (current && current.promise === promise) metadataCache.delete(key);
    });

    // Unbounded, this map is one entry per song ever crawled. Map preserves
    // insertion order, so the oldest key is the first one iteration yields.
    if (metadataCache.size > METADATA_CACHE_MAX_ENTRIES) {
        const oldest = metadataCache.keys().next().value;
        metadataCache.delete(oldest);
    }

    return promise;
};

const escapeHtml = (text) => {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const toAbsoluteUrl = (value, baseUrl) => {
    if (!value) return `${baseUrl}${FALLBACK_IMAGE}`;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/')) return `${baseUrl}${value}`;
    return `${baseUrl}/${value}`;
};

// Same resolution, but an absent value stays absent instead of becoming the
// fallback image — JSON-LD should omit a field rather than assert a wrong one.
const absolute = (value, baseUrl) => (value ? toAbsoluteUrl(value, baseUrl) : undefined);

// JSON-LD is injected inside a <script> block, where the danger is a user
// string closing the tag early. JSON.stringify handles quoting; this handles
// the one sequence it does not escape.
const safeJsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * The crawler-visible body.
 *
 * Meta tags describe a page; they are not the page. An assistant crawler that
 * does not run JavaScript was getting a correct <head> attached to an empty
 * document, which is enough to render a link preview and nothing like enough to
 * answer a question about the track. This renders the entity as plain semantic
 * HTML — heading, prose, a definition list of the facts a producer actually
 * searches on (tempo, key, genre), and links onward to the artist and genre
 * pages so the crawler has somewhere to go next.
 *
 * `body` is deliberately plain data rather than markup, so a fetcher above
 * cannot inject unescaped user content by accident: every string that lands
 * here goes through escapeHtml, and every href through toAbsoluteUrl.
 */
const renderCrawlerBody = (body, baseUrl) => {
    if (!body || !body.heading) return '';

    const parts = [`<h1>${escapeHtml(body.heading)}</h1>`];

    (body.paragraphs || []).filter(Boolean).forEach(text => {
        parts.push(`<p>${escapeHtml(text)}</p>`);
    });

    const facts = (body.facts || []).filter(f => f && f.value);
    if (facts.length) {
        const rows = facts
            .map(f => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`)
            .join('');
        parts.push(`<dl>${rows}</dl>`);
    }

    (body.sections || []).forEach(section => {
        const items = (section.items || []).filter(item => item && item.text);
        if (!items.length) return;
        parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
        const list = items.map(item => {
            const text = escapeHtml(item.text);
            if (!item.href) return `<li>${text}</li>`;
            return `<li><a href="${escapeHtml(toAbsoluteUrl(item.href, baseUrl))}">${text}</a></li>`;
        }).join('');
        parts.push(`<ul>${list}</ul>`);
    });

    return parts.join('\n        ');
};

/**
 * Rendered *inside* <div id="root">, which is the whole trick.
 *
 * createRoot().render() replaces the container's children, so a crawler that
 * runs JavaScript (Googlebot) sees the real React app and never the summary,
 * while one that does not sees the summary and never an empty page. Putting the
 * block beside #root instead would leave both versions on the page for
 * Googlebot and read as duplicated content.
 *
 * Ordinary browsers never reach this code path at all — server.js only calls it
 * behind isCrawler() — so there is no flash of this markup for a real visitor.
 */
const injectCrawlerBody = (html, body, baseUrl) => {
    const rendered = renderCrawlerBody(body, baseUrl);
    if (!rendered) return html;

    const rootTag = /<div([^>]*\bid=["']root["'][^>]*)>/i;
    if (!rootTag.test(html)) return html;

    return html.replace(rootTag, `<div$1>\n        ${rendered}\n    `);
};

const injectOGMetaTags = (html, metadata, baseUrl) => {
    if (!metadata) return html;

    const imageUrl = toAbsoluteUrl(metadata.image, baseUrl);
    const pageUrl = toAbsoluteUrl(metadata.url, baseUrl);

    const tags = [
        `<meta property="og:type" content="${escapeHtml(metadata.type)}" />`,
        `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
        `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
        `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />`,
        `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
        `<meta property="og:site_name" content="InternetDJ" />`,
        `<meta property="fb:app_id" content="1551341333046509" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:site" content="@internetdjco" />`,
        `<meta name="twitter:title" content="${escapeHtml(metadata.title)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`,
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    ];

    // Lets Discord, Telegram and Slack play the track inline instead of only
    // linking to it.
    if (metadata.audio) {
        const audioUrl = toAbsoluteUrl(metadata.audio, baseUrl);
        tags.push(`<meta property="og:audio" content="${escapeHtml(audioUrl)}" />`);
        tags.push(`<meta property="og:audio:secure_url" content="${escapeHtml(audioUrl)}" />`);
        tags.push(`<meta property="og:audio:type" content="audio/mpeg" />`);
    }
    if (metadata.musician) {
        tags.push(`<meta property="music:musician" content="${escapeHtml(toAbsoluteUrl(metadata.musician, baseUrl))}" />`);
    }

    // The crawler-visible description has to replace the static one from
    // index.html, not sit alongside it.
    tags.push(`<meta name="description" content="${escapeHtml(metadata.description)}" />`);
    tags.push(`<link rel="canonical" href="${escapeHtml(pageUrl)}" />`);
    tags.push(`<title>${escapeHtml(metadata.title)} | InternetDJ</title>`);

    if (typeof metadata.jsonLd === 'function') {
        tags.push(`<script type="application/ld+json">${safeJsonLd(metadata.jsonLd(baseUrl))}</script>`);
    }

    const ogTags = `\n    ${tags.join('\n    ')}\n    `;

    // Remove pre-existing tags that would conflict with the ones above. The
    // static <title> and <meta name="description"> in index.html are generic,
    // so leaving them in place would give the crawler two answers.
    const sanitizedHtml = html
        .replace(/\s*<meta\s+(?:property|name)=["'](?:og:[^"']+|twitter:[^"']+|fb:[^"']+|music:[^"']+)["'][^>]*>/gi, '')
        .replace(/\s*<meta\s+name=["']description["'][^>]*>/gi, '')
        .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, '')
        .replace(/\s*<title>[\s\S]*?<\/title>/i, '');

    // Injected at the very top of <head>: some crawlers only read the first few
    // kilobytes before deciding what the page is.
    const withHead = /<head[^>]*>/i.test(sanitizedHtml)
        ? sanitizedHtml.replace(/<head([^>]*)>/i, `<head$1>${ogTags}`)
        : `${ogTags}${sanitizedHtml}`;

    return injectCrawlerBody(withHead, metadata.body, baseUrl);
};

module.exports = {
    isCrawler,
    AI_CRAWLER_AGENTS,
    renderCrawlerBody,
    extractMetadata,
    STATIC_PAGES,
    fetchMetadata,
    fetchSongMetadata,
    fetchProfileMetadata,
    fetchCrateMetadata,
    fetchForumPostMetadata,
    fetchTagMetadata,
    fetchArticleMetadata,
    fetchArticleCategoryMetadata,
    fetchStaticPageMetadata,
    injectOGMetaTags,
};
