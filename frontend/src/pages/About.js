import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, MinusIcon } from '@heroicons/react/24/solid';
import StudioRackImage1 from '../assets/studio-rack-image-1.jpg';
import StudioRackImage2 from '../assets/studio-rack-image-2.jpg';
import StudioRackImage3 from '../assets/studio-rack-image-3.jpg';
import StudioRackImage4 from '../assets/studio-rack-image-4.jpg';
import {Helmet} from "react-helmet-async";
import sanitizeHtml from "sanitize-html";
import SITE_URL from '../utils/site';

function About() {
    const [isMinimized, setIsMinimized] = useState(false);
    const baseUrl = SITE_URL;
    const [randomBackgroundImage, setRandomBackgroundImage] = useState(null);

    const backgroundImages = [
        StudioRackImage1,
        StudioRackImage2,
        StudioRackImage3,
        StudioRackImage4,
    ];

    useEffect(() => {
        const randomIndex = Math.floor(Math.random() * backgroundImages.length);
        setRandomBackgroundImage(backgroundImages[randomIndex]);
    }, []);

    useEffect(() => {
        const isMinimizedStored = localStorage.getItem('internetDJWelcomeMinimized');
        if (isMinimizedStored === 'true') {
            setIsMinimized(true);
        }
    }, []);

    const handleToggleMinimize = () => {
        const newMinimizedState = !isMinimized;
        setIsMinimized(newMinimizedState);
        localStorage.setItem('internetDJWelcomeMinimized', newMinimizedState.toString());
    };

    return (
    <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>About InternetDJ</title>
                <meta
                    name="description"
                    content="Founded in 1997, InternetDJ emerged during the early days of the internet as a platform for independent artists to share their music without the barriers of traditional record labels."
                />
                <link rel="canonical" href={`${baseUrl}/about`} />
                <meta property="og:title" content="About InternetDJ" />
                <meta property="og:description" content="Founded in 1997, InternetDJ emerged during the early days of the internet as a platform for independent artists to share their music without the barriers of traditional record labels." />
                <meta property="og:url" content={`${baseUrl}/about`}/>
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="About InternetDJ" />
                <meta name="twitter:description" content="Founded in 1997, InternetDJ emerged during the early days of the internet as a platform for independent artists to share their music without the barriers of traditional record labels." />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div
                className="py-12"
                style={{
                    backgroundImage: randomBackgroundImage ? `url(${randomBackgroundImage})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            >
                <div className="container mx-auto px-4">
                    <div
                        className={`bg-zinc-900/85 border border-white/10 rounded-lg shadow-lg text-center relative ${isMinimized ? 'p-4' : 'p-8'}`}
                        style={{ opacity: 0.9 }}
                    >
                        <button
                            onClick={handleToggleMinimize}
                            className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
                            aria-label={isMinimized ? 'Expand welcome card' : 'Minimize welcome card'}
                        >
                            {isMinimized ? (
                                <PlusIcon className="w-6 h-6" />
                            ) : (
                                <MinusIcon className="w-6 h-6" />
                            )}
                        </button>
                        <h1 className="text-3xl font-bold mb-4 text-gray-800">About InternetDJ</h1>
                        {!isMinimized && (
                            <>
                                <p className="text-lg text-gray-600 mb-6">
                                    Since 1997, InternetDJ has been a pioneering platform empowering artists to create, collaborate, and share their music with the world. Our mission is to provide a creative space where musicians retain full ownership of their work—your music is never shared without your consent or used for AI training. With intuitive tools like drag-and-drop editing, Snap-to-Grid precision, live EQ adjustments, and AI-driven auto mastering, InternetDJ makes music production accessible to everyone, from beginners to professionals.
                                </p>
                                <p className="text-lg text-gray-600 mb-6">
                                    InternetDJ is more than just a music creation platform; it’s a vibrant community of artists, producers, and music lovers. Discover new tracks, collaborate with creators across the globe, and engage in our forums to share tips, feedback, and inspiration. Our decentralized rewards system, powered by IDJ Coin, ensures that artists are recognized for their contributions, fostering a fair and thriving ecosystem.
                                </p>
                                <p className="text-lg text-gray-600 mb-6">
                                    Over the years, we’ve grown into a trusted hub for independent musicians, offering features like real-time collaboration, advanced analytics to track your music’s reach, and seamless integration with social platforms to amplify your presence. Whether you’re crafting your first beat or mastering your next album, InternetDJ is here to support your creative journey.
                                </p>
                                <div className="flex justify-center space-x-4">
                                    <Link
                                        to="/browse"
                                        className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                                        aria-label="Explore music created by the InternetDJ community"
                                    >
                                        Explore Music
                                    </Link>
                                    <Link
                                        to="/projects"
                                        className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                                        aria-label="Start creating music with InternetDJ's tools"
                                    >
                                        Create Music
                                    </Link>
                                    <Link
                                        to="/idj-coin"
                                        className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                                        aria-label="Learn more about IDJ Coin"
                                    >
                                        Learn About IDJ Coin
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8">
                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Our History</h2>
                    <p className="text-gray-600 mb-4">
                        Founded in 1997, InternetDJ emerged during the early days of the internet as a platform for independent artists to share their music without the barriers of traditional record labels. Over the decades, we’ve evolved from a simple music-sharing site to a comprehensive creative suite, incorporating cutting-edge technology while staying true to our artist-first ethos.
                    </p>
                    <p className="text-gray-600 mb-4">
                        Key milestones include the launch of our drag-and-drop music editor in 2005, the introduction of AI-driven mastering in 2018, and the integration of IDJ Coin in 2023 to reward community contributions. Today, InternetDJ serves millions of users worldwide, from hobbyists to chart-topping producers.
                    </p>
                </section>

                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Our Values</h2>
                    <ul className="list-disc list-inside text-gray-600 space-y-2">
                        <li><strong>Artist Ownership:</strong> Your music is yours. We never claim rights or use your work without permission.</li>
                        <li><strong>Community-Driven:</strong> We believe in the power of collaboration and mutual support among creators.</li>
                        <li><strong>Innovation:</strong> We continuously improve our tools to make music creation intuitive and powerful.</li>
                        <li><strong>Transparency:</strong> Our decentralized rewards and open forums ensure fairness and accountability.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-2xl font-bold mb-4 font-semibold tracking-tight">Join Us</h2>
                    <p className="text-gray-600 mb-4">
                        Whether you’re an aspiring artist, a seasoned producer, or a music enthusiast, InternetDJ welcomes you. Start creating, connect with others, and be part of a global movement that celebrates creativity and independence.
                    </p>
                    <Link
                        to="/signup"
                        className="inline-block bg-primary-brand-500 text-white px-6 py-3 rounded-md hover:bg-primary-brand-700 transition-colors font-semibold"
                        aria-label="Sign up for InternetDJ"
                    >
                        Get Started
                    </Link>
                </section>
            </div>
        </div>
    );
}

export default About;