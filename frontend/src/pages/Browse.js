import React, { useEffect, useState, useContext } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import {Helmet} from "react-helmet-async";

function Browse() {
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const baseUrl = SITE_URL;
    const [tags, setTags] = useState([]);
    const [featuredSong, setFeaturedSong] = useState(null);
    const [unreviewedSongs, setUnreviewedSongs] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const tagResponse = await axios.get(`${API_URL}/music/by-tags`);
                const limitedTags = tagResponse.data.map(tag => ({
                    ...tag,
                    songs: tag.songs.slice(0, 10),
                }));
                setTags(Array.isArray(tagResponse.data) ? limitedTags : []);

                const featuredResponse = await axios.get(`${API_URL}/music/featured`);
                setFeaturedSong(featuredResponse.data[0] || null);

                const unreviewedResponse = await axios.get(`${API_URL}/music/unreviewed?limit=5`);
                setUnreviewedSongs(Array.isArray(unreviewedResponse.data) ? unreviewedResponse.data : []);
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                    url: err.config?.url,
                });
                setError('Failed to load data: ' + (err.response?.data?.error || err.message));
            }
        };

        fetchData();
    }, []);

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
                setTags((prevTags) =>
                    prevTags.map((tag) => ({
                        ...tag,
                        songs: tag.songs.map((s) =>
                            s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s
                        ),
                    }))
                );
                if (featuredSong?.id === song.id) {
                    setFeaturedSong((prev) => ({
                        ...prev,
                        plays: (Number(prev.plays) || 0) + 1,
                    }));
                }
                setUnreviewedSongs((prevSongs) =>
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
        <div className="bg-white text-gray-800 pt-16">
            <Helmet>
                <title>Browse Music Genres</title>
                <meta
                    name="description"
                    content="Browse house, trance, hip-hop, drum n bass, breaks and other electronic music"
                />
                <link rel="canonical" href={`${baseUrl}/browse`} />
                <meta property="og:title" content="About InternetDJ" />
                <meta property="og:description" content="Browse and stream house, trance, hip-hop, drum n bass, breaks and other electronic music." />
                <meta property="og:url" content={`${baseUrl}/browse`}/>
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Browse and stream InternetDJ Music" />
                <meta name="twitter:description" content="Browse and stream house, trance, hip-hop, drum n bass, breaks and other electronic music." />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div className="container mx-auto px-4 py-8">
                <div className="flex flex-col md:flex-row md:space-x-4">
                    <div className="w-full md:w-3/4">
                        <h1 className="text-3xl font-bold mb-8 text-black">Browse by Genre Tag</h1>
                        {tags.length === 0 ? (
                            <p className="text-gray-600">No tags available.</p>
                        ) : (
                            <div className="space-y-12">
                                {tags.map((tag) => (
                                    <section key={tag.tag} className="mb-12">
                                        <div className="flex justify-between items-center mb-4">
                                            <h2 className="text-2xl font-bold capitalize text-black">{tag.tag}</h2>
                                            <Link
                                                to={`/tag/${encodeURIComponent(tag.tag)}`}
                                                className="px-4 py-2 border border-black text-black rounded-md hover:bg-black hover:text-white transition-colors"
                                                aria-label={`View all songs in ${tag.tag} genre`}
                                            >
                                                View All
                                            </Link>
                                        </div>
                                        {tag.songs.length === 0 ? (
                                            <p className="text-gray-600">No songs available for this tag.</p>
                                        ) : (
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
                                                    {tag.songs.map((song, index) => (
                                                        <tr
                                                            key={song.id}
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
                                                    {tag.songs.map((song) => (
                                                        <div
                                                            key={song.id}
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
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>

                    <aside className="w-full md:w-1/4 mt-8 md:mt-0 md:pl-4">
                        <div className="mb-8">
                            <h2 className="text-xl font-bold mb-4 text-black">Featured Song</h2>
                            {featuredSong ? (
                                <div className="bg-black p-4 rounded-md shadow-sm hover:bg-gray-800 transition-colors">
                                    <div className="relative">
                                        <Link to={`/song/${featuredSong.id}`} tabIndex={0}>
                                            <img
                                                src={featuredSong.image_url || 'https://via.placeholder.com/150'}
                                                alt={featuredSong.title}
                                                className="w-full h-auto aspect-square rounded-md object-cover mb-2"
                                            />
                                        </Link>
                                        {featuredSong.mp3_url && (
                                            <button
                                                onClick={() => {
                                                    if (currentSong?.id === featuredSong.id) {
                                                        togglePlayPause();
                                                    } else {
                                                        handleSongPlay(featuredSong);
                                                    }
                                                }}
                                                className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 hover:opacity-100 transition-opacity duration-200 rounded-md"
                                                aria-label={currentSong?.id === featuredSong.id && isPlaying ? `Pause ${featuredSong.title}` : `Play ${featuredSong.title}`}
                                            >
                                                {currentSong?.id === featuredSong.id && isPlaying ? (
                                                    <PauseIcon className="w-12 h-12 text-white" />
                                                ) : (
                                                    <PlayIcon className="w-12 h-12 text-white" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                    <Link
                                        to={`/song/${featuredSong.id}`}
                                        className="text-white hover:text-gray-300 hover:underline font-semibold"
                                    >
                                        {featuredSong.title}
                                    </Link>
                                    <div className="text-sm text-gray-300 mb-2">
                                        <Link
                                            to={featuredSong.profile_id ? `/profile/${featuredSong.profile_id}` : '#'}
                                            className={
                                                featuredSong.profile_id
                                                    ? 'text-white hover:text-gray-300 hover:underline'
                                                    : 'text-gray-500 cursor-not-allowed'
                                            }
                                        >
                                            {featuredSong.profile_name}
                                        </Link>
                                    </div>
                                    <div className="text-sm text-gray-300 mb-2">
                    <span className="inline-flex items-center">
                      Plays: {Number(featuredSong.plays) || 0}
                        <SpeakerWaveIcon className="w-4 h-4 text-gray-300 ml-1" />
                    </span>
                                        <span className="inline-flex items-center ml-4">
                      Likes: {Number(featuredSong.likes_count) || 0}
                                            <HeartIconSolid
                                                className={`w-4 h-4 ml-1 ${Number(featuredSong.likes_count) > 0 ? 'text-red-600' : 'text-gray-300'}`}
                                            />
                    </span>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-gray-600">No featured song available.</p>
                            )}
                        </div>

                        <div>
                            <h2 className="text-xl font-bold mb-4 text-black">Songs Awaiting Reviews</h2>
                            {unreviewedSongs.length === 0 ? (
                                <p className="text-gray-600">No unreviewed songs available.</p>
                            ) : (
                                <ul className="space-y-4">
                                    {unreviewedSongs.map((song) => (
                                        <li
                                            key={song.id}
                                            className="bg-white p-4 rounded-md shadow-sm hover:shadow-md transition-shadow"
                                        >
                                            <div className="flex items-center space-x-2">
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
                                                    <div className="text-sm text-gray-600">
                            <span className="inline-flex items-center">
                              Plays: {Number(song.plays) || 0}
                                <SpeakerWaveIcon className="w-4 h-4 text-gray-600 inline ml-1" />
                            </span>
                                                        <span className="inline-flex items-center ml-4">
                              Likes: {Number(song.likes_count) || 0}
                                                            <HeartIconSolid
                                                                className={`w-4 h-4 inline ml-1 ${Number(song.likes_count) > 0 ? 'text-red-600' : 'text-gray-300'}`}
                                                            />
                            </span>
                                                    </div>
                                                    <Link
                                                        to={`/song/${song.id}#review`}
                                                        className="text-gray-700 hover:text-gray-900 hover:underline text-sm font-medium"
                                                    >
                                                        Write a Review
                                                    </Link>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}

export default Browse;