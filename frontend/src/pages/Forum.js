import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom'; // Add useLocation
import axios from 'axios';
import { XMarkIcon, PencilIcon } from '@heroicons/react/24/solid';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Helmet } from 'react-helmet-async';
import API_URL from '../utils/api';
import profilePath from '../utils/profilePath';

function Forum() {
    const [posts, setPosts] = useState([]);
    const [popularPosts, setPopularPosts] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(10);
    const [error, setError] = useState(null);
    const [newPost, setNewPost] = useState({ title: '', content: '', image: null });
    const [imagePreview, setImagePreview] = useState(null);
    const [user, setUser] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingPost, setEditingPost] = useState(null);
    const navigate = useNavigate();
    const location = useLocation(); // Add useLocation

    // Define baseUrl for URLs (adjust if defined elsewhere)
    const baseUrl = window.location.origin;

    // Fixed description for the forum page
    const description = "Join discussions about music, DJing, and more on InternetDJ's forum. Share ideas, ask questions, and connect with the community.";

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            axios
                .get(`${API_URL}/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                .then((res) => setUser(res.data))
                .catch((err) => {
                    console.error('Error fetching user:', err);
                    if (err.response && err.response.status === 403) {
                        localStorage.removeItem('token');
                        setUser(null);
                        navigate('/login?sessionExpired=true');
                    }
                });
        }
    }, [navigate]);

    useEffect(() => {
        const fetchPosts = async () => {
            try {
                const [postsResponse, popularResponse] = await Promise.all([
                    axios.get(`${API_URL}/forum/posts`, {
                        params: { page, limit },
                    }),
                    axios.get(`${API_URL}/forum/popular-posts`),
                ]);
                setPosts(postsResponse.data.posts || []);
                setTotal(postsResponse.data.total || 0);
                setPopularPosts(popularResponse.data.posts || []);
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                });
                setError('Failed to load posts: ' + (err.response?.data?.error || err.message));
            }
        };
        fetchPosts();

        // Handle edit state from navigation
        const { editPostId } = location.state || {};
        if (editPostId && user) {
            const fetchPostToEdit = async () => {
                try {
                    const response = await axios.get(`${API_URL}/forum/posts/${editPostId}`);
                    const post = response.data.post;
                    if (post.user_id === user.id) {
                        setEditingPost(post);
                        setNewPost({ title: post.title, content: post.content, image: null });
                        setShowForm(true);
                        // Clear the location state to prevent re-triggering
                        navigate('/forum', { replace: true, state: {} });
                    } else {
                        setError('You are not authorized to edit this post.');
                    }
                } catch (err) {
                    setError('Failed to load post for editing: ' + (err.response?.data?.error || err.message));
                }
            };
            fetchPostToEdit();
        }
    }, [page, limit, location.state, user, navigate]);

    const handleCreateOrUpdatePost = async (e) => {
        e.preventDefault();
        if (!user) {
            navigate('/login');
            return;
        }
        const plainContent = newPost.content.replace(/<(.|\n)*?>/g, '').trim();
        if (!newPost.title || !plainContent) {
            setError('Title and content are required');
            return;
        }

        setIsSubmitting(true);
        try {
            const token = localStorage.getItem('token');
            const formData = new FormData();
            formData.append('title', newPost.title);
            formData.append('content', newPost.content);
            if (newPost.image) {
                formData.append('image', newPost.image);
            }

            let response;
            if (editingPost) {
                response = await axios.put(
                    `${API_URL}/forum/posts/${editingPost.id}`,
                    { title: newPost.title, content: newPost.content },
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                setPosts(posts.map((p) => (p.id === editingPost.id ? response.data.post : p)));
                setEditingPost(null);
            } else {
                response = await axios.post(`${API_URL}/forum/posts`, formData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                });
                setPosts([response.data.post, ...posts]);
            }

            setNewPost({ title: '', content: '', image: null });
            setImagePreview(null);
            setError(null);
            setShowForm(false);
            document.getElementById('image-upload').value = '';
        } catch (err) {
            console.error('Post error:', err);
            setError('Failed to save post: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEditPost = (post) => {
        if (user && post.user_id === user.id) {
            setEditingPost(post);
            setNewPost({ title: post.title, content: post.content, image: null });
            setImagePreview(null);
            setShowForm(true);
        } else {
            setError('You are not authorized to edit this post.');
        }
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setNewPost({ ...newPost, image: file });
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const handleDeletePost = async (postId) => {
        if (!user) {
            navigate('/login');
            return;
        }
        if (!window.confirm('Are you sure you want to delete this post?')) return;

        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/forum/posts/${postId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setPosts(posts.filter((post) => post.id !== postId));
            setPopularPosts(popularPosts.filter((post) => post.id !== postId));
            setError(null);
        } catch (err) {
            console.error('Delete post error:', err);
            if (err.response?.status === 403) {
                setError('You are not authorized to delete this post.');
            } else {
                setError('Failed to delete post: ' + (err.response?.data?.error || err.message));
            }
        }
    };

    useEffect(() => {
        return () => {
            if (imagePreview) URL.revokeObjectURL(imagePreview);
        };
    }, [imagePreview]);

    const formatDate = (dateString) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Unknown';
        const monthNames = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
        ];
        const day = date.getDate();
        const suffix =
            day === 1 || day === 21 || day === 31
                ? 'st'
                : day === 2 || day === 22
                    ? 'nd'
                    : day === 3 || day === 23
                        ? 'rd'
                        : 'th';
        return `${monthNames[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`;
    };

    const canEditPost = (post) => {
        if (!user || post.user_id !== user.id) return false;
        const createdAt = new Date(post.created_at);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);
        return minutesSinceCreation <= 10;
    };

    // Update quillModules to match Post.js and backend sanitization
    const quillModules = {
        toolbar: [
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['code-block', 'blockquote'],
        ],
    };

    if (error && posts.length === 0) {
        return (
            <div className="container mx-auto px-4 py-8 text-center text-gray-100">
                <p className="retro-mono text-2xl text-fuchsia-400">{error}</p>
            </div>
        );
    }

    return (
        <>
            <Helmet>
                <title>Discussion Forum - InternetDJ</title>
                <meta name="description" content={description} />
                <link rel="canonical" href={`${baseUrl}/forum`} />
                <meta property="og:type" content="website" />
                <meta property="og:title" content="Discussion Forum - InternetDJ" />
                <meta property="og:description" content={description} />
                <meta property="og:image" content={`${baseUrl}/default-forum-image.jpg`} /> {/* Adjust to your default image */}
                <meta property="og:url" content={`${baseUrl}/forum`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Discussion Forum - InternetDJ" />
                <meta name="twitter:description" content={description} />
                <meta name="twitter:image" content={`${baseUrl}/default-forum-image.jpg`} /> {/* Adjust to your default image */}
                <meta name="twitter:site" content="@internetdjco" />
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "CollectionPage",
                        "name": "Discussion Forum - InternetDJ",
                        "description": description,
                        "url": `${baseUrl}/forum`,
                        "mainEntity": {
                            "@type": "ItemList",
                            "itemListElement": posts.map((post, index) => ({
                                "@type": "ListItem",
                                "position": index + 1,
                                "item": {
                                    "@type": "DiscussionForumPosting",
                                    "headline": post.title || "Untitled Post",
                                    "url": `${baseUrl}/forum/post/${post.id}`,
                                    "author": {
                                        "@type": "Person",
                                        "name": post.user_name || "Anonymous",
                                        "url": post.profile_id ? `${baseUrl}${profilePath(post)}` : undefined
                                    },
                                    "datePublished": post.created_at ? new Date(post.created_at).toISOString() : undefined,
                                    "interactionStatistic": [
                                        {
                                            "@type": "InteractionCounter",
                                            "interactionType": "https://schema.org/CommentAction",
                                            "userInteractionCount": post.comment_count || 0
                                        }
                                    ]
                                }
                            }))
                        }
                    })}
                </script>
            </Helmet>
            <div className="retro-page -mt-24 pt-24 -mb-28 pb-28 text-gray-100">
                <div className="container mx-auto px-4 py-8">
                    <div className="flex flex-col lg:flex-row lg:space-x-8">
                        {/* Main Content */}
                        <div className="lg:w-3/4">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <div className="retro-eyebrow mb-2">// Message Board //</div>
                                    <h1 className="retro-display retro-chrome text-2xl sm:text-3xl">Discussion Forum</h1>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowForm(!showForm);
                                        if (showForm) {
                                            setEditingPost(null);
                                            setNewPost({ title: '', content: '', image: null });
                                            setImagePreview(null);
                                        }
                                    }}
                                    className="retro-btn retro-btn--hot px-5 py-2 text-xs shrink-0"
                                >
                                    {showForm ? 'Cancel' : 'Start a Discussion'}
                                </button>
                            </div>

                            {/* Create/Edit Post Form */}
                            {showForm && (
                                <section className="mb-12 retro-panel retro-cut p-4">
                                    <h2 className="retro-display text-lg retro-glow-magenta mb-4">{editingPost ? 'Edit Post' : 'Start a Discussion'}</h2>
                                     <form onSubmit={handleCreateOrUpdatePost} className="space-y-4">
                                         <div>
                                             <input
                                                 type="text"
                                                 value={newPost.title}
                                                 onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                                                 placeholder="Post title"
                                                 className="retro-field"
                                             />
                                         </div>
                                         <div>
                                             <ReactQuill
                                                 value={newPost.content}
                                                 onChange={(content) => setNewPost({ ...newPost, content })}
                                                 modules={quillModules}
                                                 placeholder="What's on your mind?"
                                                 className="bg-white/5 text-white"
                                             />
                                         </div>
                                         {!editingPost && (
                                             <div>
                                                 <label htmlFor="image-upload" className="retro-mono text-xl text-gray-300 mr-2">
                                                     Image
                                                 </label>
                                                 <input
                                                     id="image-upload"
                                                     type="file"
                                                     accept="image/jpeg,image/png,image/gif"
                                                     onChange={handleImageChange}
                                                     className="retro-field"
                                                 />
                                                 {imagePreview && (
                                                     <div className="mt-2">
                                                         <img src={imagePreview} alt="Preview" className="max-w-xs h-auto rounded-md" />
                                                     </div>
                                                 )}
                                             </div>
                                         )}
                                         <div className="relative">
                                             <button
                                                 type="submit"
                                                 disabled={isSubmitting}
                                                 className={`retro-btn retro-btn--hot px-4 py-2 text-xs ${
                                                     isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                                                 }`}
                                             >
                                                 {editingPost ? 'Update Post' : 'Create Post'}
                                             </button>
                                             {isSubmitting && (
                                                 <div className="absolute top-0 left-0 right-0 h-1 bg-cyan-500/30 rounded-t-md">
                                                     <div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 animate-pulse" style={{ width: '100%' }} />
                                                 </div>
                                             )}
                                         </div>
                                     </form>
                                 </section>
                            )}

                            {/* Posts List */}
                            <section>
                                <h2 className="retro-display text-lg retro-glow-magenta mb-4">Recent Posts</h2>
                                {posts.length === 0 ? (
                                    <p className="retro-mono text-xl text-gray-300">No posts available.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="retro-table">
                                            <thead>
                                            <tr>
                                                <th>Post</th>
                                                <th>Comments</th>
                                                <th>Last Reply</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {posts.map((post, index) => (
                                                <tr
                                                    key={post.id}
                                                    
                                                >
                                                    <td className="flex items-center space-x-3">
                                                        {post.user_picture ? (
                                                            <img
                                                                src={post.user_picture}
                                                                alt={post.user_name}
                                                                className="w-12 h-12 object-cover border border-cyan-400/30"
                                                                onError={(e) => {
                                                                    e.target.style.display = 'none';
                                                                    e.target.nextSibling.style.display = 'block';
                                                                }}
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="w-12 h-12 border border-cyan-400/30 bg-fuchsia-900/30 flex items-center justify-center retro-pixel text-[0.4rem] text-cyan-300" style={{ display: post.user_picture ? 'none' : 'flex' }}>
                                                             ?
                                                         </div>
                                                     )}
                                                     <div className="flex-1">
                                                         <Link
                                                             to={`/forum/post/${post.id}`}
                                                             className="retro-display text-xs text-white hover:text-cyan-200"
                                                         >
                                                             {post.title}
                                                         </Link>
                                                         <div className="retro-mono text-lg text-gray-400">
                                                             <Link
                                                                 to={profilePath(post)}
                                                                 className="retro-link"
                                                             >
                                                                 {post.user_name}
                                                             </Link>
                                                             {' • '}
                                                             {formatDate(post.created_at)}
                                                             {post.edited_at && (
                                                                 <span> (Edited {formatDate(post.edited_at)})</span>
                                                             )}
                                                         </div>
                                                     </div>
                                                     {user && post.user_id === user.id && (
                                                         <div className="flex space-x-2">
                                                             {canEditPost(post) && (
                                                                 <button
                                                                     onClick={() => handleEditPost(post)}
                                                                     className="retro-link"
                                                                     title="Edit post"
                                                                 >
                                                                     <PencilIcon className="w-5 h-5" />
                                                                 </button>
                                                             )}
                                                             <button
                                                                 onClick={() => handleDeletePost(post.id)}
                                                                 className="text-red-400 hover:text-red-300"
                                                                 title="Delete post"
                                                             >
                                                                 <XMarkIcon className="w-5 h-5" />
                                                             </button>
                                                         </div>
                                                     )}
                                                    </td>
                                                    <td className="retro-mono text-lg text-cyan-300">{post.comment_count} comments</td>
                                                    <td className="retro-mono text-lg text-gray-400">
                                                        {post.last_commented_at ? (
                                                            <>
                                                                {formatDate(post.last_commented_at)} by{' '}
                                                                <Link
                                                                    to={profilePath({ profile_slug: post.last_commenter_slug, profile_id: post.last_commenter_id })}
                                                                    className="retro-link"
                                                                >
                                                                    {post.last_commenter_name || 'Unknown'}
                                                                </Link>
                                                            </>
                                                        ) : (
                                                            'No replies'
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {posts.length < total && (
                                    <button
                                        onClick={() => setPage(page + 1)}
                                        className="mt-4 retro-btn retro-btn--hot px-4 py-2 text-xs"
                                    >
                                        Load More
                                    </button>
                                )}
                            </section>
                        </div>

                        {/* Right Column: Popular Posts */}
                        <div className="lg:w-1/4 mt-8 lg:mt-0">
                            <section className="retro-panel retro-cut p-4">
                                <h2 className="retro-display text-base retro-glow-cyan mb-4">Popular Posts</h2>
                                {popularPosts.length === 0 ? (
                                    <p className="retro-mono text-xl text-gray-300">No popular posts yet.</p>
                                ) : (
                                    <ul className="space-y-3">
                                        {popularPosts.map((post) => (
                                            <li key={post.id} className="border-b border-white/10 pb-2">
                                                <Link
                                                    to={`/forum/post/${post.id}`}
                                                    className="retro-link retro-mono text-lg"
                                                >
                                                    {post.title}
                                                </Link>
                                                <div className="retro-mono text-base text-gray-400">
                                                    <Link
                                                        to={profilePath(post)}
                                                        className="retro-link"
                                                    >
                                                        {post.user_name}
                                                    </Link>
                                                    {' • '}
                                                    {post.comment_count} comments
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default Forum;