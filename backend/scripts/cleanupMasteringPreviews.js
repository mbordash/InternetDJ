/**
 * Auto-master previews are disposable: the artist either saves one (which
 * copies the audio into a real song upload) or walks away. This sweeps the
 * ones nobody kept, plus the job rows that reference them.
 *
 * Only objects under the preview prefix are touched, so a bug here can never
 * reach published song audio.
 */
const pool = require('../config/database');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/tigris');
const logger = require('../utils/logger');
const { extractObjectKey } = require('../utils/storage');
const { PREVIEW_PREFIX } = require('../utils/masteringQueue');

const RETENTION_HOURS = 24;

(async () => {
    try {
        const expired = await pool.query(
            `SELECT id, result_url FROM mastering_jobs
             WHERE created_at < NOW() - INTERVAL ? HOUR`,
            [RETENTION_HOURS]
        );

        let deleted = 0;
        for (const job of expired) {
            if (!job.result_url) continue;
            const key = extractObjectKey(job.result_url);
            if (!key || !key.startsWith(PREVIEW_PREFIX)) {
                logger.error('Refusing to delete unexpected key for mastering job', { jobId: job.id, key });
                continue;
            }
            try {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.BUCKET_NAME,
                    Key: key,
                }));
                deleted += 1;
            } catch (err) {
                logger.error('Failed to delete mastering preview', { jobId: job.id, key, err: err.message });
            }
        }

        await pool.query(
            'DELETE FROM mastering_jobs WHERE created_at < NOW() - INTERVAL ? HOUR',
            [RETENTION_HOURS]
        );
        logger.info('Mastering previews cleaned up', { rows: expired.length, objectsDeleted: deleted });
    } catch (err) {
        logger.error('Error cleaning up mastering previews:', err);
    }
    process.exit(0);
})();
