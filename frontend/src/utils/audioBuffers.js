import * as Tone from 'tone';

import { toPlayableUrl } from './playableUrl';

/**
 * One download, one decode, per audio file, shared by everything on the page.
 *
 * The sampler used to fetch every clip's file twice: WaveSurfer downloaded and
 * decoded it to draw the waveform, and Tone downloaded and decoded it again to
 * play it. A project with two clips cut from the same file paid for that file
 * four times over. Both now come from here, keyed by URL, so a file is fetched
 * once however many clips are cut from it and however many components draw it.
 *
 * Decoding into Tone's own context matters: a buffer decoded elsewhere cannot
 * be handed to a Tone.Player without being copied, and the whole point of the
 * current signal path is that clips live in the same context as the synths.
 *
 * Everything goes through the audio proxy. The storage bucket only sends
 * Access-Control-Allow-Origin when a request carries an Origin header, so a
 * decode fetched straight from it is at the mercy of whatever cached the file
 * first; see utils/playableUrl.js for the full story.
 *
 * The cache holds promises rather than results, so two clips asking for the
 * same file at the same moment share one request instead of racing.
 */
const cache = new Map();

/** Discard a failed entry so a later attempt is not stuck with the rejection. */
const forget = (url) => { cache.delete(url); };

/**
 * The decoded audio for a URL, as a Tone buffer.
 * Rejects if the file cannot be fetched or decoded; callers decide what that
 * means for them.
 */
export function getToneBuffer(url) {
    if (!url) return Promise.reject(new Error('No audio URL'));
    if (cache.has(url)) return cache.get(url);

    const pending = (async () => {
        const response = await fetch(toPlayableUrl(url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        // Tone's context, so the result can be attached to a Player directly.
        const decoded = await Tone.getContext().rawContext.decodeAudioData(bytes);
        return new Tone.ToneAudioBuffer(decoded);
    })();

    pending.catch(() => forget(url));
    cache.set(url, pending);
    return pending;
}

/** Length in seconds, or 0 if the file cannot be read. Never rejects. */
export async function getDuration(url) {
    try {
        const buffer = await getToneBuffer(url);
        return buffer.duration || 0;
    } catch (_) {
        return 0;
    }
}

/**
 * Durations for a set of clips, keyed by clip id.
 *
 * A clip whose row already carries a duration is taken as read and never
 * fetched, so an established project costs no network at all here.
 */
export async function loadSampleDurations(samples = []) {
    const durations = {};
    const missing = [];

    for (const sample of samples) {
        const cached = Number(sample.duration);
        if (Number.isFinite(cached) && cached > 0) durations[sample.id] = cached;
        else missing.push(sample);
    }

    if (missing.length > 0) {
        const results = await Promise.all(missing.map((s) => getDuration(s.mp3_url)));
        missing.forEach((sample, i) => { durations[sample.id] = results[i]; });
    }

    return { durations, fetched: missing.length };
}

/**
 * Peak amplitudes for drawing, as one value per horizontal pixel bucket.
 *
 * Returns the loudest absolute sample in each bucket rather than averaging,
 * because an average flattens percussive material into a grey smear: a kick
 * pattern should look like a kick pattern. Channels are folded together, since
 * the waveform is a thumbnail and not a stereo analysis.
 *
 * `from` and `to` are seconds, so a trimmed clip can draw only the region it
 * actually plays instead of the whole file.
 */
export function peaksFromBuffer(buffer, buckets, { from = 0, to = null } = {}) {
    const audio = buffer.get ? buffer.get() : buffer; // Tone buffer or raw
    if (!audio || !buckets) return new Float32Array(0);

    const rate = audio.sampleRate;
    const start = Math.max(0, Math.floor(from * rate));
    const end = Math.min(audio.length, Math.floor((to == null ? audio.duration : to) * rate));
    const span = Math.max(0, end - start);
    if (span === 0) return new Float32Array(buckets);

    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c += 1) channels.push(audio.getChannelData(c));

    const peaks = new Float32Array(buckets);
    const step = span / buckets;

    for (let i = 0; i < buckets; i += 1) {
        const lo = start + Math.floor(i * step);
        const hi = Math.min(end, start + Math.floor((i + 1) * step));
        let peak = 0;
        for (const data of channels) {
            // Stride on long files: a full scan of a five minute track per
            // bucket is a lot of work for a forty pixel high picture, and the
            // loudest sample in a bucket survives sampling every few frames.
            const stride = Math.max(1, Math.floor((hi - lo) / 512));
            for (let n = lo; n < hi; n += stride) {
                const v = data[n] < 0 ? -data[n] : data[n];
                if (v > peak) peak = v;
            }
        }
        peaks[i] = peak > 1 ? 1 : peak;
    }
    return peaks;
}

/** Drop everything. Only useful in tests. */
export function clearAudioBufferCache() {
    cache.clear();
}
