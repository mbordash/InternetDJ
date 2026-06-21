import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';

const InviteAccept = () => {
    const { token } = useParams(); // Get invite token from URL
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const location = useLocation();
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const acceptInvitation = async () => {
            const authToken = localStorage.getItem('token');
            if (!authToken) {
                // Redirect to login with return URL
                navigate(`/login?return=${encodeURIComponent(location.pathname)}`);
                return;
            }

            if (!user) {
                // Wait for user to load or redirect if unauthenticated
                return;
            }

            try {
                setLoading(true);
                const response = await axios.post(
                    `${API_URL}/collabs/invite/${token}`,
                    {},
                    {
                        headers: { Authorization: `Bearer ${authToken}` }
                    }
                );
                console.log('Invitation acceptance response:', response.data);
                setSuccess(true);
                // Redirect to collaborations page after 2 seconds
                setTimeout(() => {
                    navigate(`/profile/${user.profile_id}/collaborations`);
                }, 2000);
            } catch (err) {
                console.error('Invitation acceptance error:', err.response || err);
                setError(`Failed to accept invitation: ${err.response?.data?.error || err.message}`);
            } finally {
                setLoading(false);
            }
        };

        acceptInvitation();
    }, [user, token, navigate, location.pathname]);

    return (
        <div className="container mx-auto px-4 py-8 text-center text-gray-100 pt-2">
            {loading && <p>Processing invitation...</p>}
            {error && <p className="text-red-500">{error}</p>}
            {success && <p className="text-green-500">Invitation accepted! Redirecting to your collaborations...</p>}
        </div>
    );
};

export default InviteAccept;