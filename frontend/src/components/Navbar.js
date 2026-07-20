import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import IDJHeaderLogo from '../assets/internetdj-logo-header.png';

function Navbar() {
    const [user, setUser] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();
    const location = useLocation();
    const dropdownRef = useRef(null);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const urlParams = new URLSearchParams(location.search);
        const sessionExpired = urlParams.get('sessionExpired');

        if (sessionExpired && token) {
            localStorage.removeItem('token');
            setUser(null);
            return;
        }

        if (token) {
            axios
                .get(`${API_URL}/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                .then((res) => {
                    setUser(res.data);
                })
                .catch((err) => {
                    console.error('Error fetching user:', err);
                    if (err.response && err.response.status === 403) {
                        localStorage.removeItem('token');
                        setUser(null);
                        navigate('/login?sessionExpired=true');
                    }
                });
        }
    }, [navigate, location]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
        navigate('/');
        setIsDropdownOpen(false);
        setIsOpen(false);
    };

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
            setSearchQuery('');
            setIsOpen(false);
        }
    };

    const getInitials = (name) => {
        if (!name) return '?';
        const names = name.trim().split(' ');
        const initials = names.length > 1
            ? names[0][0] + names[names.length - 1][0]
            : names[0][0];
        return initials.toUpperCase();
    };

    const navItems = [
        { to: '/discover', label: 'Discover' },
        { to: '/browse', label: 'Browse' },
        { to: '/projects', label: 'DAW' },
        { to: '/stems', label: 'AI Stems' },
        { to: '/forum', label: 'Forum' },
    ];

    const isActive = (path) => location.pathname === path || location.pathname.startsWith(`${path}/`);

    const getNavLinkClass = (path) => (
        `text-sm font-medium px-3 py-2 rounded-full transition-colors ${
            isActive(path)
                ? 'bg-white/10 text-white'
                : 'text-gray-300 hover:text-white hover:bg-white/5'
        }`
    );

    return (
        <nav className="fixed top-0 left-0 right-0 bg-black/85 backdrop-blur-md border-b border-white/10 text-white shadow-lg z-30">
            <div className="container mx-auto px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <Link to="/" className="flex items-center space-x-0">
                            <img
                                src={IDJHeaderLogo}
                                alt="Internet DJ Logo"
                                className="h-20 w-auto absolute top-1 z-20 object-contain"
                            />
                        </Link>

                        <div className="w-20 md:w-20"></div>

                        <div className="hidden md:flex items-center space-x-3">
                            <form onSubmit={handleSearch} className="flex items-center">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search songs or profiles..."
                                    className="h-10 bg-white/10 text-white px-3 rounded-l-full border border-white/10 border-r-0 focus:outline-none focus:ring-2 focus:ring-primary-brand-400 w-64 md:w-72 placeholder:text-gray-300"
                                />
                                <button
                                    type="submit"
                                    className="h-10 spotify-pill px-4 rounded-r-full transition-colors inline-flex items-center justify-center"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </button>
                            </form>
                            {navItems.map((item) => (
                                <Link key={item.to} to={item.to} className={getNavLinkClass(item.to)}>
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center">
                        <button
                            className="md:hidden focus:outline-none"
                            onClick={() => setIsOpen(!isOpen)}
                            aria-label="Toggle menu"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
                            </svg>
                        </button>

                        <div className="hidden md:block relative" ref={dropdownRef}>
                            {user ? (
                                <button
                                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    className="flex items-center space-x-2 focus:outline-none"
                                >
                                    {user.picture ? (
                                        <img
                                            src={user.picture}
                                            alt={user.name || 'User'}
                                            className="w-8 h-8 rounded-full object-cover"
                                            onError={(e) => {
                                                console.warn('Profile image failed to load:', user.picture);
                                                e.target.style.display = 'none';
                                                e.target.nextSibling.style.display = 'flex';
                                                e.target.onerror = null;
                                            }}
                                        />
                                    ) : null}
                                    <div
                                        className={`w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-semibold ${
                                            user.picture ? 'hidden' : 'flex'
                                        }`}
                                    >
                                        {getInitials(user.name)}
                                    </div>
                                    <span className="text-gray-200 text-sm">{user.name || 'User'}</span>
                                    <svg
                                        className={`w-4 h-4 text-gray-300 transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                            ) : (
                                <button
                                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    className="spotify-pill px-4 py-2 rounded-full transition-colors"
                                >
                                    Account
                                </button>
                            )}

                            {isDropdownOpen && (
                                <div className="absolute right-0 mt-2 w-52 bg-zinc-900 border border-white/10 rounded-xl shadow-lg py-1 z-10">
                                    {user ? (
                                        <>
                                            <Link
                                                to={`/profile/${user.profile_id || user.id}`}
                                                className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Profile
                                            </Link>
                                            <Link
                                                to={`/profile/${user.profile_id || user.id}/songs-manager`}
                                                className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Songs Manager
                                            </Link>
                                            <Link
                                                to="/playlists"
                                                className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Playlists
                                            </Link>
                                            <Link
                                                to={`/profile/${user.profile_id || user.id}/collaborations`}
                                                className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Collabs
                                            </Link>
                                            <Link
                                                to="/settings"
                                                className="block px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Settings
                                            </Link>
                                            <button
                                                onClick={logout}
                                                className="block w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
                                            >
                                                Logout
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <Link
                                                to="/register"
                                                className="block px-4 py-3 text-sm font-medium text-white hover:bg-primary-brand-500/20"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Sign Up Free — Artists
                                            </Link>
                                            <Link
                                                to="/discover"
                                                className="block px-4 py-3 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Browse as Listener
                                            </Link>
                                            <Link
                                                to="/login"
                                                className="block px-4 py-3 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Login
                                            </Link>
                                            <a
                                                href={`${API_URL}/auth/google`}
                                                className="block px-4 py-3 text-sm text-gray-200 hover:bg-white/10"
                                                onClick={() => setIsDropdownOpen(false)}
                                            >
                                                Google Login
                                            </a>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {isOpen && (
                    <div className="md:hidden mt-4 pb-4 bg-black/70 border border-white/10 rounded-xl p-3">
                        {/* Mobile menu - add sign up links similarly if needed */}
                        <form onSubmit={handleSearch} className="mb-4 flex items-center">
                            {/* search */}
                        </form>
                        {/* your original mobile links */}
                    </div>
                )}
            </div>
        </nav>
    );
}

export default Navbar;