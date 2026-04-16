import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import * as Tone from 'tone';
import axios from 'axios';
import synthConfigs from '../config/synthConfigs';
import API_URL from '../utils/api';
import debounce from 'lodash/debounce';

const instrumentDisplayNames = {
    synth: 'Piano (Synth)',
    amsynth: 'AM Synth',
    fmsynth: 'FM Synth',
    metalsynth: 'Metallic Synth',
    duosynth: 'Duo Synth',
    membranesynth: 'Blip Synth',
    drumsampler: 'Drum Kit',
};

const Knob = ({ label, value, onChange, min = 0, max = 1, step = 0.01 }) => {
    const [angle, setAngle] = useState(((value - min) / (max - min)) * 270 - 135);
    const knobRef = useRef(null);
    const isDragging = useRef(false);

    const handleMouseDown = () => {
        isDragging.current = true;
    };

    const handleMouseUp = () => {
        isDragging.current = false;
    };

    const handleMouseMove = (e) => {
        if (!isDragging.current || !knobRef.current) return;
        const rect = knobRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angleRad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        let angleDeg = (angleRad * 180) / Math.PI + 90;
        if (angleDeg < 0) angleDeg += 360;
        angleDeg = Math.max(0, Math.min(270, angleDeg));
        const normalized = angleDeg / 270;
        const newValue = min + normalized * (max - min);
        onChange(Math.round(newValue / step) * step);
        setAngle(angleDeg - 135);
    };

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    return (
        <div className="flex flex-col items-center space-y-1">
            <div
                ref={knobRef}
                className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer shadow-inner md:w-12 md:h-12"
                style={{ transform: `rotate(${angle}deg)` }}
                onMouseDown={handleMouseDown}
            >
                <div className="w-1 h-3 bg-purple-500 rounded-full absolute top-1 md:h-4"></div>
            </div>
            <label className="text-xs text-gray-300 text-center">{label}</label>
            <span className="text-xs text-gray-400">{value.toFixed(2)}</span>
        </div>
    );
};

const Lever = ({ label, value, onChange, min = 0, max = 1, step = 0.01, showValue = true }) => {
    const percentage = ((value - min) / (max - min)) * 100;
    return (
        <div className="flex flex-col space-y-1 w-full">
            <label className="text-sm text-gray-300">{label}</label>
            <input
                type="range"
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                min={min}
                max={max}
                step={step}
                className="w-full h-2 bg-gray-600 rounded-lg cursor-pointer"
                style={{
                    background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${percentage}%, #4b5563 ${percentage}%, #4b5563 100%)`,
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    appearance: 'none',
                }}
            />
            {showValue && <span className="text-xs text-gray-400">{value.toFixed(2)}</span>}
            <style jsx>{`
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 4px;
                    height: 16px;
                    background: #8b5cf6;
                    cursor: pointer;
                    border-radius: 2px;
                }
                input[type="range"]::-moz-range-thumb {
                    width: 4px;
                    height: 16px;
                    background: #8b5cf6;
                    cursor: pointer;
                    border: none;
                    border-radius: 2px;
                }
                input[type="range"]::-ms-thumb {
                    width: 4px;
                    height: 16px;
                    background: #8b5cf6;
                    cursor: pointer;
                    border-radius: 2px;
                }
            `}</style>
        </div>
    );
};

