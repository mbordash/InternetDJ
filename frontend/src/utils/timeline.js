/**
 * Timeline arithmetic for the multitrack sampler.
 *
 * The timeline x-axis is MUSICAL time, expressed in "timeline units": seconds
 * measured at the 120 BPM reference tempo. One beat is always 0.5 units and one
 * bar always 2 units, at every tempo, so the grid and the clips on it never move
 * when the project tempo changes. What tempo changes is how fast the playhead
 * crosses that fixed canvas:
 *
 *     realSeconds = timelineUnits * timeScale,    timeScale = 120 / bpm
 *
 * Drop to 90 BPM and timeScale becomes 1.333, so the same bar takes a third
 * longer to play: the song slows down, the ruler stays put. At 120 BPM timeScale
 * is exactly 1 and units and real seconds coincide, which is the reason this was
 * able to go wrong unnoticed for so long. Every project on the site is currently
 * at 120 BPM, so an inverted conversion looks perfect until someone changes the
 * tempo.
 *
 * Stored in UNITS: playhead position, timeline duration, audio clip start_time,
 * and MIDI note start_time and duration.
 * Stored in REAL SECONDS: audio file and clip durations, fade lengths, and
 * anything handed to an AudioContext or a Tone transport.
 *
 * MIDI notes being units is easy to get wrong, and the comment at the top of
 * MultitrackSampler.js had them listed as real seconds. Three places prove
 * otherwise: the timeline length calculation adds note times straight into a
 * unit total without converting, the transport schedules them through
 * unitsToReal, and PianoRoll draws them at start_time * pixelsPerSecond on the
 * same grid the clips use. Notes are musical, so they hold their bar position
 * when the tempo changes, exactly like clips do.
 *
 * Convert at the boundary; never add one to the other.
 *
 * This module exists because the editor and the public player each had their own
 * copy of these conversions and they did not agree: the public player multiplied
 * where the editor divided, so its playhead ran at timeScale squared and its
 * samples and MIDI drifted apart at any tempo but 120. Both now import from here.
 */

export const timeScaleFor = (bpm) => 120 / (bpm || 120);

export const unitsToReal = (timelineUnits, timeScale) => timelineUnits * timeScale;
export const realToUnits = (realSeconds, timeScale) => realSeconds / timeScale;

/**
 * Where a clip starts and stops inside its source file, in real seconds.
 *
 * `trim_end` of null means "to the end of the file". A trim_end past the end of
 * the file is clamped, because a stored trim can outlive the audio it described
 * once a song version replaces the file underneath it.
 */
export const getClipTimes = (sample, fullDuration) => {
    const trimStart = Math.max(0, sample.trim_start || 0);
    const rawEnd = sample.trim_end != null ? sample.trim_end : (fullDuration || 0);
    const trimEnd = fullDuration ? Math.min(rawEnd, fullDuration) : rawEnd;
    return { trimStart, trimEnd, effDuration: Math.max(0, trimEnd - trimStart) };
};

/**
 * Where a clip sits on the timeline, in units, given its source duration.
 *
 * The start is stored in units already. The length has to be converted, because
 * the audio plays for a fixed number of real seconds however fast the timeline
 * is moving: a two second clip covers two units at 120 BPM and one and a half
 * units at 160.
 */
export const clipWindow = (sample, fullDuration, timeScale) => {
    const { trimStart, trimEnd, effDuration } = getClipTimes(sample, fullDuration);
    const startUnits = sample.start_time || 0;
    return {
        trimStart,
        trimEnd,
        effDuration,
        startUnits,
        endUnits: startUnits + realToUnits(effDuration, timeScale),
    };
};

/** Is the playhead, in units, inside this clip? */
export const isClipActive = (playheadUnits, window) =>
    playheadUnits >= window.startUnits && playheadUnits < window.endUnits;

/**
 * How far into the clip's audio the playhead is, in real seconds, including the
 * trim offset. This is what a player should be seeked to.
 */
export const clipSeekSeconds = (playheadUnits, window, timeScale) =>
    window.trimStart + unitsToReal(Math.max(0, playheadUnits - window.startUnits), timeScale);

/**
 * The gain envelope for a clip that starts playing `clipOffset` real seconds in.
 *
 * Returned as a plan rather than applied, so it can be tested without an
 * AudioContext and applied identically to any gain node. Times are real seconds
 * relative to the moment playback starts.
 *
 * Entering a clip midway through its fade-in starts partway up the ramp rather
 * than at zero, which is what makes a seek into a fading clip sound continuous
 * instead of re-fading from silence.
 */
