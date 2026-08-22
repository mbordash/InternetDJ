import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useContext, useEffect, useState, useRef } from 'react';
import API_URL from '../utils/api';
import { AuthContext } from '../context/AuthContext';
import Logo from './Logo';
import profilePath from '../utils/profilePath';

function Navbar() {
    // Auth lives in AuthContext. The navbar used to keep its own copy and fetch
    // /auth/me a second time, which meant logging out cleared the header but left
    // every page still rendering the signed-in view.
    const { user, setUser, sessionExpired, setSessionExpired } = useContext(AuthContext);
    const [isOpen, setIsOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();
    const location = useLocation();
    const dropdownRef = useRef(null);
    const createMenuRef = useRef(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (new URLSearchParams(location.search).get('sessionExpired') && token) {
            localStorage.removeItem('token');
            setUser(null);
        }
    }, [location, setUser]);

    // AuthContext detects the expired token; the navbar does the redirect,
    // since AuthProvider is mounted outside the Router.
    useEffect(() => {
        if (sessionExpired) {
            setSessionExpired(false);
            navigate('/login?sessionExpired=true');
        }
    }, [sessionExpired, setSessionExpired, navigate]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // The Create menu closes the same way the profile menu does, and on Escape
    // so it is dismissable without a mouse.
    useEffect(() => {
        const handleOutside = (event) => {
            if (createMenuRef.current && !createMenuRef.current.contains(event.target)) {
                setIsCreateOpen(false);
            }
        };
        const handleEscape = (event) => {
            if (event.key === 'Escape') setIsCreateOpen(false);
        };
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    // Never leave the menu hanging open across a navigation.
    useEffect(() => { setIsCreateOpen(false); }, [location.pathname]);

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null); // AuthContext, so every page re-renders as signed out

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

    // "Create" groups the two production tools. DAW is jargon to a newcomer;
    // the group name says what you go there to do, and collapsing two items
    // into one keeps the bar at four.
    const navItems = [
        { to: '/discover', label: 'Discover' },
        { to: '/browse', label: 'Browse' },
        {
            label: 'Create',
            children: [
                { to: '/projects', label: 'Studio / DAW' },
                { to: '/stems', label: 'AI Stems' },
            ],
        },
        { to: '/forum', label: 'Forum' },
    ];

    const isActive = (path) => location.pathname === path || location.pathname.startsWith(`${path}/`);

    // A group reads as current whenever you are inside any of its pages.
    const isGroupActive = (item) => (item.children || []).some((child) => isActive(child.to));

    const getNavLinkClass = (path) => `retro-navlink ${isActive(path) ? 'is-active' : ''}`;

    const SearchIcon = () => (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
    );

    const searchForm = (extraClass = '') => (
        <form onSubmit={handleSearch} className={`flex items-stretch ${extraClass}`}>
            <label htmlFor="idj-search" className="sr-only">Search songs or profiles</label>
            <input
                id="idj-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="search songs or profiles..."
                className="retro-input h-10 px-3 flex-1 w-full md:w-72"
            />
            <button
                type="submit"
                aria-label="Search"
                className="retro-btn retro-btn--hot h-10 px-4 shrink-0"
                style={{ clipPath: 'none' }}
            >
                <SearchIcon />
            </button>
        </form>
    );

    // Menu entries differ by auth state; rendered in both the desktop dropdown
    // and the mobile sheet so the two can't drift apart.
    const accountLinks = user
        ? [
            { to: profilePath(user), label: 'Profile' },
            { to: `${profilePath(user)}/songs-manager`, label: 'Songs Manager' },
            { to: '/playlists', label: 'Playlists' },
            { to: `${profilePath(user)}/collaborations`, label: 'Collabs' },
            { to: '/settings', label: 'Settings' },
        ]
        : [
            { to: '/register', label: 'Sign Up Free — Artists' },
            { to: '/discover', label: 'Browse as Listener' },
            { to: '/login', label: 'Login' },
        ];

    return (
        <nav className="retro-topbar fixed top-0 left-0 right-0 text-white z-30">
            <div className="container mx-auto px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <Link to="/" aria-label="InternetDJ home" className="flex items-center shrink-0">
                            {/* Switch the variant here to try another concept:
                                'disc' | 'crest' | 'tube' | 'tape' */}
                            <Logo variant="disc" mode="lockup" className="h-11 w-auto" />
                        </Link>

                        <div className="hidden md:flex items-center space-x-5">
                            {searchForm()}
                            {navItems.map((item) => (
                                item.children ? (
                                    <div key={item.label} className="relative" ref={createMenuRef}>
                                        <button
                                            type="button"
                                            onClick={() => setIsCreateOpen((open) => !open)}
                                            aria-expanded={isCreateOpen}
                                            aria-haspopup="true"
                                            className={`retro-navlink ${isGroupActive(item) ? 'is-active' : ''}`}
                                        >
                                            {item.label}
                                            <span aria-hidden="true" className="ml-1 text-[0.6em]">
                                                {isCreateOpen ? '\u25B2' : '\u25BC'}
                                            </span>
                                        </button>
                                        {isCreateOpen && (
                                            <div className="absolute left-0 top-full mt-2 w-44 retro-panel retro-cut p-2 z-50">
                                                {item.children.map((child) => (
                                                    <Link
                                                        key={child.to}
                                                        to={child.to}
                                                        onClick={() => setIsCreateOpen(false)}
                                                        className="retro-menu-item"
                                                    >
                                                        &gt; {child.label}
                                                    </Link>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <Link key={item.to} to={item.to} className={getNavLinkClass(item.to)}>
                                        {item.label}
                                    </Link>
                                )
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center">
                        <button
                            className="md:hidden retro-icon-btn p-2"
                            onClick={() => setIsOpen(!isOpen)}
                            aria-label="Toggle menu"
                            aria-expanded={isOpen}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
                            </svg>
                        </button>

                        <div className="hidden md:block relative" ref={dropdownRef}>
                            {user ? (
                                <button
                                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    className="flex items-center space-x-2 focus:outline-none group"
                                    aria-expanded={isDropdownOpen}
                                >
                                    {user.picture ? (
                                        <img
                                            src={user.picture}
                                            alt={user.name || 'User'}
                                            className="w-8 h-8 object-cover border border-cyan-400/50 group-hover:border-fuchsia-400 transition-colors"
                                            onError={(e) => {
                                                console.warn('Profile image failed to load:', user.picture);
                                                e.target.style.display = 'none';
                                                e.target.nextSibling.style.display = 'flex';
                                                e.target.onerror = null;
                                            }}
                                        />
                                    ) : null}
                                    <div
                                        className={`w-8 h-8 border border-cyan-400/50 bg-fuchsia-900/40 items-center justify-center retro-pixel text-[0.5rem] text-cyan-200 ${
                                            user.picture ? 'hidden' : 'flex'
                                        }`}
                                    >
                                        {getInitials(user.name)}
                                    </div>
                                    <span className="retro-mono text-xl text-cyan-200 group-hover:text-fuchsia-300 transition-colors">
                                        {user.name || 'User'}
                                    </span>
                                    <svg
                                        className={`w-4 h-4 text-fuchsia-400 transform transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
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
                                    className="retro-btn retro-btn--hot px-5 py-2 text-xs"
                                    aria-expanded={isDropdownOpen}
                                >
                                    Account
                                </button>
                            )}

                            {isDropdownOpen && (
                                <div className="retro-panel retro-cut absolute right-0 mt-3 w-60 py-2 z-10">
                                    <div className="retro-eyebrow px-3 pb-2">
                                        {user ? '// Your Deck //' : '// Get Started //'}
                                    </div>
                                    {accountLinks.map((item) => (
                                        <Link
                                            key={item.to + item.label}
                                            to={item.to}
                                            className="retro-menu-item"
                                            onClick={() => setIsDropdownOpen(false)}
                                        >
                                            &gt; {item.label}
                                        </Link>
                                    ))}
                                    {user ? (
                                        <button onClick={logout} className="retro-menu-item">
                                            &gt; Logout
                                        </button>
                                    ) : (
                                        <a
                                            href={`${API_URL}/auth/google`}
                                            className="retro-menu-item"
                                            onClick={() => setIsDropdownOpen(false)}
                                        >
                                            &gt; Google Login
                                        </a>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {isOpen && (
                    <div className="md:hidden mt-4 retro-panel retro-cut p-4 space-y-4">
                        {searchForm('w-full')}

                        <div>
                            <div className="retro-eyebrow mb-2">// Explore //</div>
                            {navItems.map((item) => (
                                item.children ? (
                                    // A nested dropdown inside a hamburger is a
                                    // tap too many, so the group flattens into a
                                    // labelled section instead.
                                    <div key={item.label} className="mt-2">
                                        <div className="retro-eyebrow mb-1 opacity-70">// {item.label} //</div>
                                        {item.children.map((child) => (
                                            <Link
                                                key={child.to}
                                                to={child.to}
                                                className="retro-menu-item pl-4"
                                                onClick={() => setIsOpen(false)}
                                            >
                                                &gt; {child.label}
                                            </Link>
                                        ))}
                                    </div>
                                ) : (
                                    <Link
                                        key={item.to}
                                        to={item.to}
                                        className="retro-menu-item"
                                        onClick={() => setIsOpen(false)}
                                    >
                                        &gt; {item.label}
                                    </Link>
                                )
                            ))}
                        </div>

                        <div>
                            <div className="retro-eyebrow mb-2">
                                {user ? '// Your Deck //' : '// Get Started //'}
                            </div>
                            {accountLinks.map((item) => (
                                <Link
                                    key={item.to + item.label}
                                    to={item.to}
                                    className="retro-menu-item"
                                    onClick={() => setIsOpen(false)}
                                >
                                    &gt; {item.label}
                                </Link>
                            ))}
                            {user ? (
                                <button onClick={logout} className="retro-menu-item">
                                    &gt; Logout
                                </button>
                            ) : (
                                <a
                                    href={`${API_URL}/auth/google`}
                                    className="retro-menu-item"
                                    onClick={() => setIsOpen(false)}
                                >
                                    &gt; Google Login
                                </a>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
}

export default Navbar;
