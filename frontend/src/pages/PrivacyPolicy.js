import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import SITE_URL from '../utils/site';

const LAST_UPDATED = 'June 24, 2026';

function PrivacyPolicy() {
    const baseUrl = SITE_URL;

    return (
        <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>Privacy Policy | InternetDJ</title>
                <meta name="description" content="InternetDJ Privacy Policy - how we collect, use, and protect your information." />
                <link rel="canonical" href={`${baseUrl}/privacy`} />
                <meta property="og:title" content="Privacy Policy | InternetDJ" />
                <meta property="og:description" content="How InternetDJ collects, uses, and protects your information." />
                <meta property="og:url" content={`${baseUrl}/privacy`} />
                <meta property="og:site_name" content="InternetDJ" />
            </Helmet>

            <div className="container mx-auto px-4 py-10 max-w-4xl">
                <div className="bg-zinc-900/85 border border-white/10 rounded-lg shadow-lg p-8">
                    <h1 className="text-3xl font-bold mb-2 tracking-tight">Privacy Policy</h1>
                    <p className="text-sm text-gray-400 mb-8">Last updated: {LAST_UPDATED}</p>

                    <p className="text-gray-300 mb-6">
                        InternetDJ ("InternetDJ", "we", "us", or "our") respects your privacy. This Privacy
                        Policy explains what information we collect, how we use it, and the choices you have.
                        By using InternetDJ (the "Service") you agree to the practices described here.
                    </p>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">1. Information We Collect</h2>
                        <ul className="list-disc list-inside text-gray-300 space-y-2">
                            <li><strong>Account information:</strong> such as your username, email address, and password (stored in hashed form).</li>
                            <li><strong>Content you create:</strong> music, audio, images, project files, comments, reviews, and forum posts you upload or publish.</li>
                            <li><strong>Profile information:</strong> display name, bio, avatar, and other details you choose to add.</li>
                            <li><strong>Usage data:</strong> log data such as IP address, browser type, pages visited, and play counts.</li>
                            <li><strong>Cookies and similar technologies:</strong> used to keep you signed in and to understand how the Service is used.</li>
                        </ul>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">2. How We Use Information</h2>
                        <ul className="list-disc list-inside text-gray-300 space-y-2">
                            <li>To provide, operate, and maintain the Service.</li>
                            <li>To authenticate you and keep your account secure.</li>
                            <li>To display your public profile, music, and contributions to other users.</li>
                            <li>To communicate with you about your account, updates, and support requests.</li>
                            <li>To analyze usage so we can improve features and performance.</li>
                        </ul>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">3. Your Content & Ownership</h2>
                        <p className="text-gray-300">
                            You retain ownership of the music and content you create. We do not sell your
                            content, and we do not use your work to train AI models without your consent.
                            Content you mark as public may be displayed to and shared by other users.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">4. How We Share Information</h2>
                        <p className="text-gray-300 mb-3">
                            We do not sell your personal information. We may share information only:
                        </p>
                        <ul className="list-disc list-inside text-gray-300 space-y-2">
                            <li>With service providers who help us operate the Service (e.g., hosting, storage, email), under appropriate confidentiality obligations.</li>
                            <li>When you choose to make content public or share it via social platforms.</li>
                            <li>If required by law, or to protect the rights, safety, and security of InternetDJ and its users.</li>
                        </ul>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">5. Cookies</h2>
                        <p className="text-gray-300">
                            We use cookies and similar technologies to keep you logged in and to understand
                            usage. You can control cookies through your browser settings, though some features
                            may not function properly if cookies are disabled.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">6. Data Security</h2>
                        <p className="text-gray-300">
                            We use reasonable technical and organizational measures to protect your information,
                            including hashing passwords. However, no method of transmission or storage is
                            completely secure, and we cannot guarantee absolute security.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">7. Your Rights & Choices</h2>
                        <p className="text-gray-300">
                            You may access and update your profile information at any time in your account
                            settings. You may request deletion of your account by contacting us. Depending on
                            your location, you may have additional rights regarding your personal data.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">8. Children's Privacy</h2>
                        <p className="text-gray-300">
                            The Service is not directed to children under 13, and we do not knowingly collect
                            personal information from children under 13.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">9. Changes to This Policy</h2>
                        <p className="text-gray-300">
                            We may update this Privacy Policy from time to time. We will revise the "Last
                            updated" date above, and significant changes may be communicated through the Service.
                        </p>
                    </section>

                    <section className="mb-2">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">10. Contact Us</h2>
                        <p className="text-gray-300">
                            If you have questions about this Privacy Policy, contact us at{' '}
                            <a href="mailto:support@internetdj.co" className="text-primary-brand-400 hover:underline">support@internetdj.co</a>.
                        </p>
                    </section>

                    <div className="mt-8 pt-6 border-t border-white/10 text-sm text-gray-400">
                        See also our <Link to="/terms" className="text-primary-brand-400 hover:underline">Terms of Service</Link>.
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PrivacyPolicy;
