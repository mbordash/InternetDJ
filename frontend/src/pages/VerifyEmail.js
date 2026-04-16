import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import API_URL from '../utils/api';

function VerifyEmail() {
    const [searchParams] = useSearchParams();
    const [error, setError] = useState(null);

    useEffect(() => {
        const verificationToken = searchParams.get('token');

        if (!verificationToken) {
            setError('Invalid or missing verification token');
            return;
        }

        // Redirect to backend /auth/verify-email to handle verification and redirect
        window.location.href = `${API_URL}/auth/verify-email?token=${verificationToken}`;
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
                <h1 className="text-3xl font-bold text-gray-900 text-center mb-6">Verify Your Email</h1>
                {error && (
                    <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
                        {error}
                        <p className="mt-2">
                            Return to <Link to="/login" className="text-blue-600 hover:text-primary-brand-800 font-medium">Login</Link>
                        </p>
                    </div>
                )}
                {!error && (
                    <div className="text-center text-gray-700">
                        Verifying your email, please wait...
                    </div>
                )}
            </div>
        </div>
    );
}

export default VerifyEmail;