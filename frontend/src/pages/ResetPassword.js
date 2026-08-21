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
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen text-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="retro-panel retro-cut max-w-md w-full p-8">
                <div className="retro-eyebrow text-center mb-3">&gt;&gt; Recovery</div>
                <h1 className="retro-display retro-chrome text-2xl text-center mb-6">Reset Password</h1>
                {error && (
                    <div className="mb-6 p-4 border border-fuchsia-500/60 bg-fuchsia-500/10 retro-mono text-lg text-fuchsia-200">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-6 p-4 border border-cyan-400/60 bg-cyan-400/10 retro-mono text-lg text-cyan-200">
                        {success}
                    </div>
                )}

                <form onSubmit={handleResetPassword} className="space-y-6">
                    <div>
                        <label htmlFor="password" className="retro-label">
                            New Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="retro-field mt-1"
                            placeholder="Enter your new password"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="retro-btn retro-btn--hot w-full px-6 py-3 text-xs"
                    >
                        Reset Password
                    </button>
                </form>

                <div className="text-center mt-4">
                    <p className="retro-mono text-lg text-gray-400">
                        Return to{' '}
                        <Link to="/login" className="retro-link">
                            Login
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default ResetPassword;