// src/components/ReadOnlyPianoRoll.js
import React from 'react';
import PropTypes from 'prop-types';
import * as Tone from 'tone';

// One beat, in timeline units, at every tempo. See utils/timeline.js.
const BEAT_UNITS = 0.5;

const ReadOnlyPianoRoll = ({ track, playheadPosition, zoom, timelineDuration, registerPlayhead }) => {
    const rowHeight = 15; // Match PianoRoll's row height
    const notesList = [
        'C5', 'B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C#4',
        'C4', 'B3', 'A#3', 'A3', 'G#3', 'G3', 'F#3', 'F3', 'E3', 'D#3', 'D3', 'C#3'
    ]; // Match PianoRoll's note range
    const gridHeight = notesList.length * rowHeight; // 24 * 15 = 360px
    const gridWidth = timelineDuration * zoom;
    // Notes and the grid are both in timeline units, so this must not scale with
    // tempo. Multiplying by timeScale drew the notes at the wrong x against a
    // playhead measured in units, at every tempo but 120. The editor's PianoRoll
    // has always used bare zoom.
    const pixelsPerSecond = zoom;

    return (
        <div
            className="piano-roll relative"
            style={{ width: `${gridWidth}px`, height: `${gridHeight}px` }}
        >
            <div
                className="absolute top-0 left-0 w-full h-full bg-[#0b0f1a] border border-white/10"
                style={{ width: `${gridWidth}px`, height: `${gridHeight}px` }}
            >
                {/* Sharp/Flat Note Backgrounds */}
                {notesList.map((note, index) => (
                    <div
                        key={note}
                        className={`absolute w-full h-[15px] ${
                            note.includes('#') ? 'bg-[#0b0f1a]' : 'bg-[#3a4560]'
                        } border-t border-white/10`}
                        style={{ top: `${index * rowHeight}px` }}
                    />
                ))}
                {/* Beat lines. Musical, like the editor's grid, so they hold their
                    position across a tempo change instead of sliding against the
                    notes drawn on top of them. */}
                {Array.from({ length: Math.ceil(timelineDuration / BEAT_UNITS) }, (_, i) => {
                    const pixelPosition = i * BEAT_UNITS * zoom;
                    return (
                        <div
                            key={`time-grid-${i}`}
                            className="absolute top-0 bottom-0 border-l border-white/15 z-0"
                            style={{ left: `${pixelPosition}px` }}
                        />
                    );
                })}
                {/* MIDI Notes */}
                {track.midi_notes &&
                    track.midi_notes.map((note, index) => {
                        if (!note.note || note.start_time == null || note.duration == null) return null;
                        const noteIndex = notesList.indexOf(note.note);
                        if (noteIndex === -1) return null;
                        return (
                            <div
                                key={`note-${index}`}
                                className="absolute bg-[#9333ea]"
                                style={{
                                    left: `${note.start_time * pixelsPerSecond}px`,
                                    width: `${note.duration * pixelsPerSecond}px`,
                                    top: `${noteIndex * rowHeight}px`,
                                    height: `${rowHeight}px`,
                                }}
                            />
                        );
                    })}
                {/* Playhead */}
                <div
                    className="absolute top-0 bottom-0 w-[4px] bg-[#ef4444] z-10"
                    ref={registerPlayhead}
                    style={{ left: 0, transform: `translate3d(${playheadPosition * zoom}px, 0, 0)` }}
                />
            </div>
        </div>
    );
};

ReadOnlyPianoRoll.propTypes = {
    track: PropTypes.shape({
        id: PropTypes.number.isRequired,
        midi_notes: PropTypes.array,
        track_type: PropTypes.string.isRequired,
    }).isRequired,
    playheadPosition: PropTypes.number.isRequired,
    registerPlayhead: PropTypes.func,
    zoom: PropTypes.number.isRequired,
    timelineDuration: PropTypes.number.isRequired,
};

export default ReadOnlyPianoRoll;