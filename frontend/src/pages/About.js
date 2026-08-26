import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import StudioRackImage1 from '../assets/studio-rack-image-1.jpg';
import StudioRackImage2 from '../assets/studio-rack-image-2.jpg';
import StudioRackImage3 from '../assets/studio-rack-image-3.jpg';
import StudioRackImage4 from '../assets/studio-rack-image-4.jpg';
import SITE_URL from '../utils/site';

/* Hoisted: the array is only read by the mount effect, so rebuilding it on
   every render just gives the dependency linter something to complain about. */
const BACKGROUND_IMAGES = [
    StudioRackImage1,
    StudioRackImage2,
    StudioRackImage3,
    StudioRackImage4,
];

const DESCRIPTION = 'Founded in 1997, InternetDJ emerged during the early days of the internet as a platform for independent artists to share their music without the barriers of traditional record labels.';

/* Eyebrow, glowing title, laser rule — the same section heading the home page
   uses. Repeating its shape here is what makes About read as part of the site
   rather than a leftover page with its own ideas. */
const SectionHeader = ({ eyebrow, title }) => (
    <div className="mb-5">
        <div className="retro-eyebrow mb-2">{eyebrow}</div>
        <h2 className="retro-display text-xl sm:text-2xl retro-glow-magenta">{title}</h2>
        <div className="retro-rule mt-3" />
    </div>
);

/* List rows used to be `list-disc list-inside text-gray-600`: default browser
   bullets in the default typeface, in a grey that sits near-invisible on the
   near-black ground. The marker is a pixel-font `>>` instead — Press Start 2P
   only covers basic ASCII, so decorative glyphs would silently fall back to a
   different face. */
const Bullet = ({ children }) => (
    <li className="flex gap-3">
        <span className="retro-eyebrow shrink-0 mt-2" aria-hidden="true">&gt;&gt;</span>
        <span className="retro-mono text-xl text-gray-300">{children}</span>
    </li>
);

