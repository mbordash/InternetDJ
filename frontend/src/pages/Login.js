import { useEffect, useContext, useState, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';

function Login() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { setUser } = useContext(AuthContext);
    const [error, setError] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [recaptchaToken, setRecaptchaToken] = useState(null);
    const recaptchaRef = useRef(null);

    // Get return URL from query params, default to homepage
    const returnUrl = searchParams.get('return') || '/';

    useEffect(() => {
        const token = searchParams.get('token');
        const authError = searchParams.get('error');
        const sessionExpired = searchParams.get('sessionExpired');

        console.log('Login token:', token);
        console.log('Login error:', authError);
        console.log('Session expired:', sessionExpired);

        if (authError) {
            if (authError === 'email_linked_to_different_google') {
                setError('This email is linked to a different Google account. Please use email login or a different Google account.');
            } else if (authError === 'invalid_verification_token') {
                setError('Invalid or expired email verification link. Please register again.');
            } else if (authError === 'server_error') {
                setError('An error occurred. Please try again.');
            } else if (authError === 'relink_email_sent') {
                setError('A confirmation email has been sent to re-link your Google account. Please check your email.');
            } else {
                setError('Google authentication failed: ' + authError);
            }
            return;
        }

        if (sessionExpired) {
            setError('Your session has expired. Please log in again.');
            return;
        }

        if (token) {
            localStorage.setItem('token', token);
            axios
                .get(`${API_URL}/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                .then((response) => {
                    console.log('Login user:', response.data);
                    setUser(response.data);
                    navigate(returnUrl); // Redirect to returnUrl
                })
                .catch((err) => {
                    console.error('Error fetching user:', err.response?.status, err.message);
                    setError('Failed to fetch user data');
                    localStorage.removeItem('token');
                    navigate('/login');
                });
        }
    }, [searchParams, navigate, setUser, returnUrl]);

    const handleEmailLogin = async (e) => {
        e.preventDefault();
        setError(null);

        if (!email || !password) {
            setError('Please enter both email and password');
            return;
        }

        if (!recaptchaToken) {
            setError('Please complete the reCAPTCHA');
            return;
        }

        try {
            const response = await axios.post(`${API_URL}/auth/login`, {
                email,
                password,
                recaptchaToken,
                return: returnUrl, // Pass returnUrl to backend
            });

            const { token, return: responseReturnUrl } = response.data;
            localStorage.setItem('token', token);
            const userResponse = await axios.get(`${API_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            setUser(userResponse.data);
            // Use return URL from response if present, otherwise fall back to query param
            navigate(responseReturnUrl || returnUrl);
        } catch (err) {
            console.error('Login error:', err.response?.data?.error || err.message);
            let errorMessage = err.response?.data?.error || 'Failed to log in';
            if (errorMessage === 'This account uses Google authentication') {
                errorMessage = 'This account is registered with Google. Please use Google login.';
            } else if (errorMessage === 'Please verify your email before logging in') {
                errorMessage = 'Please verify your email. Check your inbox for a verification link.';
            } else if (errorMessage === 'reCAPTCHA verification failed') {
                errorMessage = 'reCAPTCHA verification failed. Please try again.';
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

    // Update Google login URL to include returnUrl
    const googleLoginUrl = `${API_URL}/auth/google?return=${encodeURIComponent(returnUrl)}`;

    return (
        <div className="min-h-screen text-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full spotify-surface p-8">
                <h1 className="text-3xl font-bold text-white text-center mb-6">Login to InternetDJ</h1>
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-400 text-red-300 rounded-md">
                        {error}
                    </div>
                )}

                <form onSubmit={handleEmailLogin} className="space-y-6 mb-4">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-300">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1 w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-primary-brand focus:border-primary-brand"
                            placeholder="Enter your email"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 w-full px-3 py-2 border border-white/10 rounded-md shadow-sm bg-white/5 text-white focus:outline-none focus:ring-primary-brand focus:border-primary-brand"
                            placeholder="Enter your password"
                            required
                        />
                    </div>
                    <div className="flex justify-center">
                        <ReCAPTCHA
                            ref={recaptchaRef}
                            sitekey={process.env.REACT_APP_RECAPTCHA_SITE_KEY}
                            onChange={handleRecaptchaChange}
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-primary-brand-500 hover:bg-primary-brand-700 text-white font-medium px-6 py-3 rounded-md transition-colors duration-200"
                    >
                        Login with Email
                    </button>
                </form>

                <div className="text-center mb-4">
                    <Link to="/forgot-password" className="text-sm text-primary-brand-300 hover:text-primary-brand-200 font-medium">
                        Forgot Password?
                    </Link>
                </div>

                <a
                    href={googleLoginUrl}
                    className="flex items-center justify-center w-full bg-primary-brand-500 hover:bg-primary-brand-700 text-white font-medium px-6 py-3 rounded-md transition-colors duration-200 mb-4"
                >
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.24 10.667H7.937v2.666h4.303c-.41 1.143-1.594 2.666-4.303 2.666-2.59 0-4.698-2.143-4.698-4.666s2.108-4.666 4.698-4.666c1.174 0 2.23.477 2.986 1.238l1.91-1.905C10.97 4.095 8.74 3 6.24 3 2.798 3 0 5.762 0 9.167s2.798 6.167 6.24 6.167c3.6 0 5.986-2.524 5.986-6.095 0-.41-.046-.81-.126-1.238z" />
                        <path d="M24 12.333c0-.714-.064-1.429-.19-2.143H12.24v4.286h6.678c-.286 1.524-1.143 2.81-2.43 3.667v3.048h3.937c2.303-2.095 3.555-5.19 3.555-8.858z" />
                    </svg>
                    Login with Google
                </a>

                <div className="text-center">
                        <p className="text-sm text-gray-300">
                        Don't have an account?{' '}
                            <Link to="/register" className="text-primary-brand-300 hover:text-primary-brand-200 font-medium">
                            Register
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Login;