const PianoRoll = ({ instrumentType, previewSynthRef }) => {
    const isDrum = instrumentType === 'drumsampler';
    const notes = isDrum
        ? ['C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2']
        : ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3'];

    const drumLabels = [
        'Kic', // Kick
        'Sna', // Snare
        'Hat', // HiHat
        'Cla', // Clap
        'Tm1', // Tom1
        'Tm2', // Tom2
        'Cym', // Cymbal
        'Pr1', // Perc1
        'Pr2', // Perc2
        'Rim', // Rim
        'Cow', // Cowbell
        'Sha', // Shaker
    ];

    const handleNoteClick = async (note) => {
        if (!previewSynthRef.current) return;
        await Tone.start();
        previewSynthRef.current.triggerAttackRelease(note, '1n');
    };

    return (
        <div className="flex flex-col">
            <label className="text-sm text-gray-300 mb-1">Test Notes</label>
            <div className="flex space-x-px">
                {notes.map((note, index) => {
                    const isBlackKey = note.includes('#');
                    return (
                        <button
                            key={note}
                            onClick={() => handleNoteClick(note)}
                            className={`relative flex-1 h-12 md:h-16 border border-gray-600 ${
                                isBlackKey ? 'bg-gray-900 z-10 -mx-1 w-[calc(100%/12+2px)]' : 'bg-gray-200'
                            } hover:bg-opacity-80 transition-colors`}
                            style={{
                                marginLeft: isBlackKey && index > 0 ? '-2px' : '0',
                                marginRight: isBlackKey ? '-2px' : '0',
                            }}
                        >
              <span className="text-[10px] text-gray-400 absolute bottom-1 left-1/2 transform -translate-x-1/2">
                {isDrum ? drumLabels[index] : note}
              </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const TrackSettingsModal = ({
                                track,
                                projectId,
                                onClose,
                                onDelete,
                                onSettingsChange,
                                currentVolume,
                                currentInstrumentType,
                                isPolyphonic,
                                synthSettings,
                            }) => {
    const [volume, setVolume] = useState(currentVolume);
    const [instrumentType, setInstrumentType] = useState(currentInstrumentType);
    const [polyphonic, setPolyphonic] = useState(isPolyphonic);
    const [synthParams, setSynthParams] = useState(() => {
        const defaults = {
            harmonicity: synthConfigs[currentInstrumentType]?.params.harmonicity || 1,
            modulationIndex: synthConfigs[currentInstrumentType]?.params.modulationIndex || 10,
            vibratoRate: synthConfigs[currentInstrumentType]?.params.vibratoRate || 5,
            vibratoAmount: synthConfigs[currentInstrumentType]?.params.vibratoAmount || 0.5,
            detune: 0,
            pitchDecay: synthConfigs[currentInstrumentType]?.params.pitchDecay || 0.05,
            octaves: synthConfigs[currentInstrumentType]?.params.octaves || 10,
            resonance: synthConfigs[currentInstrumentType]?.params.resonance || 1500,
            frequency: synthConfigs[currentInstrumentType]?.params.frequency || 100,
        };
        return {
            ...defaults,
            ...synthSettings?.synthParams,
            harmonicity: synthSettings?.synthParams?.harmonicity ?? defaults.harmonicity,
            vibratoRate: synthSettings?.synthParams?.vibratoRate ?? defaults.vibratoRate,
            vibratoAmount: synthSettings?.synthParams?.vibratoAmount ?? defaults.vibratoAmount,
        };
    });
    const [envelope, setEnvelope] = useState(
        synthSettings?.envelope || {
            attack: synthConfigs[currentInstrumentType]?.params.envelope?.attack || 0.01,
            decay: synthConfigs[currentInstrumentType]?.params.envelope?.decay || 0.2,
            sustain: synthConfigs[currentInstrumentType]?.params.envelope?.sustain || 0.5,
            release: synthConfigs[currentInstrumentType]?.params.envelope?.release || 1,
        }
    );
    const [voice0, setVoice0] = useState(
        synthSettings?.voice0 || {
            detune: synthConfigs[currentInstrumentType]?.params.voice0?.detune || 0,
        }
    );
    const [error, setError] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showSavedMessage, setShowSavedMessage] = useState(false);
    const previewSynthRef = useRef(null);
    const isMidiTrack = track.track_type === 'midi';
    const initialSettingsRef = useRef({
        volume: currentVolume,
        instrumentType: currentInstrumentType,
        isPolyphonic: isPolyphonic,
        synthSettings: synthSettings || {},
    });

    const debouncedSave = useRef(
        debounce(async (settings, callback) => {
            try {
                const token = localStorage.getItem('token');
                await axios.put(
                    `${API_URL}/projects/${projectId}/tracks/${track.id}`,
                    settings,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                callback(settings);
                setError(null);
                setShowSavedMessage(true);
                setTimeout(() => setShowSavedMessage(false), 3000);
            } catch (err) {
                console.error('Save settings error:', err.response?.data || err.message);
                setError(`Failed to save settings: ${err.response?.data?.error || err.message}`);
            }
        }, 500)
    ).current;

    useEffect(() => {
        setVolume(currentVolume);
        setInstrumentType(currentInstrumentType);
        setPolyphonic(isPolyphonic);
        setSynthParams((prev) => ({
            ...prev,
            ...synthSettings?.synthParams,
            harmonicity: (synthSettings?.synthParams?.harmonicity ?? synthConfigs[currentInstrumentType]?.params.harmonicity) || 1,
            vibratoRate: (synthSettings?.synthParams?.vibratoRate ?? synthConfigs[currentInstrumentType]?.params.vibratoRate) || 5,
            vibratoAmount: (synthSettings?.synthParams?.vibratoAmount ?? synthConfigs[currentInstrumentType]?.params.vibratoAmount) || 0.5,
        }));
        setEnvelope(synthSettings?.envelope || synthConfigs[currentInstrumentType]?.params.envelope || {
            attack: 0.01,
            decay: 0.2,
            sustain: 0.5,
            release: 1,
        });
        setVoice0(synthSettings?.voice0 || { detune: synthConfigs[currentInstrumentType]?.params.voice0?.detune || 0 });
        initialSettingsRef.current = {
            volume: currentVolume,
            instrumentType: currentInstrumentType,
            isPolyphonic: isPolyphonic,
            synthSettings: synthSettings || {},
        };
    }, [currentVolume, currentInstrumentType, isPolyphonic, synthSettings]);

    useEffect(() => {
        if (isMidiTrack) {
            const config = synthConfigs[instrumentType] || synthConfigs.synth;
            const { SynthClass, params } = config;
            try {
                if (instrumentType === 'drumsampler') {
                    previewSynthRef.current = new SynthClass(params).toDestination();
                } else {
                    previewSynthRef.current = polyphonic
                        ? new Tone.PolySynth(SynthClass, { maxPolyphony: 8, ...params }).toDestination()
                        : new SynthClass(params).toDestination();
                }
            } catch (err) {
                console.error('Synth initialization error:', err);
                setError('Failed to initialize synth. Please try another instrument.');
            }
            return () => {
                previewSynthRef.current?.dispose();
            };
        }
    }, [instrumentType, polyphonic, isMidiTrack]);

    useEffect(() => {
        if (isMidiTrack && previewSynthRef.current && instrumentType !== 'drumsampler') {
            const params = {
                envelope,
            };
            if (instrumentType === 'membranesynth') {
                params.pitchDecay = synthParams.pitchDecay;
                params.octaves = synthParams.octaves;
            } else if (instrumentType === 'metalsynth') {
                params.frequency = synthParams.frequency;
                params.harmonicity = synthParams.harmonicity;
                params.modulationIndex = synthParams.modulationIndex;
                params.resonance = synthParams.resonance;
                params.octaves = synthParams.octaves;
            } else if (instrumentType === 'duosynth') {
                params.harmonicity = synthParams.harmonicity ?? 1.5;
                params.vibratoRate = synthParams.vibratoRate ?? 5;
                params.vibratoAmount = synthParams.vibratoAmount ?? 0.5;
            } else {
                params.harmonicity = synthParams.harmonicity;
                params.modulationIndex = synthParams.modulationIndex;
                params.vibratoRate = synthParams.vibratoRate;
                params.detune = synthParams.detune;
            }
            const validParams = Object.fromEntries(
                Object.entries(params).filter(([_, value]) => value !== undefined)
            );
            previewSynthRef.current.set(validParams);
            if (instrumentType === 'duosynth') {
                previewSynthRef.current.set({
                    voice0: { detune: voice0.detune ?? 0 },
                    voice1: { detune: -(voice0.detune ?? 0) },
                });
            }
        }
    }, [synthParams, envelope, voice0, instrumentType, isMidiTrack]);

    const buildSettings = (updatedSynthParams = synthParams, updatedEnvelope = envelope, updatedVoice0 = voice0) => {
        const settings = { volume };
        if (isMidiTrack) {
            settings.instrument_type = instrumentType;
            settings.is_polyphonic = polyphonic;
            settings.synth_settings = instrumentType === 'drumsampler' ? {} : {
                synthParams: updatedSynthParams,
                envelope: updatedEnvelope,
                voice0: updatedVoice0,
            };
        }
        return settings;
    };

    const hasChanges = (settings) => {
        return (
            settings.volume !== initialSettingsRef.current.volume ||
            (isMidiTrack &&
                (settings.instrument_type !== initialSettingsRef.current.instrumentType ||
                    settings.is_polyphonic !== initialSettingsRef.current.isPolyphonic ||
                    JSON.stringify(settings.synth_settings) !== JSON.stringify(initialSettingsRef.current.synthSettings)))
        );
    };

    const handleSave = () => {
        const settings = buildSettings();
        if (!hasChanges(settings)) {
            setShowSavedMessage(true);
            setTimeout(() => setShowSavedMessage(false), 3000);
            setError(null);
            return;
        }
        debouncedSave.cancel();
        debouncedSave(settings, (savedSettings) => {
            onSettingsChange(track.id, savedSettings);
        });
    };

    const handleSettingChange = (setter, updater, field, paramKey) => {
        setter((prev) => {
            const newValue = typeof updater === 'function' ? updater(prev) : updater;
            let settings;
            if (field === 'synth_settings') {
                let updatedSynthParams = synthParams;
                let updatedEnvelope = envelope;
                let updatedVoice0 = voice0;
                if (setter === setSynthParams) {
                    updatedSynthParams = newValue;
                } else if (setter === setEnvelope) {
                    updatedEnvelope = newValue;
                } else if (setter === setVoice0) {
                    updatedVoice0 = newValue;
                }
                settings = buildSettings(updatedSynthParams, updatedEnvelope, updatedVoice0);
            } else {
                settings = buildSettings();
                if (field === 'volume') settings.volume = newValue;
                else if (field === 'instrument_type') settings.instrument_type = newValue;
                else if (field === 'is_polyphonic') settings.is_polyphonic = newValue;
            }
            if (hasChanges(settings)) {
                debouncedSave(settings, (savedSettings) => {
                    onSettingsChange(track.id, savedSettings);
                });
            }
            return newValue;
        });
    };

    const handleDeleteClick = () => {
        setShowDeleteConfirm(true);
    };

    const confirmDelete = () => {
        onDelete(track.id);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 text-gray-200 rounded-lg shadow-lg w-full max-w-5xl max-h-[85vh] flex flex-col relative">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-200 z-10"
                    aria-label="Close"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Header */}
                <div className="p-6">
                    <h2 className="text-xl font-semibold">Settings for {track.name}</h2>
                    {error && <p className="text-red-400 mt-2 text-sm">{error}</p>}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* General Settings */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-medium">General</h3>
                            {/* Volume */}
                            <div>
                                <label htmlFor="volume" className="block text-sm font-medium">
                                    Volume: {(volume * 100).toFixed(0)}%
                                </label>
                                <Lever
                                    label=""
                                    value={volume}
                                    onChange={(v) => handleSettingChange(setVolume, v, 'volume')}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    showValue={false}
                                />
                            </div>

                            {isMidiTrack && (
                                <>
                                    {/* Instrument Type */}
                                    <div>
                                        <label htmlFor="instrument-type" className="block text-sm font-medium">
                                            Instrument Type
                                        </label>
                                        <select
                                            id="instrument-type"
                                            value={instrumentType}
                                            onChange={(e) => {
                                                const newInstrument = e.target.value;
                                                handleSettingChange(setInstrumentType, newInstrument, 'instrument_type');
                                                const newSynthParams = {
                                                    harmonicity: synthConfigs[newInstrument]?.params.harmonicity || 1,
                                                    modulationIndex: synthConfigs[newInstrument]?.params.modulationIndex || 10,
                                                    vibratoRate: synthConfigs[newInstrument]?.params.vibratoRate || 5,
                                                    vibratoAmount: synthConfigs[newInstrument]?.params.vibratoAmount || 0.5,
                                                    detune: 0,
                                                    pitchDecay: synthConfigs[newInstrument]?.params.pitchDecay || 0.05,
                                                    octaves: synthConfigs[newInstrument]?.params.octaves || 10,
                                                    resonance: synthConfigs[newInstrument]?.params.resonance || 1500,
                                                    frequency: synthConfigs[newInstrument]?.params.frequency || 100,
                                                };
                                                const newEnvelope = {
                                                    attack: synthConfigs[newInstrument]?.params.envelope?.attack || 0.01,
                                                    decay: synthConfigs[newInstrument]?.params.envelope?.decay || 0.2,
                                                    sustain: synthConfigs[newInstrument]?.params.envelope?.sustain || 0.5,
                                                    release: synthConfigs[newInstrument]?.params.envelope?.release || 1,
                                                };
                                                const newVoice0 = {
                                                    detune: synthConfigs[newInstrument]?.params.voice0?.detune || 0,
                                                };
                                                setSynthParams(newSynthParams);
                                                setEnvelope(newEnvelope);
                                                setVoice0(newVoice0);
                                                const settings = buildSettings(newSynthParams, newEnvelope, newVoice0);
                                                if (hasChanges(settings)) {
                                                    debouncedSave(settings, (savedSettings) => {
                                                        onSettingsChange(track.id, savedSettings);
                                                    });
                                                }
                                            }}
                                            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500 text-sm"
                                        >
                                            {Object.keys(synthConfigs).map((key) => (
                                                <option key={key} value={key}>
                                                    {instrumentDisplayNames[key] || key}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Polyphonic Mode */}
                                    <div className="flex items-center">
                                        <input
                                            type="checkbox"
                                            id="polyphonic"
                                            checked={polyphonic}
                                            onChange={(e) => handleSettingChange(setPolyphonic, e.target.checked, 'is_polyphonic')}
                                            disabled={instrumentType === 'drumsampler'}
                                            className="h-4 w-4 text-purple-500 focus:ring-purple-500 border-gray-600 rounded disabled:opacity-50"
                                        />
                                        <label htmlFor="polyphonic" className="ml-2 text-sm">
                                            Polyphonic Mode
                                        </label>
                                    </div>

                                    {/* Piano Roll */}
                                    <PianoRoll instrumentType={instrumentType} previewSynthRef={previewSynthRef} />
                                </>
                            )}
                        </div>

                        {/* Synth Parameters */}
                        {isMidiTrack && instrumentType !== 'drumsampler' && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium">Synth Parameters</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {['amsynth', 'fmsynth', 'metalsynth', 'duosynth'].includes(instrumentType) && (
                                        <Knob
                                            label="Harmonicity"
                                            value={synthParams.harmonicity}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, harmonicity: v }), 'synth_settings', 'harmonicity')}
                                            min={0.1}
                                            max={5}
                                            step={0.1}
                                        />
                                    )}
                                    {['amsynth', 'fmsynth', 'metalsynth'].includes(instrumentType) && (
                                        <Knob
                                            label="Mod Index"
                                            value={synthParams.modulationIndex}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, modulationIndex: v }), 'synth_settings', 'modulationIndex')}
                                            min={0}
                                            max={20}
                                            step={0.1}
                                        />
                                    )}
                                    {['metalsynth'].includes(instrumentType) && (
                                        <Knob
                                            label="Resonance"
                                            value={synthParams.resonance}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, resonance: v }), 'synth_settings', 'resonance')}
                                            min={100}
                                            max={3000}
                                            step={10}
                                        />
                                    )}
                                    {['metalsynth'].includes(instrumentType) && (
                                        <Knob
                                            label="Frequency"
                                            value={synthParams.frequency}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, frequency: v }), 'synth_settings', 'frequency')}
                                            min={50}
                                            max={500}
                                            step={1}
                                        />
                                    )}
                                    {['metalsynth', 'membranesynth'].includes(instrumentType) && (
                                        <Knob
                                            label="Octaves"
                                            value={synthParams.octaves}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, octaves: v }), 'synth_settings', 'octaves')}
                                            min={0.1}
                                            max={20}
                                            step={0.1}
                                        />
                                    )}
                                    {instrumentType === 'duosynth' && (
                                        <Knob
                                            label="Vibrato Rate"
                                            value={synthParams.vibratoRate}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, vibratoRate: v }), 'synth_settings', 'vibratoRate')}
                                            min={0}
                                            max={10}
                                            step={0.1}
                                        />
                                    )}
                                    {instrumentType === 'duosynth' && (
                                        <Knob
                                            label="Vibrato Amt"
                                            value={synthParams.vibratoAmount}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, vibratoAmount: v }), 'synth_settings', 'vibratoAmount')}
                                            min={0}
                                            max={5}
                                            step={0.1}
                                        />
                                    )}
                                    {instrumentType === 'membranesynth' && (
                                        <Knob
                                            label="Pitch Decay"
                                            value={synthParams.pitchDecay}
                                            onChange={(v) => handleSettingChange(setSynthParams, (prev) => ({ ...prev, pitchDecay: v }), 'synth_settings', 'pitchDecay')}
                                            min={0.01}
                                            max={0.5}
                                            step={0.01}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Envelope and Voice */}
                        {isMidiTrack && instrumentType !== 'drumsampler' && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-medium">Envelope</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <Knob
                                        label="Attack"
                                        value={envelope.attack}
                                        onChange={(v) => handleSettingChange(setEnvelope, (prev) => ({ ...prev, attack: v }), 'synth_settings', 'attack')}
                                        min={0.001}
                                        max={1}
                                        step={0.001}
                                    />
                                    <Knob
                                        label="Decay"
                                        value={envelope.decay}
                                        onChange={(v) => handleSettingChange(setEnvelope, (prev) => ({ ...prev, decay: v }), 'synth_settings', 'decay')}
                                        min={0.001}
                                        max={1}
                                        step={0.001}
                                    />
                                    <Knob
                                        label="Sustain"
                                        value={envelope.sustain}
                                        onChange={(v) => handleSettingChange(setEnvelope, (prev) => ({ ...prev, sustain: v }), 'synth_settings', 'sustain')}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                    />
                                    <Knob
                                        label="Release"
                                        value={envelope.release}
                                        onChange={(v) => handleSettingChange(setEnvelope, (prev) => ({ ...prev, release: v }), 'synth_settings', 'release')}
                                        min={0.001}
                                        max={2}
                                        step={0.001}
                                    />
                                </div>

                                {instrumentType === 'duosynth' && (
                                    <>
                                        <h3 className="text-sm font-medium mt-4">Voice</h3>
                                        <Lever
                                            label="Voice Detune"
                                            value={voice0.detune}
                                            onChange={(v) => handleSettingChange(setVoice0, (prev) => ({ ...prev, detune: v }), 'synth_settings', 'detune')}
                                            min={-50}
                                            max={50}
                                            step={1}
                                        />
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Separator */}
                    <hr className="border-gray-600 my-6" />

                    {/* Footer with Save and Delete */}
                    <div className="flex flex-col items-start gap-4">
                        {showDeleteConfirm ? (
                            <div className="p-4 bg-red-900 rounded-md w-full max-w-md">
                                <p className="text-red-300 mb-2">Are you sure you want to delete this track?</p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={confirmDelete}
                                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                                    >
                                        Yes, Delete
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-4 py-2 bg-gray-600 text-gray-200 rounded-md hover:bg-gray-700"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 bg-primary-brand-500 text-white rounded-md hover:bg-primary-brand-700"
                                >
                                    Save Settings
                                </button>
                                <button
                                    onClick={handleDeleteClick}
                                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                                >
                                    Delete Track
                                </button>
                                {showSavedMessage && (
                                    <div
                                        className="flex items-center space-x-2 px-3 py-1 bg-green-500 bg-opacity-20 border border-green-500 text-green-300 text-sm rounded-md animate-fade-out"
                                        role="alert"
                                        aria-live="polite"
                                    >
                                        <span>✅ Saved</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

TrackSettingsModal.propTypes = {
    track: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
    onSettingsChange: PropTypes.func.isRequired,
    currentVolume: PropTypes.number.isRequired,
    currentInstrumentType: PropTypes.string.isRequired,
    isPolyphonic: PropTypes.bool,
    synthSettings: PropTypes.object,
};

export default TrackSettingsModal;