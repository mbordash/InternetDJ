import { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PlayIcon, PauseIcon } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import { Helmet } from 'react-helmet-async';
import API_URL from '../utils/api';
import IDJCoinLogo from '../assets/idj-coin.png';
import { getDefaultAvatar } from '../utils/defaultAvatar';
import profilePath from '../utils/profilePath';

function Home() {
    const { user } = useContext(AuthContext);
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [mostPlayed, setMostPlayed] = useState([]);
    const [highestRated, setHighestRated] = useState([]);
    const [latestSongs, setLatestSongs] = useState([]);
    const [latestProfiles, setLatestProfiles] = useState([]);
    const [popularProfiles, setPopularProfiles] = useState([]);
    const [followedSongs, setFollowedSongs] = useState([]);
    const [recentlyCommentedPosts, setRecentlyCommentedPosts] = useState([]);
    const [topReviewers, setTopReviewers] = useState([]);
    const [error, setError] = useState(null);
    const [showWelcome, setShowWelcome] = useState(true);

    /* This used to read "the ultimate platform for music creators, DJs, and
       enthusiasts", which describes no particular site and matches no search
       anyone performs. The home page is where both search engines and
       assistants decide what this domain is for, so it names the thing a
       producer is actually looking for: somewhere to publish a track and get
       told what is wrong with it. Kept in step with the '/' entry in
       backend/middleware/ogMetaTags.js, which serves the same claim to crawlers
       that do not run JavaScript. */
    const description = "Publish your music free on InternetDJ and get written feedback from other "
        + "electronic producers. House, techno, drum & bass, ambient and everything in between, "
        + "plus crates, collaborations and a free AI loop generator.";

    // Dismissible welcome banner
    useEffect(() => {
        if (user) {
            if (localStorage.getItem('homeWelcomeDismissed') === 'true') setShowWelcome(false);
        }
    }, [user]);

    const dismissWelcome = () => {
        localStorage.setItem('homeWelcomeDismissed', 'true');
        setShowWelcome(false);
    };

    const shuffleAndLimit = (array, limit) => {
        const shuffled = [...array].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(limit, shuffled.length));
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const requests = [
                    axios.get(`${API_URL}/music/most-played`),
                    axios.get(`${API_URL}/music/highest-rated`),
                    axios.get(`${API_URL}/music/latest`),
                    axios.get(`${API_URL}/profile/latest`, { headers: { Accept: 'application/json' } }),
                    axios.get(`${API_URL}/profile/most-popular`, { headers: { Accept: 'application/json' } }),
                    axios.get(`${API_URL}/forum/recently-commented`),
                    axios.get(`${API_URL}/profile/top-reviewers`, { headers: { Accept: 'application/json' } }),
                ];

                if (user) {
                    const token = localStorage.getItem('token');
                    requests.push(
                        axios.get(`${API_URL}/profile/${user.id}/followed-songs`, {
                            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                        })
                    );
                }

                const [
                    mostPlayedRes, highestRatedRes, latestSongsRes,
                    latestProfilesRes, popularProfilesRes, recentlyCommentedRes,
                    topReviewersRes, followedSongsRes
                ] = await Promise.all(requests);

                const normalizeProfiles = (data) => {
                    let profiles = data;
                    if (!Array.isArray(data)) {
                        if (data.profiles) profiles = data.profiles;
                        else if (data.profile) profiles = [data.profile];
                        else if (data && typeof data === 'object') profiles = [data];
                        else return [];
                    }
                    return profiles.map(p => ({
                        user_id: Number(p.user_id || 0),
                        profile_id: Number(p.profile_id || 0),
                        // Carried through so links can use the vanity address.
                        profile_slug: p.profile_slug || p.slug || null,
                        name: p.name || p.email || 'Unknown',
                        created_at: p.created_at || null,
                        total_plays: Number(p.total_plays) || 0,
                        picture_url: p.picture_url || null,
                    }));
                };

                setMostPlayed(shuffleAndLimit(mostPlayedRes.data || [], 6));
                setHighestRated(shuffleAndLimit(highestRatedRes.data || [], 6));
                setLatestSongs(shuffleAndLimit(latestSongsRes.data || [], 6));
                setLatestProfiles(normalizeProfiles(latestProfilesRes.data));
                setPopularProfiles(normalizeProfiles(popularProfilesRes.data));
                setRecentlyCommentedPosts(recentlyCommentedRes.data.posts || []);
                setTopReviewers(
                    (Array.isArray(topReviewersRes.data) ? topReviewersRes.data : []).map(r => ({
                        ...normalizeProfiles([r])[0],
                        review_count: Number(r.review_count) || 0,
                    }))
                );
                if (user && followedSongsRes) {
                    setFollowedSongs(shuffleAndLimit(followedSongsRes.data || [], 6));
                }
            } catch (err) {
                setError('Failed to load data');
            }
        };
        fetchData();
    }, [user]);

    // ==================== PLAY FUNCTION ====================
    const handleSongPlay = async (song) => {
        const playedKey = `played_${song.id}`;
        if (!sessionStorage.getItem(playedKey)) {
            try {
                const token = localStorage.getItem('token');
                await axios.post(`${API_URL}/music/play/${song.id}`, {}, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                sessionStorage.setItem(playedKey, 'true');

                // Update play counts in state
                const updatePlayCount = (songs) =>
                    songs.map(s => s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s);

                setMostPlayed(updatePlayCount);
                setHighestRated(updatePlayCount);
                setLatestSongs(updatePlayCount);
                setFollowedSongs(updatePlayCount);
            } catch (err) {
                console.error('Error recording play:', err);
            }
        }

        playSong({
            id: song.id,
            title: song.title,
            mp3_url: song.mp3_url,
            image_url: song.image_url,
            profile_id: song.profile_id,
            profile_slug: song.profile_slug || null,
            profile_name: song.profile_name || 'Unknown Artist',
        });
    };

    // ==================== RETRO SECTION HEADER ====================
    const SectionHeader = ({ eyebrow, title, linkTo, linkLabel }) => (
        <div className="mb-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="retro-eyebrow mb-2">{eyebrow}</div>
                    <h2 className="retro-display text-xl sm:text-2xl retro-glow-magenta">{title}</h2>
                </div>
                {linkTo && (
                    <Link to={linkTo} className="retro-link retro-mono text-lg whitespace-nowrap">
                        {linkLabel} &raquo;&raquo;
                    </Link>
                )}
            </div>
            <div className="retro-rule mt-3" />
        </div>
    );

    // ==================== RENDER SONG CARD ====================
    const renderSongCard = (song, badge = null) => {
        const isLive = currentSong?.id === song.id;

        return (
            <div
                key={song.id}
                className={`retro-card retro-cut p-4 flex flex-col ${isLive ? 'retro-card--live' : ''}`}
            >
                <div className="relative w-full aspect-square mb-4 retro-scanlines overflow-hidden border border-white/10">
                    {song.image_url ? (
                        <img
                            src={song.image_url}
                            alt={song.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-fuchsia-900/50 to-cyan-900/40 flex items-center justify-center retro-pixel text-2xl text-cyan-300">
                            ?
                        </div>
                    )}

                    {badge && (
                        <span className={`retro-badge retro-badge--${badge.tone} absolute top-2 left-2 bg-black/70 z-10`}>
                            {badge.label}
                        </span>
                    )}

                    {isLive && isPlaying && (
                        <span className="retro-eq absolute bottom-2 right-2 z-10">
                            <span /><span /><span /><span />
                        </span>
                    )}

                    {song.mp3_url && (
                        <button
                            onClick={() => {
                                if (currentSong?.id === song.id) {
                                    togglePlayPause();
                                } else {
                                    handleSongPlay(song);
                                }
                            }}
                            aria-label={isLive && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                            className="absolute inset-0 z-20 flex items-center justify-center bg-fuchsia-900/40 opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                            <span className="w-16 h-16 rounded-full border-2 border-cyan-300 bg-black/60 flex items-center justify-center shadow-[0_0_28px_rgba(0,240,255,0.6)]">
                                {isLive && isPlaying
                                    ? <PauseIcon className="w-8 h-8 text-cyan-200" />
                                    : <PlayIcon className="w-8 h-8 text-cyan-200 ml-1" />}
                            </span>
                        </button>
                    )}
                </div>

                <div className="text-center">
                    <Link
                        to={`/song/${song.id}`}
                        className="retro-display text-sm text-white hover:text-cyan-200 block truncate"
                        title={song.title}
                    >
                        {song.title}
                    </Link>
                    <Link
                        to={profilePath(song)}
                        className="retro-mono text-lg retro-link block truncate"
                    >
                        {song.profile_name || 'Unknown Artist'}
                    </Link>
                </div>
            </div>
        );
    };

    // ==================== SIDEBAR PROFILE ROW ====================
    const profileRow = (p, rank) => (
        <Link
            key={p.profile_id}
            to={profilePath(p)}
            className="flex items-center gap-3 py-1.5 px-2 hover:bg-cyan-400/10 transition-colors group"
        >
            {rank != null && (
                <span className="retro-pixel text-[0.5rem] text-fuchsia-400 w-4 shrink-0">
                    {String(rank).padStart(2, '0')}
                </span>
            )}
            <img
                src={p.picture_url || getDefaultAvatar(p.profile_id)}
                alt=""
                className="w-8 h-8 object-cover border border-cyan-400/40 group-hover:border-fuchsia-400 transition-colors"
            />
            <span className="retro-mono text-lg text-gray-200 group-hover:text-cyan-200 truncate">{p.name}</span>
        </Link>
    );

    // ==================== TICKER ITEMS ====================
    const tickerSongs = latestSongs.length ? latestSongs : mostPlayed;

    if (error) {
        return (
            <div className="container mx-auto px-4 py-16 text-center">
                <p className="retro-pixel text-sm text-fuchsia-400">!! SIGNAL LOST !!</p>
                <p className="retro-mono text-2xl text-gray-300 mt-4">{error}</p>
            </div>
        );
    }

    return (
        <>
            <Helmet>
                <title>InternetDJ: Publish Your Music, Get Real Feedback</title>
                <meta name="description" content={description} />
            </Helmet>

            {/* Bleed under the fixed navbar and past the main padding for a full-page ground. */}
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100">

                {/* ==================== HERO ==================== */}
                {!user ? (
                    <section className="relative overflow-hidden border-b border-fuchsia-500/30">
                        <div className="retro-horizon" aria-hidden="true" />
                        <div className="retro-sun" aria-hidden="true" />

                        <div className="relative container mx-auto px-4 py-20 md:py-28 text-center">
                            {/* Was "NOW WITH 100% MORE A.I." - an infomercial joke,
                                but the first line on the page and it celebrated the
                                exact thing a wary producer is suspicious of, leaving
                                the headline below to walk it back. This sets up
                                "Human Music" instead of arguing with it. */}
                            <div className="retro-eyebrow mb-6">
                                * EST. 1997 * BY PRODUCERS, FOR PRODUCERS *
                            </div>

                            {/* "AI Music" was the previous headline, and it named the
                                wrong thing: as a noun phrase it means music made by
                                AI, which writes the producer out of their own work.
                                "AI Tools" names an instrument instead, so the person
                                reading it is still the author. Same two beats, same
                                chrome treatment - one word doing the work.

                                AI stays in the headline deliberately. The loop
                                generator is a real feature people search for by name,
                                and burying it would cost traffic to fix a problem that
                                was only ever about grammar. */}
                            <h1 className="retro-display retro-chrome text-4xl sm:text-6xl md:text-7xl leading-[1.05] mb-6">
                                AI Tools.<br />Human Music.
                            </h1>

                            {/* "Collaborate" traded for "Real feedback": the subhead
                                listed four tools and nothing about the thing that
                                actually separates this site from a file host. */}
                            <p className="retro-mono text-2xl md:text-3xl text-cyan-200 max-w-3xl mx-auto mb-10">
                                Royalty-free loops &#9642; Online DAW &#9642; Real feedback &#9642; Discover
                            </p>

                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <Link to="/register" className="retro-btn retro-btn--hot px-10 py-4 text-sm">
                                    Start as Artist — Free
                                </Link>
                                <Link to="/discover" className="retro-btn px-10 py-4 text-sm">
                                    Discover Music
                                </Link>
                            </div>
                        </div>
                    </section>
                ) : showWelcome && (
                    <section className="container mx-auto px-4 pt-8">
                        <div className="retro-panel retro-cut p-6">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                                <div>
                                    <div className="retro-eyebrow mb-2">&gt;&gt; System Online &lt;&lt;</div>
                                    <h2 className="retro-display text-xl retro-glow-cyan">
                                        Welcome back, {user.name?.split(' ')[0] || 'DJ'}
                                    </h2>
                                    <p className="retro-mono text-xl text-fuchsia-300 mt-1">
                                        &gt; What are we creating today?
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Link to="/loops" className="retro-btn retro-btn--hot px-5 py-3 text-xs">
                                        Generate AI Loops
                                    </Link>
                                    <Link to="/projects" className="retro-btn px-5 py-3 text-xs">
                                        Open DAW
                                    </Link>
                                    <Link to="/playlists" className="retro-btn px-5 py-3 text-xs">
                                        Create Mixtape
                                    </Link>
                                    <button
                                        onClick={dismissWelcome}
                                        className="retro-mono text-lg text-gray-400 hover:text-fuchsia-300 underline"
                                    >
                                        hide this
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* ==================== TICKER ====================
                    The track list is rendered twice so the marquee can loop
                    seamlessly. Only the first copy is real, navigable content;
                    the duplicate is hidden from keyboards and screen readers so
                    every song isn't announced and tabbed through twice.
                    The animation pauses on hover and on keyboard focus, so the
                    links are never a moving target when you go to click them. */}
                {tickerSongs.length > 0 && (
                    <nav className="retro-ticker mt-8" aria-label="Latest releases">
                        <div className="retro-ticker__track retro-mono text-xl">
                            {[0, 1].map(copy => (
                                tickerSongs.map((song, i) => (
                                    <Link
                                        key={`${copy}-${song.id}-${i}`}
                                        to={`/song/${song.id}`}
                                        className="retro-ticker__item text-cyan-200"
                                        aria-hidden={copy === 1 ? 'true' : undefined}
                                        tabIndex={copy === 1 ? -1 : undefined}
                                    >
                                        <span className="text-fuchsia-400">&#9654;</span>{' '}
                                        {song.title} &mdash; {song.profile_name || 'Unknown Artist'}
                                    </Link>
                                ))
                            ))}
                        </div>
                    </nav>
                )}

                {/* ==================== FOR PRODUCERS ====================
                    The hero leads with the AI tools, which is the right pitch
                    for someone who came here to make something. It is the wrong
                    pitch for the other half of the audience: the producer who
                    already has a finished track and is looking for somewhere to
                    put it. This section is that half's entry point, and it sits
                    directly under the ticker so a visitor arriving from a
                    search for somewhere to publish does not have to scroll
                    past a wall of other people's music to find the way in.

                    Signed-out only. A member has already joined, and the copy
                    below is an invitation to. Crawlers are always signed out,
                    so this is what search engines and assistants read. */}
                {!user && (
                    <section className="container mx-auto px-4 pt-10">
                        <div className="retro-panel retro-cut p-6 md:p-8">
                            <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                                <div className="flex-1">
                                    <div className="retro-eyebrow mb-2">// For Producers //</div>
                                    <h2 className="retro-display text-xl sm:text-2xl retro-glow-magenta mb-3">
                                        Made a track? Put it up.
                                    </h2>
                                    <p className="retro-mono text-xl text-gray-300">
                                        Publish your music on InternetDJ for free and get written
                                        feedback from other producers, not just a play count.
                                        No upload limit, no submission fee, and you keep every right
                                        to your work.
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
                                    <Link
                                        to="/promote"
                                        className="retro-btn retro-btn--hot px-8 py-4 text-sm whitespace-nowrap"
                                    >
                                        Promote Your Music
                                    </Link>
                                    <Link
                                        to="/new"
                                        className="retro-btn px-8 py-4 text-sm whitespace-nowrap"
                                    >
                                        Hear What&rsquo;s New
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                <div className="container mx-auto px-4 py-10">

                    {/* === 3 COLUMN GRID === */}
                    <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_340px] gap-8">

                        {/* LEFT SIDEBAR */}
                        <aside className="hidden xl:block xl:sticky xl:top-28 h-fit max-h-[calc(100vh-9rem)] overflow-y-auto space-y-6">
                            <div className="retro-panel retro-cut p-4">
                                <h3 className="retro-eyebrow mb-4">// Navigate //</h3>
                                <div className="space-y-0.5">
                                    {[
                                        ['/discover', 'Discover'],
                                        ['/new', 'New Releases'],
                                        ['/browse', 'Browse Artists'],
                                        ['/crates', 'Mixtapes'],
                                        ['/articles', 'Articles'],
                                        ['/loops', 'AI Loops'],
                                        ['/projects', 'Studio / DAW'],
                                        ['/forum', 'Forum'],
                                        // Listed for members rather than for search. The producer
                                        // section further up this page is signed-out only, so
                                        // without this entry a signed-in member has no route to
                                        // /promote except the footer. This card renders either way.
                                        ['/promote', 'Promote Your Music'],
                                    ].map(([to, label]) => (
                                        <Link
                                            key={to}
                                            to={to}
                                            className="retro-mono text-xl block px-3 py-1.5 text-gray-300 hover:text-cyan-200 hover:bg-cyan-400/10 border-l-2 border-transparent hover:border-fuchsia-500 transition-colors"
                                        >
                                            {label}
                                        </Link>
                                    ))}
                                </div>
                            </div>

                            <section className="retro-panel retro-cut p-4">
                                <h3 className="retro-eyebrow mb-3">// Forum //</h3>
                                {recentlyCommentedPosts.length > 0 ? (
                                    recentlyCommentedPosts.slice(0, 4).map(post => (
                                        <Link
                                            key={post.id}
                                            to={`/forum/post/${post.id}`}
                                            className="retro-mono text-lg block py-1 text-gray-300 hover:text-fuchsia-300 truncate"
                                        >
                                            &gt; {post.title}
                                        </Link>
                                    ))
                                ) : (
                                    <p className="retro-mono text-lg text-gray-500">&gt; no recent activity</p>
                                )}
                            </section>

                            <section className="retro-panel retro-cut p-4">
                                <div className="flex items-center gap-3 mb-2">
                                    <img src={IDJCoinLogo} alt="" className="w-10 h-10" />
                                    <div className="retro-display text-sm retro-glow-cyan">IDJ Coin</div>
                                </div>
                                <div className="space-y-0.5">Airdrop coins available now!</div>
                                <Link to="/idj-coin" className="retro-link retro-mono text-lg">
                                    Learn more &raquo;&raquo;
                                </Link>
                            </section>

                        </aside>

                        {/* CENTER - MAIN CONTENT */}
                        <div className="space-y-14">

                            {/* Followed Songs */}
                            {user && followedSongs.length > 0 && (
                                <section>
                                    <SectionHeader
                                        eyebrow="&gt;&gt; Your Crew"
                                        title="From Artists You Follow"
                                        linkTo="/browse"
                                        linkLabel="see more"
                                    />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {followedSongs.map(song => renderSongCard(song))}
                                    </div>
                                </section>
                            )}

                            {/* New Releases */}
                            <section>
                                <SectionHeader
                                    eyebrow="&gt;&gt; Fresh Off The Wire"
                                    title="New Releases"
                                    linkTo="/new"
                                    linkLabel="see all"
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {latestSongs.map(song =>
                                        renderSongCard(song, { label: 'New!', tone: 'new' })
                                    )}
                                </div>
                            </section>

                            {/* Trending */}
                            <section>
                                <SectionHeader
                                    eyebrow="&gt;&gt; Peak Hour"
                                    title="Trending Right Now"
                                    linkTo="/browse"
                                    linkLabel="explore more"
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {highestRated.map(song =>
                                        renderSongCard(song, { label: 'Hot', tone: 'hot' })
                                    )}
                                </div>
                            </section>

                        </div>

                        {/* RIGHT SIDEBAR */}
                        <div className="xl:sticky xl:top-28 h-fit max-h-[calc(100vh-9rem)] overflow-y-auto space-y-6">

                            <section className="retro-panel retro-cut p-4">
                                <h3 className="retro-eyebrow mb-3">// New Members //</h3>
                                {latestProfiles.slice(0, 5).map(p => profileRow(p))}
                            </section>

                            <section className="retro-panel retro-cut p-4">
                                <h3 className="retro-eyebrow mb-3">// Top Artists //</h3>
                                {popularProfiles.slice(0, 5).map((p, i) => profileRow(p, i + 1))}
                            </section>

                            {topReviewers.length > 0 && (
                                <section className="retro-panel retro-cut p-4">
                                    <h3 className="retro-eyebrow mb-3">// Top Reviewers //</h3>
                                    {topReviewers.slice(0, 5).map((p, i) => (
                                        <Link
                                            key={p.profile_id}
                                            to={profilePath(p)}
                                            className="flex items-center gap-3 py-1.5 px-2 hover:bg-cyan-400/10 transition-colors group"
                                        >
                                            <span className="retro-pixel text-[0.5rem] text-fuchsia-400 w-4 shrink-0">
                                                {String(i + 1).padStart(2, '0')}
                                            </span>
                                            <img
                                                src={p.picture_url || getDefaultAvatar(p.profile_id)}
                                                alt=""
                                                className="w-8 h-8 object-cover border border-cyan-400/40 group-hover:border-fuchsia-400 transition-colors"
                                            />
                                            <span className="retro-mono text-lg text-gray-200 group-hover:text-cyan-200 truncate flex-1">
                                                {p.name}
                                            </span>
                                            <span
                                                className="retro-mono text-lg text-cyan-300 tabular-nums shrink-0"
                                                title={`${p.review_count} review${p.review_count === 1 ? '' : 's'}`}
                                            >
                                                {p.review_count}
                                            </span>
                                        </Link>
                                    ))}
                                </section>
                            )}



                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default Home;
