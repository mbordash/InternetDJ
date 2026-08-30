const pool = require('../config/database');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const logger = require('../utils/logger');
const { extractObjectKey } = require('../utils/storage');

(async () => {
    try {
        const oldLoops = await pool.query('SELECT id, url FROM loops WHERE created_at < NOW() - INTERVAL 1 DAY');

        for (const loop of oldLoops) {
            if (loop.url) {
                const key = extractObjectKey(loop.url);
                const deleteParams = {
                    Bucket: process.env.BUCKET_NAME,
                    Key: key
                };
                await s3Client.send(new DeleteObjectCommand(deleteParams));
                logger.info('Deleted S3 file for expired loop', { loopId: loop.id, key });
            }
        }

        await pool.query('DELETE FROM loops WHERE created_at < NOW() - INTERVAL 1 DAY');
        logger.info('Expired loops cleaned up from DB', { count: oldLoops.length });
    } catch (err) {
        logger.error('Error cleaning up loops:', err);
    }
    process.exit(0);
})();