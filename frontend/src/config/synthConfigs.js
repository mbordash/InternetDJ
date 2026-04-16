// src/config/synthConfigs.js
import * as Tone from 'tone';

const synthConfigs = {
    synth: {
        SynthClass: Tone.Synth,
        params: {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 1 }
        }
    },
    amsynth: {
        SynthClass: Tone.AMSynth,
        params: {
            harmonicity: 2,
            modulationIndex: 10,
            oscillator: { type: 'sine' },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 1.2 }
        }
    },
    fmsynth: {
        SynthClass: Tone.FMSynth,
        params: {
            harmonicity: 3,
            modulationIndex: 15,
            oscillator: { type: 'square' },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.8 }
        }
    },
    metalsynth: {
        SynthClass: Tone.MetalSynth,
        params: {
            frequency: 100,
            harmonicity: 2.0,
            modulationIndex: 8,
            resonance: 1500,
            octaves: 1.2,
            envelope: { attack: 0.05, decay: 0.3, sustain: 0.8, release: 1.2 }
        }
    },
    duosynth: {
        SynthClass: Tone.DuoSynth,
        params: {
            vibratoAmount: 0.5,
            vibratoRate: 5,
            harmonicity: 1.5,
            voice0: {
                oscillator: { type: 'sawtooth' },
                envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 1 }
            },
            voice1: {
                oscillator: { type: 'sine' },
                envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 1 }
            }
        }
    },
    membranesynth: {
        SynthClass: Tone.MembraneSynth,
        params: {
            pitchDecay: 0.05,
            octaves: 10,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 }
        }
    },
    drumsampler: {
        SynthClass: Tone.Sampler,
        params: {
            urls: {
                C2: '/samples/kick-deep.wav',         // MIDI 36: Kick
                A2: '/samples/tom-acoustic01.wav',    // MIDI 45: Low Tom
                B2: '/samples/tom-acoustic02.wav',    // MIDI 47: Mid Tom
                C3: '/samples/tom-analog.wav',        // MIDI 48: High Tom
                D2: '/samples/snare-acoustic01.wav',  // MIDI 38: Snare
                E2: '/samples/clap-fat.wav',          // MIDI 39: Clap
                'F#2': '/samples/hihat-acoustic01.wav', // MIDI 42: Closed Hi-Hat
                'A#2': '/samples/openhat-acoustic01.wav', // MIDI 46: Open Hi-Hat
                'C#3': '/samples/crash-acoustic.wav',   // MIDI 49: Crash
                'D#3': '/samples/ride-acoustic01.wav'   // MIDI 51: Ride
            },
            baseUrl: '',
            onload: () => console.log('Drum samples loaded')
        }
    }
};

export default synthConfigs;