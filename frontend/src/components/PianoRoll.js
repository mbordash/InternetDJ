// In PianoRoll.js
import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import API_URL from '../utils/api';

const PianoRoll = ({
                       track,
                       projectId,
                       playheadPosition,
                       zoom,
                       bpm,
                       isSnapping,
                       timelineDuration,
                       onExtendTimeline,
                       onNotesChange,
                       isMinimized,
                   }) => {
    const [notes, setNotes] = useState(Array.isArray(track.midi_notes) ? track.midi_notes : []);
    const canvasRef = useRef(null);

    const drumNotes = [
        'D#3', 'C#3', 'A#2', 'F#2', 'E2', 'D2', 'C3', 'B2', 'A2', 'C2',
    ];
    const melodicNotes = [
        'C5', 'B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C#4',
        'C4', 'B3', 'A#3', 'A3', 'G#3', 'G3', 'F#3', 'F3', 'E3', 'D#3', 'D3', 'C#3',
        'C3', 'B2', 'A#2', 'A2', 'G#2', 'G2', 'F#2', 'F2', 'E2', 'D#2', 'D2', 'C#2',
    ];

    const isDrumTrack = track.instrument_type === 'drumsampler';
    const notesList = isDrumTrack ? drumNotes : melodicNotes;
    const rowHeight = 15;
    const fullGridHeight = notesList.length * rowHeight;
    const minimizedHeight = 80;
    const gridWidth = timelineDuration * zoom;
    const timeScale = 120 / bpm;
    const pixelsPerSecond = zoom;
    const currentHeight = isMinimized ? minimizedHeight : fullGridHeight;
    const minorInterval = 0.1;
    const majorInterval = 1.0;
    const totalRealSeconds = timelineDuration / timeScale;
    const numMinorMarkers = Math.ceil(totalRealSeconds / minorInterval);
    const segmentDuration = 0.25; // Increased for audibility

    useEffect(() => {
        if (track.midi_notes == null || !Array.isArray(track.midi_notes)) {
            setNotes([]);
        } else {
            setNotes(track.midi_notes);
        }
    }, [track.midi_notes]);

    const drawGrid = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#e5e7eb';
        notesList.forEach((note, index) => {
            if (!isDrumTrack && note.includes('#')) {
                const y = index * rowHeight;
                if (isMinimized && y >= minimizedHeight) return;
                ctx.fillRect(0, y, gridWidth, rowHeight);
            }
        });

        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        const visibleRows = isMinimized ? Math.ceil(minimizedHeight / rowHeight) : notesList.length;
        for (let i = 0; i <= visibleRows; i++) {
            const y = i * rowHeight;
            if (isMinimized && y > minimizedHeight) break;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(gridWidth, y);
            ctx.stroke();
        }

        ctx.strokeStyle = '#ccc';
        for (let i = 0; i < numMinorMarkers; i++) {
            const realTime = i * minorInterval;
            const scaledTime = realTime * timeScale;
            const pixelPosition = scaledTime * pixelsPerSecond;
            const isMajorMarker = Math.abs(realTime % majorInterval) < 0.001;

            ctx.beginPath();
            ctx.moveTo(pixelPosition, 0);
            ctx.lineTo(pixelPosition, currentHeight);
            ctx.strokeStyle = isMajorMarker ? 'rgba(156, 163, 175, 0.8)' : 'rgba(156, 163, 175, 0.5)';
            ctx.stroke();
        }

        ctx.fillStyle = '#9333ea';
        notes.forEach((note) => {
            const noteIndex = notesList.indexOf(note.note);
            if (noteIndex === -1) {
                console.warn(`Invalid note: ${note.note} not in notesList`, { note, notesList });
                return;
            }
            const y = noteIndex * rowHeight;
            if (isMinimized && y >= minimizedHeight) return;
            const x = note.start_time * timeScale * pixelsPerSecond;
            const width = note.duration * timeScale * pixelsPerSecond;
            ctx.fillRect(x, y, width, rowHeight);
        });

        ctx.fillStyle = '#ef4444';
        const playheadX = playheadPosition * pixelsPerSecond;
        ctx.fillRect(playheadX, 0, 4, currentHeight);

        ctx.restore();
    };

    const handleCanvasClick = async (e) => {
        e.stopPropagation();
        if (isMinimized) {
            console.log('Canvas click ignored: Piano roll is minimized');
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            console.error('Canvas ref is not set');
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const noteIndex = Math.floor(y / rowHeight);
        const note = notesList[noteIndex];
        if (!note) {
            console.warn('Invalid note index:', noteIndex, 'y:', y);
            return;
        }

        let startTime = x / pixelsPerSecond / timeScale;
        if (isSnapping) {
            const snapIntervalReal = 0.05;
            const snapIntervalScaled = snapIntervalReal * timeScale;
            startTime = Math.round(startTime / snapIntervalScaled) * snapIntervalScaled;
        }
        startTime = Number(startTime.toFixed(2));

        console.log('Clicked note:', note, 'startTime:', startTime);

        const existingNote = notes.find(
            (n) =>
                n.note === note &&
                Math.abs(n.start_time - startTime) < segmentDuration / 2
        );

        let newNotes;
        if (existingNote) {
            console.log('Removing note:', existingNote);
            newNotes = notes.filter((n) => n !== existingNote);
        } else {
            console.log('Adding note:', { note, start_time: startTime, duration: segmentDuration });
            newNotes = [...notes, { note, start_time: startTime, duration: segmentDuration }];
            onExtendTimeline(startTime, segmentDuration);
        }

        setNotes(newNotes);
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                throw new Error('No authentication token found');
            }
            await axios.put(
                `${API_URL}/projects/${projectId}/tracks/${track.id}/midi`,
                { midi_notes: newNotes },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            console.log('Saved notes to backend:', newNotes);
            onNotesChange(track.id, newNotes);
        } catch (err) {
            console.error('Failed to save MIDI notes:', err.response?.data || err.message);
            setNotes(notes);
            setError('Failed to save MIDI notes: ' + (err.response?.data?.error || err.message));
        }
    };

    useEffect(() => {
        drawGrid();
    }, [notes, playheadPosition, zoom, bpm, timelineDuration, isMinimized, track.instrument_type]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const handleClick = (e) => {
                console.log('Canvas clicked:', e);
                handleCanvasClick(e);
            };
            canvas.addEventListener('click', handleClick);
            return () => {
                console.log('Removing canvas click listener');
                canvas.removeEventListener('click', handleClick);
            };
        }
    }, [isMinimized, isSnapping, zoom, bpm, track.id, notesList, notes]);

    return (
        <div
            className="relative"
            style={{ width: `${gridWidth}px`, height: `${currentHeight}px` }}
        >
            <canvas
                ref={canvasRef}
                width={gridWidth}
                height={currentHeight}
                className={`border border-gray-300 ${isMinimized ? 'cursor-default' : 'cursor-pointer'}`}
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    imageRendering: 'pixelated',
                    background: '#f9f9f9',
                    zIndex: 20,
                    pointerEvents: isMinimized ? 'none' : 'auto',
                }}
            />
        </div>
    );
};

PianoRoll.propTypes = {
    track: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    playheadPosition: PropTypes.number.isRequired,
    zoom: PropTypes.number.isRequired,
    bpm: PropTypes.number.isRequired,
    isSnapping: PropTypes.bool.isRequired,
    timelineDuration: PropTypes.number.isRequired,
    onExtendTimeline: PropTypes.func.isRequired,
    onNotesChange: PropTypes.func.isRequired,
    isMinimized: PropTypes.bool.isRequired,
};

export default PianoRoll;