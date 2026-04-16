// server/socket.js
const { Server } = require('socket.io');
const pool = require('./config/database');

const socketOrigins = [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URL_PROD,
    process.env.FRONTEND_URL_LOCAL,
    'http://localhost:3000',
].filter(Boolean);

module.exports = (server) => {
    const io = new Server(server, {
        cors: {
            origin: socketOrigins,
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });

    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Join chat-specific room (existing)
        socket.on('join', ({ collabId, profileId }, callback) => {
            if (!collabId || !profileId) {
                console.error('Invalid join data:', { collabId, profileId });
                callback({ error: 'Invalid collab or profile ID' });
                return;
            }
            socket.join(`collab:${collabId}`);
            console.log(`User ${profileId} joined collab:${collabId}`);
            callback({ success: true });
        });

        // Handle new chat message (existing)
        socket.on('sendMessage', async ({ collabId, sender_id, receiver_id, content }, callback) => {
            try {
                const parsedCollabId = parseInt(collabId);
                const parsedSenderId = parseInt(sender_id);
                const parsedReceiverId = parseInt(receiver_id);
                if (isNaN(parsedCollabId) || isNaN(parsedSenderId) || isNaN(parsedReceiverId) || !content) {
                    console.error('Invalid message data:', { collabId, sender_id, receiver_id, content });
                    socket.emit('error', { message: 'Invalid message data: IDs must be numbers and content is required' });
                    callback({ error: 'Invalid message data' });
                    return;
                }

                const collabs = await pool.query('SELECT id FROM collabs WHERE id = ?', [parsedCollabId]);
                if (!collabs.length) {
                    console.error('Collab not found:', parsedCollabId);
                    socket.emit('error', { message: 'Collaboration not found' });
                    callback({ error: 'Collaboration not found' });
                    return;
                }

                const senderProfiles = await pool.query('SELECT id FROM profiles WHERE id = ?', [parsedSenderId]);
                const receiverProfiles = await pool.query('SELECT id FROM profiles WHERE id = ?', [parsedReceiverId]);
                if (!senderProfiles.length || !receiverProfiles.length) {
                    console.error('Profile not found:', { sender_id: parsedSenderId, receiver_id: parsedReceiverId });
                    socket.emit('error', { message: 'Sender or receiver profile not found' });
                    callback({ error: 'Sender or receiver profile not found' });
                    return;
                }

                const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
                const result = await pool.query(
                    'INSERT INTO messages (collab_id, sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
                    [parsedCollabId, parsedSenderId, parsedReceiverId, content, createdAt]
                );

                const messageId = Number(result.insertId);
                if (isNaN(messageId)) {
                    throw new Error('Failed to convert insertId to Number');
                }

                const message = {
                    id: messageId,
                    collab_id: Number(parsedCollabId),
                    sender_id: Number(parsedSenderId),
                    receiver_id: Number(parsedReceiverId),
                    content,
                    created_at: createdAt,
                    is_read: false,
                };

                console.log('Message saved:', message);
                console.log(`Emitting receiveMessage to collab:${parsedCollabId}`);
                io.to(`collab:${parsedCollabId}`).emit('receiveMessage', message);
                callback({ success: true, id: messageId });
            } catch (err) {
                console.error('Error sending message:', {
                    message: err.message,
                    stack: err.stack,
                    collabId,
                    sender_id,
                    receiver_id,
                    content,
                });
                socket.emit('error', { message: `Failed to send message: ${err.message}` });
                callback({ error: `Failed to send message: ${err.message}` });
            }
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });
    });

    // Make io accessible for routes
    global.io = io;

    return io;
};