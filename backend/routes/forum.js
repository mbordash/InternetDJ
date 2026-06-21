const express = require('express');
const pool = require('../config/database');
const authenticate = require('../middleware/authenticate');
const { uploadToS3, deleteFromS3 } = require('../utils/s3');
const sanitizeHtml = require('sanitize-html');
const { createNotification, NOTIFICATION_TYPES } = require('../utils/notifications');
const router = express.Router();

// Get list of posts with pagination
router.get('/posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const [posts, total] = await Promise.all([
            pool.query(
                `
                    SELECT
                        fp.id,
                        fp.user_id,
                        fp.title,
                        fp.content,
                        fp.image_url,
                        fp.created_at,
                        fp.edited_at,
                        p.name AS user_name,
                        p.picture_url AS user_picture,
                        p.id AS profile_id,
                        COUNT(fc.id) AS comment_count,
                        MAX(fc.created_at) AS last_commented_at,
                        (SELECT p2.name FROM profiles p2
                         WHERE p2.user_id = (
                             SELECT fc2.user_id
                             FROM forum_comments fc2
                             WHERE fc2.post_id = fp.id
                             ORDER BY fc2.created_at DESC
                            LIMIT 1
                        )) AS last_commenter_name,
                        (SELECT p2.id FROM profiles p2
                         WHERE p2.user_id = (
                             SELECT fc2.user_id
                             FROM forum_comments fc2
                             WHERE fc2.post_id = fp.id
                             ORDER BY fc2.created_at DESC
                            LIMIT 1
                        )) AS last_commenter_id
                    FROM forum_posts fp
                        LEFT JOIN profiles p ON p.user_id = fp.user_id
                        LEFT JOIN forum_comments fc ON fc.post_id = fp.id
                    GROUP BY fp.id
                    ORDER BY fp.created_at DESC
                        LIMIT ? OFFSET ?
                `,
                [limit, offset]
            ),
            pool.query('SELECT COUNT(*) AS total FROM forum_posts'),
        ]);

        const sanitizedPosts = posts.map((post) => ({
            id: Number(post.id),
            user_id: Number(post.user_id),
            profile_id: Number(post.profile_id) || null,
            title: post.title,
            content: post.content,
            image_url: post.image_url || null,
            created_at: post.created_at,
            edited_at: post.edited_at || null,
            user_name: post.user_name || 'Unknown',
            user_picture: post.user_picture || null,
            comment_count: Number(post.comment_count) || 0,
            last_commented_at: post.last_commented_at || null,
            last_commenter_name: post.last_commenter_name || null,
            last_commenter_id: Number(post.last_commenter_id) || null,
        }));

        res.json({
            posts: sanitizedPosts,
            total: Number(total[0].total) || 0,
            page,
            limit,
        });
    } catch (err) {
        console.error('Error in GET /forum/posts:', err);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

router.post('/posts', authenticate, async (req, res) => {
    const { title, content } = req.body;
    const image = req.files?.image;
    const userId = req.user.id;
    let imageUrl = null;

    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }

    // Sanitize content with stricter rules
    const sanitizedContent = sanitizeHtml(content, {
        allowedTags: ['br','p','a', 'b', 'i', 'u', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
        allowedAttributes: {
            a: ['href', 'target'], // Allow href and target for links
        },
        allowedSchemes: ['http', 'https'], // Restrict to http and https
        disallowedTagsMode: 'discard', // Discard any disallowed tags
        textFilter: (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;'), // Escape any stray HTML
        transformTags: {
            a: (tagName, attribs) => {
                // Ensure href starts with http:// or https://
                if (attribs.href && !/^https?:\/\//i.test(attribs.href)) {
                    attribs.href = ''; // Remove invalid href
                }
                // Force target="_blank" for security
                attribs.target = '_blank';
                // Add rel="noopener noreferrer" to prevent phishing attacks
                attribs.rel = 'noopener noreferrer';
                return {
                    tagName,
                    attribs,
                };
            },
        },
    });

    // Trim and validate sanitized content
    if (!sanitizedContent.trim()) {
        return res.status(400).json({ error: 'Content cannot be empty after sanitization' });
    }

    try {
        if (image) {
            imageUrl = await uploadToS3(image, userId);
        }

        const result = await pool.query(
            'INSERT INTO forum_posts (user_id, title, content, image_url) VALUES (?, ?, ?, ?)',
            [userId, title, sanitizedContent, imageUrl]
        );

        const [newPost] = await pool.query(
            `
                SELECT
                    fp.id,
                    fp.user_id,
                    fp.title,
                    fp.content,
                    fp.image_url,
                    fp.created_at,
                    fp.edited_at,
                    p.name AS user_name,
                    p.picture_url AS user_picture,
                    p.id AS profile_id
                FROM forum_posts fp
                         LEFT JOIN profiles p ON p.user_id = fp.user_id
                WHERE fp.id = ?
            `,
            [result.insertId]
        );

        const sanitizedPost = {
            id: Number(newPost.id),
            user_id: Number(newPost.user_id),
            profile_id: Number(newPost.profile_id) || null,
            title: newPost.title,
            content: newPost.content,
            image_url: newPost.image_url || null,
            created_at: newPost.created_at,
            edited_at: newPost.edited_at || null,
            user_name: newPost.user_name || 'Unknown',
            user_picture: newPost.user_picture || null,
            comment_count: 0,
        };

        res.status(201).json({ post: sanitizedPost });
    } catch (err) {
        console.error('Error in POST /forum/posts:', err);
        res.status(500).json({ error: err.message || 'Failed to create post' });
    }
});

// Delete a post
router.delete('/posts/:postId', authenticate, async (req, res) => {
    const postId = parseInt(req.params.postId);
    const userId = req.user.id;

    console.log(`Attempting to delete post ${postId} by user ${userId}`);

    if (isNaN(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }

    try {
        // MariaDB returns an array for single-record queries
        const [post] = await pool.query(
            'SELECT user_id, image_url FROM forum_posts WHERE id = ?',
            [postId]
        );

        console.log('Raw query result:', post);

        if (!post) {
            console.log(`Post ${postId} not found`);
            return res.status(404).json({ error: 'Post not found' });
        }

        // Cast user_id to Number to ensure type consistency
        const postUserId = Number(post.user_id);
        console.log(`Post found: user_id=${postUserId}, image_url=${post.image_url}`);

        if (postUserId !== Number(userId)) {
            console.log(`Unauthorized: user ${userId} does not own post ${postId} (owner: ${postUserId})`);
            return res.status(403).json({ error: 'Unauthorized to delete this post' });
        }

        // Delete image from S3
        if (post.image_url) {
            await deleteFromS3(post.image_url);
        }

        // Delete associated comments' images
        const comments = await pool.query(
            'SELECT image_url FROM forum_comments WHERE post_id = ?',
            [postId]
        );
        for (const comment of comments) {
            if (comment.image_url) {
                await deleteFromS3(comment.image_url);
            }
        }

        // Delete post and comments
        await pool.query('DELETE FROM forum_comments WHERE post_id = ?', [postId]);
        await pool.query('DELETE FROM forum_posts WHERE id = ?', [postId]);

        res.status(204).send();
    } catch (err) {
        console.error('Error in DELETE /forum/posts/:postId:', err);
        res.status(500).json({ error: err.message || 'Failed to delete post' });
    }
});

// Get a single post with its comments
router.get('/posts/:postId', async (req, res) => {
    const postId = parseInt(req.params.postId);

    if (isNaN(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }

    try {
        const [post] = await pool.query(
            `
                SELECT
                    fp.id,
                    fp.user_id,
                    fp.title,
                    fp.content,
                    fp.image_url,
                    fp.created_at,
                    fp.edited_at,
                    p.name AS user_name,
                    p.picture_url AS user_picture,
                    p.id AS profile_id
                FROM forum_posts fp
                         LEFT JOIN profiles p ON p.user_id = fp.user_id
                WHERE fp.id = ?
            `,
            [postId]
        );

        const comments = await pool.query(
            `
                SELECT
                    fc.id,
                    fc.user_id,
                    fc.content,
                    fc.image_url,
                    fc.created_at,
                    fc.edited_at,
                    fc.parent_comment_id,
                    p.name AS user_name,
                    p.picture_url AS user_picture,
                    p.id AS profile_id
                FROM forum_comments fc
                         LEFT JOIN profiles p ON p.user_id = fc.user_id
                WHERE fc.post_id = ?
                ORDER BY fc.created_at ASC
            `,
            [postId]
        );

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const sanitizedPost = {
            id: Number(post.id),
            user_id: Number(post.user_id),
            profile_id: Number(post.profile_id) || null,
            title: post.title,
            content: post.content,
            image_url: post.image_url || null,
            created_at: post.created_at,
            edited_at: post.edited_at || null,
            user_name: post.user_name || 'Unknown',
            user_picture: post.user_picture || null,
        };

        const sanitizedComments = comments.map((comment) => ({
            id: Number(comment.id),
            user_id: Number(comment.user_id),
            profile_id: Number(comment.profile_id) || null,
            content: comment.content,
            image_url: comment.image_url || null,
            created_at: comment.created_at,
            edited_at: comment.edited_at || null,
            parent_comment_id: Number(comment.parent_comment_id) || null,
            user_name: comment.user_name || 'Unknown',
            user_picture: comment.user_picture || null,
        }));

        res.json({ post: sanitizedPost, comments: sanitizedComments });
    } catch (err) {
        console.error('Error in GET /forum/posts/:postId:', err);
        res.status(500).json({ error: 'Failed to fetch post' });
    }
});

router.post('/posts/:postId/comments', authenticate, async (req, res) => {
    const postId = parseInt(req.params.postId);
    const { content, parent_comment_id } = req.body;
    const image = req.files?.image;
    const userId = req.user.id;

    if (isNaN(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }

    if (!content) {
        return res.status(400).json({ error: 'Comment content is required' });
    }

    const sanitizedContent = sanitizeHtml(content, {
        allowedTags: ['br','p','a', 'b', 'i', 'u', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
        allowedAttributes: {
            a: ['href', 'target'], // Allow href and target for links
        },
        allowedSchemes: ['http', 'https'], // Restrict to http and https
        disallowedTagsMode: 'discard', // Discard any disallowed tags
        textFilter: (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;'), // Escape any stray HTML
        transformTags: {
            a: (tagName, attribs) => {
                // Ensure href starts with http:// or https://
                if (attribs.href && !/^https?:\/\//i.test(attribs.href)) {
                    attribs.href = ''; // Remove invalid href
                }
                // Force target="_blank" for security
                attribs.target = '_blank';
                // Add rel="noopener noreferrer" to prevent phishing attacks
                attribs.rel = 'noopener noreferrer';
                return {
                    tagName,
                    attribs,
                };
            },
        },
    });

    if (!sanitizedContent.trim()) {
        return res.status(400).json({ error: 'Comment content cannot be empty after sanitization' });
    }

    try {
        const [post] = await pool.query('SELECT id, user_id, title FROM forum_posts WHERE id = ?', [postId]);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (parent_comment_id) {
            const [parentComment] = await pool.query(
                'SELECT id FROM forum_comments WHERE id = ? AND post_id = ?',
                [parent_comment_id, postId]
            );
            if (!parentComment) {
                return res.status(404).json({ error: 'Parent comment not found' });
            }
        }

        let imageUrl = null;
        if (image) {
            imageUrl = await uploadToS3(image, userId);
        }

        const result = await pool.query(
            'INSERT INTO forum_comments (post_id, user_id, content, image_url, parent_comment_id) VALUES (?, ?, ?, ?, ?)',
            [postId, userId, content, imageUrl, parent_comment_id || null]
        );

        const [newComment] = await pool.query(
            `
                SELECT
                    fc.id,
                    fc.user_id,
                    fc.content,
                    fc.image_url,
                    fc.created_at,
                    fc.edited_at,
                    fc.parent_comment_id,
                    p.name AS user_name,
                    p.picture_url AS user_picture,
                    p.id AS profile_id
                FROM forum_comments fc
                         LEFT JOIN profiles p ON p.user_id = fc.user_id
                WHERE fc.id = ?
            `,
            [result.insertId]
        );

        const sanitizedComment = {
            id: Number(newComment.id),
            user_id: Number(newComment.user_id),
            profile_id: Number(newComment.profile_id) || null,
            content: newComment.content,
            image_url: newComment.image_url || null,
            created_at: newComment.created_at,
            edited_at: newComment.edited_at || null,
            parent_comment_id: Number(newComment.parent_comment_id) || null,
            user_name: newComment.user_name || 'Unknown',
            user_picture: newComment.user_picture || null,
        };

        await createNotification({
            recipientUserId: Number(post.user_id),
            actorUserId: userId,
            type: NOTIFICATION_TYPES.FORUM_POST_REPLIED,
            message: 'Someone replied to your forum post.',
            entityType: 'forum_post',
            entityId: postId,
            metadata: {
                comment_id: Number(newComment.id),
                post_title: post.title,
                parent_comment_id: parent_comment_id ? Number(parent_comment_id) : null,
            },
        });

        res.status(201).json({ comment: sanitizedComment });
    } catch (err) {
        console.error('Error in POST /forum/posts/:postId/comments:', err);
        res.status(500).json({ error: err.message || 'Failed to add comment' });
    }
});

// Delete a comment
router.delete('/posts/:postId/comments/:commentId', authenticate, async (req, res) => {
    const postId = parseInt(req.params.postId);
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;

    if (isNaN(postId) || isNaN(commentId)) {
        return res.status(400).json({ error: 'Invalid post or comment ID' });
    }

    try {
        // MariaDB returns an array for single-record queries
        const [comment] = await pool.query(
            'SELECT user_id, image_url FROM forum_comments WHERE id = ? AND post_id = ?',
            [commentId, postId]
        );

        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        const commentUserId = Number(comment.user_id);
        if (commentUserId !== Number(userId)) {
            return res.status(403).json({ error: 'Unauthorized to delete this comment' });
        }

        // Delete image from S3
        if (comment.image_url) {
            await deleteFromS3(comment.image_url);
        }

        // Delete comment
        await pool.query('DELETE FROM forum_comments WHERE id = ?', [commentId]);

        res.status(204).send();
    } catch (err) {
        console.error('Error in DELETE /forum/posts/:postId/comments/:commentId:', err);
        res.status(500).json({ error: err.message || 'Failed to delete comment' });
    }
});

router.get('/recently-commented', async (req, res) => {
    try {
        const posts = await pool.query(
            `
                SELECT
                    fp.id,
                    fp.title,
                    COALESCE(MAX(fc.created_at), fp.created_at) AS last_commented_at
                FROM forum_posts fp
                         LEFT JOIN forum_comments fc ON fc.post_id = fp.id
                GROUP BY fp.id, fp.title, fp.created_at
                ORDER BY last_commented_at DESC
                    LIMIT 5
            `
        );

        const sanitizedPosts = posts.map((post) => ({
            id: Number(post.id),
            title: post.title,
            last_commented_at: post.last_commented_at || null,
        }));

        res.json({ posts: sanitizedPosts });
    } catch (err) {
        console.error('Error in GET /forum/recently-commented:', err);
        res.status(500).json({ error: 'Failed to fetch recently commented posts' });
    }
});

router.put('/posts/:postId', authenticate, async (req, res) => {
    const postId = parseInt(req.params.postId);
    const { title, content } = req.body;
    const userId = req.user.id;

    if (isNaN(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }

    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }

    try {
        const [post] = await pool.query(
            'SELECT user_id, created_at FROM forum_posts WHERE id = ?',
            [postId]
        );
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (Number(post.user_id) !== Number(userId)) {
            return res.status(403).json({ error: 'Unauthorized to edit this post' });
        }

        const createdAt = new Date(post.created_at);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);
        if (minutesSinceCreation > 10) {
            return res.status(403).json({ error: 'Edit window (10 minutes) has expired' });
        }

        await pool.query(
            'UPDATE forum_posts SET title = ?, content = ?, edited_at = NOW() WHERE id = ?',
            [title, content, postId]
        );

        const [updatedPost] = await pool.query(
            `
                SELECT 
                    fp.id,
                    fp.user_id,
                    fp.title,
                    fp.content,
                    fp.image_url,
                    fp.created_at,
                    fp.edited_at,
                    p.name AS user_name,
                    p.picture_url AS user_picture,
                    p.id AS profile_id
                FROM forum_posts fp
                LEFT JOIN profiles p ON p.user_id = fp.user_id
                WHERE fp.id = ?
            `,
            [postId]
        );

        const sanitizedPost = {
            id: Number(updatedPost.id),
            user_id: Number(updatedPost.user_id),
            profile_id: Number(updatedPost.profile_id) || null,
            title: updatedPost.title,
            content: updatedPost.content,
            image_url: updatedPost.image_url || null,
            created_at: updatedPost.created_at,
            edited_at: updatedPost.edited_at || null,
            user_name: updatedPost.user_name || 'Unknown',
            user_picture: updatedPost.user_picture || null,
            comment_count: 0,
        };

        res.json({ post: sanitizedPost });
    } catch (err) {
        console.error('Error in PUT /forum/posts/:postId:', err);
        res.status(500).json({ error: 'Failed to edit post' });
    }
});

router.put('/posts/:postId/comments/:commentId', authenticate, async (req, res) => {
    const postId = parseInt(req.params.postId);
    const commentId = parseInt(req.params.commentId);
    const { content } = req.body;
    const userId = req.user.id;

    if (isNaN(postId) || isNaN(commentId)) {
        return res.status(400).json({ error: 'Invalid post or comment ID' });
    }

    if (!content) {
        return res.status(400).json({ error: 'Comment content is required' });
    }

    try {
        const [comment] = await pool.query(
            'SELECT user_id, created_at FROM forum_comments WHERE id = ? AND post_id = ?',
            [commentId, postId]
        );
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (Number(comment.user_id) !== Number(userId)) {
            return res.status(403).json({ error: 'Unauthorized to edit this comment' });
        }

        const createdAt = new Date(comment.created_at);
        const now = new Date();
        const minutesSinceCreation = (now - createdAt) / (1000 * 60);
        if (minutesSinceCreation > 10) {
            return res.status(403).json({ error: 'Edit window (10 minutes) has expired' });
        }

        await pool.query(
            'UPDATE forum_comments SET content = ?, edited_at = NOW() WHERE id = ?',
            [content, commentId]
        );

        const [updatedComment] = await pool.query(
            `
                SELECT 
                    fc.id,
                    fc.user_id,
                    fc.content,
                    fc.image_url,
                    fc.created_at,
                    fc.edited_at,
                    fc.parent_comment_id,
                    p.name AS user_name,
                    p.picture_url AS user_picture,
                    p.id AS profile_id
                FROM forum_comments fc
                LEFT JOIN profiles p ON p.user_id = fc.user_id
                WHERE fc.id = ?
            `,
            [commentId]
        );

        const sanitizedComment = {
            id: Number(updatedComment.id),
            user_id: Number(updatedComment.user_id),
            profile_id: Number(updatedComment.profile_id) || null,
            content: updatedComment.content,
            image_url: updatedComment.image_url || null,
            created_at: updatedComment.created_at,
            edited_at: updatedComment.edited_at || null,
            parent_comment_id: Number(updatedComment.parent_comment_id) || null,
            user_name: updatedComment.user_name || 'Unknown',
            user_picture: updatedComment.user_picture || null,
        };

        res.json({ comment: sanitizedComment });
    } catch (err) {
        console.error('Error in PUT /forum/posts/:postId/comments/:commentId:', err);
        res.status(500).json({ error: 'Failed to edit comment' });
    }
});

router.get('/popular-posts', async (req, res) => {
    try {
        const posts = await pool.query(
            `
                SELECT
                    fp.id,
                    fp.title,
                    p.name AS user_name,
                    p.id AS profile_id,
                    COUNT(fc.id) AS comment_count
                FROM forum_posts fp
                LEFT JOIN profiles p ON p.user_id = fp.user_id
                LEFT JOIN forum_comments fc ON fc.post_id = fp.id
                GROUP BY fp.id, fp.title, p.name, p.id
                ORDER BY comment_count DESC, fp.created_at DESC
                LIMIT 5
            `
        );

        const sanitizedPosts = posts.map((post) => ({
            id: Number(post.id),
            title: post.title,
            user_name: post.user_name || 'Unknown',
            profile_id: Number(post.profile_id) || null,
            comment_count: Number(post.comment_count) || 0,
        }));

        res.json({ posts: sanitizedPosts });
    } catch (err) {
        console.error('Error in GET /forum/popular-posts:', err);
        res.status(500).json({ error: 'Failed to fetch popular posts' });
    }
});

module.exports = router;