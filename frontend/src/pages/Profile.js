import React, { useEffect, useState, useContext, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import {
    SpeakerWaveIcon,
    PlayIcon,
    PauseIcon,
    HeartIcon as HeartIconSolid,
    GlobeAltIcon,
    LinkIcon,
    PlayCircleIcon,
    CameraIcon,
    ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/solid';
import { HeartIcon as HeartIconOutline } from '@heroicons/react/24/outline';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Buffer } from 'buffer';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { getDefaultAvatar } from '../utils/defaultAvatar';
import sanitizeHtml from 'sanitize-html';
import {Helmet} from "react-helmet-async";

window.Buffer = window.Buffer || Buffer;

const ProfilePage = () => {
    const { profileId } = useParams();
    const { user } = useContext(AuthContext);
    const { playSong, currentSong, isPlaying, togglePlayPause } = useContext(AudioPlayerContext);
    const [profile, setProfile] = useState(null);
    const [songs, setSongs] = useState([]);
    const [error, setError] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        genre: '',
        description: '',
        picture: null,
        background: '',
        backgroundImage: null,
        heroBackgroundImage: null,
        donation_link: '',
        website_url: '',
        x_url: '',
        facebook_url: '',
        youtube_url: '',
        instagram_url: '',
        solana_address: '',
    });
    const [isFollowing, setIsFollowing] = useState(false);
    const [followerCount, setFollowerCount] = useState(0);
    const [followingCount, setFollowingCount] = useState(0);
    const [followers, setFollowers] = useState([]);
    const [followingProfiles, setFollowingProfiles] = useState([]);
    const [likedSongsByArtist, setLikedSongsByArtist] = useState([]);
    const [latestArtistReviews, setLatestArtistReviews] = useState([]);
    const [likesPlaylist, setLikesPlaylist] = useState(null);
    const [viewerLikedSongIds, setViewerLikedSongIds] = useState([]);
    const [likedSongActionIds, setLikedSongActionIds] = useState([]);
    const [memberFollowActionIds, setMemberFollowActionIds] = useState([]);
    const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);
    const [isSendCoinModalOpen, setIsSendCoinModalOpen] = useState(false);
    const [sendAmount, setSendAmount] = useState('');
    const [sendError, setSendError] = useState(null);
    const [sendSuccess, setSendSuccess] = useState(null);
    const [isArtistInfoExpanded, setIsArtistInfoExpanded] = useState(false);
    const backgroundImageInputRef = useRef(null);

    const baseUrl = SITE_URL;

    const backgroundOptions = [
        { id: 'bg-gradient-1', name: 'Blue Gradient', class: 'bg-gradient-1' },
        { id: 'bg-gradient-2', name: 'Pink Gradient', class: 'bg-gradient-2' },
        { id: 'bg-gradient-3', name: 'Green Gradient', class: 'bg-gradient-3' },
        { id: 'bg-gradient-4', name: 'Purple Gradient', class: 'bg-gradient-4' },
        { id: 'bg-gradient-5', name: 'Orange Gradient', class: 'bg-gradient-5' },
        { id: 'bg-gradient-dark-grey', name: 'Dark Grey Gradient', class: 'bg-gradient-dark-grey' },
        { id: 'bg-line-pattern', name: 'Line Pattern', class: 'bg-line-pattern' },
        { id: 'bg-inverse-line-pattern', name: 'Inverse Line Pattern', class: 'bg-inverse-line-pattern' },
    ];

    const IDJ_COIN_MINT = new PublicKey('DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN');
    const connection = new Connection(
        process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
        'confirmed'
    );

    const processDescription = (description) => {
        if (!description) return description;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const processed = description.replace(urlRegex, (url) => {
            try {
                const urlObj = new URL(url);
                const domain = urlObj.hostname.replace(/^www\./, '');
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">${domain}</a>`;
            } catch (err) {
                console.error('Invalid URL in description:', url, err);
                return url;
            }
        });

        return sanitizeHtml(processed, {
            allowedTags: ['a'],
            allowedAttributes: {
                a: ['href', 'target', 'rel', 'class'],
            },
        });
    };

    useEffect(() => {
        const fetchProfileData = async () => {
            if (!profileId || isNaN(parseInt(profileId))) {
                setError('Invalid profile ID');
                return;
            }
            try {
                const response = await axios.get(`${API_URL}/profile/${profileId}`);
                if (!response.data || !response.data.profile || typeof response.data.profile !== 'object') {
                    console.error('Invalid profile response:', response.data);
                    setError('Failed to load profile: Invalid response data');
                    return;
                }

                const [followersResponse, followingResponse, likedSongsResponse, recentReviewsResponse] = await Promise.all([
                    axios.get(`${API_URL}/profile/${profileId}/followers`),
                    axios.get(`${API_URL}/profile/${profileId}/following`),
                    axios.get(`${API_URL}/profile/${profileId}/liked-songs-public`),
                    axios.get(`${API_URL}/profile/${profileId}/recent-reviews`),
                ]);

                setProfile(response.data.profile);
                setSongs(response.data.songs || []);
                setFollowerCount(Number(response.data.profile?.follower_count) || 0);
                setFollowingCount(Number(response.data.profile?.following_count) || 0);
                setFollowers(Array.isArray(followersResponse.data) ? followersResponse.data : []);
                setFollowingProfiles(Array.isArray(followingResponse.data) ? followingResponse.data : []);
                setLikedSongsByArtist(Array.isArray(likedSongsResponse.data) ? likedSongsResponse.data.slice(0, 3) : []);
                setLatestArtistReviews(Array.isArray(recentReviewsResponse.data) ? recentReviewsResponse.data : []);
                setIsArtistInfoExpanded(false);

                if (user) {
                    const token = localStorage.getItem('token');
                    if (token) {
                        const playlistsResponse = await axios.get(`${API_URL}/playlists`, {
                            headers: { Authorization: `Bearer ${token}` },
                        });
                        const resolvedLikesPlaylist = (playlistsResponse.data || []).find((pl) => (pl.name || '').toLowerCase() === 'likes') || null;
                        setLikesPlaylist(resolvedLikesPlaylist);

                        if (resolvedLikesPlaylist) {
                            const songsResponse = await axios.get(`${API_URL}/playlists/${resolvedLikesPlaylist.id}/songs`, {
                                headers: { Authorization: `Bearer ${token}` },
                            });
                            setViewerLikedSongIds((songsResponse.data?.songs || []).map((song) => Number(song.id)));
                        } else {
                            setViewerLikedSongIds([]);
                        }
                    } else {
                        setLikesPlaylist(null);
                        setViewerLikedSongIds([]);
                    }
                } else {
                    setLikesPlaylist(null);
                    setViewerLikedSongIds([]);
                }

                setFormData({
                    name: response.data.profile.name || '',
                    genre: response.data.profile.genre || '',
                    description: response.data.profile.description || '',
                    picture: null,
                    background: response.data.profile.background && !response.data.profile.background.startsWith('http') ? response.data.profile.background : '',
                    backgroundImage: null,
                    heroBackgroundImage: null,
                    donation_link: response.data.profile.donation_link || '',
                    website_url: response.data.profile.website_url || '',
                    x_url: response.data.profile.x_url || '',
                    facebook_url: response.data.profile.facebook_url || '',
                    youtube_url: response.data.profile.youtube_url || '',
                    instagram_url: response.data.profile.instagram_url || '',
                    solana_address: response.data.profile.solana_address || '',
                });

                console.log('Profile background:', response.data.profile.background);

                if (user && user.id !== parseInt(profileId)) {
                    const token = localStorage.getItem('token');
                    const followResponse = await axios.get(`${API_URL}/profile/${profileId}/follow-status`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    });
                    setIsFollowing(followResponse.data.isFollowing);
                }
            } catch (err) {
                console.error('Fetch profile error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                });
                if (err.response && err.response.status === 404) {
                    setError('Profile not found');
                } else {
                    setError(`Failed to fetch profile: ${err.response?.data?.error || err.message}`);
                }
            }
        };

        fetchProfileData();
    }, [profileId, user]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'solana_address' && value && !/^[1-9A-HJ-NP-Za-km-z]{0,44}$/.test(value)) {
            setError('Solana address must be a valid Base58 string (44 characters)');
            return;
        }
        setFormData({ ...formData, [name]: value });
        if (name === 'solana_address' && error && value.length <= 44) {
            setError(null);
        }
    };

    const handleSendAmountChange = (e) => {
        const value = e.target.value;
        if (value && (isNaN(value) || value <= 0)) {
            setSendError('Please enter a valid amount greater than 0');
            return;
        }
        setSendAmount(value);
        setSendError(null);
    };

    const handleSendCoin = async () => {
        if (!sendAmount || sendAmount <= 0) {
            setSendError('Please enter a valid amount');
            return;
        }

        if (!window.solana || !window.solana.isPhantom) {
            setSendError('Please install Phantom wallet to send IDJ Coin');
            return;
        }

        try {
            await window.solana.connect();
            const senderPublicKey = new PublicKey(window.solana.publicKey.toString());
            const recipientPublicKey = new PublicKey(profile.solana_address);

            if (!PublicKey.isOnCurve(recipientPublicKey)) {
                setSendError('Invalid recipient Solana address');
                return;
            }

            const senderTokenAccount = await connection.getTokenAccountsByOwner(senderPublicKey, {
                mint: IDJ_COIN_MINT,
            });
            if (!senderTokenAccount.value.length) {
                setSendError(
                    'No IDJ Coin found in your wallet. Buy some on Raydium: ' +
                    '<a href="https://raydium.io/swap/?inputMint=sol&outputMint=DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN&referrer=HjSJR8xGc1NbB3eULRUYC5EjZL6UpRJqBrtqFmhz8hi9" target="_blank" class="text-blue-600 hover:underline">Trade Now</a>'
                );
                return;
            }

            const recipientTokenAccount = await connection.getTokenAccountsByOwner(recipientPublicKey, {
                mint: IDJ_COIN_MINT,
            });
            let recipientTokenAccountPubkey;
            if (!recipientTokenAccount.value.length) {
                setSendError('Recipient wallet does not have an IDJ Coin account. Ask them to receive IDJ Coin first.');
                return;
            } else {
                recipientTokenAccountPubkey = recipientTokenAccount.value[0].pubkey;
            }

            const amount = parseFloat(sendAmount) * Math.pow(10, 9);
            const transaction = new Transaction().add(
                createTransferInstruction(
                    senderTokenAccount.value[0].pubkey,
                    recipientTokenAccountPubkey,
                    senderPublicKey,
                    amount,
                    [],
                    TOKEN_PROGRAM_ID
                )
            );

            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = senderPublicKey;

            const signedTransaction = await window.solana.signTransaction(transaction);

            let serializedTransaction;
            try {
                serializedTransaction = signedTransaction.serialize();
            } catch (serializeErr) {
                console.error('Serialization error:', {
                    message: serializeErr.message,
                    stack: serializeErr.stack,
                });
                throw new Error('Failed to serialize transaction. Ensure your browser environment supports Buffer.');
            }

            const signature = await connection.sendRawTransaction(serializedTransaction);

            const confirmation = await connection.confirmTransaction(signature, 'confirmed');
            if (confirmation.value.err) {
                throw new Error('Transaction failed');
            }

            setSendSuccess(`Successfully sent ${sendAmount} IDJ Coin! Transaction: ${signature}`);
            setSendAmount('');
            setTimeout(() => setSendSuccess(null), 5000);

            // Record the payment
            try {
                const token = localStorage.getItem('token');
                await axios.post(`${API_URL}/profile/${profileId}/record-payment`, {
                    amount: parseFloat(sendAmount),
                    signature,
                }, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                // Refresh profile to update unpaid
                const response = await axios.get(`${API_URL}/profile/${profileId}`);
                setProfile(response.data.profile);
            } catch (recordErr) {
                console.error('Error recording payment:', recordErr);
            }
        } catch (err) {
            console.error('Send IDJ Coin error:', {
                message: err.message,
                stack: err.stack,
                response: err.response?.data,
                status: err.response?.status,
            });
            if (err.message.includes('403')) {
                setSendError('Access to Solana network blocked. Please try again or contact support via Discord: <a href="https://discord.gg/AbebAd3yS8" target="_blank" class="text-blue-600 hover:underline">Join Discord</a>');
            } else if (err.message.includes('Buffer')) {
                setSendError('Transaction failed due to a browser compatibility issue. Try using a different browser or contact support.');
            } else {
                setSendError(`Failed to send IDJ Coin: ${err.message}`);
            }
        }
    };

    const handleFileChange = (e) => {
        const { name, files } = e.target;
        setFormData({ ...formData, [name]: files[0] });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to update your profile');
            return;
        }
        const form = new FormData();
        form.append('name', formData.name);
        form.append('genre', formData.genre);
        form.append('description', formData.description);
        form.append('donation_link', formData.donation_link);
        form.append('website_url', formData.website_url);
        form.append('x_url', formData.x_url);
        form.append('facebook_url', formData.facebook_url);
        form.append('youtube_url', formData.youtube_url);
        form.append('instagram_url', formData.instagram_url);
        form.append('solana_address', formData.solana_address);
        if (formData.picture) {
            form.append('picture', formData.picture);
        }
        if (formData.background) {
            form.append('background', formData.background);
        }
        if (formData.backgroundImage) {
            form.append('backgroundImage', formData.backgroundImage);
        }
        if (formData.heroBackgroundImage) {
            form.append('heroBackgroundImage', formData.heroBackgroundImage);
        }

        try {
            const response = await axios.post(`${API_URL}/profile`, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'multipart/form-data',
                },
            });
            console.log('POST /profile response:', response.data);
            if (!response.data.profile) {
                throw new Error('Profile data missing in response');
            }
            setProfile(response.data.profile);
            setFormData({
                ...formData,
                picture: null,
                background: response.data.profile.background && !response.data.profile.background.startsWith('http') ? response.data.profile.background : '',
                backgroundImage: null,
                heroBackgroundImage: null,
                donation_link: response.data.profile.donation_link || '',
                website_url: response.data.profile.website_url || '',
                x_url: response.data.profile.x_url || '',
                facebook_url: response.data.profile.facebook_url || '',
                youtube_url: response.data.profile.youtube_url || '',
                instagram_url: response.data.profile.instagram_url || '',
                solana_address: response.data.profile.solana_address || '',
            });
            setIsEditing(false);
            setError(null);
        } catch (err) {
            console.error('Profile update error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
            });
            setError(`Failed to update profile: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleRemoveBackground = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to remove your background');
            return;
        }
        try {
            const response = await axios.post(`${API_URL}/profile/background/remove`, {}, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            console.log('POST /profile/background/remove response:', response.data);
            if (!response.data.profile) {
                throw new Error('Profile data missing in response');
            }
            setProfile(response.data.profile);
            setFormData({
                ...formData,
                background: '',
                backgroundImage: null,
                heroBackgroundImage: null,
            });
            setError(null);
        } catch (err) {
            console.error('Remove background error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
            });
            setError(`Failed to remove background: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleRemoveHeroBackground = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to remove your header background');
            return;
        }

        try {
            const response = await axios.post(`${API_URL}/profile/hero-background/remove`, {}, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            console.log('POST /profile/hero-background/remove response:', response.data);
            if (!response.data.profile) {
                throw new Error('Profile data missing in response');
            }
            setProfile(response.data.profile);
            setFormData({
                ...formData,
                heroBackgroundImage: null,
            });
            setError(null);
        } catch (err) {
            console.error('Remove hero background error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
            });
            setError(`Failed to remove header background: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleFollowToggle = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to follow/unfollow');
            return;
        }

        try {
            if (isFollowing) {
                await axios.delete(`${API_URL}/profile/${profileId}/follow`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                setIsFollowing(false);
                setFollowerCount((prev) => prev - 1);
            } else {
                await axios.post(`${API_URL}/profile/${profileId}/follow`, {}, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                setIsFollowing(true);
                setFollowerCount((prev) => prev + 1);
            }
            setError(null);
        } catch (err) {
            console.error('Follow/Unfollow error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
            });
            setError(`Failed to ${isFollowing ? 'unfollow' : 'follow'} profile: ${err.response?.data?.error || err.message}`);
        }
    };

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
                setSongs(songs.map((s) =>
                    s.id === song.id ? { ...s, plays: (Number(s.plays) || 0) + 1 } : s
                ));
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
            profile_name: song.profile_name || 'Unknown Artist',
        });
    };

    const handleBackgroundSelect = (backgroundId) => {
        setFormData({ ...formData, background: backgroundId });
        setIsBackgroundModalOpen(false);
    };

    const handlePayOwed = () => {
        setSendAmount(profile.unpaid.toString());
        setIsSendCoinModalOpen(true);
    };

    const handleFeaturedSongChange = async (songId) => {
        if (!isOwner) {
            return;
        }

        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setError('You must be logged in to update your featured song');
                return;
            }

            await axios.patch(
                `${API_URL}/profile/${profileId}/featured-song`,
                { songId: songId ? Number(songId) : null },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            setSongs((prevSongs) =>
                prevSongs.map((song) => ({
                    ...song,
                    is_featured: songId ? Number(song.id) === Number(songId) : false,
                }))
            );
            setError(null);
        } catch (err) {
            console.error('Featured song update error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
            });
            setError(`Failed to update featured song: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleMemberFollowToggle = async (member, currentlyFollowing) => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to follow/unfollow');
            return;
        }

        const memberProfileId = Number(member.profile_id);
        if (!memberProfileId || memberFollowActionIds.includes(memberProfileId)) {
            return;
        }

        setMemberFollowActionIds((prev) => [...prev, memberProfileId]);

        try {
            if (currentlyFollowing) {
                await axios.delete(`${API_URL}/profile/${memberProfileId}/follow`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                setFollowingProfiles((prev) => prev.filter((p) => Number(p.profile_id) !== memberProfileId));
                setFollowingCount((prev) => Math.max(0, prev - 1));
            } else {
                await axios.post(`${API_URL}/profile/${memberProfileId}/follow`, {}, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                setFollowingProfiles((prev) => {
                    if (prev.some((p) => Number(p.profile_id) === memberProfileId)) {
                        return prev;
                    }
                    return [member, ...prev];
                });
                setFollowingCount((prev) => prev + 1);
            }
            setError(null);
        } catch (err) {
            console.error('Member follow toggle error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
                memberProfileId,
            });
            setError(`Failed to ${currentlyFollowing ? 'unfollow' : 'follow'} member: ${err.response?.data?.error || err.message}`);
        } finally {
            setMemberFollowActionIds((prev) => prev.filter((id) => id !== memberProfileId));
        }
    };

    const handleLikeFromArtistLikes = async (songId) => {
        if (!user) {
            setError('You must be logged in to like songs');
            return;
        }

        const parsedSongId = Number(songId);
        if (!parsedSongId || likedSongActionIds.includes(parsedSongId) || viewerLikedSongIds.includes(parsedSongId)) {
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            setError('You must be logged in to like songs');
            return;
        }

        setLikedSongActionIds((prev) => [...prev, parsedSongId]);

        try {
            let resolvedLikesPlaylist = likesPlaylist;
            if (!resolvedLikesPlaylist) {
                const createResponse = await axios.post(
                    `${API_URL}/playlists`,
                    { name: 'Likes' },
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                resolvedLikesPlaylist = createResponse.data.playlist;
                setLikesPlaylist(resolvedLikesPlaylist);
            }

            await axios.post(
                `${API_URL}/playlists/${resolvedLikesPlaylist.id}/songs`,
                { songId: parsedSongId },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setViewerLikedSongIds((prev) => (prev.includes(parsedSongId) ? prev : [...prev, parsedSongId]));
            setLikedSongsByArtist((prev) =>
                prev.map((song) =>
                    Number(song.id) === parsedSongId
                        ? { ...song, likes_count: (Number(song.likes_count) || 0) + 1 }
                        : song
                )
            );
            setError(null);
        } catch (err) {
            console.error('Like from artist likes error:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
                songId: parsedSongId,
            });
            setError(`Failed to like song: ${err.response?.data?.error || err.message}`);
        } finally {
            setLikedSongActionIds((prev) => prev.filter((id) => id !== parsedSongId));
        }
    };

    const isOwner = user && profile && user.id === profile.user_id;
    const featuredSong = songs.find((song) => Boolean(song.is_featured));
    const nonFeaturedSongs = songs.filter((song) => !song.is_featured);
    const viewerLikedSongIdSet = new Set(viewerLikedSongIds.map((id) => Number(id)));
    const followerProfileIdSet = new Set(followers.map((p) => Number(p.profile_id)));
    const followingProfileIdSet = new Set(followingProfiles.map((p) => Number(p.profile_id)));
    const socialLinks = [
        { key: 'x_url', label: 'X', href: profile?.x_url, icon: ChatBubbleLeftRightIcon },
        { key: 'facebook_url', label: 'Facebook', href: profile?.facebook_url, icon: LinkIcon },
        { key: 'youtube_url', label: 'YouTube', href: profile?.youtube_url, icon: PlayCircleIcon },
        { key: 'website_url', label: 'Website', href: profile?.website_url, icon: GlobeAltIcon },
        { key: 'instagram_url', label: 'Instagram', href: profile?.instagram_url, icon: CameraIcon },
        { key: 'donation_link', label: 'Donate', href: profile?.donation_link, icon: HeartIconSolid },
    ].filter((link) => typeof link.href === 'string' && link.href.trim().length > 0);
    const shouldClampArtistInfo = ((profile?.description || '').length > 320) || socialLinks.length > 4;

    if (error === 'Profile not found') {
        if (isOwner) {
            return (
                <div className="container mx-auto px-4 py-8 max-w-2xl text-gray-100 pt-2">
                    <h1 className="text-3xl font-bold mb-4">Your Profile</h1>
                    <p className="mb-6">Your profile has not been created yet. Create it below:</p>
                    <form onSubmit={handleSubmit} className="space-y-6 bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleInputChange}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Genre</label>
                            <input
                                type="text"
                                name="genre"
                                value={formData.genre}
                                onChange={handleInputChange}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Description</label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleInputChange}
                                rows="4"
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Donation Link (e.g., PayPal, Patreon)</label>
                            <input
                                type="url"
                                name="donation_link"
                                value={formData.donation_link}
                                onChange={handleInputChange}
                                placeholder="https://www.paypal.me/username"
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Website</label>
                                <input type="url" name="website_url" value={formData.website_url} onChange={handleInputChange} placeholder="https://yourwebsite.com" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">X</label>
                                <input type="url" name="x_url" value={formData.x_url} onChange={handleInputChange} placeholder="https://x.com/username" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Facebook</label>
                                <input type="url" name="facebook_url" value={formData.facebook_url} onChange={handleInputChange} placeholder="https://facebook.com/username" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">YouTube</label>
                                <input type="url" name="youtube_url" value={formData.youtube_url} onChange={handleInputChange} placeholder="https://youtube.com/@channel" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Instagram</label>
                                <input type="url" name="instagram_url" value={formData.instagram_url} onChange={handleInputChange} placeholder="https://instagram.com/username" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Solana Address (Optional)</label>
                            <input
                                type="text"
                                name="solana_address"
                                value={formData.solana_address}
                                onChange={handleInputChange}
                                placeholder="Enter your Solana wallet address"
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                            />
                            <p className="mt-1 text-sm text-gray-400">
                                Your Solana address is used to receive IDJ Coin grants and donations for your contributions to InternetDJ.{' '}
                                <a
                                    href="https://phantom.app/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary-brand-300 hover:underline"
                                >
                                    Get one with Phantom
                                </a>
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Profile Picture</label>
                            <input
                                type="file"
                                name="picture"
                                onChange={handleFileChange}
                                accept="image/*"
                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Background</label>
                            <button
                                type="button"
                                onClick={() => setIsBackgroundModalOpen(true)}
                                className="mt-1 w-full py-2 px-4 bg-white/10 text-white font-semibold rounded-md shadow-sm hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand border border-white/10"
                            >
                                Choose Background
                            </button>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Upload Page Background Image</label>
                            <input
                                type="file"
                                name="backgroundImage"
                                onChange={handleFileChange}
                                accept="image/*"
                                ref={backgroundImageInputRef}
                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300">Upload Header Background Image</label>
                            <input
                                type="file"
                                name="heroBackgroundImage"
                                onChange={handleFileChange}
                                accept="image/*"
                                className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                            />
                        </div>
                        <button
                            type="submit"
                            className="w-full py-2 px-4 bg-black text-white font-semibold rounded-md shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700"
                        >
                            Create Profile
                        </button>
                    </form>
                </div>
            );
        } else {
            return (
                <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                    <p className="text-lg">This user has not created a profile yet.</p>
                </div>
            );
        }
    }

    if (error && !isOwner) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-red-500 text-lg">{error}</p>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
                <p className="text-lg">Loading...</p>
            </div>
        );
    }

    const rawPageBackground = typeof profile.background === 'string' ? profile.background.trim() : '';
    const gradientBackgroundIds = new Set(backgroundOptions.map((option) => option.id));
    const hasCustomPageBackground = rawPageBackground.startsWith('http') || gradientBackgroundIds.has(rawPageBackground);
    const backgroundStyle = hasCustomPageBackground
        ? rawPageBackground.startsWith('http')
            ? {
                backgroundImage: `url(${rawPageBackground})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: '#f0f0f0',
            }
            : rawPageBackground
        : 'bg-default';
    const headerBackgroundClass = profile.hero_background && !profile.hero_background.startsWith('http') ? profile.hero_background : '';
    const headerBackgroundStyle = profile.hero_background && profile.hero_background.startsWith('http')
        ? {
            backgroundImage: `linear-gradient(rgba(24,24,27,0.65), rgba(24,24,27,0.65)), url(${profile.hero_background})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        }
        : {};

    console.log('Applying background style:', backgroundStyle);

    return (
        <div className="relative min-h-screen">
            <Helmet>
                <title>{profile.name} - InternetDJ</title>
                <meta
                    name="description"
                    content={
                        profile?.description
                            ? sanitizeHtml(profile.description, { allowedTags: [], allowedAttributes: {} })
                            : `Listen to ${profile?.name} on InternetDJ. Explore reviews, genres, and more.`
                    }
                />
                <link rel="canonical" href={`${baseUrl}/profile/${profileId}`} />
                <meta property="og:title" content={profile?.name || 'Profile'} />
                <meta property="og:description" content={`Listen to ${profile?.name} on InternetDJ. Explore reviews, genres, and more.`} />
                <meta property="og:image" content={profile?.picture_url} />
                <meta property="og:url" content={`${baseUrl}/profile/${profileId}`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={profile?.name || 'Profile'} />
                <meta name="twitter:description" content={`Listen to ${profile?.name} on InternetDJ. Explore reviews, genres, and more.`} />
                <meta name="twitter:image" content={profile?.picture_url} />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div
                className={`profile-background ${typeof backgroundStyle === 'string' ? backgroundStyle : ''}`}
                style={typeof backgroundStyle === 'object' ? backgroundStyle : {}}
            ></div>
            <div className="relative container mx-auto px-4 py-8 max-w-7xl text-gray-100 z-0 pt-2">
                <div
                    className={`bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl mb-8 backdrop-blur-sm ${headerBackgroundClass}`}
                    style={headerBackgroundStyle}
                >
                    <div className="flex flex-col md:flex-row md:items-center md:space-x-6 gap-4">
                        <img
                            src={profile.picture_url || getDefaultAvatar(profile.id || profile.user_id || profile.name)}
                            alt={profile.name || 'Profile'}
                            className="w-32 h-32 rounded-full object-cover shadow-sm"
                            onError={(e) => {
                                e.currentTarget.src = getDefaultAvatar(profile.id || profile.user_id || profile.name);
                            }}
                        />
                        <div>
                            <h1 className="text-3xl font-bold">{profile.name}</h1>
                            <p className="text-lg">Genre: {profile.genre}</p>
                            <Link to="/idj-coin" className="text-lg text-primary-brand-300 hover:underline">
                                IDJC Earned: {profile.total_idjc_earned || 0}
                            </Link>
                        </div>
                    </div>

                    <div className="mt-4 flex space-x-4">
                        {isOwner && !isEditing && (
                            <>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="py-2 px-4 bg-black text-white font-semibold rounded-md shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700"
                                >
                                    Edit Profile
                                </button>
                            </>
                        )}
                        {user && !isOwner && (
                            <button
                                onClick={handleFollowToggle}
                                className={`py-2 px-4 font-semibold rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700 ${
                                    isFollowing
                                        ? 'bg-gray-500 text-white hover:bg-gray-600'
                                        : 'bg-black text-white hover:bg-gray-800'
                                }`}
                            >
                                {isFollowing ? 'Unfollow' : 'Follow'}
                            </button>
                        )}
                        {profile.donation_link && (
                            <a
                                href={profile.donation_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="py-2 px-4 bg-green-500 text-white font-semibold rounded-md shadow-sm hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                            >
                                Donate
                            </a>
                        )}
                        {profile.solana_address && (
                            <button
                                onClick={() => setIsSendCoinModalOpen(true)}
                                className="py-2 px-4 bg-purple-500 text-white font-semibold rounded-md shadow-sm hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                            >
                                Send IDJ Coin
                            </button>
                        )}
                        {user && user.is_admin && (
                            <button
                                onClick={handlePayOwed}
                                className="py-2 px-4 bg-primary-brand text-white font-semibold rounded-md shadow-sm hover:bg-primary-brand-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
                            >
                                Pay Owed IDJC ({profile.unpaid})
                            </button>
                        )}
                    </div>

                    {isOwner && isEditing && (
                        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Genre</label>
                                <input
                                    type="text"
                                    name="genre"
                                    value={formData.genre}
                                    onChange={handleInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Description</label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    rows="4"
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Donation Link (e.g., PayPal, Patreon)</label>
                                <input
                                    type="url"
                                    name="donation_link"
                                    value={formData.donation_link}
                                    onChange={handleInputChange}
                                    placeholder="https://www.paypal.me/username"
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300">Website</label>
                                    <input type="url" name="website_url" value={formData.website_url} onChange={handleInputChange} placeholder="https://yourwebsite.com" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300">X</label>
                                    <input type="url" name="x_url" value={formData.x_url} onChange={handleInputChange} placeholder="https://x.com/username" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300">Facebook</label>
                                    <input type="url" name="facebook_url" value={formData.facebook_url} onChange={handleInputChange} placeholder="https://facebook.com/username" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300">YouTube</label>
                                    <input type="url" name="youtube_url" value={formData.youtube_url} onChange={handleInputChange} placeholder="https://youtube.com/@channel" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300">Instagram</label>
                                    <input type="url" name="instagram_url" value={formData.instagram_url} onChange={handleInputChange} placeholder="https://instagram.com/username" className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Solana Address (Optional)</label>
                                <input
                                    type="text"
                                    name="solana_address"
                                    value={formData.solana_address}
                                    onChange={handleInputChange}
                                    placeholder="Enter your Solana wallet address"
                                    className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                                />
                                <p className="mt-1 text-sm text-gray-400">
                                    Your Solana address is used to receive IDJ Coin grants and donations for your contributions to InternetDJ.{' '}
                                    <a
                                        href="https://phantom.app/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary-brand-300 hover:underline"
                                    >
                                        Get one with Phantom
                                    </a>
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Profile Picture</label>
                                <input
                                    type="file"
                                    name="picture"
                                    onChange={handleFileChange}
                                    accept="image/*"
                                    className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Background</label>
                                <button
                                    type="button"
                                    onClick={() => setIsBackgroundModalOpen(true)}
                                    className="mt-1 w-full py-2 px-4 bg-white/10 text-white font-semibold rounded-md shadow-sm hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand border border-white/10"
                                >
                                    Choose Background
                                </button>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Upload Page Background Image</label>
                                <input
                                    type="file"
                                    name="backgroundImage"
                                    onChange={handleFileChange}
                                    accept="image/*"
                                    ref={backgroundImageInputRef}
                                    className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300">Upload Header Background Image</label>
                                <input
                                    type="file"
                                    name="heroBackgroundImage"
                                    onChange={handleFileChange}
                                    accept="image/*"
                                    className="mt-1 block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                                />
                            </div>
                            <div>
                                <button
                                    type="button"
                                    onClick={handleRemoveBackground}
                                    className="py-2 px-4 bg-red-500 text-white font-semibold rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                >
                                    Remove Page Background
                                </button>
                            </div>
                            <div>
                                <button
                                    type="button"
                                    onClick={handleRemoveHeroBackground}
                                    className="py-2 px-4 bg-red-500 text-white font-semibold rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                >
                                    Remove Header Background
                                </button>
                            </div>
                            <div className="flex space-x-4">
                                <button
                                    type="submit"
                                    className="py-2 px-4 bg-black text-white font-semibold rounded-md shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700"
                                >
                                    Save Changes
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsEditing(false)}
                                    className="py-2 px-4 bg-black text-white font-semibold rounded-md shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                <div className="flex flex-col lg:flex-row lg:items-start gap-8">
                    <div className="lg:w-[65%] bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                            <h2 className="text-2xl font-bold">Songs</h2>
                            {isOwner && songs.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <label htmlFor="featured-song" className="text-sm text-gray-300 whitespace-nowrap">
                                        Featured song
                                    </label>
                                    <select
                                        id="featured-song"
                                        value={featuredSong?.id || ''}
                                        onChange={(e) => handleFeaturedSongChange(e.target.value)}
                                        className="px-3 py-2 border border-white/10 rounded-md bg-white/5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand"
                                    >
                                        <option value="">None</option>
                                        {songs.map((song) => (
                                            <option key={`feature-opt-${song.id}`} value={song.id}>
                                                {song.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {songs.length === 0 ? (
                            <p>No songs found for this profile.</p>
                        ) : (
                            <div className="space-y-6">
                                {featuredSong && (
                                    <div className="border border-primary-brand-400/40 bg-primary-brand-500/10 rounded-md p-3">
                                        <p className="text-xs uppercase tracking-wide text-primary-brand-300 mb-2">Featured</p>
                                        <div className="flex items-start space-x-4 p-4 bg-white/5 rounded-md shadow-sm border border-white/10 hover:bg-white/10 transition-colors">
                                            <div className="relative w-32 h-32 flex-shrink-0">
                                                {featuredSong.image_url ? (
                                                    <Link to={`/song/${featuredSong.id}`}>
                                                        <img
                                                            src={featuredSong.image_url}
                                                            alt={featuredSong.title}
                                                            className="w-32 h-32 rounded-md object-cover"
                                                            onError={() => console.error('Song image failed to load:', featuredSong.image_url)}
                                                        />
                                                    </Link>
                                                ) : (
                                                    <div className="w-32 h-32 rounded-md bg-white/10 flex items-center justify-center text-gray-400 text-sm">
                                                        No Image
                                                    </div>
                                                )}
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
                                                        aria-label={currentSong?.id === featuredSong.id && isPlaying ? 'Pause song' : 'Play song'}
                                                    >
                                                        {currentSong?.id === featuredSong.id && isPlaying ? (
                                                            <PauseIcon className="w-8 h-8 text-white" />
                                                        ) : (
                                                            <PlayIcon className="w-8 h-8 text-white" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <Link
                                                    to={`/song/${featuredSong.id}`}
                                                    className="text-lg font-semibold text-gray-100 hover:text-primary-brand-300 hover:underline"
                                                >
                                                    {featuredSong.title}
                                                </Link>
                                                <div className="text-sm text-gray-300 flex items-center gap-x-2">
                                                    {featuredSong.genre && <span>{featuredSong.genre}</span>}
                                                    {featuredSong.genre && <span> | </span>}
                                                    <span className="inline-flex items-center">
                                                        {Number(featuredSong.plays) || 0}
                                                        <SpeakerWaveIcon
                                                            className={`w-4 h-4 ml-1 ${Number(featuredSong.plays) > 0 ? 'text-gray-100' : 'text-gray-500'}`}
                                                        />
                                                    </span>
                                                    <span> | </span>
                                                    <span className="inline-flex items-center">
                                                        {Number(featuredSong.likes_count) || 0}
                                                        <HeartIconSolid
                                                            className={`w-4 h-4 ml-1 ${Number(featuredSong.likes_count) > 0 ? 'text-red-500' : 'text-gray-500'}`}
                                                        />
                                                    </span>
                                                </div>
                                                {featuredSong.description && (
                                                    <p className="text-sm text-gray-300 mt-1">{featuredSong.description}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-6">
                                    {nonFeaturedSongs.map((song) => (
                                        <div key={song.id} className="flex items-start space-x-4 p-4 bg-white/5 rounded-md shadow-sm border border-white/10 hover:bg-white/10 transition-colors">
                                            <div className="relative w-32 h-32 flex-shrink-0">
                                                {song.image_url ? (
                                                    <Link to={`/song/${song.id}`}>
                                                        <img
                                                            src={song.image_url}
                                                            alt={song.title}
                                                            className="w-32 h-32 rounded-md object-cover"
                                                            onError={() => console.error('Song image failed to load:', song.image_url)}
                                                        />
                                                    </Link>
                                                ) : (
                                                    <div className="w-32 h-32 rounded-md bg-white/10 flex items-center justify-center text-gray-400 text-sm">
                                                        No Image
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
                                                        aria-label={currentSong?.id === song.id && isPlaying ? 'Pause song' : 'Play song'}
                                                    >
                                                        {currentSong?.id === song.id && isPlaying ? (
                                                            <PauseIcon className="w-8 h-8 text-white" />
                                                        ) : (
                                                            <PlayIcon className="w-8 h-8 text-white" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <Link
                                                    to={`/song/${song.id}`}
                                                    className="text-lg font-semibold text-gray-100 hover:text-primary-brand-300 hover:underline"
                                                >
                                                    {song.title}
                                                </Link>
                                                <div className="text-sm text-gray-300 flex items-center gap-x-2">
                                                    {song.genre && <span>{song.genre}</span>}
                                                    {song.genre && <span> | </span>}
                                                    <span className="inline-flex items-center">
                                                        {Number(song.plays) || 0}
                                                        <SpeakerWaveIcon
                                                            className={`w-4 h-4 ml-1 ${Number(song.plays) > 0 ? 'text-gray-100' : 'text-gray-500'}`}
                                                        />
                                                    </span>
                                                    <span> | </span>
                                                    <span className="inline-flex items-center">
                                                        {Number(song.likes_count) || 0}
                                                        <HeartIconSolid
                                                            className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-red-500' : 'text-gray-500'}`}
                                                        />
                                                    </span>
                                                </div>
                                                {song.description && (
                                                    <p className="text-sm text-gray-300 mt-1">{song.description}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="lg:w-[35%] space-y-6">
                        <div className="bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                            <div className="space-y-3 text-gray-200">
                                <div className={`${!isArtistInfoExpanded && shouldClampArtistInfo ? 'max-h-44 overflow-hidden' : ''}`}>
                                    {profile.description ? (
                                        <div
                                            className="text-gray-300"
                                            dangerouslySetInnerHTML={{ __html: processDescription(profile.description) }}
                                        />
                                    ) : (
                                        <p className="text-gray-400">No artist bio yet.</p>
                                    )}

                                    {socialLinks.length > 0 && (
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {socialLinks.map((link) => {
                                                const Icon = link.icon;
                                                return (
                                                    <a
                                                        key={link.key}
                                                        href={link.href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                                                        title={link.label}
                                                    >
                                                        <Icon className="w-4 h-4" />
                                                        <span className="text-xs font-medium">{link.label}</span>
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {shouldClampArtistInfo && (
                                    <button
                                        onClick={() => setIsArtistInfoExpanded((prev) => !prev)}
                                        className="text-sm text-primary-brand-300 hover:text-primary-brand-200"
                                    >
                                        {isArtistInfoExpanded ? 'Show less' : 'Show more'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-semibold">Followers</h3>
                                <span className="text-sm text-gray-400">{followerCount}</span>
                            </div>
                            {followers.length === 0 ? (
                                <p className="text-gray-400">No followers yet.</p>
                            ) : (
                                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                                    {followers.map((member) => {
                                        const memberProfileId = Number(member.profile_id);
                                        const currentlyFollowing = followingProfileIdSet.has(memberProfileId);
                                        const actionPending = memberFollowActionIds.includes(memberProfileId);

                                        return (
                                            <div key={`follower-${member.profile_id}`} className="flex items-center justify-between gap-2 p-2 rounded-md hover:bg-white/10 transition-colors">
                                                <Link
                                                    to={`/profile/${member.profile_id}`}
                                                    className="flex items-center gap-3 min-w-0"
                                                >
                                                    <img
                                                        src={member.picture_url || getDefaultAvatar(member.profile_id || member.user_id || member.name)}
                                                        alt={member.name}
                                                        className="w-9 h-9 rounded-full object-cover"
                                                        onError={(e) => {
                                                            e.currentTarget.src = getDefaultAvatar(member.profile_id || member.user_id || member.name);
                                                        }}
                                                    />
                                                    <span className="text-sm text-gray-100 truncate">{member.name}</span>
                                                </Link>
                                                {isOwner && memberProfileId !== Number(profile.id) && (
                                                    <button
                                                        onClick={() => handleMemberFollowToggle(member, currentlyFollowing)}
                                                        disabled={actionPending}
                                                        className={`text-xs px-2 py-1 rounded-md border border-white/10 whitespace-nowrap ${currentlyFollowing ? 'bg-white/10 hover:bg-white/20 text-gray-100' : 'bg-primary-brand hover:bg-primary-brand-500 text-white'} disabled:opacity-60 disabled:cursor-not-allowed`}
                                                    >
                                                        {actionPending ? 'Saving...' : currentlyFollowing ? 'Following' : 'Follow back'}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-semibold">Following</h3>
                                <span className="text-sm text-gray-400">{followingCount}</span>
                            </div>
                            {followingProfiles.length === 0 ? (
                                <p className="text-gray-400">Not following anyone yet.</p>
                            ) : (
                                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                                    {followingProfiles.map((member) => {
                                        const memberProfileId = Number(member.profile_id);
                                        const actionPending = memberFollowActionIds.includes(memberProfileId);
                                        const followsYou = followerProfileIdSet.has(memberProfileId);

                                        return (
                                            <div key={`following-${member.profile_id}`} className="flex items-center justify-between gap-2 p-2 rounded-md hover:bg-white/10 transition-colors">
                                                <Link
                                                    to={`/profile/${member.profile_id}`}
                                                    className="flex items-center gap-3 min-w-0"
                                                >
                                                    <img
                                                        src={member.picture_url || getDefaultAvatar(member.profile_id || member.user_id || member.name)}
                                                        alt={member.name}
                                                        className="w-9 h-9 rounded-full object-cover"
                                                        onError={(e) => {
                                                            e.currentTarget.src = getDefaultAvatar(member.profile_id || member.user_id || member.name);
                                                        }}
                                                    />
                                                    <span className="text-sm text-gray-100 truncate">{member.name}</span>
                                                    {isOwner && followsYou && (
                                                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-primary-brand-400/40 bg-primary-brand-500/15 text-primary-brand-200">
                                                            Follows you
                                                        </span>
                                                    )}
                                                </Link>
                                                {isOwner && memberProfileId !== Number(profile.id) && (
                                                    <button
                                                        onClick={() => handleMemberFollowToggle(member, true)}
                                                        disabled={actionPending}
                                                        className="text-xs px-2 py-1 rounded-md border border-white/10 bg-white/10 hover:bg-white/20 text-gray-100 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                                                    >
                                                        {actionPending ? 'Saving...' : 'Unfollow'}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                            <h3 className="text-xl font-semibold mb-4">Liked Songs</h3>
                            {likedSongsByArtist.length === 0 ? (
                                <p className="text-gray-400">No liked songs from other artists yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {likedSongsByArtist.map((song) => {
                                        const songId = Number(song.id);
                                        const isAlreadyLikedByViewer = viewerLikedSongIdSet.has(songId);
                                        const isLikeActionPending = likedSongActionIds.includes(songId);

                                        return (
                                            <div key={`liked-song-${song.id}`} className="flex items-center gap-3 p-2 rounded-md hover:bg-white/10 transition-colors">
                                                <div className="relative w-12 h-12 flex-shrink-0">
                                                    {song.image_url ? (
                                                        <img
                                                            src={song.image_url}
                                                            alt={song.title}
                                                            className="w-12 h-12 rounded-md object-cover"
                                                            onError={(e) => {
                                                                e.currentTarget.src = getDefaultAvatar(song.profile_id || song.profile_name || song.title);
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-md bg-white/10 flex items-center justify-center text-[10px] text-gray-400">
                                                            No Img
                                                        </div>
                                                    )}
                                                    {song.mp3_url && (
                                                        <button
                                                            onClick={() => {
                                                                if (currentSong?.id === songId) {
                                                                    togglePlayPause();
                                                                } else {
                                                                    handleSongPlay(song);
                                                                }
                                                            }}
                                                            className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 hover:opacity-100 transition-opacity rounded-md"
                                                            aria-label={`Play ${song.title}`}
                                                        >
                                                            {currentSong?.id === songId && isPlaying ? (
                                                                <PauseIcon className="w-4 h-4 text-white" />
                                                            ) : (
                                                                <PlayIcon className="w-4 h-4 text-white" />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <Link to={`/song/${song.id}`} className="text-sm text-gray-100 hover:text-primary-brand-300 hover:underline block truncate">
                                                        {song.title}
                                                    </Link>
                                                    <Link to={`/profile/${song.profile_id}`} className="text-xs text-gray-400 hover:text-primary-brand-300 hover:underline block truncate">
                                                        by {song.profile_name}
                                                    </Link>
                                                </div>

                                                {user && (
                                                    isAlreadyLikedByViewer ? (
                                                        <HeartIconSolid className="w-5 h-5 text-red-500 flex-shrink-0" title="Already liked" />
                                                    ) : (
                                                        <button
                                                            onClick={() => handleLikeFromArtistLikes(songId)}
                                                            disabled={isLikeActionPending}
                                                            className="text-gray-300 hover:text-red-400 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                                                            aria-label={`Like ${song.title}`}
                                                        >
                                                            <HeartIconOutline className="w-5 h-5" />
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="bg-zinc-900/85 border border-white/10 p-6 rounded-lg shadow-xl backdrop-blur-sm">
                            <h3 className="text-xl font-semibold mb-4">Latest Reviews</h3>
                            {latestArtistReviews.length === 0 ? (
                                <p className="text-gray-400">No recent reviews on other artists yet.</p>
                            ) : (
                                <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                                    {latestArtistReviews.map((review) => (
                                        <div key={`artist-review-${review.id}`} className="p-2 rounded-md border border-white/10 bg-white/5">
                                            <Link
                                                to={`/song/${review.song_id}`}
                                                className="text-sm text-gray-100 hover:text-primary-brand-300 hover:underline block truncate"
                                            >
                                                {review.song_title}
                                            </Link>
                                            <Link
                                                to={`/profile/${review.song_profile_id}`}
                                                className="text-xs text-gray-400 hover:text-primary-brand-300 hover:underline"
                                            >
                                                by {review.song_artist_name}
                                            </Link>
                                            <p className="text-xs text-gray-300 mt-2 line-clamp-3">
                                                {review.review || 'No written review content.'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {isBackgroundModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-zinc-900/95 border border-white/10 rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 text-gray-100">
                        <h3 className="text-xl font-bold mb-4">Choose a Background</h3>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            {backgroundOptions.map((option) => (
                                <div
                                    key={option.id}
                                    className={`w-16 h-16 rounded-md cursor-pointer border-2 ${
                                        formData.background === option.id ? 'border-primary-brand-400' : 'border-white/10'
                                    } hover:border-primary-brand transition-colors`}
                                    style={{ background: `var(--${option.class})` }}
                                    onClick={() => handleBackgroundSelect(option.id)}
                                    title={option.name}
                                >
                                    <div className={`${option.class} w-full h-full rounded-md`}></div>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsBackgroundModalOpen(false)}
                            className="w-full py-2 px-4 bg-white/10 text-white font-semibold rounded-md shadow-sm hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {isSendCoinModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-zinc-900/95 border border-white/10 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 text-gray-100">
                        <h3 className="text-xl font-bold mb-4">Send IDJ Coin to {profile.name}</h3>
                        {sendError && (
                            <p className="text-red-400 text-sm mb-4" dangerouslySetInnerHTML={{ __html: sendError }}></p>
                        )}
                        {sendSuccess && (
                            <p className="text-green-400 text-sm mb-4">{sendSuccess}</p>
                        )}
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-300">Amount (IDJ Coin)</label>
                            <input
                                type="number"
                                value={sendAmount}
                                onChange={handleSendAmountChange}
                                placeholder="Enter amount"
                                className="mt-1 block w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
                                min="0"
                                step="0.000000001"
                            />
                        </div>
                        <div className="flex space-x-4">
                            <button
                                onClick={handleSendCoin}
                                className="py-2 px-4 bg-purple-500 text-white font-semibold rounded-md shadow-sm hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                            >
                                Send
                            </button>
                            <button
                                onClick={() => {
                                    setIsSendCoinModalOpen(false);
                                    setSendAmount('');
                                    setSendError(null);
                                    setSendSuccess(null);
                                }}
                                className="py-2 px-4 bg-white/10 text-white font-semibold rounded-md shadow-sm hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-brand"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfilePage;