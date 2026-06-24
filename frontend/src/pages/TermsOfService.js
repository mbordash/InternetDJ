import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import SITE_URL from '../utils/site';

const LAST_UPDATED = 'June 24, 2026';

function TermsOfService() {
    const baseUrl = SITE_URL;

    return (
        <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>Terms of Service | InternetDJ</title>
                <meta name="description" content="InternetDJ Terms of Service - the rules and terms for using the platform." />
                <link rel="canonical" href={`${baseUrl}/terms`} />
                <meta property="og:title" content="Terms of Service | InternetDJ" />
                <meta property="og:description" content="The rules and terms for using InternetDJ." />
                <meta property="og:url" content={`${baseUrl}/terms`} />
                <meta property="og:site_name" content="InternetDJ" />
            </Helmet>

            <div className="container mx-auto px-4 py-10 max-w-4xl">
                <div className="bg-zinc-900/85 border border-white/10 rounded-lg shadow-lg p-8">
                    <h1 className="text-3xl font-bold mb-2 tracking-tight">Terms of Service</h1>
                    <p className="text-sm text-gray-400 mb-8">Last updated: {LAST_UPDATED}</p>

                    <p className="text-gray-300 mb-6">
                        These Terms of Service ("Terms") govern your access to and use of InternetDJ (the
                        "Service"). By creating an account or using the Service, you agree to these Terms. If
                        you do not agree, please do not use the Service.
                    </p>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">1. Eligibility & Accounts</h2>
                        <p className="text-gray-300">
                            You must be at least 13 years old to use the Service. You are responsible for
                            maintaining the confidentiality of your account credentials and for all activity
                            that occurs under your account. Notify us promptly of any unauthorized use.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">2. Your Content</h2>
                        <p className="text-gray-300 mb-3">
                            You retain ownership of the music, audio, images, and other content you upload or
                            create ("Your Content"). You represent that you have the rights necessary to upload
                            and share Your Content.
                        </p>
                        <p className="text-gray-300">
                            By publishing content publicly, you grant InternetDJ a limited, non-exclusive license
                            to host, store, display, and stream that content solely for the purpose of operating
                            and promoting the Service. We will not use Your Content to train AI models without
                            your consent.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">3. Acceptable Use</h2>
                        <p className="text-gray-300 mb-3">You agree not to:</p>
                        <ul className="list-disc list-inside text-gray-300 space-y-2">
                            <li>Upload content that infringes the intellectual property or other rights of any party.</li>
                            <li>Post unlawful, harmful, harassing, defamatory, or otherwise objectionable content.</li>
                            <li>Attempt to disrupt, attack, or gain unauthorized access to the Service or other accounts.</li>
                            <li>Use the Service to distribute spam, malware, or fraudulent material.</li>
                            <li>Misrepresent your identity or impersonate others.</li>
                        </ul>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">4. Intellectual Property</h2>
                        <p className="text-gray-300">
                            The Service, including its software, design, and branding, is owned by InternetDJ and
                            protected by applicable laws. Except for Your Content, you may not copy, modify, or
                            distribute any part of the Service without our permission.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">5. Copyright & DMCA</h2>
                        <p className="text-gray-300">
                            We respect intellectual property rights. If you believe content on the Service
                            infringes your copyright, contact us at{' '}
                            <a href="mailto:support@internetdj.co" className="text-primary-brand-400 hover:underline">support@internetdj.co</a>{' '}
                            with sufficient detail to identify the work and the allegedly infringing material. We
                            may remove infringing content and terminate repeat infringers.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">6. IDJ Coin</h2>
                        <p className="text-gray-300">
                            Any rewards or tokens offered through the Service, including IDJ Coin, are provided as
                            part of community features and are subject to additional rules. They are not financial
                            instruments and may change or be discontinued at our discretion.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">7. Termination</h2>
                        <p className="text-gray-300">
                            We may suspend or terminate your access to the Service at any time if you violate
                            these Terms or to protect the Service and its users. You may stop using the Service
                            and request account deletion at any time.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">8. Disclaimers</h2>
                        <p className="text-gray-300">
                            The Service is provided "as is" and "as available" without warranties of any kind,
                            whether express or implied. We do not warrant that the Service will be uninterrupted,
                            secure, or error-free.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">9. Limitation of Liability</h2>
                        <p className="text-gray-300">
                            To the maximum extent permitted by law, InternetDJ will not be liable for any
                            indirect, incidental, special, consequential, or punitive damages, or any loss of
                            data, profits, or revenue arising from your use of the Service.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">10. Changes to These Terms</h2>
                        <p className="text-gray-300">
                            We may update these Terms from time to time. We will revise the "Last updated" date
                            above, and your continued use of the Service after changes take effect constitutes
                            acceptance of the revised Terms.
                        </p>
                    </section>

                    <section className="mb-2">
                        <h2 className="text-xl font-bold mb-3 tracking-tight">11. Contact Us</h2>
                        <p className="text-gray-300">
                            Questions about these Terms? Contact us at{' '}
                            <a href="mailto:support@internetdj.co" className="text-primary-brand-400 hover:underline">support@internetdj.co</a>.
                        </p>
                    </section>

                    <div className="mt-8 pt-6 border-t border-white/10 text-sm text-gray-400">
                        See also our <Link to="/privacy" className="text-primary-brand-400 hover:underline">Privacy Policy</Link>.
                    </div>
                </div>
            </div>
        </div>
    );
}

export default TermsOfService;
