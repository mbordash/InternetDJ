import React, { useEffect, useState, useContext, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import { AudioPlayerContext } from '../context/AudioPlayerContext';
import { SpeakerWaveIcon, PlayIcon, PauseIcon, HeartIcon as HeartIconSolid } from '@heroicons/react/24/solid';
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
        donation_link: '',
        solana_address: '',
    });
    const [isFollowing, setIsFollowing] = useState(false);
    const [followerCount, setFollowerCount] = useState(0);
    const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);
    const [isSendCoinModalOpen, setIsSendCoinModalOpen] = useState(false);
    const [sendAmount, setSendAmount] = useState('');
    const [sendError, setSendError] = useState(null);
    const [sendSuccess, setSendSuccess] = useState(null);
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
                setProfile(response.data.profile);
                setSongs(response.data.songs || []);
                setFormData({
                    name: response.data.profile.name || '',
                    genre: response.data.profile.genre || '',
                    description: response.data.profile.description || '',
                    picture: null,
                    background: response.data.profile.background && !response.data.profile.background.startsWith('http') ? response.data.profile.background : '',
                    backgroundImage: null,
                    donation_link: response.data.profile.donation_link || '',
                    solana_address: response.data.profile.solana_address || '',
                });

                console.log('Profile background:', response.data.profile.background);

                const followerResponse = await axios.get(`${API_URL}/profile/${profileId}/follower-count`);
                setFollowerCount(followerResponse.data.follower_count || 0);

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
                donation_link: response.data.profile.donation_link || '',
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

    const isOwner = user && profile && user.id === profile.user_id;

    if (error === 'Profile not found') {
        if (isOwner) {
            return (
                <div className="container mx-auto px-4 py-8 max-w-2xl bg-white text-gray-800 pt-20">
                    <h1 className="text-3xl font-bold mb-4">Your Profile</h1>
                    <p className="mb-6">Your profile has not been created yet. Create it below:</p>
                    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow-md">
                        <div>
                            <label className="block text-sm font-medium">Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleInputChange}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Genre</label>
                            <input
                                type="text"
                                name="genre"
                                value={formData.genre}
                                onChange={handleInputChange}
                                required
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Description</label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleInputChange}
                                rows="4"
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Donation Link (e.g., PayPal, Patreon)</label>
                            <input
                                type="url"
                                name="donation_link"
                                value={formData.donation_link}
                                onChange={handleInputChange}
                                placeholder="https://www.paypal.me/username"
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Solana Address (Optional)</label>
                            <input
                                type="text"
                                name="solana_address"
                                value={formData.solana_address}
                                onChange={handleInputChange}
                                placeholder="Enter your Solana wallet address"
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                            />
                            <p className="mt-1 text-sm text-gray-500">
                                Your Solana address is used to receive IDJ Coin grants and donations for your contributions to InternetDJ.{' '}
                                <a
                                    href="https://phantom.app/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                >
                                    Get one with Phantom
                                </a>
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Profile Picture</label>
                            <input
                                type="file"
                                name="picture"
                                onChange={handleFileChange}
                                accept="image/*"
                                className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-800 hover:file:bg-gray-200"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Background</label>
                            <button
                                type="button"
                                onClick={() => setIsBackgroundModalOpen(true)}
                                className="mt-1 w-full py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                            >
                                Choose Background
                            </button>
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Upload Custom Background</label>
                            <input
                                type="file"
                                name="backgroundImage"
                                onChange={handleFileChange}
                                accept="image/*"
                                ref={backgroundImageInputRef}
                                className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-800 hover:file:bg-gray-200"
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
                <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800 pt-20">
                    <p className="text-lg">This user has not created a profile yet.</p>
                </div>
            );
        }
    }

    if (error && !isOwner) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800 pt-20">
                <p className="text-red-500 text-lg">{error}</p>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800 pt-20">
                <p className="text-lg">Loading...</p>
            </div>
        );
    }

    const backgroundStyle = profile.background
        ? profile.background.startsWith('http')
            ? { backgroundImage: `url(${profile.background})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#f0f0f0' }
            : profile.background
        : 'bg-default';

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
            <div className="relative container mx-auto px-4 py-8 max-w-4xl text-gray-800 z-0 pt-20">
                <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md mb-8">
                    <div className="flex items-center space-x-6">
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
                            <p className="text-lg">Followers: {followerCount}</p>
                            <Link to="/idj-coin" className="text-lg text-blue-600 hover:underline">
                                IDJC Earned: {profile.total_idjc_earned || 0}
                            </Link>
                            {profile.description && (
                                <div
                                    className="mt-2 text-gray-600"
                                    dangerouslySetInnerHTML={{ __html: processDescription(profile.description) }}
                                />
                            )}
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
                                <label className="block text-sm font-medium">Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Genre</label>
                                <input
                                    type="text"
                                    name="genre"
                                    value={formData.genre}
                                    onChange={handleInputChange}
                                    required
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Description</label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    rows="4"
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Donation Link (e.g., PayPal, Patreon)</label>
                                <input
                                    type="url"
                                    name="donation_link"
                                    value={formData.donation_link}
                                    onChange={handleInputChange}
                                    placeholder="https://www.paypal.me/username"
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Solana Address (Optional)</label>
                                <input
                                    type="text"
                                    name="solana_address"
                                    value={formData.solana_address}
                                    onChange={handleInputChange}
                                    placeholder="Enter your Solana wallet address"
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                />
                                <p className="mt-1 text-sm text-gray-500">
                                    Your Solana address is used to receive IDJ Coin grants and donations for your contributions to InternetDJ.{' '}
                                    <a
                                        href="https://phantom.app/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline"
                                    >
                                        Get one with Phantom
                                    </a>
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Profile Picture</label>
                                <input
                                    type="file"
                                    name="picture"
                                    onChange={handleFileChange}
                                    accept="image/*"
                                    className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-800 hover:file:bg-gray-200"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Background</label>
                                <button
                                    type="button"
                                    onClick={() => setIsBackgroundModalOpen(true)}
                                    className="mt-1 w-full py-2 px-4 bg-gray-100 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                                >
                                    Choose Background
                                </button>
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Upload Custom Background</label>
                                <input
                                    type="file"
                                    name="backgroundImage"
                                    onChange={handleFileChange}
                                    accept="image/*"
                                    ref={backgroundImageInputRef}
                                    className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 file:text-gray-800 hover:file:bg-gray-200"
                                />
                            </div>
                            <div>
                                <button
                                    type="button"
                                    onClick={handleRemoveBackground}
                                    className="py-2 px-4 bg-red-500 text-white font-semibold rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                >
                                    Remove Background
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

                <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold mb-4">Songs</h2>
                    {songs.length === 0 ? (
                        <p>No songs found for this profile.</p>
                    ) : (
                        <div className="space-y-6">
                            {songs.map((song) => (
                                <div
                                    key={song.id}
                                    className="flex items-start space-x-4 p-4 bg-gray-50 rounded-md shadow-sm"
                                >
                                    <div className="relative w-32 h-32 flex-shrink-0">
                                        {song.image_url ? (
                                            <Link to={`/song/${song.id}`}>
                                                <img
                                                    src={song.image_url}
                                                    alt={song.title}
                                                    className="w-32 h-32 rounded-md object-cover"
                                                    onError={(e) => console.error('Song image failed to load:', song.image_url)}
                                                />
                                            </Link>
                                        ) : (
                                            <div className="w-32 h-32 rounded-md bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
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
                                            className="text-lg font-semibold text-black hover:underline"
                                        >
                                            {song.title}
                                        </Link>
                                        <div className="text-sm text-gray-600 flex items-center gap-x-2">
                                            {song.genre && <span>{song.genre}</span>}
                                            {song.genre && <span> | </span>}
                                            <span className="inline-flex items-center">
                                                {Number(song.plays) || 0}
                                                <SpeakerWaveIcon
                                                    className={`w-4 h-4 ml-1 ${Number(song.plays) > 0 ? 'text-black' : 'text-gray-500'}`}
                                                />
                                            </span>
                                            <span> | </span>
                                            <span className="inline-flex items-center">
                                                {Number(song.likes_count) || 0}
                                                <HeartIconSolid
                                                    className={`w-4 h-4 ml-1 ${Number(song.likes_count) > 0 ? 'text-red-600' : 'text-gray-500'}`}
                                                />
                                            </span>
                                        </div>
                                        {song.description && (
                                            <p className="text-sm text-gray-600 mt-1">{song.description}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {isBackgroundModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
                        <h3 className="text-xl font-bold mb-4">Choose a Background</h3>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            {backgroundOptions.map((option) => (
                                <div
                                    key={option.id}
                                    className={`w-16 h-16 rounded-md cursor-pointer border-2 ${
                                        formData.background === option.id ? 'border-blue-600' : 'border-gray-300'
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
                            className="w-full py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {isSendCoinModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                        <h3 className="text-xl font-bold mb-4">Send IDJ Coin to {profile.name}</h3>
                        {sendError && (
                            <p className="text-red-500 text-sm mb-4" dangerouslySetInnerHTML={{ __html: sendError }}></p>
                        )}
                        {sendSuccess && (
                            <p className="text-green-500 text-sm mb-4">{sendSuccess}</p>
                        )}
                        <div className="mb-4">
                            <label className="block text-sm font-medium">Amount (IDJ Coin)</label>
                            <input
                                type="number"
                                value={sendAmount}
                                onChange={handleSendAmountChange}
                                placeholder="Enter amount"
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-brand focus:border-primary-brand sm:text-sm"
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
                                className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
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