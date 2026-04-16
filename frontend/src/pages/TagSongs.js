import React, { useEffect, useState, useContext, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import sanitizeHtml from "sanitize-html";
import {Helmet} from "react-helmet-async";

function TagSongs() {
    const { tag } = useParams();
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [songs, setSongs] = useState([]);
    const [sort, setSort] = useState('random');
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const observerRef = useRef();
    const limit = 20;

    const baseUrl = SITE_URL;

    const fetchSongs = async (newSort = sort, reset = false) => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/music/by-tag/${encodeURIComponent(tag)}`, {
                params: {
                    limit,
                    offset: reset ? 0 : offset,
                    sort: newSort,
                },
            });
            const newSongs = Array.isArray(response.data.songs) ? response.data.songs : [];
            setSongs((prev) => (reset ? newSongs : [...prev, ...newSongs]));
            setHasMore(newSongs.length === limit);
            setOffset((prev) => (reset ? limit : prev + limit));
        } catch (err) {
            console.error('Fetch error:', err.response?.data || err.message);
            setError('Failed to load songs: ' + (err.response?.data?.error || err.message));
        } finally {
            setLoading(false);
        }
    };

    const handleSortChange = (newSort) => {
        setSort(newSort);
        setOffset(0);
        setSongs([]);
        setHasMore(true);
        fetchSongs(newSort, true);
    };

    const lastSongElementRef = (node) => {
        if (loading || !hasMore) return;
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                fetchSongs();
            }
        });
        if (node) observerRef.current.observe(node);
    };

    useEffect(() => {
        fetchSongs('random', true);
        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
    }, [tag]);

    const handleSongPlay = async (song) => {
        const playedKey = `played_${song.id}`;
        if (!sessionStorage.getItem(playedKey)) {
            try {
                const token = localStorage.getItem('token');
                await axios.post(`${API_URL}/music/play/${song.id}`, {}, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                console.log(`Play recorded for song ID: ${song.id}`);
                sessionStorage.setItem(playedKey, 'true');
                setSongs((prevSongs) =>
                    prevSongs.map((s) =>
                        s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s
                    )
                );
            } catch (err) {
                console.error('Error recording play:', err);
            }
        }

        if (!song.mp3_url) {
            console.warn(`No mp3_url for song ID ${song.id}. Attempting to fetch or use fallback.`);
            song.mp3_url = song.mp3_url || '';
        }

        playSong({
            id: song.id,
            title: song.title,
            mp3_url: song.mp3_url,
            image_url: song.image_url,
            profile_id: song.profile_id,
            profile_name: song.profile_name || 'Unknown Artist',
        });
    };

    if (error) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800 pt-16">
                <p className="text-red-400 text-lg">{error}</p>
            </div>
        );
    }

    return (
        <div className="bg-white text-gray-800 pt-16"><Helmet>
            <title>Browse {decodeURIComponent(tag)} Music</title>
            <meta
                name="description"
                content={`Browse ${decodeURIComponent(tag)} Music on InternetDJ`}
            />
            <link rel="canonical" href={`${baseUrl}/tag/${decodeURIComponent(tag)}`} />
            <meta property="og:title" content={`Browse ${decodeURIComponent(tag)} Music`} />
            <meta property="og:description" content={`Browse ${decodeURIComponent(tag)} Music on InternetDJ`} />
            <meta property="og:url" content={`${baseUrl}/tag/${decodeURIComponent(tag)}`} />
            <meta property="og:site_name" content="InternetDJ" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={`Browse ${decodeURIComponent(tag)} Music`} />
            <meta name="twitter:description" content={`Browse ${decodeURIComponent(tag)} Music on InternetDJ`} />
            <meta name="twitter:site" content="@internetdjco" />
        </Helmet>
            <div className="container mx-auto px-4 py-8">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold text-black capitalize">
                        Songs in {decodeURIComponent(tag)}
                    </h1>
                    <Link
                        to="/browse"
                        className="text-black hover:text-gray-600 hover:underline text-lg"
                    >
                        Back to Browse
                    </Link>
                </div>

                <div className="mb-6 flex flex-wrap gap-4">
                    <button
                        onClick={() => handleSortChange('random')}
                        className={`px-4 py-2 rounded-md ${
                            sort === 'random'
                                ? 'bg-black text-white'
                                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                        }`}
                    >
                        Random
                    </button>
                    <button
                        onClick={() => handleSortChange('alpha')}
                        className={`px-4 py-2 rounded-md ${
                            sort === 'alpha'
                                ? 'bg-black text-white'
                                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                        }`}
                    >
                        Alphabetical
                    </button>
                    <button
                        onClick={() => handleSortChange('listens')}
                        className={`px-4 py-2 rounded-md ${
                            sort === 'listens'
                                ? 'bg-black text-white'
                                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                        }`}
                    >
                        Most Listens
                    </button>
                    <button
                        onClick={() => handleSortChange('likes')}
                        className={`px-4 py-2 rounded-md ${
                            sort === 'likes'
                                ? 'bg-black text-white'
                                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                        }`}
                    >
                        Most Liked
                    </button>
                </div>

                {!loading && songs.length === 0 && (
                    <div className="text-gray-600">
                        <p>No songs found for the tag "{decodeURIComponent(tag)}".</p>
                        <p>Try a different tag or check if songs are tagged correctly in the database.</p>
                        <Link to="/browse" className="text-black hover:text-gray-600 hover:underline">
                            Back to Browse
                        </Link>
                    </div>
                )}
                {songs.length > 0 && (
                    <div className="md:overflow-x-auto">
                        {/* Table for Desktop */}
                        <table className="min-w-full hidden md:table table-fixed">
                            <thead>
                            <tr className="bg-gray-100">
                                <th className="px-4 py-2 text-left text-gray-800 w-[60%]">Song</th>
                                <th className="px-4 py-2 text-left text-gray-800 w-[20%]">Plays</th>
                                <th className="px-4 py-2 text-left text-gray-800 w-[20%]">Likes</th>
                            </tr>
                            </thead>
                            <tbody>
                            {songs.map((song, index) => (
                                <tr
                                    key={song.id}
                                    ref={index === songs.length - 1 ? lastSongElementRef : null}
                                    className={`${
                                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                                    } hover:bg-gray-100 transition-colors`}
                                >
                                    <td className="px-4 py-2 flex items-center space-x-2">
                                        <div className="relative flex-shrink-0 w-12 h-12">
                                            {song.image_url ? (
                                                <Link to={`/song/${song.id}`} tabIndex={0}>
                                                    <img
                                                        src={song.image_url}
                                                        alt={song.title}
                                                        className="w-12 h-12 rounded-md object-cover"
                                                        onError={(e) => {
                                                            console.error(
                                                                `Failed to load song image for song ${song.id}:`,
                                                                song.image_url
                                                            );
                                                            e.target.style.display = 'none';
                                                            e.target.nextSibling.style.display = 'block';
                                                        }}
                                                        loading="lazy"
                                                    />
                                                </Link>
                                            ) : (
                                                <div
                                                    className="w-12 h-12 rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-xs"
                                                    style={{
                                                        display: song.image_url ? 'none' : 'flex',
                                                    }}
                                                >
                                                    ?
                                                </div>
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
                                                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                                                    aria-label={currentSong?.id === song.id && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                                                >
                                                    {currentSong?.id === song.id && isPlaying ? (
                                                        <PauseIcon className="w-4 h-4 text-white" />
                                                    ) : (
                                                        <PlayIcon className="w-4 h-4 text-white" />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center space-x-2 flex-1">
                                            <div className="min-w-0 flex-1">
                                                <Link
                                                    to={`/song/${song.id}`}
                                                    className="text-black hover:text-gray-600 hover:underline font-medium block truncate"
                                                    title={song.title}
                                                >
                                                    {song.title}
                                                </Link>
                                                <div className="text-sm text-gray-600 truncate">
                                                    <Link
                                                        to={song.profile_id ? `/profile/${song.profile_id}` : '#'}
                                                        className={
                                                            song.profile_id
                                                                ? 'text-black hover:text-gray-600 hover:underline'
                                                                : 'text-gray-500 cursor-not-allowed'
                                                        }
                                                        title={song.profile_name}
                                                    >
                                                        {song.profile_name}
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                      <span className="inline-flex items-center">
                        {Number(song.plays) || 0}
                          <SpeakerWaveIcon className="w-4 h-4 text-gray-600 ml-1" />
                      </span>
                                    </td>
                                    <td className="px-4 py-2">
                      <span className="inline-flex items-center">
                        {Number(song.likes_count) || 0}
                          <HeartIconSolid
                              className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-red-600' : 'text-gray-300'}`}
                          />
                      </span>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>

                        {/* Card Layout for Mobile */}
                        <div className="md:hidden space-y-4">
                            {songs.map((song, index) => (
                                <div
                                    key={song.id}
                                    ref={index === songs.length - 1 ? lastSongElementRef : null}
                                    className="bg-white p-4 rounded-md shadow-sm hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-center space-x-4">
                                        <div className="relative flex-shrink-0 w-16 h-16">
                                            {song.image_url ? (
                                                <Link to={`/song/${song.id}`} tabIndex={0}>
                                                    <img
                                                        src={song.image_url}
                                                        alt={song.title}
                                                        className="w-16 h-16 rounded-md object-cover"
                                                        onError={(e) => {
                                                            console.error(
                                                                `Failed to load song image for song ${song.id}:`,
                                                                song.image_url
                                                            );
                                                            e.target.style.display = 'none';
                                                            e.target.nextSibling.style.display = 'block';
                                                        }}
                                                        loading="lazy"
                                                    />
                                                </Link>
                                            ) : (
                                                <div
                                                    className="w-16 h-16 rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-xs"
                                                    style={{
                                                        display: song.image_url ? 'none' : 'flex',
                                                    }}
                                                >
                                                    ?
                                                </div>
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
                                                    className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                                                    aria-label={currentSong?.id === song.id && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                                                >
                                                    {currentSong?.id === song.id && isPlaying ? (
                                                        <PauseIcon className="w-4 h-4 text-white" />
                                                    ) : (
                                                        <PlayIcon className="w-4 h-4 text-white" />
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <Link
                                                to={`/song/${song.id}`}
                                                className="text-black hover:text-gray-600 hover:underline font-medium"
                                            >
                                                {song.title}
                                            </Link>
                                            <div className="text-sm text-gray-600">
                                                <Link
                                                    to={song.profile_id ? `/profile/${song.profile_id}` : '#'}
                                                    className={
                                                        song.profile_id
                                                            ? 'text-black hover:text-gray-600 hover:underline'
                                                            : 'text-gray-500 cursor-not-allowed'
                                                    }
                                                >
                                                    {song.profile_name}
                                                </Link>
                                            </div>
                                            <div className="text-sm text-gray-600 mt-1">
                                                Plays: {Number(song.plays) || 0}
                                                <SpeakerWaveIcon className="w-4 h-4 text-gray-600 inline ml-1" />
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                Likes: {Number(song.likes_count) || 0}
                                                <HeartIconSolid
                                                    className={`w-4 h-4 inline ml-1 ${Number(song.likes_count) > 0 ? 'text-red-600' : 'text-gray-300'}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="text-center py-4">
                        <p className="text-gray-600">Loading songs...</p>
                    </div>
                )}
                {!hasMore && songs.length > 0 && (
                    <div className="text-center py-4">
                        <p className="text-gray-600">No more songs to load.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default TagSongs;