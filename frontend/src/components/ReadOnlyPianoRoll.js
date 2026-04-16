// src/components/ReadOnlyPianoRoll.js
import React from 'react';
import PropTypes from 'prop-types';
import * as Tone from 'tone';

const ReadOnlyPianoRoll = ({ track, playheadPosition, zoom, bpm, timelineDuration }) => {
    const timeScale = 120 / bpm;
    const rowHeight = 15; // Match PianoRoll's row height
    const notesList = [
        'C5', 'B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C#4',
        'C4', 'B3', 'A#3', 'A3', 'G#3', 'G3', 'F#3', 'F3', 'E3', 'D#3', 'D3', 'C#3'
    ]; // Match PianoRoll's note range
    const gridHeight = notesList.length * rowHeight; // 24 * 15 = 360px
    const gridWidth = timelineDuration * zoom;
    const pixelsPerSecond = zoom * timeScale;

    return (
        <div
            className="piano-roll relative"
            style={{ width: `${gridWidth}px`, height: `${gridHeight}px` }}
        >
            <div
                className="absolute top-0 left-0 w-full h-full bg-[#f9f9f9] border border-gray-300"
                style={{ width: `${gridWidth}px`, height: `${gridHeight}px` }}
            >
                {/* Sharp/Flat Note Backgrounds */}
                {notesList.map((note, index) => (
                    <div
                        key={note}
                        className={`absolute w-full h-[15px] ${
                            note.includes('#') ? 'bg-[#e5e7eb]' : 'bg-[#f9f9f9]'
                        } border-t border-[#ccc]`}
                        style={{ top: `${index * rowHeight}px` }}
                    />
                ))}
                {/* Time Grid Lines */}
                {Array.from({ length: Math.ceil(timelineDuration / timeScale) }, (_, i) => {
                    const realTime = i * 1; // 1-second intervals
                    const scaledTime = realTime * timeScale;
                    const pixelPosition = scaledTime * zoom;
                    return (
                        <div
                            key={`time-grid-${i}`}
                            className="absolute top-0 bottom-0 border-l border-[#ccc] z-0"
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
                    style={{ left: `${playheadPosition * zoom}px` }}
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
    zoom: PropTypes.number.isRequired,
    bpm: PropTypes.number.isRequired,
    timelineDuration: PropTypes.number.isRequired,
};

export default ReadOnlyPianoRoll;