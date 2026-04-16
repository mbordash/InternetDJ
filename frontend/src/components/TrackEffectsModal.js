import React, { useState, useRef, useEffect } from 'react';

// Knob component (copied from TrackSettingsModal.js)
const Knob = ({ label, value, onChange, min = 0, max = 1, step = 0.01, decimals = 2 }) => {
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

    useEffect(() => {
        // Update angle when value prop changes
        const newAngle = ((value - min) / (max - min)) * 270 - 135;
        setAngle(newAngle);
    }, [value, min, max]);

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
            <span className="text-xs text-gray-400">{value.toFixed(decimals)}</span>
        </div>
    );
};

const TrackEffectsModal = ({ track, onClose, onEffectsChange }) => {
    // Initialize default effects settings
    const defaultEffectsSettings = {
        reverb: { enabled: false, decay: 2, wet: 0.5 },
        delay: { enabled: false, delayTime: 0.3, wet: 0.4 },
        distortion: { enabled: false, distortion: 0.4, wet: 0.5 }
    };

    // Merge track.effects_settings with defaults, enabling effects present in track.effects_settings
    const initialEffectsSettings = {
        reverb: {
            ...defaultEffectsSettings.reverb,
            ...(track.effects_settings?.reverb || {}),
            enabled: !!track.effects_settings?.reverb
        },
        delay: {
            ...defaultEffectsSettings.delay,
            ...(track.effects_settings?.delay || {}),
            enabled: !!track.effects_settings?.delay
        },
        distortion: {
            ...defaultEffectsSettings.distortion,
            ...(track.effects_settings?.distortion || {}),
            enabled: !!track.effects_settings?.distortion
        }
    };
    console.log('TrackEffectsModal opened with track:', track.id, 'effects_settings:', track.effects_settings);
    console.log('Initial effectsSettings:', initialEffectsSettings);

    const [effectsSettings, setEffectsSettings] = useState(initialEffectsSettings);

    const handleEffectToggle = (effect) => {
        setEffectsSettings(prev => {
            const newSettings = {
                ...prev,
                [effect]: { ...prev[effect], enabled: !prev[effect].enabled }
            };
            console.log('Toggled effect:', effect, 'New settings:', newSettings);
            return newSettings;
        });
    };

    const handleParameterChange = (effect, param, value) => {
        setEffectsSettings(prev => ({
            ...prev,
            [effect]: { ...prev[effect], [param]: Number(value) }
        }));
    };

    const handleSave = () => {
        const cleanedSettings = {};
        Object.entries(effectsSettings).forEach(([effect, params]) => {
            if (params.enabled) {
                cleanedSettings[effect] = {};
                if (effect === 'reverb') {
                    cleanedSettings[effect].decay = params.decay;
                    cleanedSettings[effect].wet = params.wet;
                } else if (effect === 'delay') {
                    cleanedSettings[effect].delayTime = params.delayTime;
                    cleanedSettings[effect].wet = params.wet;
                } else if (effect === 'distortion') {
                    cleanedSettings[effect].distortion = params.distortion;
                    cleanedSettings[effect].wet = params.wet;
                }
            }
        });
        console.log('Saving effects settings:', cleanedSettings);
        onEffectsChange(track.id, cleanedSettings);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 text-gray-200 rounded-lg p-6 w-[450px] shadow-lg">
                <h2 className="text-xl font-semibold mb-4">Effects for {track.name}</h2>
                {['reverb', 'delay', 'distortion'].map(effect => (
                    <div key={effect} className="mb-6">
                        <label className="flex items-center space-x-2 mb-2">
                            <input
                                type="checkbox"
                                checked={effectsSettings[effect]?.enabled || false}
                                onChange={() => handleEffectToggle(effect)}
                                className="h-4 w-4 text-purple-500 focus:ring-purple-500 border-gray-600 rounded"
                            />
                            <span className="capitalize text-sm font-medium">{effect}</span>
                        </label>
                        {effectsSettings[effect]?.enabled && (
                            <div className="ml-6 grid grid-cols-2 gap-4">
                                {effect === 'reverb' && (
                                    <>
                                        <Knob
                                            label="Decay"
                                            value={effectsSettings.reverb.decay}
                                            onChange={(value) => handleParameterChange('reverb', 'decay', value)}
                                            min={0.1}
                                            max={10}
                                            step={0.1}
                                            decimals={1}
                                        />
                                        <Knob
                                            label="Wet"
                                            value={effectsSettings.reverb.wet}
                                            onChange={(value) => handleParameterChange('reverb', 'wet', value)}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            decimals={2}
                                        />
                                    </>
                                )}
                                {effect === 'delay' && (
                                    <>
                                        <Knob
                                            label="Delay Time"
                                            value={effectsSettings.delay.delayTime}
                                            onChange={(value) => handleParameterChange('delay', 'delayTime', value)}
                                            min={0}
                                            max={2}
                                            step={0.01}
                                            decimals={2}
                                        />
                                        <Knob
                                            label="Wet"
                                            value={effectsSettings.delay.wet}
                                            onChange={(value) => handleParameterChange('delay', 'wet', value)}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            decimals={2}
                                        />
                                    </>
                                )}
                                {effect === 'distortion' && (
                                    <>
                                        <Knob
                                            label="Distortion"
                                            value={effectsSettings.distortion.distortion}
                                            onChange={(value) => handleParameterChange('distortion', 'distortion', value)}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            decimals={2}
                                        />
                                        <Knob
                                            label="Wet"
                                            value={effectsSettings.distortion.wet}
                                            onChange={(value) => handleParameterChange('distortion', 'wet', value)}
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            decimals={2}
                                        />
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                <div className="flex justify-end space-x-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TrackEffectsModal;