import { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import { Helmet } from 'react-helmet-async';
import API_URL from '../utils/api';
import IDJCoinLogo from '../assets/idj-coin.png';
import { getDefaultAvatar } from '../utils/defaultAvatar';

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
    const [error, setError] = useState(null);
    const [showWelcome, setShowWelcome] = useState(true);

    const baseUrl = window.location.origin;
    const description = "Discover, create, and share music on InternetDJ - the ultimate platform for music creators, DJs, and enthusiasts.";

    // Dismissible welcome
    useEffect(() => {
        if (user) {
            if (localStorage.getItem('homeWelcomeDismissed') === 'true') setShowWelcome(false);
        }
    }, [user]);

    const dismissWelcome = () => {
        localStorage.setItem('homeWelcomeDismissed', 'true');
        setShowWelcome(false);
    };

    const shuffleAndLimit = (array, limit) => [...array].sort(() => Math.random() - 0.5).slice(0, limit);

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
                ];

                if (user) {
                    const token = localStorage.getItem('token');
                    requests.push(axios.get(`${API_URL}/profile/${user.id}/followed-songs`, {
                        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
                    }));
                }

                const res = await Promise.all(requests);
                const [most, high, latest, newProf, popProf, forum, followed] = res;

                setMostPlayed(shuffleAndLimit(most.data || [], 6));
                setHighestRated(shuffleAndLimit(high.data || [], 6));
                setLatestSongs(shuffleAndLimit(latest.data || [], 6));
                setLatestProfiles(newProf.data || []);
                setPopularProfiles(popProf.data || []);
                setRecentlyCommentedPosts(forum.data.posts || []);
                if (user && followed) setFollowedSongs(shuffleAndLimit(followed.data || [], 6));
            } catch (err) {
                setError('Failed to load data');
            }
        };
        fetchData();
    }, [user]);

    const renderSongCard = (song) => (
        <div key={song.id} className="bg-zinc-900/80 border border-white/10 rounded-xl p-4 hover:bg-zinc-800/90 transition">
            <div className="relative w-full aspect-square mb-3">
                {song.image_url ? (
                    <img src={song.image_url} alt={song.title} className="w-full h-full rounded-md object-cover" />
                ) : <div className="w-full h-full bg-zinc-800 rounded-md" />}
                {song.mp3_url && (
                    <button onClick={() => handleSongPlay(song)} className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 rounded-md">
                        {currentSong?.id === song.id && isPlaying ? <PauseIcon className="w-10 h-10" /> : <PlayIcon className="w-10 h-10" />}
                    </button>
                )}
            </div>
            <Link to={`/song/${song.id}`} className="font-semibold text-white hover:underline block truncate">{song.title}</Link>
            <Link to={`/profile/${song.profile_id}`} className="text-sm text-gray-300 hover:underline">{song.profile_name}</Link>
        </div>
    );

    const handleSongPlay = (song) => { /* keep your existing play logic */ };

    return (
        <>
            <Helmet>
                <title>InternetDJ - Discover, Create, and Share Music</title>
                <meta name="description" content={description} />
            </Helmet>

            <div className="text-gray-100 pt-2">
                <div className="container mx-auto px-4 py-8">

                    {/* HERO / WELCOME */}
                    {!user ? (
                        <section className="mb-12 bg-gradient-to-br from-zinc-950 via-black to-zinc-900 border border-white/10 rounded-3xl p-8 md:p-16 text-center">
                            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6">AI Music.<br />Made Simple.</h1>
                            <p className="text-2xl text-gray-300 max-w-2xl mx-auto mb-8">Generate royalty-free stems • Online DAW • Collaborate • Discover</p>
                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <Link to="/register" className="px-10 py-4 bg-white text-black font-semibold rounded-2xl text-xl">Start as Artist (Free)</Link>
                                <Link to="/discover" className="px-10 py-4 border-2 border-white/50 hover:bg-white/10 rounded-2xl text-xl">Discover Music</Link>
                            </div>
                        </section>
                    ) : showWelcome && (
                        <section className="mb-8 bg-zinc-900/60 border border-white/10 rounded-2xl p-6">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-semibold">Welcome back, {user.name?.split(' ')[0] || 'there'} 👋</h2>
                                    <p className="text-gray-300">What are we creating today?</p>
                                </div>
                                <div className="flex gap-3">
                                    <Link to="/stems" className="px-6 py-3 bg-primary-brand-500 rounded-xl font-medium">Generate AI Stems</Link>
                                    <Link to="/projects" className="px-6 py-3 border border-white/30 rounded-xl font-medium">Open DAW</Link>
                                    <button onClick={dismissWelcome} className="px-4 py-3 text-sm text-gray-400 hover:text-white underline">Hide</button>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* === PROPER 3 COLUMN GRID === */}
                    <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_360px] gap-8">

                        {/* LEFT SIDEBAR */}
                        <aside className="hidden xl:block xl:sticky xl:top-24 h-fit">
                            <div className="spotify-surface p-4 rounded-2xl">
                                <h3 className="text-sm uppercase tracking-widest text-gray-300 mb-4">Explore</h3>
                                <div className="space-y-1 text-sm">
                                    <Link to="/discover" className="block px-3 py-2 rounded-lg hover:bg-white/10">Discover</Link>
                                    <Link to="/new" className="block px-3 py-2 rounded-lg hover:bg-white/10">New Releases</Link>
                                    <Link to="/browse" className="block px-3 py-2 rounded-lg hover:bg-white/10">Browse Artists</Link>
                                    <Link to="/stems" className="block px-3 py-2 rounded-lg hover:bg-white/10">AI Stems</Link>
                                    <Link to="/projects" className="block px-3 py-2 rounded-lg hover:bg-white/10">Studio / DAW</Link>
                                    <Link to="/forum" className="block px-3 py-2 rounded-lg hover:bg-white/10">Forum</Link>
                                </div>
                            </div>
                        </aside>

                        {/* CENTER COLUMN - MAIN CONTENT */}
                        <div className="space-y-12">

                            {/* Followed Songs */}
                            {user && followedSongs.length > 0 && (
                                <section>
                                    <div className="flex justify-between items-center mb-4">
                                        <h2 className="text-2xl font-bold">From Artists You Follow</h2>
                                        <Link to="/browse" className="text-sm text-gray-400 hover:text-white">See more →</Link>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {followedSongs.map(song => renderSongCard(song))}
                                    </div>
                                </section>
                            )}

                            {/* New Releases */}
                            <section>
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-2xl font-bold">New Releases</h2>
                                    <Link to="/new" className="text-sm text-gray-400 hover:text-white">See all →</Link>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {latestSongs.map(song => renderSongCard(song))}
                                </div>
                            </section>

                            {/* Trending */}
                            <section>
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-2xl font-bold">Trending Right Now</h2>
                                    <Link to="/browse" className="text-sm text-gray-400 hover:text-white">Explore more →</Link>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {highestRated.map(song => renderSongCard(song))}
                                </div>
                            </section>

                        </div>

                        {/* RIGHT SIDEBAR */}
                        <div className="xl:sticky xl:top-24 h-fit space-y-8">

                            <section className="spotify-surface p-4 rounded-2xl">
                                <h3 className="font-semibold mb-3">New Members</h3>
                                {latestProfiles.slice(0,5).map(p => (
                                    <Link key={p.profile_id} to={`/profile/${p.profile_id}`} className="flex items-center gap-3 py-1 hover:bg-white/5 rounded">
                                        <img src={p.picture_url || getDefaultAvatar(p.profile_id)} className="w-8 h-8 rounded-full" />
                                        <span className="text-sm">{p.name}</span>
                                    </Link>
                                ))}
                            </section>

                            <section className="spotify-surface p-4 rounded-2xl">
                                <h3 className="font-semibold mb-3">Popular Artists</h3>
                                {popularProfiles.slice(0,5).map(p => (
                                    <Link key={p.profile_id} to={`/profile/${p.profile_id}`} className="flex items-center gap-3 py-1 hover:bg-white/5 rounded">
                                        <img src={p.picture_url || getDefaultAvatar(p.profile_id)} className="w-8 h-8 rounded-full" />
                                        <span className="text-sm flex-1">{p.name}</span>
                                    </Link>
                                ))}
                            </section>

                            <section className="spotify-surface p-4 rounded-2xl">
                                <h3 className="font-semibold mb-3">Recent Discussions</h3>
                                {recentlyCommentedPosts.length > 0 ? recentlyCommentedPosts.slice(0,4).map(post => (
                                    <Link key={post.id} to={`/forum/post/${post.id}`} className="block text-sm text-gray-300 hover:text-white py-0.5">{post.title}</Link>
                                )) : <p className="text-sm text-gray-400">No recent activity</p>}
                            </section>

                            <section className="spotify-surface p-4 rounded-2xl">
                                <div className="flex items-center gap-3 mb-2">
                                    <img src={IDJCoinLogo} className="w-9 h-9" />
                                    <div className="font-semibold">IDJ Coin</div>
                                </div>
                                <Link to="/idj-coin" className="text-sm underline">Learn more →</Link>
                            </section>

                        </div>
                    </div>

                </div>
            </div>
        </>
    );
}

export default Home;