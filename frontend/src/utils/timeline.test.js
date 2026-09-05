import {
    timeScaleFor,
    unitsToReal,
    realToUnits,
    getClipTimes,
    clipWindow,
    isClipActive,
    clipSeekSeconds,
    fadePlan,
    timelineLength,
    trackGain,
    clipGain,
    mixFromTracks,
} from './timeline';

// Every project on the site is at 120 BPM, where timeScale is 1 and a wrong
// conversion is invisible. These tests deliberately work at other tempos.
const AT_120 = timeScaleFor(120); // 1
const AT_90 = timeScaleFor(90);   // 1.333...
const AT_160 = timeScaleFor(160); // 0.75

describe('unit conversion', () => {
    it('is identity at the reference tempo', () => {
        expect(AT_120).toBe(1);
        expect(unitsToReal(4, AT_120)).toBe(4);
        expect(realToUnits(4, AT_120)).toBe(4);
    });

    it('makes a slower tempo take longer in real time', () => {
        // One bar is 2 units at every tempo. At 90 BPM it lasts 2.667 seconds.
        expect(unitsToReal(2, AT_90)).toBeCloseTo(2.6667, 4);
        expect(unitsToReal(2, AT_160)).toBeCloseTo(1.5, 4);
    });

    it('round-trips', () => {
        for (const scale of [AT_90, AT_120, AT_160]) {
            expect(realToUnits(unitsToReal(3.7, scale), scale)).toBeCloseTo(3.7, 10);
        }
    });

    // The public player computed its playhead as elapsed * timeScale where the
    // editor divides. This is the regression that produced.
    it('does not confuse multiply with divide away from 120 BPM', () => {
        const elapsedReal = 4;
        const correct = realToUnits(elapsedReal, AT_90);
        const theOldPublicPlayerBug = elapsedReal * AT_90;
        expect(correct).toBeCloseTo(3, 6);
        expect(theOldPublicPlayerBug).toBeCloseTo(5.3333, 4);
        expect(correct).not.toBeCloseTo(theOldPublicPlayerBug, 3);
    });
});

describe('getClipTimes', () => {
    it('defaults trim_end to the end of the file', () => {
        expect(getClipTimes({ trim_start: 0, trim_end: null }, 10))
            .toEqual({ trimStart: 0, trimEnd: 10, effDuration: 10 });
    });

    it('honours a trim', () => {
        expect(getClipTimes({ trim_start: 2, trim_end: 7 }, 10))
            .toEqual({ trimStart: 2, trimEnd: 7, effDuration: 5 });
    });

    it('clamps a trim that outlived its audio', () => {
        // A song version can replace the file with a shorter one.
        expect(getClipTimes({ trim_start: 1, trim_end: 30 }, 10).effDuration).toBe(9);
    });

    it('never returns a negative duration', () => {
        expect(getClipTimes({ trim_start: 8, trim_end: 3 }, 10).effDuration).toBe(0);
    });

    it('treats missing trim fields as no trim', () => {
        expect(getClipTimes({}, 6).effDuration).toBe(6);
    });
});

describe('clipWindow', () => {
    it('keeps start in units and converts the length', () => {
        // A 3 second clip at unit 4, played at 160 BPM, covers 4 units.
        const w = clipWindow({ start_time: 4, trim_start: 0, trim_end: null }, 3, AT_160);
        expect(w.startUnits).toBe(4);
        expect(w.endUnits).toBeCloseTo(8, 6);
    });

    it('covers fewer units at a slower tempo', () => {
        const w = clipWindow({ start_time: 0, trim_start: 0, trim_end: null }, 4, AT_90);
        expect(w.endUnits).toBeCloseTo(3, 6);
    });

    it('is zero-length for a fully trimmed clip', () => {
        const w = clipWindow({ start_time: 2, trim_start: 5, trim_end: 5 }, 10, AT_120);
        expect(w.endUnits).toBe(2);
        expect(isClipActive(2, w)).toBe(false);
    });
});

describe('isClipActive', () => {
    const w = clipWindow({ start_time: 2, trim_start: 0, trim_end: null }, 2, AT_120);

    it('includes the start and excludes the end', () => {
        expect(isClipActive(1.99, w)).toBe(false);
        expect(isClipActive(2, w)).toBe(true);
        expect(isClipActive(3.99, w)).toBe(true);
        expect(isClipActive(4, w)).toBe(false);
    });
});