function About() {
    const [randomBackgroundImage, setRandomBackgroundImage] = useState(null);
    const baseUrl = SITE_URL;

    useEffect(() => {
        const randomIndex = Math.floor(Math.random() * BACKGROUND_IMAGES.length);
        setRandomBackgroundImage(BACKGROUND_IMAGES[randomIndex]);
    }, []);

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>About InternetDJ</title>
                <meta name="description" content={DESCRIPTION} />
                <link rel="canonical" href={`${baseUrl}/about`} />
                <meta property="og:title" content="About InternetDJ" />
                <meta property="og:description" content={DESCRIPTION} />
                <meta property="og:url" content={`${baseUrl}/about`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="About InternetDJ" />
                <meta name="twitter:description" content={DESCRIPTION} />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            {/* ==================== MASTHEAD ====================
                The studio photo used to sit behind a translucent zinc card with
                rounded corners, which read as a modal dropped onto a wallpaper.
                Here the photo is full-bleed and treated as texture: a heavy
                scrim, scanlines and the horizon grid over it, with the type
                sitting directly on the image the way a flyer would print it.

                Kept deliberately short. The horizon grid is sized as a share of
                its section, so a masthead tall enough to hold three paragraphs
                drags perspective lines and the sun straight through the body
                copy. The prose lives in its own panel below instead. */}
            <section className="relative overflow-hidden retro-scanlines">
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: randomBackgroundImage ? `url(${randomBackgroundImage})` : 'none' }}
                    aria-hidden="true"
                />
                {/* Without a scrim this heavy, the chrome headline loses its
                    edges against a busy rack of gear and the whole thing turns
                    to mush. The photo is atmosphere, not the subject. */}
                <div
                    className="absolute inset-0 bg-gradient-to-b from-[#0a0418]/90 via-[#12042c]/80 to-[#0a0418]"
                    aria-hidden="true"
                />
                {/* Horizon only, no retro-sun: the sun is positioned as a
                    share of its section's height, so in a masthead this short
                    it lands squarely behind the eyebrow. The photo already
                    carries the focal texture. */}
                <div className="retro-horizon" aria-hidden="true" />

                <div className="relative container mx-auto px-4 py-16 md:py-24 text-center">
                    <div className="retro-eyebrow mb-5">
                        * EST. 1997 * ARTIST-OWNED SINCE DAY ONE *
                    </div>

                    <h1 className="retro-display retro-chrome text-4xl sm:text-5xl md:text-6xl leading-[1.05] mb-6">
                        About InternetDJ
                    </h1>

                    <p className="retro-mono text-2xl md:text-3xl text-cyan-200 max-w-3xl mx-auto mb-10">
                        Create &#9642; Collaborate &#9642; Keep what&rsquo;s yours
                    </p>

                    <div className="flex flex-col sm:flex-row flex-wrap gap-4 justify-center">
                        <Link
                            to="/browse"
                            className="retro-btn retro-btn--hot px-8 py-4 text-sm"
                            aria-label="Explore music created by the InternetDJ community"
                        >
                            Explore Music
                        </Link>
                        <Link
                            to="/projects"
                            className="retro-btn px-8 py-4 text-sm"
                            aria-label="Start creating music with InternetDJ's tools"
                        >
                            Create Music
                        </Link>
                        <Link
                            to="/idj-coin"
                            className="retro-btn px-8 py-4 text-sm"
                            aria-label="Learn more about IDJ Coin"
                        >
                            Learn About IDJ Coin
                        </Link>
                    </div>
                </div>
            </section>

            {/* Capped for line length: the container alone runs body copy to
                about 140 characters a line on a wide display, which is well
                past comfortable reading. Retro skin, modern bones. */}
            {/* Two columns from lg up. The single column left most of a wide
                display empty, and the fine print is long enough that a reader
                loses sight of what the page was asking them to do.

                The sidebar comes first in the DOM so the desktop grid needs no
                order overrides, and so that on a phone — where this all
                collapses to one column — what the site stands for and the way
                in land directly under the masthead, ahead of the policy text
                rather than buried below it. */}
            <div className="container mx-auto max-w-6xl px-4 py-12">
                <div className="grid gap-12 lg:grid-cols-3">
                    {/* Not sticky. A sticky rail sounds right for a column
                        beside long fine print, but this one is taller than the
                        viewport, so pinning it stranded Join Us and its call to
                        action permanently below the fold with no way to scroll
                        to them. self-start still stops the column stretching to
                        the row height. */}
                    <aside className="lg:col-span-1 lg:self-start space-y-12">
                    <section>
                        <SectionHeader eyebrow="// What We Stand For //" title="Our Values" />
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                            {[
                                ['Artist Ownership', 'Your music is yours. We never claim rights or use your work without permission.'],
                                ['Community-Driven', 'We believe in the power of collaboration and mutual support among creators.'],
                                ['Innovation', 'We continuously improve our tools to make music creation intuitive and powerful.'],
                                ['Transparency', 'Our decentralized rewards and open forums ensure fairness and accountability.'],
                            ].map(([label, copy]) => (
                                <div key={label} className="retro-card retro-cut p-5">
                                    <h3 className="retro-display text-base retro-glow-cyan mb-2">{label}</h3>
                                    <p className="retro-mono text-xl text-gray-300">{copy}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <SectionHeader eyebrow="// Pull Up a Deck //" title="Join Us" />
                        <div className="retro-panel retro-cut p-6">
                            <p className="retro-mono text-xl text-gray-300 mb-6">
                                Whether you&rsquo;re an aspiring artist, a seasoned producer, or a music enthusiast, InternetDJ welcomes you. Start creating, connect with others, and be part of a global movement that celebrates creativity and independence.
                            </p>
                            {/* This pointed at /signup, which is not a route — the
                                page's primary call to action rendered a blank
                                screen. The registration route is /register. */}
                            <Link
                                to="/register"
                                className="retro-btn retro-btn--hot px-8 py-4 text-sm"
                                aria-label="Sign up for InternetDJ"
                            >
                                Get Started
                            </Link>
                        </div>
                    </section>
                    </aside>

                    <div className="lg:col-span-2 space-y-14">
                    <section>
                        <SectionHeader eyebrow="// Why We're Here //" title="Our Mission" />
                        <div className="retro-panel retro-cut p-6 space-y-4">
                            <p className="retro-mono text-xl text-gray-300">
                                Since 1997, InternetDJ has been a pioneering platform empowering artists to create, collaborate, and share their music with the world. Our mission is to provide a creative space where musicians retain full ownership of their work&mdash;your music is never shared without your consent or used for AI training. With intuitive tools like drag-and-drop editing, Snap-to-Grid precision, live EQ adjustments, and AI-driven auto mastering, InternetDJ makes music production accessible to everyone, from beginners to professionals.
                            </p>
                            <p className="retro-mono text-xl text-gray-300">
                                InternetDJ is more than just a music creation platform; it&rsquo;s a vibrant community of artists, producers, and music lovers. Discover new tracks, collaborate with creators across the globe, and engage in our forums to share tips, feedback, and inspiration. Our decentralized rewards system, powered by IDJ Coin, ensures that artists are recognized for their contributions, fostering a fair and thriving ecosystem.
                            </p>
                            <p className="retro-mono text-xl text-gray-300">
                                Over the years, we&rsquo;ve grown into a trusted hub for independent musicians, offering features like real-time collaboration, advanced analytics to track your music&rsquo;s reach, and seamless integration with social platforms to amplify your presence. Whether you&rsquo;re crafting your first beat or mastering your next album, InternetDJ is here to support your creative journey.
                            </p>
                        </div>
                    </section>

                    <section>
                        <SectionHeader eyebrow="// The Long Version //" title="Our History" />
                        <div className="retro-panel retro-cut p-6 space-y-4">
                            <p className="retro-mono text-xl text-gray-300">
                                Founded in 1997, InternetDJ emerged during the early days of the internet as a platform for independent artists to share their music without the barriers of traditional record labels. Over the decades, we&rsquo;ve evolved from a simple music-sharing site to a comprehensive creative suite, incorporating cutting-edge technology while staying true to our artist-first ethos.
                            </p>
                            <p className="retro-mono text-xl text-gray-300">
                                Key milestones include the launch of our drag-and-drop music editor in 2005, the introduction of AI-driven mastering in 2018, and the integration of IDJ Coin in 2023 to reward community contributions. Today, InternetDJ is a working community of independent producers &mdash; hobbyists and veterans alike, including many who were here in the dial-up days and have come back.
                            </p>
                        </div>
                    </section>

                    <section>
                        <SectionHeader eyebrow="// Fine Print //" title="Legal" />
                        <p className="retro-mono text-xl text-gray-300 mb-4">
                            Review the policies that govern your use of InternetDJ:
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <Link to="/privacy" className="retro-chip" aria-label="Read the InternetDJ Privacy Policy">
                                Privacy Policy
                            </Link>
                            <Link to="/terms" className="retro-chip" aria-label="Read the InternetDJ Terms of Service">
                                Terms of Service
                            </Link>
                        </div>
                    </section>

                    {/* The AGPL's section 13 requires that anyone interacting with this
                        service over a network be offered its source, so this link is a
                        licence obligation rather than a nicety — it needs to stay
                        reachable, and it needs to point at the running version. */}
                    <section>
                        <SectionHeader eyebrow="// Free Software //" title="Open Source" />
                        <div className="retro-panel retro-cut p-6 space-y-4">
                            <p className="retro-mono text-xl text-gray-300">
                                InternetDJ is free software, licensed under the{' '}
                                <a
                                    href="https://www.gnu.org/licenses/agpl-3.0.html"
                                    target="_blank"
                                    rel="noopener noreferrer license"
                                    className="retro-link underline"
                                    aria-label="Read the GNU Affero General Public License version 3"
                                >
                                    GNU Affero General Public License v3
                                </a>
                                . You are free to read it, run it, change it and share it. If you
                                run a modified version as a public service, the licence asks that
                                you offer your users its source in turn.
                            </p>
                            <p className="retro-mono text-xl text-gray-300">
                                The complete source for this site lives at{' '}
                                <a
                                    href="https://github.com/mbordash/InternetDJ"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="retro-link underline"
                                    aria-label="Browse the InternetDJ source code on GitHub"
                                >
                                    github.com/mbordash/InternetDJ
                                </a>
                                .
                            </p>
                        </div>
                    </section>

                    <section>
                        <SectionHeader eyebrow="// Your Work Stays Yours //" title="Copyright &amp; Music Ownership" />
                        <p className="retro-mono text-xl text-gray-300">
                            InternetDJ does not claim ownership of any music uploaded to our platform. All music, recordings, compositions, and related content remain the exclusive property of their respective rights holders. InternetDJ serves solely as a hosting and distribution platform and holds no rights, licenses, or claims over any uploaded content beyond what is strictly necessary to operate the service.
                        </p>
                    </section>

                    <section>
                        <SectionHeader eyebrow="// Takedowns //" title="DMCA &amp; Copyright Infringement" />
                        <p className="retro-mono text-xl text-gray-300 mb-5">
                            InternetDJ respects intellectual property rights and complies with the Digital Millennium Copyright Act (DMCA). If you believe that content hosted on InternetDJ infringes your copyright, please send a written notification containing the following information to our designated DMCA agent:
                        </p>
                        <ul className="space-y-3 mb-6">
                            <Bullet>A description of the copyrighted work you claim has been infringed.</Bullet>
                            <Bullet>The URL or other specific location on InternetDJ where the allegedly infringing material is located.</Bullet>
                            <Bullet>Your contact information (name, address, phone number, and email address).</Bullet>
                            <Bullet>A statement that you have a good faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</Bullet>
                            <Bullet>A statement made under penalty of perjury that the information in your notification is accurate and that you are the copyright owner or authorized to act on the copyright owner&rsquo;s behalf.</Bullet>
                            <Bullet>Your physical or electronic signature.</Bullet>
                        </ul>
                        <p className="retro-mono text-xl text-gray-300">
                            Send DMCA notices to:{' '}
                            <a
                                href="mailto:internetdjco@gmail.com"
                                className="retro-link underline"
                                aria-label="Email InternetDJ DMCA agent"
                            >
                                internetdjco@gmail.com
                            </a>
                        </p>
                    </section>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default About;
