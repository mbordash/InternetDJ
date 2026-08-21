import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { generateMelody, parsePrompt, STYLES, MODES, KEYS } from '../utils/melodyGenerator';

const MidiGenerateModal = ({ track, bpm, onClose, onApply }) => {
    const [prompt, setPrompt] = useState('');
    const [key, setKey] = useState('C');
    const [mode, setMode] = useState('minor');
    const [style, setStyle] = useState('lead');
    const [bars, setBars] = useState(4);
    const [density, setDensity] = useState(0.8);
    const [preview, setPreview] = useState(null);
    const [isApplying, setIsApplying] = useState(false);
    const [error, setError] = useState(null);

    const hasExistingNotes = Array.isArray(track.midi_notes) && track.midi_notes.length > 0;

    const applyPrompt = (text) => {
        setPrompt(text);
        const parsed = parsePrompt(text);
        if (parsed.key) setKey(parsed.key);
        if (parsed.mode) setMode(parsed.mode);
        if (parsed.style) setStyle(parsed.style);
        if (parsed.bars) setBars(parsed.bars);
        if (parsed.density !== undefined) setDensity(parsed.density);
    };

    const handleGenerate = () => {
        const notes = generateMelody({
            key, mode, style, bars, bpm, density,
            seed: Math.floor(Math.random() * 2 ** 31),
        });
        if (!notes.length) {
            setError('Could not generate notes for those settings — try another key/mode.');
            return;
        }
        setError(null);
        setPreview(notes);
    };

    const handleApply = async () => {
        if (!preview) return;
        setIsApplying(true);
        try {
            await onApply(track.id, preview);
            onClose();
        } catch (err) {
            setError('Failed to apply notes: ' + (err.message || 'unknown error'));
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="retro-panel retro-cut w-full max-w-lg flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-400/25">
                    <h2 className="text-lg font-semibold">✨ Generate MIDI — {track.name}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto">
                    <div>
                        <label className="retro-label" htmlFor="midi-gen-prompt">Describe it</label>
                        <input
                            id="midi-gen-prompt"
                            type="text"
                            value={prompt}
                            onChange={(e) => applyPrompt(e.target.value)}
                            placeholder='e.g. "lead melody in F# minor" or "busy arpeggio in C dorian, 8 bars"'
                            className="w-full px-3 py-2 bg-[#1d0a38] border border-cyan-400/30 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">Fills in the settings below — tweak them anytime.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="retro-label" htmlFor="midi-gen-key">Key</label>
                            <select id="midi-gen-key" value={key} onChange={(e) => setKey(e.target.value)}
                                className="retro-field w-full">
                                {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="midi-gen-mode">Scale</label>
                            <select id="midi-gen-mode" value={mode} onChange={(e) => setMode(e.target.value)}
                                className="retro-field w-full">
                                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="midi-gen-style">Style</label>
                            <select id="midi-gen-style" value={style} onChange={(e) => setStyle(e.target.value)}
                                className="retro-field w-full">
                                {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="retro-label" htmlFor="midi-gen-bars">Bars</label>
                            <select id="midi-gen-bars" value={bars} onChange={(e) => setBars(Number(e.target.value))}
                                className="retro-field w-full">
                                {[1, 2, 4, 8, 16].map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="retro-label" htmlFor="midi-gen-density">
                            Density: {density <= 0.55 ? 'sparse' : density >= 0.95 ? 'busy' : 'medium'}
                        </label>
                        <input
                            id="midi-gen-density"
                            type="range" min="0.3" max="1" step="0.05"
                            value={density}
                            onChange={(e) => setDensity(Number(e.target.value))}
                            className="w-full"
                        />
                    </div>
                    {preview && (
                        <p className="retro-mono text-lg text-cyan-300">
                            Generated {preview.length} notes over {bars} bar{bars > 1 ? 's' : ''} at {bpm} BPM. Not feeling it? Regenerate for a new take.
                        </p>
                    )}
                    {hasExistingNotes && (
                        <p className="text-sm text-yellow-400">⚠ Applying will replace the {track.midi_notes.length} existing notes on this track.</p>
                    )}
                    {error && <p className="retro-mono text-lg text-fuchsia-400">{error}</p>}
                </div>
                <div className="flex justify-end space-x-3 px-5 py-3 border-t border-cyan-400/25">
                    <button onClick={onClose} className="px-4 py-2 bg-[#1d0a38] rounded-lg text-sm hover:bg-gray-600">Cancel</button>
                    <button
                        onClick={handleGenerate}
                        className="px-4 py-2 bg-purple-600 rounded-lg text-sm font-semibold hover:bg-purple-500"
                    >
                        {preview ? '🎲 Regenerate' : '✨ Generate'}
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={!preview || isApplying}
                        className="px-4 py-2 bg-gradient-to-r from-teal-500 to-green-500 rounded-lg text-sm font-semibold hover:from-teal-600 hover:to-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isApplying ? 'Applying…' : 'Apply to Track'}
                    </button>
                </div>
            </div>
        </div>
    );
};

MidiGenerateModal.propTypes = {
    track: PropTypes.object.isRequired,
    bpm: PropTypes.number.isRequired,
    onClose: PropTypes.func.isRequired,
    onApply: PropTypes.func.isRequired,
};

export default MidiGenerateModal;
