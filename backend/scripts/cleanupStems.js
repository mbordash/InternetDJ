const pool = require('../config/database');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const logger = require('../utils/logger');
const { extractObjectKey } = require('../utils/storage');

(async () => {
    try {
        const oldStems = await pool.query('SELECT id, url FROM stems WHERE created_at < NOW() - INTERVAL 1 DAY');

        for (const stem of oldStems) {
            if (stem.url) {
                const key = extractObjectKey(stem.url);
                const deleteParams = {
                    Bucket: process.env.BUCKET_NAME,
                    Key: key
                };
                await s3Client.send(new DeleteObjectCommand(deleteParams));
                logger.info('Deleted S3 file for expired stem', { stemId: stem.id, key });
            }
        }

        await pool.query('DELETE FROM stems WHERE created_at < NOW() - INTERVAL 1 DAY');
        logger.info('Expired stems cleaned up from DB', { count: oldStems.length });
    } catch (err) {
        logger.error('Error cleaning up stems:', err);
    }
    process.exit(0);
})();