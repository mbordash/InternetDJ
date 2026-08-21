import { useState, useContext, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';

function Register() {
    const navigate = useNavigate();
    const { setUser } = useContext(AuthContext);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [recaptchaToken, setRecaptchaToken] = useState(null);
    const recaptchaRef = useRef(null);

    const handleRegister = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!email || !password || !name) {
            setError('Please fill in all fields');
            return;
        }

        if (!recaptchaToken) {
            setError('Please complete the reCAPTCHA');
            return;
        }

        try {
            const response = await axios.post(`${API_URL}/auth/register`, {
                email,
                password,
                name,
                recaptchaToken,
            });

            setSuccess(response.data.message);
            setEmail('');
            setPassword('');
            setName('');
            setRecaptchaToken(null);
            if (recaptchaRef.current) {
                recaptchaRef.current.reset();
            }
        } catch (err) {
            console.error('Registration error:', err.response?.data?.error || err.message);
            let errorMessage = err.response?.data?.error || 'Failed to register';
            if (errorMessage === 'Email is already registered with Google authentication') {
                errorMessage = 'This email is registered with Google. Please log in with Google or use a different email.';
            }
            setError(errorMessage);
            if (recaptchaRef.current) {
                recaptchaRef.current.reset();
            }
            setRecaptchaToken(null);
        }
    };

    const handleRecaptchaChange = (token) => {
        setRecaptchaToken(token);
    };

    return (
        <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 min-h-screen text-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="retro-panel retro-cut max-w-md w-full p-8">
                <div className="retro-eyebrow text-center mb-3">&gt;&gt; New Operator</div>
                <h1 className="retro-display retro-chrome text-2xl text-center mb-6">Register for InternetDJ</h1>
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

                <form onSubmit={handleRegister} className="space-y-6">
                    <div>
                        <label htmlFor="name" className="retro-label">
                            Name
                        </label>
                        <input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="retro-field mt-1"
                            placeholder="Enter your name"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="email" className="retro-label">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="retro-field mt-1"
                            placeholder="Enter your email"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="retro-label">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="retro-field mt-1"
                            placeholder="Enter your password"
                            required
                        />
                    </div>
                    <div className="flex justify-center p-2 border border-cyan-400/25 bg-black/30">
                        <ReCAPTCHA
                            ref={recaptchaRef}
                            sitekey={process.env.REACT_APP_RECAPTCHA_SITE_KEY}
                            onChange={handleRecaptchaChange}
                        />
                    </div>
                    <button
                        type="submit"
                        className="retro-btn retro-btn--hot w-full px-6 py-3 text-xs"
                    >
                        Register
                    </button>
                </form>

                <div className="text-center mt-4">
                        <p className="retro-mono text-lg text-gray-400">
                        Already have an account?{' '}
                            <Link to="/login" className="retro-link">
                            Login
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Register;