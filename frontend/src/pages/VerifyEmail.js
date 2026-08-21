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
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen text-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="retro-panel retro-cut max-w-md w-full p-8">
                <div className="retro-eyebrow text-center mb-3">&gt;&gt; Verification</div>
                <h1 className="retro-display retro-chrome text-2xl text-center mb-6">Verify Your Email</h1>
                {error && (
                    <div className="mb-6 p-4 border border-fuchsia-500/60 bg-fuchsia-500/10 retro-mono text-lg text-fuchsia-200">
                        {error}
                        <p className="mt-2">
                            Return to <Link to="/login" className="retro-link">Login</Link>
                        </p>
                    </div>
                )}
                {!error && (
                    <div className="retro-mono text-xl text-cyan-200 text-center">
                        Verifying your email, please wait...
                    </div>
                )}
            </div>
        </div>
    );
}

export default VerifyEmail;