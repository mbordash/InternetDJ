import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import API_URL from '../utils/api';

function Badges() {
    const [badges, setBadges] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchBadges = async () => {
            const token = localStorage.getItem('token');
            if (!token) {
                setError('Please log in to view your badges');
                return;
            }

            try {
                const response = await axios.get(`${API_URL}/collabs/badges`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                setBadges(response.data.badges || []);
            } catch (err) {
                if (err.response) {
                    if (err.response.status === 400 || err.response.status === 401) {
                        setError('Invalid or expired session. Please log in again.');
                    } else if (err.response.status === 404) {
                        setError('Profile not found. Please complete your profile.');
                    } else {
                        setError(err.response.data.error || 'Failed to load badges');
                    }
                } else {
                    setError('Network error. Please try again later.');
                }
            }
        };
        fetchBadges();
    }, []);

    return (
        <div>
            {error && (
                <p className="text-red-400 mb-4">
                    {error}
                    {error.includes('log in') && (
                        <span>
                            {' '}
                            <Link to="/login" className="underline hover:text-red-600">
                                Log in
                            </Link>
                        </span>
                    )}
                </p>
            )}
            {badges.length === 0 && !error ? (
                <p className="text-gray-600">No badges yet. Start collaborating!</p>
            ) : (
                <ul className="space-y-2">
                    {badges.map((badge) => (
                        <li key={badge.name} className="flex items-center gap-2">
                            <span className="text-yellow-500">🏆</span>
                            <div>
                                <p className="text-sm font-medium text-black">{badge.name}</p>
                                <p className="text-xs text-gray-600">{badge.description}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default Badges;