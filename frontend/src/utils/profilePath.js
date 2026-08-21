/**
 * Where a profile lives.
 *
 * A profile always answers to its numeric id, and additionally to its slug once
 * the artist has set one. Links should prefer the slug so the pretty address is
 * what gets copied, shared and indexed — but the numeric id is always a valid
 * fallback, so a payload that predates the slug column still links correctly.
 *
 * Payload shapes differ: a song carries `profile_slug` / `profile_id`, while a
 * profile object carries `slug` / `id`. Both are handled.
 */
export function profilePath(source, fallbackId = null) {
    const slug = source?.profile_slug || source?.slug || null;
    const id = source?.profile_id ?? source?.id ?? fallbackId;
    const address = slug || id;
    // Without either, send the visitor somewhere real rather than /profile/undefined.
    if (address === null || address === undefined || address === '') return '/browse';
    return `/profile/${encodeURIComponent(address)}`;
}

export default profilePath;
