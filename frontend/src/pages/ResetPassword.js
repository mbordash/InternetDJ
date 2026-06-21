import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import API_URL from '../utils/api';

function ResetPassword() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    useEffect(() => {
        const token = searchParams.get('token');
        if (!token) {
            setError('Invalid or missing reset token');
        }
    }, [searchParams]);

    const handleResetPassword = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        const token = searchParams.get('token');
        if (!token) {
            setError('Invalid or missing reset token');
            return;
        }

        if (!password) {
            setError('Please enter a new password');
            return;
        }

        try {
            const response = await axios.post(`${API_URL}/auth/reset-password`, {
                token,
                password,
            });

            setSuccess(response.data.message);
            setPassword('');
            setTimeout(() => navigate('/login'), 3000); // Redirect after 3s
        } catch (err) {
            console.error('Reset password error:', err.response?.data?.error || err.message);
            const errorMessage = err.response?.data?.error || 'Failed to reset password';
            setError(errorMessage);
        }
    };

    return (
        <div className="min-h-screen text-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full spotify-surface p-8">
                <h1 className="text-3xl font-bold text-white text-center mb-6">Reset Password</h1>
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-400 text-red-300 rounded-md">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-400 text-emerald-300 rounded-md">
                        {success}
                    </div>
                )}

                <form onSubmit={handleResetPassword} className="space-y-6">
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                            New Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-primary-brand focus:border-primary-brand"
                            placeholder="Enter your new password"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full spotify-pill px-6 py-3 rounded-full transition-colors duration-200"
                    >
                        Reset Password
                    </button>
                </form>

                <div className="text-center mt-4">
                    <p className="text-sm text-gray-300">
                        Return to{' '}
                        <Link to="/login" className="text-primary-brand-300 hover:text-primary-brand-200 font-medium">
                            Login
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default ResetPassword;