describe('clipSeekSeconds', () => {
    it('adds the trim offset', () => {
        const w = clipWindow({ start_time: 0, trim_start: 1.5, trim_end: null }, 10, AT_120);
        expect(clipSeekSeconds(0, w, AT_120)).toBeCloseTo(1.5, 6);
        expect(clipSeekSeconds(2, w, AT_120)).toBeCloseTo(3.5, 6);
    });

    it('converts elapsed units into real seconds of audio', () => {
        // 3 units into the clip at 90 BPM is 4 real seconds of audio.
        const w = clipWindow({ start_time: 1, trim_start: 0, trim_end: null }, 20, AT_90);
        expect(clipSeekSeconds(4, w, AT_90)).toBeCloseTo(4, 6);
    });

    it('never seeks before the trim start', () => {
        const w = clipWindow({ start_time: 5, trim_start: 2, trim_end: null }, 10, AT_120);
        expect(clipSeekSeconds(0, w, AT_120)).toBe(2);
    });
});

describe('fadePlan', () => {
    it('is a flat pass-through with no fades', () => {
        expect(fadePlan({ fade_in: 0, fade_out: 0 }, 0, 5))
            .toEqual({ startValue: 1, rampIn: null, holdOut: null, rampOut: null });
    });

    it('starts at silence and ramps up from the top of a clip', () => {
        const p = fadePlan({ fade_in: 2, fade_out: 0 }, 0, 10);
        expect(p.startValue).toBe(0);
        expect(p.rampIn).toEqual({ to: 1, at: 2 });
    });

    // Seeking into a fade should not restart it from zero.
    it('starts partway up when entering mid fade-in', () => {
        const p = fadePlan({ fade_in: 4, fade_out: 0 }, 3, 10);
        expect(p.startValue).toBeCloseTo(0.75, 6);
        expect(p.rampIn).toEqual({ to: 1, at: 1 });
    });

    it('is already at full level past the fade-in', () => {
        const p = fadePlan({ fade_in: 2, fade_out: 0 }, 5, 10);
        expect(p.startValue).toBe(1);
        expect(p.rampIn).toBeNull();
    });

    it('schedules the fade-out against the time remaining', () => {
        const p = fadePlan({ fade_in: 0, fade_out: 3 }, 2, 10);
        expect(p.holdOut).toEqual({ value: 1, at: 5 });
        expect(p.rampOut).toEqual({ to: 0, at: 8 });
    });

    it('caps a fade longer than the clip', () => {
        const p = fadePlan({ fade_in: 99, fade_out: 0 }, 0, 4);
        expect(p.rampIn).toEqual({ to: 1, at: 4 });
    });

    it('does not let a fade-out start before the fade-in finishes', () => {
        const p = fadePlan({ fade_in: 6, fade_out: 6 }, 0, 8);
        expect(p.rampIn.at).toBe(6);
        expect(p.holdOut.at).toBe(6);
        expect(p.rampOut.at).toBe(8);
    });

    // Entering a clip that is already fading out. This used to jump to full
    // level and compress the remaining fade, so seeking into a fading clip came
    // back louder than the clip you seeked into.
    it('carries on down when entering mid fade-out', () => {
        const p = fadePlan({ fade_in: 0, fade_out: 3 }, 9, 10);
        expect(p.startValue).toBeCloseTo(1 / 3, 6);
        expect(p.holdOut).toBeNull();
        expect(p.rampOut).toEqual({ to: 0, at: 1 });
    });

    it('takes the quieter fade when a short clip is inside both', () => {
        // 4s clip, 3s in and 3s out, entered at 2s: 2/3 up the in, 2/3 down the out.
        const p = fadePlan({ fade_in: 3, fade_out: 3 }, 2, 4);
        expect(p.startValue).toBeCloseTo(2 / 3, 6);
    });

    it('is silent at the exact end of a fade-out', () => {
        const p = fadePlan({ fade_in: 0, fade_out: 2 }, 10, 10);
        expect(p.startValue).toBe(0);
    });

    it('has nothing left to do at the very end of a clip', () => {
        const p = fadePlan({ fade_in: 0, fade_out: 2 }, 10, 10);
        expect(p.holdOut).toBeNull();
        expect(p.rampOut).toBeNull();
    });
});

