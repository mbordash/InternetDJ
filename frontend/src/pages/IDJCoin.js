import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import IDJCoinLogo from '../assets/idj-coin.png';
import axios from 'axios';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { getDefaultAvatar } from '../utils/defaultAvatar';
import {Helmet} from "react-helmet-async";
import { AuthContext } from '../context/AuthContext';

const IDJ_COIN_MINT = 'DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN';
const RAYDIUM_SWAP_URL = `https://raydium.io/swap/?inputMint=sol&outputMint=${IDJ_COIN_MINT}&referrer=HjSJR8xGc1NbB3eULRUYC5EjZL6UpRJqBrtqFmhz8hi9`;

function IDJCoin() {
    const [topEarners, setTopEarners] = useState([]);
    const [claimStatus, setClaimStatus] = useState('idle');
    const [claimMessage, setClaimMessage] = useState('');
    const [claimSignature, setClaimSignature] = useState('');
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, loading } = useContext(AuthContext);
    const autoClaimHandledRef = useRef(false);
    const baseUrl = SITE_URL;

    const claimAmount = 1000;
    const claimCampaignText = 'For a limited time, claim 1,000 IDJC tokens to help grow InternetDJ.';

    const getAuthHeaders = () => {
        const token = localStorage.getItem('token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const clearClaimIntent = () => {
        if (!searchParams.get('claim')) {
            return;
        }

        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('claim');
        setSearchParams(nextParams, { replace: true });
    };

    const fetchClaimStatus = async () => {
        if (!user) {
            setClaimStatus('unauthenticated');
            return;
        }

        try {
            const response = await axios.get(`${API_URL}/idjc/claim/status`, {
                headers: getAuthHeaders(),
            });

            const data = response.data || {};

            if (data.needsWallet) {
                setClaimStatus('needs_wallet');
                return;
            }

            if (data.status === 'completed') {
                setClaimStatus('claimed');
                setClaimSignature(data.transactionSignature || '');
                return;
            }

            setClaimStatus(data.canClaim ? 'available' : 'idle');
        } catch (err) {
            console.error('Fetch claim status error:', err);
            setClaimStatus('error');
        }
    };

    const handleClaim = async ({ clearIntent = false } = {}) => {
        if (loading || claimStatus === 'processing') {
            return;
        }

        if (!user) {
            const returnPath = '/idj-coin?claim=1';
            navigate(`/login?return=${encodeURIComponent(returnPath)}`);
            return;
        }

        setClaimStatus('processing');
        setClaimMessage('Sending IDJC to your Solana wallet...');

        try {
            const response = await axios.post(
                `${API_URL}/idjc/claim`,
                {},
                { headers: getAuthHeaders() }
            );

            setClaimStatus('claimed');
            setClaimMessage(response.data?.message || `Successfully claimed ${claimAmount.toLocaleString()} IDJC.`);
            setClaimSignature(response.data?.transactionSignature || '');
        } catch (err) {
            const apiError = err.response?.data?.error || 'Unable to claim IDJC right now.';

            if (err.response?.status === 409 && /already claimed/i.test(apiError)) {
                setClaimStatus('claimed');
                setClaimMessage('You already claimed this limited-time IDJC reward.');
            } else if (err.response?.status === 400 && /solana|wallet/i.test(apiError)) {
                setClaimStatus('needs_wallet');
                setClaimMessage(apiError);
            } else {
                setClaimStatus('available');
                setClaimMessage(apiError);
            }
        } finally {
            if (clearIntent) {
                clearClaimIntent();
            }
        }
    };

    useEffect(() => {
        const fetchTopEarners = async () => {
            try {
                const response = await axios.get(`${API_URL}/profile/top-earners`);
                setTopEarners(response.data || []);
            } catch (err) {
                console.error('Fetch top earners error:', err);
            }
        };

        fetchTopEarners();
    }, []);

    useEffect(() => {
        if (loading) {
            return;
        }

        fetchClaimStatus();
    }, [loading, user]);

    useEffect(() => {
        if (loading || !user || claimStatus === 'processing') {
            return;
        }

        const wantsClaim = searchParams.get('claim') === '1';
        if (!wantsClaim || autoClaimHandledRef.current) {
            return;
        }

        autoClaimHandledRef.current = true;
        handleClaim({ clearIntent: true });
    }, [loading, user, claimStatus, searchParams]);

    return (
        <div className="bg-white text-gray-800 pt-16 min-h-screen">
            <Helmet>
                <title>IDJ Solana Coin - Earn</title>
                <meta
                    name="description"
                    content="Earn Solana IDJ Coin for your music"
                />
                <link rel="canonical" href={`${baseUrl}/idj-coin`} />
                <meta property="og:title" content="IDJ Solana Coin - Earn<" />
                <meta property="og:description" content="Earn Solana IDJ Coin for your music" />
                <meta property="og:url" content={`${baseUrl}/idj-coin`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="IDJ Solana Coin - Earn<" />
                <meta name="twitter:description" content="Earn Solana IDJ Coin for your music" />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div className="container mx-auto px-4 py-8 flex gap-8">
                {/* Main Content - Left Column */}
                <div className="w-3/4">
                    <section className="mb-12">
                        <div className="flex items-start space-x-6">
                            <img
                                src={IDJCoinLogo}
                                alt="IDJ Coin"
                                className="w-64 h-64 flex-shrink-0"
                                onError={(e) => {
                                    console.error('Failed to load IDJ Coin logo');
                                    e.target.style.display = 'none';
                                }}
                            />
                            <div className="flex-1">
                                <h1 className="text-3xl font-bold mb-6 text-gray-800">IDJ Coin - Liquidity & Allocation</h1>
                                <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Overview</h2>
                                <p className="text-gray-600 mb-4">
                                    IDJ Coin (symbol: iDJc) is the backbone of the InternetDJ ecosystem, enabling decentralized rewards, community growth, and platform sustainability. By buying and holding IDJ Coin, you directly support musicians on InternetDJ, helping fund artist grants, platform development, and creative initiatives. With a total initial supply of 1 billion coins, IDJ Coin is strategically allocated to support founders, liquidity, ownership, and future development.
                                </p>
                                <a
                                    href={RAYDIUM_SWAP_URL}
                                    className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Trade IDJ Coin on Raydium
                                </a>
                                <p className="text-sm text-gray-600 mt-3">
                                    Mint Address: <span className="font-mono break-all">{IDJ_COIN_MINT}</span>
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="mb-12 bg-gradient-to-r from-indigo-50 to-cyan-50 border border-indigo-100 rounded-lg p-6">
                        <h2 className="text-2xl font-bold mb-3 font-semibold tracking-tight">Limited-Time IDJC Claim</h2>
                        <p className="text-gray-700 mb-2">
                            {claimCampaignText}
                        </p>
                        <p className="text-gray-700 mb-4">
                            You can use IDJC and send some to your favorite artists on internetdj.co, or keep it in your wallet as an investment in InternetDJ&apos;s future.
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => handleClaim()}
                                disabled={claimStatus === 'processing' || claimStatus === 'claimed'}
                                className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {claimStatus === 'processing'
                                    ? 'Processing Claim...'
                                    : claimStatus === 'claimed'
                                        ? `Claimed ${claimAmount.toLocaleString()} IDJC`
                                        : `Claim ${claimAmount.toLocaleString()} IDJC`}
                            </button>
                            {claimStatus === 'needs_wallet' && user?.profile_id && (
                                <Link
                                    to={`/profile/${user.profile_id}`}
                                    className="inline-block bg-white text-primary-brand-700 border border-primary-brand-300 px-6 py-3 rounded-md hover:bg-gray-50 transition-colors font-semibold"
                                >
                                    Add Solana Wallet in Profile
                                </Link>
                            )}
                            {!user && (
                                <button
                                    type="button"
                                    onClick={() => navigate(`/login?return=${encodeURIComponent('/idj-coin?claim=1')}`)}
                                    className="inline-block bg-white text-primary-brand-700 border border-primary-brand-300 px-6 py-3 rounded-md hover:bg-gray-50 transition-colors font-semibold"
                                >
                                    Login to Claim
                                </button>
                            )}
                        </div>
                        {claimMessage && (
                            <p className="text-sm text-gray-700 mt-3">{claimMessage}</p>
                        )}
                        {claimSignature && (
                            <p className="text-xs text-gray-500 mt-2 break-all">
                                Transaction Signature: {claimSignature}
                            </p>
                        )}
                    </section>

                    <section className="mb-12">
                        <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Token Allocation</h2>
                        <ul className="list-disc list-inside text-gray-600 space-y-2">
                            <li>
                                <strong>Founders Grant (200M coins):</strong> 20 initial InternetDJ members each receive 10,000,000 coins, vested monthly over time to align with long-term commitment.
                            </li>
                            <li>
                                <strong>Liquidity Pool (100M coins):</strong> A liquidity pool on Raydium (Pool ID: 51xpfGT4T5xhe6qabFf7NQtkpaqJM3nnsF9Lr1NDvHwm) ensures market stability and accessibility.
                            </li>
                            <li>
                                <strong>Ownership Allocation (100M coins):</strong> Allocated to the founder’s family to support legacy leadership and vision.
                            </li>
                            <li>
                                <strong>Locked Reserve (500M coins):</strong> Locked for one year with monthly vesting to fund future initiatives and ensure long-term growth. New contributing members who actively participate in the InternetDJ ecosystem may be eligible for future grants from this allocation, fostering community-driven development.
                            </li>
                            <li>
                                <strong>R&D and Site Expenses (100M coins):</strong> Reserved for research, development, and operational costs to enhance the InternetDJ platform.
                            </li>
                        </ul>
                    </section>

                    <section className="mb-12">
                        <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">How IDJC Earnings Work</h2>
                        <ul className="list-disc list-inside text-gray-600 space-y-2">
                            <li><strong>Listen-based rewards:</strong> Artists earn from counted song listens.</li>
                            <li><strong>Daily formula:</strong> 1 IDJC per 10 listens, calculated per profile each day.</li>
                            <li><strong>Daily cap:</strong> Maximum 10 IDJC can be earned per day.</li>
                            <li><strong>Payout tracking:</strong> Earnings accrue in your profile and admins can record IDJC payouts as they are sent.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Get Involved</h2>
                        <p className="text-gray-600 mb-4">
                            Join the InternetDJ community to learn more about IDJ Coin and how it powers our ecosystem. Explore our platform or join our Discord for details.
                        </p>
                        <div className="flex space-x-4">
                            <Link
                                to="/browse"
                                className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                            >
                                Explore Music
                            </Link>
                            <a
                                href="https://discord.gg/AbebAd3yS8"
                                className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Join Discord
                            </a>
                        </div>
                    </section>
                </div>

                {/* Right Column: Top 10 Profile Earners */}
                <div className="w-1/4 bg-white bg-opacity-90 p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold mb-4">Top 10 Earners</h2>
                    {topEarners.length === 0 ? (
                        <p>No top earners found.</p>
                    ) : (
                        <div className="space-y-4">
                            {topEarners.map((earner) => (
                                <Link key={earner.id} to={`/profile/${earner.id}`} className="block">
                                    <div className="flex items-center space-x-4 p-2 bg-gray-50 rounded-md shadow-sm hover:bg-gray-100">
                                        <img
                                            src={earner.picture_url || getDefaultAvatar(earner.id || earner.name)}
                                            alt={earner.name}
                                            className="w-12 h-12 rounded-full object-cover"
                                            onError={(e) => {
                                                e.currentTarget.src = getDefaultAvatar(earner.id || earner.name);
                                            }}
                                        />
                                        <div>
                                            <p className="font-semibold">{earner.name}</p>
                                            <p className="text-sm text-gray-600">{earner.total_earned} IDJC Earned</p>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default IDJCoin;