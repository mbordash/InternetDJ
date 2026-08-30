// Nightly logical backup of the MariaDB database to object storage.
//
// Runs on the cron machine, which is the only process group with
// mariadb-client installed by the dockerfile. The dump is streamed through
// gzip to a temp file rather than buffered, so memory stays flat as the
// database grows.
//
// The backup bucket MUST NOT be the bucket that serves songs and loops: that
// one is public-read (objects return 200 without credentials), and a dump key
// is guessable from the date, so writing there would publish the whole user
// database. The guard below refuses to run in that case.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const logger = require('../utils/logger');
require('dotenv').config();

const BACKUP_PREFIX = 'db-backups/';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 14;

const backupBucket = process.env.BACKUP_BUCKET_NAME;

if (!backupBucket) {
    logger.error('Backup aborted: BACKUP_BUCKET_NAME is not set');
    process.exit(1);
}

if (backupBucket === process.env.BUCKET_NAME) {
    logger.error(
        'Backup aborted: BACKUP_BUCKET_NAME matches the public asset bucket. ' +
        'Database dumps must go to a private bucket, or they become downloadable ' +
        'by anyone who guesses the object key.'
    );
    process.exit(1);
}

// Falls back to the main Tigris credentials so a single-bucket-per-key setup
// still works, but lets the backup bucket have its own scoped key.
const backupClient = new S3Client({
    region: process.env.BACKUP_AWS_REGION || process.env.AWS_REGION,
    endpoint: process.env.BACKUP_AWS_ENDPOINT_URL_S3 || process.env.AWS_ENDPOINT_URL_S3,
    credentials: {
        accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
    }
});

const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');

const dumpToFile = (destination) => new Promise((resolve, reject) => {
    const args = [
        '--single-transaction', // consistent snapshot without locking writers out
        '--quick',
        '--routines',
        '--triggers',
        '--no-tablespaces', // avoids needing the PROCESS privilege
        '--host', process.env.DB_HOST,
        '--port', String(process.env.DB_PORT || 3306),
        '--user', process.env.DB_USER,
        process.env.DB_NAME
    ];

    // Password via MYSQL_PWD instead of --password so it never appears in the
    // machine's process list.
    const child = spawn('mysqldump', args, {
        env: { ...process.env, MYSQL_PWD: process.env.DB_PASS }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);

    const finished = pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(destination));

    child.on('close', (code) => {
        if (code !== 0) {
            reject(new Error(`mysqldump exited ${code}: ${stderr.trim()}`));
            return;
        }
        finished.then(resolve, reject);
    });
});

const pruneOldBackups = async () => {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let continuationToken;
    let deleted = 0;

    do {
        const page = await backupClient.send(new ListObjectsV2Command({
            Bucket: backupBucket,
            Prefix: BACKUP_PREFIX,
            ContinuationToken: continuationToken
        }));

        for (const object of page.Contents || []) {
            if (object.LastModified && object.LastModified.getTime() < cutoff) {
                await backupClient.send(new DeleteObjectCommand({
                    Bucket: backupBucket,
                    Key: object.Key
                }));
                deleted += 1;
            }
        }

        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
};

(async () => {
    const key = `${BACKUP_PREFIX}${process.env.DB_NAME}-${timestamp()}.sql.gz`;
    const tempFile = path.join(os.tmpdir(), path.basename(key));

    try {
        await dumpToFile(tempFile);

        const { size } = await fs.promises.stat(tempFile);
        if (size === 0) {
            throw new Error('mysqldump produced an empty file');
        }

        await backupClient.send(new PutObjectCommand({
            Bucket: backupBucket,
            Key: key,
            Body: fs.createReadStream(tempFile),
            ContentLength: size,
            ContentType: 'application/gzip'
        }));

        logger.info('Database backup uploaded', { key, bytes: size });

        const deleted = await pruneOldBackups();
        if (deleted > 0) {
            logger.info('Pruned expired database backups', { deleted, retentionDays: RETENTION_DAYS });
        }
    } catch (err) {
        // Exit non-zero so a failed backup is visible in `fly logs` rather than
        // looking like a successful no-op.
        logger.error('Database backup failed:', err);
        process.exitCode = 1;
    } finally {
        await fs.promises.rm(tempFile, { force: true });
    }
})();
