const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris'); // Your Tigris-configured client
const sharp = require('sharp');
const { buildPublicFileUrl, extractObjectKey } = require('./storage');

const uploadToS3 = async (file, userId) => {
    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
        throw new Error('Invalid file type. Only JPEG, PNG, and GIF are allowed.');
    }
    if (file.size > 5 * 1024 * 1024) {
        throw new Error('File size exceeds 5MB limit.');
    }

    // Process image with sharp
    const processedImage = await sharp(file.data)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    // Determine file extension
    const imageExtension = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/gif' ? '.gif' : '.jpg';
    const key = `forum-images/${userId}-${Date.now()}${imageExtension}`;

    const uploadParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: key,
        Body: processedImage,
        ContentType: file.mimetype,
    };

    try {
        await s3Client.send(new PutObjectCommand(uploadParams));
        return buildPublicFileUrl(key);
    } catch (err) {
        console.error('S3 upload error:', err);
        throw new Error('Failed to upload image to S3');
    }
};

const deleteFromS3 = async (imageUrl) => {
    if (!imageUrl) return;

    // Extract key from URL
    const key = extractObjectKey(imageUrl);
    const deleteParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: key,
    };

    try {
        await s3Client.send(new DeleteObjectCommand(deleteParams));
    } catch (err) {
        console.error('S3 deletion error:', err);
        throw new Error('Failed to delete image from S3');
    }
};

module.exports = { uploadToS3, deleteFromS3 };