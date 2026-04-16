import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { XMarkIcon, PencilIcon } from '@heroicons/react/24/solid';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import parse from 'html-react-parser';
import API_URL from '../utils/api';
import SITE_URL from '../utils/site';
import {Helmet} from "react-helmet-async";

function Post() {
    const { postId } = useParams();
    const baseUrl = SITE_URL;
    const [post, setPost] = useState(null);
    const [comments, setComments] = useState([]);
    const [newComment, setNewComment] = useState({ content: '', image: null, parent_comment_id: null });
    const [imagePreview, setImagePreview] = useState(null);
    const [error, setError] = useState(null);
    const [user, setUser] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingComment, setEditingComment] = useState(null);
    const navigate = useNavigate();

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
        const fetchPost = async () => {
            try {
                const response = await axios.get(`${API_URL}/forum/posts/${postId}`);
                setPost(response.data.post || null);
                setComments(response.data.comments || []);
            } catch (err) {
                console.error('Fetch error:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status,
                });
                setError('Failed to load post: ' + (err.response?.data?.error || err.message));
            }
        };
        fetchPost();
    }, [postId]);

    const handleAddOrUpdateComment = async (e) => {
        e.preventDefault();
        if (!user) {
            navigate('/login');
            return;
        }
        const plainContent = newComment.content.replace(/<(.|\n)*?>/g, '').trim();
        if (!plainContent) {
            setError('Comment cannot be empty');
            return;
        }

        setIsSubmitting(true);
        try {
            const token = localStorage.getItem('token');
            const formData = new FormData();
            formData.append('content', newComment.content);
            if (newComment.image) {
                formData.append('image', newComment.image);
            }
            if (newComment.parent_comment_id && !editingComment) {
                formData.append('parent_comment_id', newComment.parent_comment_id);
            }

            let response;
            if (editingComment) {
                response = await axios.put(
                    `${API_URL}/forum/posts/${postId}/comments/${editingComment.id}`,
                    { content: newComment.content },
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                setComments(comments.map((c) => (c.id === editingComment.id ? response.data.comment : c)));
                setEditingComment(null);
            } else {
                response = await axios.post(
                    `${API_URL}/forum/posts/${postId}/comments`,
                    formData,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'multipart/form-data',
                        },
                    }
                );
                setComments([...comments, response.data.comment]);
            }

            setNewComment({ content: '', image: null, parent_comment_id: null });
            setImagePreview(null);
            setError(null);
            document.getElementById('comment-image-upload').value = '';
        } catch (err) {
            console.error('Comment error:', err);
            setError('Failed to save comment: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setNewComment({ ...newComment, image: file });
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const handleDeleteComment = async (commentId) => {
        if (!user) {
            navigate('/login');
            return;
        }
        if (!window.confirm('Are you sure you want to delete this comment?')) return;

        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/forum/posts/${postId}/comments/${commentId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setComments(comments.filter((comment) => comment.id !== commentId));
            setError(null);
        } catch (err) {
            console.error('Delete comment error:', err);
            if (err.response?.status === 403) {
                setError('You are not authorized to delete this comment.');
            } else {
                setError('Failed to delete comment: ' + (err.response?.data?.error || err.message));
            }
        }
    };

    const handleDeletePost = async () => {
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
            navigate('/forum');
        } catch (err) {
            console.error('Delete post error:', err);
            if (err.response?.status === 403) {
                setError('You are not authorized to delete this post.');
            } else {
                setError('Failed to delete post: ' + (err.response?.data?.error || err.message));
            }
        }
    };

    const handleReply = (commentId) => {
        setNewComment({ ...newComment, parent_comment_id: commentId });
        setEditingComment(null);
        document.getElementById('comment-content').focus();
    };

    const handleEditComment = (comment) => {
        setEditingComment(comment);
        setNewComment({ content: comment.content, image: null, parent_comment_id: null });
        setImagePreview(null);
        document.getElementById('comment-content').focus();
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

    const buildCommentTree = (comments) => {
        const commentMap = new Map();
        const tree = [];

        comments.forEach((comment) => {
            comment.children = [];
            commentMap.set(comment.id, { ...comment });
        });

        comments.forEach((comment) => {
            if (comment.parent_comment_id) {
                const parent = commentMap.get(comment.parent_comment_id);
                if (parent) {
                    parent.children.push(commentMap.get(comment.id));
                }
            } else {
                tree.push(commentMap.get(comment.id));
            }
        });

        return tree;
    };

    const canEditComment = (comment) => {
        if (!user || comment.user_id !== user.id) return false;
        const createdAt = new Date(comment.created_at);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);
        return minutesSinceCreation <= 10;
    };

    const renderComments = (comments, level = 0) => {
        return comments.map((comment) => (
            <div
                key={comment.id}
                className={`ml-${level * 4} border border-gray-300 rounded-md p-4 bg-white mb-4`}
            >
                <div className="flex justify-between">
                    <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                            {comment.user_picture ? (
                                <img
                                    src={comment.user_picture}
                                    alt={comment.user_name}
                                    className="w-8 h-8 rounded-full object-cover"
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        e.target.nextSibling.style.display = 'block';
                                    }}
                                    loading="lazy"
                                />
                            ) : (
                                <div
                                    className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs"
                                    style={{ display: comment.user_picture ? 'none' : 'flex' }}
                                >
                                    ?
                                </div>
                            )}
                            <div>
                                <Link
                                    to={`/profile/${comment.profile_id}`}
                                    className="text-black hover:underline"
                                >
                                    {comment.user_name}
                                </Link>
                                <div className="text-sm text-gray-600">
                                    {formatDate(comment.created_at)}
                                    {comment.edited_at && (
                                        <span> (Edited {formatDate(comment.edited_at)})</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="prose max-w-none text-gray-800">{parse(comment.content)}</div>
                        {comment.image_url && (
                            <div className="mt-4">
                                <img
                                    src={comment.image_url}
                                    alt="Comment image"
                                    className="max-w-full h-auto rounded-md"
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                    }}
                                    loading="lazy"
                                />
                            </div>
                        )}
                        <div className="flex space-x-2 mt-2">
                            <button
                                onClick={() => handleReply(comment.id)}
                                className="text-blue-600 hover:text-primary-brand-800 text-sm"
                            >
                                Reply
                            </button>
                            {user && comment.user_id === user.id && canEditComment(comment) && (
                                <button
                                    onClick={() => handleEditComment(comment)}
                                    className="text-blue-600 hover:text-primary-brand-800 text-sm"
                                >
                                    Edit
                                </button>
                            )}
                        </div>
                    </div>
                    {user && comment.user_id === user.id && (
                        <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete comment"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
                {comment.children && comment.children.length > 0 && (
                    <div className="mt-4">{renderComments(comment.children, level + 1)}</div>
                )}
            </div>
        ));
    };

    if (error && !post) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800">
                <p className="text-red-400 text-lg">{error}</p>
            </div>
        );
    }

    if (!post) {
        return (
            <div className="container mx-auto px-4 py-8 text-center bg-white text-gray-800">
                <p>Loading...</p>
            </div>
        );
    }

    const commentTree = buildCommentTree(comments);
    const quillModules = {
        toolbar: [
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'code-block', 'blockquote'],
        ],
    };

    const canEditPost = (post) => {
        if (!user || post.user_id !== user.id) return false;
        const createdAt = new Date(post.created_at);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);
        return minutesSinceCreation <= 10;
    };

    return (
        <div className="bg-white text-gray-800 pt-16">
            <Helmet>
                <title>InternetDJ Discussion Forum</title>
                <meta
                    name="description"
                    content="Discuss music, production, mixing, mastering, collaboration and song promotion"
                />
                <link rel="canonical" href={`${baseUrl}/forum/post/${postId}`} />
                <meta property="og:title" content="Forum Post" />
                <meta property="og:description" content="Discuss music, production, mixing, mastering, collaboration and song promotion" />
                <meta property="og:url" content={`${baseUrl}/forum/post/${postId}`} />
                <meta property="og:site_name" content="InternetDJ" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Forum Post" />
                <meta name="twitter:description" content="Discuss music, production, mixing, mastering, collaboration and song promotion" />
                <meta name="twitter:site" content="@internetdjco" />
            </Helmet>
            <div className="container mx-auto px-4 py-8">
                <Link to="/forum" className="text-blue-600 hover:underline mb-4 inline-block">
                    ← Back to Forum
                </Link>
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-3xl font-bold">{post.title}</h1>
                    {user && post.user_id === user.id && (
                        <div className="flex space-x-2">
                            {canEditPost(post) && (
                                <button
                                    onClick={() => navigate('/forum', { state: { editPostId: post.id } })}
                                    className="text-blue-600 hover:text-primary-brand-800"
                                    title="Edit post"
                                >
                                    <PencilIcon className="w-6 h-6" />
                                </button>
                            )}
                            <button
                                onClick={handleDeletePost}
                                className="text-red-600 hover:text-red-800"
                                title="Delete post"
                            >
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                    )}
                </div>
                <div className="mb-8 border border-gray-300 rounded-md p-4 bg-gray-50">
                    <div className="flex items-center space-x-2 mb-2">
                        {post.user_picture ? (
                            <img
                                src={post.user_picture}
                                alt={post.user_name}
                                className="w-10 h-10 rounded-full object-cover"
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'block';
                                }}
                                loading="lazy"
                            />
                        ) : (
                            <div
                                className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs"
                                style={{ display: post.user_picture ? 'none' : 'flex' }}
                            >
                                ?
                            </div>
                        )}
                        <div>
                            <Link
                                to={`/profile/${post.profile_id}`}
                                className="text-black hover:underline"
                            >
                                {post.user_name}
                            </Link>
                            <div className="text-sm text-gray-600">
                                {formatDate(post.created_at)}
                                {post.edited_at && (
                                    <span> (Edited {formatDate(post.edited_at)})</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="prose max-w-none text-gray-800">{parse(post.content)}</div>
                    {post.image_url && (
                        <div className="mt-4">
                            <img
                                src={post.image_url}
                                alt="Post image"
                                className="max-w-full h-auto rounded-md"
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                }}
                                loading="lazy"
                            />
                        </div>
                    )}
                </div>

                {/* Comments Section */}
                <section className="mb-12">
                    <h2 className="text-2xl font-bold mb-4">Comments</h2>
                    {commentTree.length === 0 ? (
                        <p>No comments yet.</p>
                    ) : (
                        <div className="space-y-4">{renderComments(commentTree)}</div>
                    )}
                </section>

                {/* Add/Edit Comment Form */}
                <section>
                    <h2 className="text-2xl font-bold mb-4">
                        {editingComment ? 'Edit Comment' : newComment.parent_comment_id ? 'Reply to Comment' : 'Add a Comment'}
                    </h2>
                    <form onSubmit={handleAddOrUpdateComment} className="space-y-4">
                        <div>
                            <ReactQuill
                                id="comment-content"
                                value={newComment.content}
                                onChange={(content) => setNewComment({ ...newComment, content })}
                                modules={quillModules}
                                placeholder="Your comment..."
                                className="bg-white"
                            />
                        </div>
                        {!editingComment && (
                            <div>
                                <label htmlFor="comment-image-upload" className="text-gray-700 mr-2">
                                    Image
                                </label>
                                <input
                                    id="comment-image-upload"
                                    type="file"
                                    accept="image/jpeg,image/png,image/gif"
                                    onChange={handleImageChange}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                />
                                {imagePreview && (
                                    <div className="mt-2">
                                        <img src={imagePreview} alt="Preview" className="max-w-xs h-auto rounded-md" />
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex space-x-2">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className={`bg-primary-brand-500 text-white px-4 py-2 rounded-md transition-colors ${
                                    isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary-brand-700'
                                }`}
                            >
                                {editingComment ? 'Update Comment' : 'Post Comment'}
                            </button>
                            {(newComment.parent_comment_id || editingComment) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setNewComment({ ...newComment, content: '', parent_comment_id: null });
                                        setEditingComment(null);
                                    }}
                                    className="bg-gray-300 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-400 transition-colors"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                </section>
            </div>
        </div>
    );
}

export default Post;