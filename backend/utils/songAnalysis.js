const fs = require('fs');
const tmp = require('tmp');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('../config/database');
const s3Client = require('../config/tigris');
const logger = require('./logger');
const { extractObjectKey } = require('./storage');
const {
    analyzeAudioFeatures,
    KEY_CONFIDENCE_MIN,
    BPM_CONFIDENCE_MIN,
} = require('./audioFeatures');

// Shared by the analysis worker and by the backfill script's --inline mode, so
// a song analysed from the command line goes through exactly the same path as
// one analysed from the queue.

async function downloadToTemp(mp3Url) {
    const key = extractObjectKey(mp3Url);
    if (!key) throw new Error(`Unrecognised storage URL: ${mp3Url}`);

    const { Body } = await s3Client.send(new GetObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: key,
    }));

    const file = tmp.fileSync({ postfix: '.mp3', discardDescriptor: true });
    await new Promise((resolve, reject) => {
        Body.pipe(fs.createWriteStream(file.name))
            .on('finish', resolve)
            .on('error', reject);
    });
    return file;
}

/**
 * Detect tempo, key and duration for one song and write them to its row.
 *
 * Resolves to a summary of what was found and what was stored. Resolves with
 * `{ skipped: true }` if the song is gone. Marks the row 'failed' and rethrows
 * on any real error, so the caller can decide whether to retry.
 */
async function analyzeSong(songId) {
    const id = Number(songId);
    let sourceFile = null;

    const songs = await pool.query('SELECT mp3_url, title FROM songs WHERE id = ?', [id]);
    if (!songs.length) {
        // Deleted between being queued and being processed. Nothing to record.
        return { songId: id, skipped: true, reason: 'song no longer exists' };
    }
    const { mp3_url: mp3Url, title } = songs[0];
    if (!mp3Url) {
        await pool.query("UPDATE songs SET analysis_status = 'failed' WHERE id = ?", [id]);
        return { songId: id, title, skipped: true, reason: 'song has no audio file' };
    }

    await pool.query("UPDATE songs SET analysis_status = 'analyzing' WHERE id = ?", [id]);

    try {
        sourceFile = await downloadToTemp(mp3Url);
        const features = await analyzeAudioFeatures(sourceFile.name);

        // Both readings are suggestions, and a wrong one shown as fact is
        // worse than a blank. Percussion-only and atonal tracks score well
        // below the key threshold, which is exactly what should happen.
        const bpm = features.bpm !== null && features.bpmConfidence >= BPM_CONFIDENCE_MIN
            ? features.bpm
            : null;
        const musicalKey = features.key !== null && features.keyConfidence >= KEY_CONFIDENCE_MIN
            ? features.key
            : null;

        await pool.query(
            `UPDATE songs
             SET bpm = ?, musical_key = ?, duration = ?, analysis_status = 'done'
             WHERE id = ?`,
            [bpm, musicalKey, features.durationSec, id]
        );

        const result = {
            songId: id,
            title,
            skipped: false,
            storedBpm: bpm,
            storedKey: musicalKey,
            durationSec: features.durationSec,
            // Kept even when the value was not stored: this is what explains a
            // blank field to whoever is looking at the logs.
            detectedBpm: features.bpm,
            bpmConfidence: features.bpmConfidence,
            detectedKey: features.key,
            keyConfidence: features.keyConfidence,
            keyAlternative: features.keyAlternative,
        };
        logger.info('Analysed song audio', result);
        return result;
    } catch (err) {
        await pool.query(
            "UPDATE songs SET analysis_status = 'failed' WHERE id = ?",
            [id]
        ).catch(() => {});
        throw err;
    } finally {
        if (sourceFile) {
            try {
                sourceFile.removeCallback();
            } catch (cleanupErr) {
                logger.warn('Failed to remove analysis temp file', { songId: id, err: cleanupErr.message });
            }
        }
    }
}

module.exports = { analyzeSong, downloadToTemp };
