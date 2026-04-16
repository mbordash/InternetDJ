import React, { useEffect, useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import { PlusIcon } from '@heroicons/react/24/solid';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMusic, faVolumeUp, faHeadphones, faSlidersH, faFileAudio } from '@fortawesome/free-solid-svg-icons';

const Projects = () => {
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const baseUrl = SITE_URL;
    const [projects, setProjects] = useState([]);
    const [publicProjects, setPublicProjects] = useState([]);
    const [newProjectTitle, setNewProjectTitle] = useState('');
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [deleteProjectId, setDeleteProjectId] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        const fetchProjects = async () => {
            if (!user) return;
            try {
                const token = localStorage.getItem('token');
                const response = await axios.get(`${API_URL}/projects`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                console.log('Projects API response:', response.data);
                const projectsData = response.data;
                if (!Array.isArray(projectsData)) {
                    console.error('Expected an array, got:', projectsData);
                    setError('Failed to load projects: Invalid data format from server.');
                    setProjects([]);
                    return;
                }
                setProjects(projectsData);
            } catch (err) {
                console.error('Fetch projects error:', err.response?.data || err.message);
                setError('Failed to fetch projects: ' + (err.response?.data?.error || err.message));
                setProjects([]);
            }
        };

        const fetchPublicProjects = async () => {
            try {
                const response = await axios.get(`${API_URL}/projects/public`);
                console.log('Public projects API response:', response.data);
                if (!Array.isArray(response.data)) {
                    console.error('Expected an array, got:', response.data);
                    setPublicProjects([]);
                    return;
                }
                setPublicProjects(response.data);
            } catch (err) {
                console.error('Fetch public projects error:', err.response?.data || err.message);
                setError('Failed to fetch public projects: ' + (err.response?.data?.error || err.message));
            }
        };

        fetchProjects();
        fetchPublicProjects();
    }, [user]);

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!newProjectTitle) {
            setError('Project title is required');
            return;
        }
        try {
            const token = localStorage.getItem('token');
            const response = await axios.post(
                `${API_URL}/projects`,
                { title: newProjectTitle },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setProjects([...projects, response.data]);
            setNewProjectTitle('');
            setError(null);
            setSuccess('Project created successfully');
            setShowCreateModal(false);
            navigate(`/projects/${response.data.id}`);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            const errorMessage = err.response?.data?.error || err.message;
            console.error('Create project error:', errorMessage);
            setError(`Failed to create project: ${errorMessage}`);
        }
    };

    const handleDeleteProject = async () => {
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/projects/${deleteProjectId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setProjects(projects.filter((project) => project.id !== deleteProjectId));
            setPublicProjects(publicProjects.filter((project) => project.id !== deleteProjectId));
            setDeleteProjectId(null);
            setError(null);
            setSuccess('Project deleted successfully');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            const errorMessage = err.response?.data?.error || err.message;
            console.error('Delete project error:', errorMessage);
            setError(`Failed to delete project: ${errorMessage}`);
            setDeleteProjectId(null);
        }
    };

    const openDeleteConfirm = (projectId) => {
        setDeleteProjectId(projectId);
    };

    const closeDeleteConfirm = () => {
        setDeleteProjectId(null);
    };

    return (
        <div className="container mx-auto px-4 py-8 bg-white text-gray-800 pt-20">
            <Helmet>
                <title>Projects - InternetDJ Digital Audio Workstation</title>
                <meta
                    name="description"
                    content="Create music with InternetDJ’s browser-based Digital Audio Workstation. Sequence MIDI, mix audio samples, design instruments, apply effects, and export to MP3. Explore community projects and share feedback on our forum!"
                />
                <meta property="og:title" content="InternetDJ Digital Audio Workstation - Create & Share Music" />
                <meta
                    property="og:description"
                    content="Make music in your browser with MIDI sequencing, audio samples, custom instruments, effects, and MP3 export. Join our community on the forum to shape our early-stage Digital Audio Workstation!"
                />
                <meta property="og:image" content={`${baseUrl}/daw-preview.jpg`} />
                <meta property="og:url" content={`${baseUrl}/projects`} />
                <meta property="og:type" content="website" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="InternetDJ Digital Audio Workstation - Create & Share Music" />
                <meta
                    name="twitter:description"
                    content="Make music in your browser with MIDI sequencing, audio samples, custom instruments, effects, and MP3 export. Join our forum to share ideas!"
                />
                <meta name="twitter:image" content={`${baseUrl}/daw-preview.jpg`} />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>

            {/* Hero Section */}
            <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md mb-8">
                <h1 className="text-3xl font-bold mb-4">InternetDJ: Your Browser-Based Music Studio</h1>
                <p className="text-lg text-gray-600 mb-4">
                    Create music anywhere with InternetDJ’s <strong>browser-based Digital Audio Workstation</strong>. Sequence <strong>MIDI notes</strong>, mix <strong>audio samples</strong>, design <strong>custom instruments</strong>, apply <strong>effects</strong>, and <strong>export to MP3</strong>—no downloads needed. We’re in early development and building this with your input. Join our forum to share ideas and make this studio epic!
                </p>
                <div className="flex flex-wrap gap-4">
                    {user ? (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="inline-flex items-center px-4 py-2 bg-primary-brand-500 text-white font-semibold rounded-md shadow-md hover:bg-primary-brand-700 focus:outline-none focus:ring-2 focus:ring-primary-brand"
                        >
                            <PlusIcon className="w-5 h-5 mr-2" />
                            Start a Project
                        </button>
                    ) : (
                        <Link
                            to="/login"
                            className="inline-flex items-center px-4 py-2 bg-primary-brand-500 text-white font-semibold rounded-md shadow-md hover:bg-primary-brand-700 focus:outline-none focus:ring-2 focus:ring-primary-brand"
                        >
                            <PlusIcon className="w-5 h-5 mr-2" />
                            Log In to Create
                        </Link>
                    )}
                    <Link
                        to="/forum"
                        className="inline-flex items-center px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                        Join the Forum
                    </Link>
                </div>
            </div>

            {/* Create Project Modal */}
            {showCreateModal && user && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                        <h3 className="text-lg font-bold mb-4">Create New Project</h3>
                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium">Project Title</label>
                                <input
                                    type="text"
                                    value={newProjectTitle}
                                    onChange={(e) => setNewProjectTitle(e.target.value)}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                    placeholder="Enter project title"
                                    autoFocus
                                />
                            </div>
                            <div className="flex justify-end space-x-4">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="py-2 px-4 bg-black text-white font-semibold rounded-md shadow-sm hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-700"
                                >
                                    Create
                                </button>
                            </div>
                        </form>
                        {error && <p className="text-red-500 mt-2">{error}</p>}
                        {success && <p className="text-green-500 mt-2">{success}</p>}
                    </div>
                </div>
            )}

            <div className="flex flex-col md:flex-row gap-8">
                <div className="flex-1 max-w-4xl">
                    <h2 className="text-2xl font-bold mb-4">Your Digital Audio Workstation Projects</h2>
                    {user ? (
                        <>
                            {error && <p className="text-red-500 mb-4">{error}</p>}
                            {success && <p className="text-green-500 mb-4">{success}</p>}
                            <div className="space-y-4">
                                {projects.length === 0 ? (
                                    <p className="text-gray-600">No projects found. Start one using the button above!</p>
                                ) : (
                                    projects.map((project) => (
                                        <div
                                            key={project.id}
                                            className="flex items-center justify-between p-4 bg-gray-50 rounded-md shadow-sm hover:bg-gray-100"
                                        >
                                            <Link
                                                to={`/projects/${project.id}`}
                                                className="flex-1"
                                            >
                                                <h3 className="text-lg font-semibold">{project.title}</h3>
                                                <p className="text-sm text-gray-600">
                                                    Created: {new Date(project.created_at).toLocaleDateString()}
                                                </p>
                                                <p className="text-sm text-gray-600">
                                                    Visibility: {project.is_public ? 'Public' : 'Private'}
                                                </p>
                                            </Link>
                                            <button
                                                onClick={() => openDeleteConfirm(project.id)}
                                                className="ml-4 py-1 px-3 bg-red-500 text-white font-semibold rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    ) : (
                        <p className="text-lg text-gray-600">
                            Please <Link to="/login" className="text-primary-brand hover:underline">log in</Link> to create and manage your projects.
                        </p>
                    )}

                    {/* Confirmation Modal */}
                    {deleteProjectId && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
                                <h3 className="text-lg font-bold mb-4">Confirm Delete</h3>
                                <p className="text-gray-600 mb-6">
                                    Are you sure you want to delete this project? This action cannot be undone.
                                </p>
                                <div className="flex justify-end space-x-4">
                                    <button
                                        onClick={closeDeleteConfirm}
                                        className="py-2 px-4 bg-gray-200 text-gray-800 font-semibold rounded-md shadow-sm hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleDeleteProject}
                                        className="py-2 px-4 bg-red-500 text-white font-semibold rounded-md shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="w-full md:w-1/3">
                    <h2 className="text-2xl font-bold mb-4">Explore Community Creations</h2>
                    <p className="text-gray-600 mb-4">
                        Check out what others are making with InternetDJ Digital Audio Workstation! Inspired? Share your own projects to join the community.
                    </p>
                    <div className="space-y-4">
                        {publicProjects.length === 0 ? (
                            <p className="text-gray-600">
                                No public projects yet.{' '}
                                {user ? (
                                    <button
                                        onClick={() => setShowCreateModal(true)}
                                        className="text-primary-brand hover:underline"
                                    >
                                        Create one to share!
                                    </button>
                                ) : (
                                    <Link to="/login" className="text-primary-brand hover:underline">
                                        Log in to contribute!
                                    </Link>
                                )}
                            </p>
                        ) : (
                            publicProjects.map((project) => (
                                <div
                                    key={project.id}
                                    className="p-4 bg-gray-50 rounded-md shadow-sm hover:bg-gray-100"
                                >
                                    <div className="flex items-start">
                                        <div className="flex-shrink-0 mr-4">
                                            {project.picture_url ? (
                                                <img
                                                    src={project.picture_url}
                                                    alt={`${project.creator}'s profile`}
                                                    className="w-16 h-16 rounded-full object-cover"
                                                    loading="lazy"
                                                    onError={(e) => {
                                                        console.error('Profile image failed to load:', project.picture_url);
                                                        e.target.style.display = 'none';
                                                        e.target.nextSibling.style.display = 'block';
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xl">
                                                    {project.creator ? project.creator[0].toUpperCase() : '?'}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <Link to={`/public/${project.id}`} className="block">
                                                <h3 className="text-lg font-semibold hover:underline">{project.title}</h3>
                                            </Link>
                                            <p className="text-sm text-gray-600">
                                                Created: {new Date(project.created_at).toLocaleDateString()}
                                            </p>
                                            <p className="text-sm text-gray-600 flex items-center">
                                                Creator:{' '}
                                                {project.creator && project.profile_id ? (
                                                    <Link
                                                        to={`/profile/${project.profile_id}`}
                                                        className="text-primary-brand hover:underline ml-1"
                                                        aria-label={`View ${project.creator}'s profile`}
                                                    >
                                                        {project.creator}
                                                    </Link>
                                                ) : (
                                                    <span className="ml-1">{project.creator || 'Unknown Creator'}</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Feature Showcase */}
            <div className="bg-white bg-opacity-90 p-6 rounded-lg shadow-md mb-8">
                <h2 className="text-2xl font-bold mb-4">What Can You Create with InternetDJ Digital Audio Workstation?</h2>
                <p className="text-gray-600 mb-4">
                    From beats to melodies, our Digital Audio Workstation empowers your creativity. Here’s what you can do today, with more features on the way!
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex items-start space-x-3">
                        <FontAwesomeIcon icon={faMusic} className="w-8 h-8 text-blue-600" />
                        <div>
                            <h3 className="text-lg font-semibold">MIDI Sequencing</h3>
                            <p className="text-sm text-gray-600">
                                Craft melodies and rhythms with our intuitive MIDI editor, right in your browser.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3">
                        <FontAwesomeIcon icon={faVolumeUp} className="w-8 h-8 text-blue-600" />
                        <div>
                            <h3 className="text-lg font-semibold">Audio Samples</h3>
                            <p className="text-sm text-gray-600">
                                Drag and drop from our sample library or upload your own to mix and layer sounds.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3">
                        <FontAwesomeIcon icon={faHeadphones} className="w-8 h-8 text-blue-600" />
                        <div>
                            <h3 className="text-lg font-semibold">Custom Instruments</h3>
                            <p className="text-sm text-gray-600">
                                Design unique synths with customizable settings for endless sonic possibilities.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3">
                        <FontAwesomeIcon icon={faSlidersH} className="w-8 h-8 text-blue-600" />
                        <div>
                            <h3 className="text-lg font-semibold">Effects</h3>
                            <p className="text-sm text-gray-600">
                                Add reverb, delay, and more to polish your tracks. New effects coming soon!
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3">
                        <FontAwesomeIcon icon={faFileAudio} className="w-8 h-8 text-blue-600" />
                        <div>
                            <h3 className="text-lg font-semibold">MP3 Export</h3>
                            <p className="text-sm text-gray-600">
                                Export your tracks as MP3s to share or upload to InternetDJ’s music platform.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default Projects;