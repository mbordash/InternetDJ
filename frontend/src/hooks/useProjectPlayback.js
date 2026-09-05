import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';

import synthConfigs from '../config/synthConfigs';
import { getToneBuffer } from '../utils/audioBuffers';
import {
    timeScaleFor,
    unitsToReal,
    realToUnits,
    clipWindow,
    clipSeekSeconds,
    fadePlan,
    trackGain,
    mixFromTracks,
} from '../utils/timeline';

/**
 * Playback for a multitrack project: the transport, the per-clip players, the
 * synths, the mix, the fades and the playhead loop.
 *
 * There were two copies of this. The editor's was correct and had grown clip
 * trimming, fades, per-clip volume, pan, mute and solo; the public player was a
 * fork from before most of that existed, and it had drifted rather than simply
 * lagged. It multiplied where the editor divided, so its playhead ran at
 * timeScale squared and its samples and MIDI pulled apart at any tempo but 120.
 * It ignored trim, fades, clip volume, and every track's volume, pan and mute,
 * so a visitor heard a different arrangement from the one the artist made, with
 * muted tracks audible. And it closed the shared Tone context on unmount, which
 * silenced MIDI in the editor for the rest of the session.
 *
 * None of that was going to stay fixed while the fix had to be applied twice.
 * So there is one engine now, and the public player is the same engine with
 * `readOnly` set: no metronome, no seeking, and no reacting to edits, because
 * there are none.
 *
 * ── The signal path ─────────────────────────────────────────────────────────
 *
 *   Tone.Player ─→ fade gain ─→ clip gain ─┐
 *                                          ├─→ track bus ─→ effects ─→ pan ─→ out
 *   synth ─────────────────────────────────┘
 *
 * Everything runs in Tone's own context, which is the point of this
 * arrangement. Audio clips used to play through WaveSurfer, whose WebAudio
 * backend builds a private AudioContext per player, so the reverb, delay and
 * distortion nodes this file created had no input: they were constructed,
 * connected to the destination, and fed nothing. The knobs rendered, the
 * settings saved, and nothing an artist did with them was ever audible on an
 * audio track. Only MIDI tracks, whose synths were already Tone nodes, heard
 * their effects. Those private contexts were also never closed, because
 * WaveSurfer's WebAudioPlayer has no teardown, so a few play cycles on a busy
 * project marched toward the browser's cap on live AudioContexts.
 *
 * Playing clips through Tone.Player fixes both at once. WaveSurfer is still the
 * right tool for drawing a waveform, and SampleBlock still uses it for exactly
 * that; it is no longer asked to be a mixer as well.
 *
 * The bus is per track rather than per clip, which is what the UI has always
 * implied: effects and pan belong to a track, and every clip on it should share
 * one reverb rather than each running its own. The previous code built a chain
 * per clip and stored it under the track id, so on a track with three clips two
 * chains were orphaned the moment they were made.
 *
 * ── What lives where ────────────────────────────────────────────────────────
 * Timing conversions are in utils/timeline.js and unit tested; this file owns
 * the audio graph and is the part that needs a browser. Anything decidable
 * without an AudioContext belongs over there, not here.
 *
 * ── Options ─────────────────────────────────────────────────────────────────
 *   tracks, projectSamples, sampleDurations, bpm, timelineDuration
 *   mix              { trackVolumes, trackPans, mutedTrackIds, soloTrackIds }
 *   metronome        boolean, editor only
 *   readOnly         no seek, no metronome, no live re-mixing
 *   onError          surfaces a message; the caller decides how to show it
 */
