import { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Helmet } from 'react-helmet-async';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { AuthContext } from '../context/AuthContext';

function Settings() {
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const baseUrl = SITE_URL;
    const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    useEffect(() => {
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
                setEmailNotificationsEnabled(response.data.email_notifications_enabled);
                setError(null);
            } catch (err) {
                console.error('Failed to load preferences:', err);
                setError('Failed to load notification preferences');
            } finally {
                setIsLoading(false);
            }
        };

        loadPreferences();
    }, [user, navigate]);

    const handleToggleEmailNotifications = async () => {
        try {
            const token = localStorage.getItem('token');
            const newValue = !emailNotificationsEnabled;

            await axios.patch(
                `${API_URL}/notifications/preferences`,
                { email_notifications_enabled: newValue },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setEmailNotificationsEnabled(newValue);
            setSuccess('Notification preference updated successfully');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Failed to update preferences:', err);
            setError('Failed to update notification preferences');
        }
    };

    return (
        <div className="text-gray-100 pt-2 min-h-screen">
            <Helmet>
                <title>Settings | InternetDJ</title>
                <meta name="description" content="Manage your InternetDJ preferences and notification settings." />
                <link rel="canonical" href={`${baseUrl}/settings`} />
            </Helmet>

            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <h1 className="text-3xl font-bold text-white mb-8 tracking-tight">Settings</h1>

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
                    <div className="spotify-surface border border-white/10 rounded-xl p-6">
                        <p className="text-gray-300">Loading preferences...</p>
                    </div>
                ) : (
                    <>
                        <section className="mb-8">
                            <div className="spotify-surface border border-white/10 rounded-xl p-6">
                                <h2 className="text-xl font-semibold text-white mb-6">Notifications</h2>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                                        <div className="flex-1">
                                            <h3 className="text-white font-medium mb-1">Email Notifications</h3>
                                            <p className="text-sm text-gray-400">
                                                Receive email updates when someone interacts with your content
                                                (likes, reviews, replies, follows, collaboration updates).
                                            </p>
                                        </div>

                                        <button
                                            onClick={handleToggleEmailNotifications}
                                            className={`ml-4 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                                                emailNotificationsEnabled
                                                    ? 'bg-primary-brand-500 text-white hover:bg-primary-brand-600'
                                                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                            }`}
                                        >
                                            {emailNotificationsEnabled ? 'Enabled' : 'Disabled'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section>
                            <div className="spotify-surface border border-white/10 rounded-xl p-6">
                                <h2 className="text-xl font-semibold text-white mb-4">About</h2>
                                <div className="space-y-2 text-sm text-gray-300">
                                    <p>InternetDJ — Create, share, and collaborate on music.</p>
                                    <p className="text-xs text-gray-500">
                                        All in-app notifications are always delivered. This setting only controls
                                        whether you receive emails for activity notifications.
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