export const fadePlan = (sample, clipOffset, effDuration) => {
    const fadeIn = Math.min(sample.fade_in || 0, effDuration);
    const fadeOut = Math.min(sample.fade_out || 0, effDuration);
    const remaining = Math.max(0, effDuration - clipOffset);
    const clamp = (v) => Math.max(0, Math.min(1, v));

    // The level the envelope is already at, entering here. Both fades are
    // considered: a short clip can be inside its fade-in and its fade-out at the
    // same time, and the quieter of the two wins.
    const inFactor = fadeIn > 0 ? clamp(clipOffset / fadeIn) : 1;
    const outFactor = fadeOut > 0 ? clamp(remaining / fadeOut) : 1;
    const startValue = Math.min(inFactor, outFactor);

    const plan = { startValue, rampIn: null, holdOut: null, rampOut: null };

    const fadeInEnd = clipOffset < fadeIn ? fadeIn - clipOffset : 0;
    if (clipOffset < fadeIn) {
        plan.rampIn = { to: 1, at: fadeInEnd };
    }

    if (fadeOut > 0 && remaining > 0) {
        if (remaining > fadeOut) {
            // The fade-out is still ahead: hold, then ramp.
            plan.holdOut = { value: 1, at: Math.max(remaining - fadeOut, fadeInEnd) };
            plan.rampOut = { to: 0, at: remaining };
        } else {
            // Already inside it. Carry on down from startValue rather than
            // jumping to full level and fading the rest in the time left, which
            // is what this did before and made a seek into a fading clip louder
            // than the clip it seeked into.
            plan.rampOut = { to: 0, at: remaining };
        }
    }
    return plan;
};

/**
 * How long the timeline should be, in units.
 *
 * Audio clip ends and MIDI note ends are both taken into account. Clip
 * start_times are already units and their durations convert; MIDI note times
 * are units throughout and need no conversion at all.
 */
export const timelineLength = (
    { projectSamples = [], tracks = [], sampleDurations = {}, timeScale, bufferUnits = 10, minUnits = 30 }
) => {
    let maxEndUnits = 0;

    for (const sample of projectSamples) {
        const fullDuration = sampleDurations[sample.id] || 0;
        const { endUnits } = clipWindow(sample, fullDuration, timeScale);
        if (endUnits > maxEndUnits) maxEndUnits = endUnits;
    }

    for (const track of tracks) {
        if (track.track_type !== 'midi' || !Array.isArray(track.midi_notes)) continue;
        for (const note of track.midi_notes) {
            const endUnits = (note.start_time || 0) + (note.duration || 0);
            if (endUnits > maxEndUnits) maxEndUnits = endUnits;
        }
    }

    return Math.max(maxEndUnits + bufferUnits, minUnits);
};

/**
 * The effective gain for a track, folding in mute and any soloing elsewhere.
 *
 * A soloed track anywhere silences every track that is not soloed, which is the
 * behaviour people expect from a mixer and is why this cannot be decided from
 * one track's own row.
 */
export const trackGain = (trackId, { trackVolumes = {}, mutedTrackIds = [], soloTrackIds = [] }) => {
    const soloed = soloTrackIds.length > 0;
    const audible = soloed ? soloTrackIds.includes(trackId) : !mutedTrackIds.includes(trackId);
    return audible ? (trackVolumes[trackId] ?? 1) : 0;
};

/** A clip's gain: its own level against its track's. */
export const clipGain = (sample, mix) =>
    (sample.volume ?? 1) * trackGain(sample.track_id, mix);

/**
 * The mix, derived from the track rows alone.
 *
 * The editor keeps volume, pan, mute and solo in its own state, because all
 * four are live controls there. A read-only player has only what the API
 * returned, and every one of those values is on the track row. Deriving it here
 * rather than inside the player is what lets one engine serve both: the gain
 * maths never has to know which page it is running on.
 *
 * There is no solo: soloing is a monitoring decision an artist makes while
 * working, not part of the arrangement, and it is not persisted.
 */
export const mixFromTracks = (tracks = []) => ({
    trackVolumes: Object.fromEntries(tracks.map((t) => [t.id, t.volume ?? 1])),
    trackPans: Object.fromEntries(tracks.map((t) => [t.id, t.pan ?? 0])),
    mutedTrackIds: tracks.filter((t) => t.is_muted).map((t) => t.id),
    soloTrackIds: [],
});
