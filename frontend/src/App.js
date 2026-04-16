import React from 'react';
import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useParams, useNavigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AudioPlayerProvider } from './context/AudioPlayerContext';
import { HelmetProvider, Helmet } from 'react-helmet-async'; // Add Helmet import
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import IDJCoin from './pages/IDJCoin';
import Browse from './pages/Browse';
import New from './pages/New';
import TagSongs from './pages/TagSongs';
import Search from './pages/Search';
import Forum from './pages/Forum';
import Post from './pages/Post';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import ConfirmGoogleRelink from './pages/ConfirmGoogleRelink';
import Profile from './pages/Profile';
import Song from './pages/Song';
import SongsManager from './pages/SongsManager';
import CollaborationsManager from './components/CollaborationsManager';
import InviteAccept from './components/InviteAccept';
import Projects from './pages/Projects';
import MultitrackSampler from './pages/MultitrackSampler';
import PublicMultiTrackSampler from './pages/PublicMultiTrackSampler';
import Playlists from './pages/Playlists';
import About from './pages/About';
import Discover from './pages/Discover';
import StemGenerator from './pages/AIStems';
import axios from 'axios';
import API_URL from './utils/api';
import './styles.css';
import './styles/backgrounds.css';
import './styles/audioPlayer.css';
import './styles/react-select.css';
import { Link } from 'react-router-dom';

// Updated Layout component
function Layout() {
    const location = useLocation();

    return (
        <div className="flex flex-col min-h-screen bg-white text-black">
            <Navbar />
            <main className="flex-grow bg-transparent">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/about" element={<About />} />
                    <Route path="/discover" element={<Discover />} />
                    <Route path="/browse" element={<Browse />} />
                    <Route path="/new" element={<New />} />
                    <Route path="/tag/:tag" element={<TagSongs />} />
                    <Route path="/search" element={<Search />} />
                    <Route path="/forum" element={<Forum />} />
                    <Route path="/forum/post/:postId" element={<Post />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    <Route path="/confirm-google-relink" element={<ConfirmGoogleRelink />} />
                    <Route path="/profile/:profileId" element={<Profile />} />
                    <Route path="/profile/:profileId/songs-manager" element={<SongsManager />} />
                    <Route path="/song/:songId" element={<Song />} />
                    <Route path="/profile/:profileId/collaborations" element={<CollaborationsManager />} />
                    <Route path="/collabs/invite/:token" element={<InviteAccept />} />
                    <Route path="/projects" element={<Projects />} />
                    <Route path="/projects/:projectId" element={<MultitrackSampler />} />
                    <Route path="/public/:projectId" element={<PublicMultiTrackSampler />} />
                    <Route path="/playlists" element={<Playlists />} />
                    <Route path="/idj-coin" element={<IDJCoin />} />
                    <Route path="/stems" element={<StemGenerator />} />
                </Routes>
            </main>
            <Footer />
        </div>
    );
}

class ErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error: error.message };
    }
    render() {
        if (this.state.error) {
            return (
                <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800">
                    <p className="text-red-400 text-lg">Error: {this.state.error}</p>
                </div>
            );
        }
        return this.props.children;
    }
}

function App() {
    return (
        <HelmetProvider> {/* Add HelmetProvider */}
            <Helmet>
                {/* Google tag (gtag.js) */}
                <script async src="https://www.googletagmanager.com/gtag/js?id=AW-17577069012" />
                <script>
                    {`
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());

                        gtag('config', 'AW-17577069012');
                    `}
                </script>
            </Helmet>
            <AuthProvider>
                <AudioPlayerProvider>
                    <Router>
                        <ErrorBoundary>
                            <Layout />
                        </ErrorBoundary>
                    </Router>
                </AudioPlayerProvider>
            </AuthProvider>
        </HelmetProvider>
    );
}

export default App;