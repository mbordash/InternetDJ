import API_URL from './api';

/**
 * The URL to actually fetch a bucket audio file from.
 *
 * Everything on the site that puts audio through Web Audio goes via the backend
 * proxy, because the storage bucket sends no `Access-Control-Allow-Origin` and
 * a cross-origin fetch of the file is therefore blocked. A plain `<audio>`
 * element does not care, which is why a media element can point straight at the
 * bucket and a decode cannot.
 *
 * The multitrack sampler used to be in the first category and quietly became
 * part of the second: clips moved from WaveSurfer, which played through a media
 * element, to Tone.Player, which downloads and decodes the file so it can run
 * through the effects graph. Same file, same bucket, but now a fetch, so every
 * clip failed to load with a CORS error and nothing on an audio track would
 * play.
 *
 * The proxy also carries the byte-range handling that seeking depends on, and
 * it has its own rate-limit bucket in server.js, so audio traffic does not eat
 * the shared API budget.
 */
export const toPlayableUrl = (url) =>
    url ? `${API_URL}/proxy/audio?url=${encodeURIComponent(url)}` : '';

export default toPlayableUrl;
