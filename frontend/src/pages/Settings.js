import { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Helmet } from 'react-helmet-async';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { AuthContext } from '../context/AuthContext';

function Settings() {
    const { user, loading: authLoading } = useContext(AuthContext);
    const navigate = useNavigate();
    const baseUrl = SITE_URL;
    const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
    const [emailProfileActivityEnabled, setEmailProfileActivityEnabled] = useState(true);
    const [emailArtistActivityEnabled, setEmailArtistActivityEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    useEffect(() => {
        // AuthContext starts as { user: null, loading: true }, so redirecting on
        // a null user alone bounces signed-in people who land here directly.
        if (authLoading) return;
        if (!user) {
            navigate('/login');
            return;
        }

        const loadPreferences = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/notifications/preferences`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                    setEmailProfileActivityEnabled(response.data.email_profile_activity_enabled);
                    setEmailArtistActivityEnabled(response.data.email_artist_activity_enabled);
                setError(null);
            } catch (err) {
                console.error('Failed to load preferences:', err);
                setError('Failed to load notification preferences');
            } finally {
                setIsLoading(false);
            }
        };

        loadPreferences();
    }, [user, authLoading, navigate]);

    const handleToggleProfileActivity = async () => {
        try {
            const token = localStorage.getItem('token');
            const newValue = !emailProfileActivityEnabled;

            await axios.patch(
                `${API_URL}/notifications/preferences`,
                { email_profile_activity_enabled: newValue },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setEmailProfileActivityEnabled(newValue);
            setSuccess('Notification preference updated successfully');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Failed to update preferences:', err);
            setError('Failed to update notification preferences');
        }
    };

    const handleToggleArtistActivity = async () => {
        try {
            const token = localStorage.getItem('token');
            const newValue = !emailArtistActivityEnabled;

            await axios.patch(
                `${API_URL}/notifications/preferences`,
                { email_artist_activity_enabled: newValue },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setEmailArtistActivityEnabled(newValue);
            setSuccess('Notification preference updated successfully');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Failed to update preferences:', err);
            setError('Failed to update notification preferences');
        }
    };

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100 min-h-screen">
            <Helmet>
                <title>Settings | InternetDJ</title>
                <meta name="description" content="Manage your InternetDJ preferences and notification settings." />
                <link rel="canonical" href={`${baseUrl}/settings`} />
            </Helmet>

            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <header className="mb-8">
                    <div className="retro-eyebrow mb-3">// Control Panel //</div>
                    <h1 className="retro-display retro-chrome text-3xl sm:text-4xl">Settings</h1>
                    <div className="retro-rule mt-4" />
                </header>

                {error && (
                    <div className="mb-4 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="mb-4 p-4 rounded-lg bg-green-500/20 border border-green-500/50 text-green-300">
                        {success}
                    </div>
                )}

                {isLoading ? (
                    <div className="retro-panel retro-cut p-6">
                        <p className="retro-mono text-xl text-gray-300">Loading preferences...</p>
                    </div>
                ) : (
                    <>
                        <section className="mb-8">
                            <div className="retro-panel retro-cut p-6">
                                <h2 className="retro-display text-base retro-glow-cyan mb-6">Notifications</h2>

                                <div className="space-y-4">
                                    <div className="retro-card retro-cut flex items-center justify-between p-4">
                                        <div className="flex-1">
                                                            <h3 className="retro-display text-xs text-white mb-1">Profile Activity</h3>
                                            <p className="retro-mono text-lg text-gray-400">
                                                                Receive emails when someone likes, reviews, or replies to your content,
                                                                follows your profile, or updates a collaboration you own.
                                            </p>
                                        </div>

                                        <button
                                                            onClick={handleToggleProfileActivity}
                                                            className={`retro-btn ml-4 px-4 py-2 text-[0.6rem] whitespace-nowrap ${
                                                                emailProfileActivityEnabled
                                                    ? 'retro-btn--hot'
                                                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                            }`}
                                        >
                                                            {emailProfileActivityEnabled ? 'Enabled' : 'Disabled'}
                                        </button>
                                    </div>

                                                    <div className="retro-card retro-cut flex items-center justify-between p-4">
                                                        <div className="flex-1">
                                                            <h3 className="retro-display text-xs text-white mb-1">Artist Activity</h3>
                                                            <p className="retro-mono text-lg text-gray-400">
                                                                Receive emails when artists you follow upload new songs.
                                                            </p>
                                                        </div>

                                                        <button
                                                            onClick={handleToggleArtistActivity}
                                                            className={`retro-btn ml-4 px-4 py-2 text-[0.6rem] whitespace-nowrap ${
                                                                emailArtistActivityEnabled
                                                                    ? 'retro-btn--hot'
                                                                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                                            }`}
                                                        >
                                                            {emailArtistActivityEnabled ? 'Enabled' : 'Disabled'}
                                                        </button>
                                                    </div>
                                </div>
                            </div>
                        </section>

                        <section>
                            <div className="retro-panel retro-cut p-6">
                                <h2 className="retro-display text-base retro-glow-cyan mb-4">About</h2>
                                <div className="space-y-2 text-sm text-gray-300">
                                    <p className="retro-mono text-xl text-gray-300">InternetDJ &mdash; create, share, and collaborate on music.</p>
                                    <p className="retro-mono text-base text-gray-500">
                                            All in-app notifications are always delivered. These settings only control
                                            whether you receive emails for profile activity and artist activity notifications.
                                    </p>
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    );
}

export default Settings;