describe('timelineLength', () => {
    it('falls back to the minimum for an empty project', () => {
        expect(timelineLength({ timeScale: AT_120 })).toBe(30);
    });

    it('extends past the last clip with a buffer', () => {
        const length = timelineLength({
            projectSamples: [{ id: 1, start_time: 40, trim_start: 0, trim_end: null }],
            sampleDurations: { 1: 5 },
            timeScale: AT_120,
        });
        expect(length).toBe(55);
    });

    // Notes are musical, like clips: they hold their bar position across a
    // tempo change, so their stored times are units and never convert.
    it('accounts for MIDI notes, whose times are already units', () => {
        for (const scale of [AT_90, AT_120, AT_160]) {
            const length = timelineLength({
                tracks: [{ track_type: 'midi', midi_notes: [{ start_time: 30, duration: 2 }] }],
                timeScale: scale,
            });
            expect(length).toBe(42);
        }
    });

    it('ignores MIDI notes on non-MIDI tracks', () => {
        const length = timelineLength({
            tracks: [{ track_type: 'sample', midi_notes: [{ start_time: 300, duration: 2 }] }],
            timeScale: AT_120,
        });
        expect(length).toBe(30);
    });

    it('takes the later of clips and notes', () => {
        const length = timelineLength({
            projectSamples: [{ id: 1, start_time: 10, trim_start: 0, trim_end: null }],
            sampleDurations: { 1: 2 },
            tracks: [{ track_type: 'midi', midi_notes: [{ start_time: 50, duration: 1 }] }],
            timeScale: AT_120,
        });
        expect(length).toBe(61);
    });
});

describe('trackGain', () => {
    it('defaults to unity', () => {
        expect(trackGain(1, {})).toBe(1);
    });

    it('uses the track volume', () => {
        expect(trackGain(1, { trackVolumes: { 1: 0.4 } })).toBeCloseTo(0.4, 6);
    });

    it('silences a muted track', () => {
        expect(trackGain(1, { trackVolumes: { 1: 0.8 }, mutedTrackIds: [1] })).toBe(0);
    });

    it('silences everything not soloed, mute state notwithstanding', () => {
        const mix = { trackVolumes: { 1: 0.5, 2: 0.9 }, soloTrackIds: [2] };
        expect(trackGain(1, mix)).toBe(0);
        expect(trackGain(2, mix)).toBeCloseTo(0.9, 6);
    });

    it('lets solo win over mute on the soloed track itself', () => {
        expect(trackGain(2, { soloTrackIds: [2], mutedTrackIds: [2] })).toBe(1);
    });
});

describe('clipGain', () => {
    it('multiplies clip level by track level', () => {
        expect(clipGain({ track_id: 1, volume: 0.5 }, { trackVolumes: { 1: 0.5 } })).toBeCloseTo(0.25, 6);
    });

    it('treats a null clip volume as unity', () => {
        // The API returns null for clips that never had a level set.
        expect(clipGain({ track_id: 1, volume: null }, { trackVolumes: { 1: 0.6 } })).toBeCloseTo(0.6, 6);
    });

    it('is silent on a muted track whatever the clip level', () => {
        expect(clipGain({ track_id: 1, volume: 1 }, { mutedTrackIds: [1] })).toBe(0);
    });
});

describe('mixFromTracks', () => {
    // The public player has only the track rows to go on, so this derivation is
    // what makes a visitor hear the arrangement the artist actually made. The
    // old public player ignored all of it: muted tracks played, at full level.
    const tracks = [
        { id: 1, volume: 0.5, pan: -0.3, is_muted: 0 },
        { id: 2, volume: 1, pan: 0, is_muted: 1 },
        { id: 3, is_muted: 0 },
    ];

    it('reads levels and pans off the rows', () => {
        const m = mixFromTracks(tracks);
        expect(m.trackVolumes).toEqual({ 1: 0.5, 2: 1, 3: 1 });
        expect(m.trackPans).toEqual({ 1: -0.3, 2: 0, 3: 0 });
    });

    it('collects the muted tracks', () => {
        expect(mixFromTracks(tracks).mutedTrackIds).toEqual([2]);
    });

    it('never solos, because solo is not part of a saved arrangement', () => {
        expect(mixFromTracks(tracks).soloTrackIds).toEqual([]);
    });

    it('silences a muted track and keeps the others at their level', () => {
        const m = mixFromTracks(tracks);
        expect(trackGain(1, m)).toBeCloseTo(0.5, 6);
        expect(trackGain(2, m)).toBe(0);
        expect(trackGain(3, m)).toBe(1);
    });

    it('defaults a bare track to unity and centre', () => {
        const m = mixFromTracks([{ id: 9 }]);
        expect(trackGain(9, m)).toBe(1);
        expect(m.trackPans[9]).toBe(0);
    });

    it('copes with no tracks', () => {
        expect(mixFromTracks()).toEqual({
            trackVolumes: {}, trackPans: {}, mutedTrackIds: [], soloTrackIds: [],
        });
    });
});
