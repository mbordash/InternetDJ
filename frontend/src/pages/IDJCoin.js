import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import IDJCoinLogo from '../assets/idj-coin.png';
import axios from 'axios';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import {Helmet} from "react-helmet-async";

function IDJCoin() {
    const [topEarners, setTopEarners] = useState([]);
    const baseUrl = SITE_URL;

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
                                    href="https://raydium.io/swap/?inputMint=sol&outputMint=DTLkUR3Sfp1LcPVZMSv8toTTK3iwU7WTdF66TawwJpKN&referrer=HjSJR8xGc1NbB3eULRUYC5EjZL6UpRJqBrtqFmhz8hi9"
                                    className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Trade IDJ Coin on Raydium
                                </a>
                            </div>
                        </div>
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
                        <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Liquidity Strategy</h2>
                        <p className="text-gray-600 mb-4">
                            Our liquidity strategy focuses on stability and accessibility. The initial 100M coin liquidity pool on Raydium provides a robust foundation for trading, while the 500M locked reserve ensures controlled release to prevent market flooding. Monthly vesting for founders and locked reserves aligns incentives with the platform’s long-term success.
                        </p>
                        <p className="text-gray-600">
                            The remaining 100M coins for R&D and site expenses are managed transparently to fund platform upgrades, community initiatives, and operational costs, ensuring InternetDJ remains a cutting-edge platform for artists.
                        </p>
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
                            {topEarners.map((earner, index) => (
                                <Link key={earner.id} to={`/profile/${earner.id}`} className="block">
                                    <div className="flex items-center space-x-4 p-2 bg-gray-50 rounded-md shadow-sm hover:bg-gray-100">
                                        <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                                            {earner.picture_url ? (
                                                <img src={earner.picture_url} alt={earner.name} className="w-12 h-12 rounded-full object-cover" />
                                            ) : (
                                                <span className="text-xl">{index + 1}</span>
                                            )}
                                        </div>
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