export default function useProjectPlayback({
    tracks = [],
    projectSamples = [],
    sampleDurations = {},
    bpm = 120,
    timelineDuration = 30,
    mix = {},
    metronome = false,
    readOnly = false,
    onError,
    onFrame,
} = {}) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [playheadPosition, setPlayheadPosition] = useState(0);

    // Everything the rAF loop and the async play path touch lives in refs. They
    // outlive any single render, and reading them from a closure created three
    // renders ago was the source of more than one bug in the originals.
    const clipsRef = useRef({});   // sampleId -> { player, fadeGain, gain, active }
    const busesRef = useRef({});   // trackId  -> { input, effects, panner, signature }
    const synthsRef = useRef({});
    const rafRef = useRef(null);
    const startTimeRef = useRef(0);
    const fallbackCounterRef = useRef(0);
    const isPlayingRef = useRef(false);
    const playheadRef = useRef(0);
    const metronomeOnRef = useRef(metronome);
    const metronomeSynthRef = useRef(null);
    const metronomeNextBeatRef = useRef(0);
    // Bumped by every play, pause, stop and seek. `play` awaits audio loading,
    // so a second press while the first is still loading would otherwise leave
    // two rAF loops running against one transport.
    const generationRef = useRef(0);

    // Latest props, for the same reason.
    const latest = useRef({});
    latest.current = { tracks, projectSamples, sampleDurations, bpm, timelineDuration, mix };

    useEffect(() => { metronomeOnRef.current = metronome; }, [metronome]);
    useEffect(() => { playheadRef.current = playheadPosition; }, [playheadPosition]);

    // Called on every animation frame with the playhead in units, for callers
    // that want to move a DOM node without a React render. See the note on
    // publishing below.
    const onFrameRef = useRef(onFrame);
    onFrameRef.current = onFrame;
    const lastPublishRef = useRef(0);

    const report = useCallback((message) => {
        if (onError) onError(message);
        else console.warn(message);
    }, [onError]);

    const dispose = (node) => {
        try { node?.dispose(); } catch (_) { /* already gone */ }
    };

    // ── The mix ─────────────────────────────────────────────────────────────

    /**
     * The mix, normalised. The editor keeps volume, pan, mute and solo in its
     * own state; the public player has only the track rows. Both arrive here as
     * the same shape so the gain maths does not have to know which page it is.
     */
    const currentMix = () => {
        const { mix: m, tracks: t } = latest.current;
        if (m && (m.trackVolumes || m.mutedTrackIds || m.soloTrackIds || m.trackPans)) return m;
        return mixFromTracks(t);
    };

    // Track level lives on the bus and clip level on the clip, so the two
    // multiply in the graph rather than in arithmetic. Their product is what
    // clipGain() computes, which is what the tests still pin down.
    const clipOwnGain = (sample) => sample.volume ?? 1;

    // ── The track bus ───────────────────────────────────────────────────────

    const disposeBus = (bus) => {
        bus.effects.forEach(dispose);
        dispose(bus.panner);
        dispose(bus.input);
    };

    const disposeAllBuses = () => {
        Object.values(busesRef.current).forEach(disposeBus);
        busesRef.current = {};
    };

    /**
     * One bus per track: level, then its effects in series, then pan, then out.
     * Clips and synths on that track both feed it.
     *
     * Rebuilt only when the track's effects actually change, so pressing play
     * twice does not churn the graph and a reverb tail is not cut off.
     */
    const ensureTrackBus = (track, m) => {
        const signature = JSON.stringify(track.effects_settings || {});
        const existing = busesRef.current[track.id];

        if (existing && existing.signature === signature) {
            existing.input.gain.value = trackGain(track.id, m);
            existing.panner.pan.value = m.trackPans?.[track.id] ?? 0;
            return existing;
        }
        if (existing) disposeBus(existing);

        const input = new Tone.Gain(trackGain(track.id, m));
        const panner = new Tone.Panner(m.trackPans?.[track.id] ?? 0);
        const settings = track.effects_settings || {};
        const effects = [];

        let tail = input;
        if (settings.reverb) {
            const node = new Tone.Reverb({ decay: settings.reverb.decay, wet: settings.reverb.wet });
            tail.connect(node); tail = node; effects.push(node);
        }
        if (settings.delay) {
            const node = new Tone.FeedbackDelay({ delayTime: settings.delay.delayTime, wet: settings.delay.wet });
            tail.connect(node); tail = node; effects.push(node);
        }
        if (settings.distortion) {
            const node = new Tone.Distortion({ distortion: settings.distortion.distortion, wet: settings.distortion.wet });
            tail.connect(node); tail = node; effects.push(node);
        }
        tail.connect(panner);
        panner.toDestination();

        const bus = { input, effects, panner, signature };
        busesRef.current[track.id] = bus;
        return bus;
    };

    /** The instrument for a MIDI track, with its saved settings over the defaults. */
    const buildSynth = (track, destination) => {
        const instrumentType = track.instrument_type || 'synth';
        const config = synthConfigs[instrumentType] || synthConfigs.synth;
        const { SynthClass, params } = config;

        if (instrumentType === 'drumsampler') {
            return new Tone.Sampler({
                urls: params.urls,
                baseUrl: params.baseUrl || '',
                onload: params.onload,
            }).connect(destination);
        }

        // Merge saved settings over the instrument's defaults so characteristic
        // params (oscillator type, for one) survive a partial save.
        const synthParams = track.synth_settings
            ? {
                ...params,
                ...track.synth_settings.synthParams,
                envelope: { ...params.envelope, ...track.synth_settings.envelope },
                voice0: { ...params.voice0, ...track.synth_settings.voice0 },
                voice1: track.synth_settings.voice0
                    ? { ...params.voice1, detune: -track.synth_settings.voice0.detune }
                    : params.voice1,
            }
            : params;

        return track.is_polyphonic
            ? new Tone.PolySynth(SynthClass, { maxPolyphony: 8, ...synthParams }).connect(destination)
            : new SynthClass(synthParams).connect(destination);
    };

    const disposeSynths = () => {
        Object.values(synthsRef.current).forEach((entry) => dispose(entry.synth ?? entry));
        synthsRef.current = {};
    };

    /**
     * The instrument for a track, reused until its definition changes.
     *
     * A fresh one per play was expensive in a way that broke playback rather
     * than merely wasting bandwidth. The drum kit is a Tone.Sampler over nine
     * WAV files, so rebuilding it re-fetched and re-decoded all of them, and
     * beat-matching means pressing play, listening for a bar, pausing, nudging
     * a clip and playing again. Play again before the kit finished loading and
     * the first scheduled note hit a Sampler with no buffers, which throws.
     *
     * Keeping the instrument alive across plays removes the window entirely:
     * after the first play there is nothing left to load.
     */
    const ensureSynth = (track, bus) => {
        const signature = JSON.stringify({
            instrument: track.instrument_type || 'synth',
            poly: !!track.is_polyphonic,
            settings: track.synth_settings || null,
        });
        const existing = synthsRef.current[track.id];

        if (existing && existing.signature === signature) {
            // The bus may have been rebuilt underneath it.
            try {
                existing.synth.disconnect();
                existing.synth.connect(bus.input);
            } catch (_) { /* nothing else to try */ }
            return existing.synth;
        }
        if (existing) dispose(existing.synth);

        const synth = buildSynth(track, bus.input);
        synthsRef.current[track.id] = { synth, signature };
        return synth;
    };

    /** Every live instrument, whatever shape the cache entry is in. */
    const allSynths = () =>
        Object.values(synthsRef.current).map((entry) => entry.synth ?? entry);

    const disposeClips = () => {
        Object.values(clipsRef.current).forEach(disposeClip);
        clipsRef.current = {};
    };

    /** Push volume, pan and mute onto everything currently sounding. */
    const applyMix = useCallback(() => {
        const m = currentMix();
        const { projectSamples: samples, tracks: currentTracks } = latest.current;

        currentTracks.forEach((track) => {
            const bus = busesRef.current[track.id];
            if (!bus) return;
            bus.input.gain.value = trackGain(track.id, m);
            bus.panner.pan.value = m.trackPans?.[track.id] ?? 0;
        });

        samples.forEach((sample) => {
            const clip = clipsRef.current[sample.id];
            if (clip) clip.gain.gain.value = clipOwnGain(sample);
        });
    }, []);

    /** Apply the fade envelope for a clip entered `clipOffset` seconds in. */
    const applyFades = (clip, sample, clipOffset, effDuration) => {
        const g = clip.fadeGain.gain;
        const now = Tone.getContext().currentTime;
        const plan = fadePlan(sample, clipOffset, effDuration);

        g.cancelScheduledValues(now);
        g.setValueAtTime(plan.startValue, now);
        if (plan.rampIn) g.linearRampToValueAtTime(plan.rampIn.to, now + plan.rampIn.at);
        if (plan.holdOut) g.setValueAtTime(plan.holdOut.value, now + plan.holdOut.at);
        if (plan.rampOut) g.linearRampToValueAtTime(plan.rampOut.to, now + plan.rampOut.at);
    };

    const clipFullDuration = (clip, sample) =>
        latest.current.sampleDurations[sample.id] || clip.player.buffer?.duration || 0;

    /**
     * Start one clip at a playhead position: into the buffer at the right
     * offset, for exactly as long as the clip has left, with its fades armed.
     *
     * The third argument to Player.start is what enforces trim_end, so a
     * trimmed clip stops itself rather than waiting for the loop to catch it.
     */
    const startClipAt = (clip, sample, playheadUnits, timeScale) => {
        // A clip whose audio failed to load has no buffer, and Tone throws from
        // inside start() rather than returning. Without this the rAF loop
        // retries every frame and fills the console.
        if (!clip.player.loaded) return;

        const w = clipWindow(sample, clipFullDuration(clip, sample), timeScale);
        if (w.effDuration <= 0) return;

        const seekSeconds = clipSeekSeconds(playheadUnits, w, timeScale);
        const clipOffset = seekSeconds - w.trimStart;
        const remaining = Math.max(0, w.effDuration - clipOffset);
        if (remaining <= 0) return;

        applyFades(clip, sample, clipOffset, w.effDuration);
        try {
            clip.player.start(undefined, seekSeconds, remaining);
            clip.active = true;
        } catch (err) {
            console.warn(`Error starting clip ${sample.id}:`, err.message);
        }
    };

    /**
     * Build a clip's nodes and start its audio loading.
     *
     * Synchronous in the graph, asynchronous in the buffer: the player exists
     * immediately and `startClipAt` refuses to start it until `loaded` is true.
     * That is what lets a clip created while the transport is running join in on
     * a later frame instead of waiting for the next fresh play.
     */
    const createClip = (sample, bus) => {
        const gain = new Tone.Gain(clipOwnGain(sample)).connect(bus.input);
        const fadeGain = new Tone.Gain(1).connect(gain);
        const player = new Tone.Player().connect(fadeGain);
        // Fades are ours, scheduled on fadeGain from the stored fade_in and
        // fade_out. Tone's own ramps would fight them.
        player.fadeIn = 0;
        player.fadeOut = 0;

        const entry = { player, fadeGain, gain, active: false };
        clipsRef.current[sample.id] = entry;

        const ready = getToneBuffer(sample.mp3_url)
            .then((buffer) => {
                // Only if this entry is still the current one: a stop between
                // here and there disposes the player underneath us.
                if (clipsRef.current[sample.id] === entry) player.buffer = buffer;
            })
            .catch((err) => {
                console.warn(`Error loading clip ${sample.id}:`, err.message);
            });

        return { entry, ready };
    };

    const disposeClip = (clip) => {
        try {
            if (clip.player.state === 'started') clip.player.stop();
        } catch (_) { /* already gone */ }
        dispose(clip.player);
        dispose(clip.fadeGain);
        dispose(clip.gain);
    };

    const stopClip = (clip) => {
        // Tone asserts that start precedes stop, so only stop what is running.
        try {
            if (clip.player.state === 'started') clip.player.stop();
        } catch (_) { /* already gone */ }
        clip.active = false;
    };

    // ── Transport ───────────────────────────────────────────────────────────

    const transport = () => Tone.getTransport();

    /**
     * Schedule a track's notes, from `after` onwards.
     *
     * The try/catch is not decoration. These callbacks run inside Tone's clock
     * tick, and an exception thrown there escapes the clock and stops the
     * transport dead: one unplayable note silences the entire project, audio
     * clips included. A note that cannot sound should be a note that does not
     * sound, not the end of playback.
     */
    const scheduleNotes = (synth, notes, timeScale, after = null) => {
        notes.forEach((note) => {
            if (after != null && note.start_time < after) return;
            transport().schedule((time) => {
                try {
                    synth.triggerAttackRelease(note.note, unitsToReal(note.duration, timeScale), time);
                } catch (err) {
                    console.warn(`Skipped MIDI note ${note.note}:`, err.message);
                }
            }, unitsToReal(note.start_time, timeScale));
        });
    };

    /**
     * Tone's context is shared process-wide. If something closed it, every
     * later schedule call goes to a dead clock and simply never fires, without
     * throwing. Swap in a fresh one rather than letting that happen silently.
     */
    const ensureToneContext = async () => {
        try {
            const raw = Tone.context && Tone.context.rawContext;
            if (!Tone.context || (raw && raw.state === 'closed')) {
                Tone.setContext(new Tone.Context());
            }
        } catch (err) {
            try { Tone.setContext(new Tone.Context()); } catch (_) { /* nothing else to try */ }
        }
        await Tone.start();
    };

    // ── The loop ────────────────────────────────────────────────────────────

    const tick = useCallback(() => {
        if (!isPlayingRef.current) return;

        const { bpm: currentBpm, timelineDuration: maxUnits, projectSamples: samples } = latest.current;
        const timeScale = timeScaleFor(currentBpm);
        const ctx = Tone.getContext();
        const running = ctx.rawContext?.state === 'running';

        let elapsedUnits;
        if (running) {
            elapsedUnits = realToUnits(ctx.currentTime - startTimeRef.current, timeScale);
            fallbackCounterRef.current = elapsedUnits;
        } else {
            // A suspended context stops advancing currentTime, so the playhead
            // would freeze under a still-running transport. Limp forward.
            fallbackCounterRef.current += realToUnits(0.016, timeScale);
            elapsedUnits = fallbackCounterRef.current;
        }

        playheadRef.current = elapsedUnits;
        onFrameRef.current?.(elapsedUnits);

        // React state is published about ten times a second, not sixty.
        //
        // Setting it every frame rerendered the whole editor sixty times a
        // second: every lane, every clip, and a full repaint of each piano roll
        // canvas, all so a line could move a few pixels. The line itself is
        // moved by the frame callback above, which writes a transform and skips
        // React entirely. What still needs state is the numeric readout and
        // anything that reasons about position, and neither needs frame
        // accuracy.
        const now = performance.now();
        if (now - lastPublishRef.current >= 100) {
            lastPublishRef.current = now;
            setPlayheadPosition(elapsedUnits);
        }

        if (!readOnly) {
            const beatUnits = 0.5; // one beat, at every tempo
            while (elapsedUnits >= metronomeNextBeatRef.current * beatUnits) {
                if (metronomeOnRef.current) {
                    try {
                        let click = metronomeSynthRef.current;
                        if (!click || click.disposed || click.context !== Tone.getContext()) {
                            dispose(click);
                            click = new Tone.Synth({
                                oscillator: { type: 'square' },
                                envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
                                volume: -10,
                            }).toDestination();
                            metronomeSynthRef.current = click;
                        }
                        click.triggerAttackRelease(
                            metronomeNextBeatRef.current % 4 === 0 ? 'C6' : 'C5', '32n'
                        );
                    } catch (err) {
                        console.warn('Metronome click error:', err.message);
                    }
                }
                metronomeNextBeatRef.current += 1;
            }
        }

        samples.forEach((sample) => {
            let clip = clipsRef.current[sample.id];
            if (!clip) {
                // A clip that appeared mid-playback: duplicating one to extend
                // a loop, or dropping a new one in while the project runs.
                // Build it now and let a later frame start it, once its buffer
                // has landed. A duplicate is nearly free, because the copy
                // shares the original's file and the cache already holds it.
                const bus = busesRef.current[sample.track_id];
                if (!bus) return;
                clip = createClip(sample, bus).entry;
            }
            try {
                const w = clipWindow(sample, clipFullDuration(clip, sample), timeScale);
                const inside = elapsedUnits >= w.startUnits && elapsedUnits < w.endUnits;

                // `active`, not the player's own state: a clip that has reached
                // its trim end stopped itself, and must not be started again
                // while the playhead is still inside its window.
                if (inside && !clip.active) startClipAt(clip, sample, elapsedUnits, timeScale);
                else if (!inside && clip.active) stopClip(clip);
            } catch (err) {
                console.warn('Error controlling clip playback:', err.message);
            }
        });

        // A clip deleted mid-playback is no longer in `samples`, so the loop
        // above never visits it again and it would play on to its end with
        // nothing left able to stop it.
        const liveIds = new Set(samples.map((sample) => sample.id));
        Object.keys(clipsRef.current).forEach((key) => {
            if (liveIds.has(Number(key))) return;
            disposeClip(clipsRef.current[key]);
            delete clipsRef.current[key];
        });

        if (elapsedUnits >= maxUnits) {
            stopRef.current();
            return;
        }
        rafRef.current = requestAnimationFrame(tick);
    }, [readOnly]);

    // stop() and tick() refer to each other, so one of them goes through a ref.
    const stopRef = useRef(() => {});

    // ── Controls ────────────────────────────────────────────────────────────

    const stop = useCallback(() => {
        generationRef.current += 1;
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        try {
            transport().stop();
            transport().cancel();
        } catch (_) { /* context may be gone */ }

        disposeClips();
        disposeAllBuses();
        // Instruments deliberately survive a stop. Building a drum kit means
        // fetching and decoding nine WAV files, and stop-then-play is a normal
        // way to work; ensureSynth reconnects them to the new buses on the next
        // play and rebuilds only what has actually been re-configured. They go
        // on unmount.
        allSynths().forEach((synth) => {
            try {
                if (synth.releaseAll) synth.releaseAll();
                else synth.triggerRelease(Tone.now());
            } catch (_) { /* no voices held */ }
        });

        isPlayingRef.current = false;
        playheadRef.current = 0;
        fallbackCounterRef.current = 0;
        metronomeNextBeatRef.current = 0;
        lastPublishRef.current = 0;
        setIsPlaying(false);
        setIsPaused(false);
        setPlayheadPosition(0);
    }, []);

    stopRef.current = stop;

    /**
     * Pause holds the graph together: players, synths and buses all survive, so
     * resuming means restarting the clips under the playhead rather than
     * reloading every file and rewiring everything.
     */
    const pause = useCallback(async () => {
        generationRef.current += 1;
        try {
            Object.values(clipsRef.current).forEach(stopClip);
            allSynths().forEach((synth) => {
                try {
                    if (synth.releaseAll) synth.releaseAll();
                    else synth.triggerRelease(Tone.now());
                } catch (_) { /* no voices held */ }
            });

            transport().pause();
            transport().cancel();

            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }

            isPlayingRef.current = false;
            setIsPlaying(false);
            setIsPaused(true);
            // The last published value can be up to a tenth of a second behind.
            setPlayheadPosition(playheadRef.current);
        } catch (err) {
            console.error('Error pausing playback:', err.message);
            report('Failed to pause playback');
        }
    }, [report]);

    const play = useCallback(async () => {
        const {
            tracks: currentTracks,
            projectSamples: samples,
            bpm: currentBpm,
        } = latest.current;

        const generation = generationRef.current + 1;
        generationRef.current = generation;
        const superseded = () => generationRef.current !== generation;

        setIsPlaying(true);
        isPlayingRef.current = true;

        try {
            await ensureToneContext();
        } catch (err) {
            console.error('Failed to start Tone audio:', err);
            report('Failed to start audio. Please press play again.');
            setIsPlaying(false);
            isPlayingRef.current = false;
            return;
        }

        const timeScale = timeScaleFor(currentBpm);
        const startPos = playheadRef.current;
        const m = currentMix();

        // A real resume needs loaded players. Pressing play after a seek from a
        // stopped state sets isPaused with nothing loaded, and that has to take
        // the fresh path or it resumes silence.
        const canResume = isPaused && Object.keys(clipsRef.current).length > 0;

        // Buses first: clips and synths both connect into them. Any bus whose
        // effects were edited since the last play is rebuilt here.
        currentTracks.forEach((track) => ensureTrackBus(track, m));

        if (!canResume) {
            disposeClips();
            // Not disposeSynths(): ensureSynth below rebuilds only instruments
            // whose definition changed, which is what keeps a replay from
            // re-downloading a drum kit.
            transport().cancel();

            const loading = samples.map((sample) => {
                const bus = busesRef.current[sample.track_id];
                return bus ? createClip(sample, bus).ready : null;
            }).filter(Boolean);

            currentTracks.forEach((track) => {
                if (track.track_type !== 'midi' || !Array.isArray(track.midi_notes) || !track.id) return;
                const bus = busesRef.current[track.id];
                if (!bus) return;

                const synth = ensureSynth(track, bus);

                // Note times are musical units; the transport runs in seconds.
                scheduleNotes(synth, track.midi_notes, timeScale);
            });

            await Promise.all(loading);
            // And the instruments' own audio. Tone tracks every outstanding
            // buffer load globally, so this covers a drum kit's WAV files as
            // well as the clips. Starting the transport before they land is
            // what threw "buffer is either not set or not loaded" from inside a
            // scheduled note.
            await Tone.loaded();

            // Bail out if something stopped us, or started again, while the
            // audio was loading.
            if (!isPlayingRef.current || superseded()) return;
        } else {
            // A rebuilt bus is a new node, so anything still pointing at the old
            // one has to be moved across. ensureSynth reconnects as it goes.
            currentTracks.forEach((track) => {
                const bus = busesRef.current[track.id];
                if (bus && track.track_type === 'midi') ensureSynth(track, bus);
            });
            samples.forEach((sample) => {
                const clip = clipsRef.current[sample.id];
                const bus = busesRef.current[sample.track_id];
                if (!clip || !bus) return;
                clip.active = false;
                try {
                    clip.gain.disconnect();
                    clip.gain.connect(bus.input);
                } catch (_) { /* nothing else to try */ }
            });

            transport().cancel();
            currentTracks.forEach((track) => {
                if (track.track_type !== 'midi' || !Array.isArray(track.midi_notes)) return;
                const entry = synthsRef.current[track.id];
                if (!entry) return;
                scheduleNotes(entry.synth, track.midi_notes, timeScale, startPos);
            });
            setIsPaused(false);
        }

        applyMix();

        // Everything is loaded: set the clock, start the clips under the
        // playhead, and start the transport, so audio and the playhead begin in
        // the same instant.
        startTimeRef.current = Tone.getContext().currentTime - unitsToReal(startPos, timeScale);
        setPlayheadPosition(startPos);
        playheadRef.current = startPos;

        samples.forEach((sample) => {
            const clip = clipsRef.current[sample.id];
            if (!clip) return;
            try {
                const w = clipWindow(sample, clipFullDuration(clip, sample), timeScale);
                if (startPos >= w.startUnits && startPos < w.endUnits) {
                    startClipAt(clip, sample, startPos, timeScale);
                }
            } catch (err) {
                console.warn('Error starting clip at playhead:', err.message);
            }
        });

        // Start AT the offset. A '+delay' start postpones MIDI instead of
        // skipping to the right position.
        transport().start(undefined, unitsToReal(startPos, timeScale));

        if (superseded()) return;
        metronomeNextBeatRef.current = Math.max(0, Math.ceil((startPos / 0.5) - 1e-6));
        rafRef.current = requestAnimationFrame(tick);
    }, [isPaused, applyMix, report, tick]);

    const toggle = useCallback(() => {
        if (isPlayingRef.current) pause();
        else play();
    }, [pause, play]);

    /**
     * Move the playhead. Everything stops first, including the transport: the
     * editor used to leave it running here, so MIDI kept sounding under a
     * stationary playhead and the offset was then silently ignored on resume,
     * because Tone's clock drops a start() it receives while already started.
     */
    const seek = useCallback(async (units) => {
        if (readOnly) return;
        const target = Math.max(0, units);
        generationRef.current += 1;
        try {
            Object.values(clipsRef.current).forEach(stopClip);
            allSynths().forEach((synth) => {
                try {
                    if (synth.releaseAll) synth.releaseAll();
                    else synth.triggerRelease(Tone.now());
                } catch (_) { /* no voices held */ }
            });

            transport().pause();
            transport().cancel();

            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        } catch (err) {
            console.warn('Error while seeking:', err.message);
        }

        isPlayingRef.current = false;
        playheadRef.current = target;
        fallbackCounterRef.current = target;
        metronomeNextBeatRef.current = Math.max(0, Math.ceil((target / 0.5) - 1e-6));
        setPlayheadPosition(target);
        setIsPlaying(false);
        setIsPaused(true);
    }, [readOnly]);

    // Live mix changes reach anything already sounding. `projectSamples` is in
    // here because clip volume lives on the clip row, so editing one while the
    // project plays has to reach its gain node too.
    useEffect(() => {
        if (readOnly) return;
        applyMix();
    }, [applyMix, readOnly, tracks, mix, projectSamples]);

    // ── Teardown ────────────────────────────────────────────────────────────
    //
    // Note what is NOT here: Tone.context.close(). Tone's context is shared by
    // every component on the page, and the public player used to close it on
    // unmount, which left the editor's transport bound to a dead clock that
    // never ticked again. Nothing here owns the context, so nothing here closes
    // it; the nodes this hook made are all it takes away.
    useEffect(() => () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        disposeClips();
        disposeSynths();
        disposeAllBuses();
        dispose(metronomeSynthRef.current);
        metronomeSynthRef.current = null;

        try {
            Tone.getTransport().stop();
            Tone.getTransport().cancel();
        } catch (_) { /* context may be gone */ }
    }, []);

    return {
        isPlaying,
        isPaused,
        playheadPosition,
        play,
        pause,
        toggle,
        stop,
        seek,
        setPlayheadPosition,
    };
}
