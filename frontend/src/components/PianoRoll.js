// In PianoRoll.js
import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import API_URL from '../utils/api';

const PianoRoll = ({
                       track,
                       projectId,
                       playheadPosition,
                       registerPlayhead,
                       zoom,
                       bpm,
                       isSnapping,
                       timelineDuration,
                       onExtendTimeline,
                       onNotesChange,
                       isMinimized,
                   }) => {
    const [notes, setNotes] = useState(Array.isArray(track.midi_notes) ? track.midi_notes : []);
    const [selectedIndices, setSelectedIndices] = useState(new Set());
    const [lassoRect, setLassoRect] = useState(null);
    const dragStateRef = useRef(null);
    const suppressClickRef = useRef(false);
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
    // Notes and the grid are both in timeline units, so nothing here depends on
    // the tempo — the piano roll looks identical at every BPM.
    const pixelsPerSecond = zoom;
    const currentHeight = isMinimized ? minimizedHeight : fullGridHeight;
    const minorInterval = 0.125; // a 1/16 note in timeline units
    const majorInterval = 0.5; // one beat
    const numMinorMarkers = Math.ceil(timelineDuration / minorInterval);
    const segmentDuration = 0.25; // half a beat, in timeline units

    useEffect(() => {
        if (track.midi_notes == null || !Array.isArray(track.midi_notes)) {
            setNotes([]);
        } else {
            setNotes(track.midi_notes);
        }
        setSelectedIndices(new Set());
    }, [track.midi_notes]);

    const drawGrid = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // White-key (natural) rows get a lighter tint; sharp rows stay dark
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        notesList.forEach((note, index) => {
            if (!isDrumTrack && !note.includes('#')) {
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
            const unitTime = i * minorInterval;
            const pixelPosition = unitTime * pixelsPerSecond;
            const isMajorMarker = Math.abs(unitTime % majorInterval) < 0.001;

            ctx.beginPath();
            ctx.moveTo(pixelPosition, 0);
            ctx.lineTo(pixelPosition, currentHeight);
            ctx.strokeStyle = isMajorMarker ? 'rgba(156, 163, 175, 0.8)' : 'rgba(156, 163, 175, 0.5)';
            ctx.stroke();
        }

        ctx.fillStyle = '#9333ea';
        notes.forEach((note, idx) => {
            const noteIndex = notesList.indexOf(note.note);
            if (noteIndex === -1) {
                console.warn(`Invalid note: ${note.note} not in notesList`, { note, notesList });
                return;
            }
            const y = noteIndex * rowHeight;
            if (isMinimized && y >= minimizedHeight) return;
            const x = note.start_time * pixelsPerSecond;
            const width = note.duration * pixelsPerSecond;
            ctx.fillStyle = selectedIndices.has(idx) ? '#22d3ee' : '#9333ea';
            ctx.fillRect(x, y, width, rowHeight);
        });

        // Lasso marquee
        if (lassoRect) {
            const lx = Math.min(lassoRect.x1, lassoRect.x2);
            const ly = Math.min(lassoRect.y1, lassoRect.y2);
            const lw = Math.abs(lassoRect.x2 - lassoRect.x1);
            const lh = Math.abs(lassoRect.y2 - lassoRect.y1);
            ctx.fillStyle = 'rgba(34, 211, 238, 0.15)';
            ctx.fillRect(lx, ly, lw, lh);
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(lx, ly, lw, lh);
        }

        // The playhead is not painted here. It is a DOM element overlaid on this
        // canvas and moved by a transform, so it can run at the frame rate
        // without dragging a full repaint of the grid and every note along with
        // it. Drawing it here meant the roll redrew as often as the line moved.

        ctx.restore();
    };

    const saveNotes = async (newNotes, prevNotes) => {
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
            onNotesChange(track.id, newNotes);
        } catch (err) {
            console.error('Failed to save MIDI notes:', err.response?.data || err.message);
            setNotes(prevNotes);
        }
    };

    const handleCanvasClick = async (e) => {
        e.stopPropagation();
        if (isMinimized) {
            console.log('Canvas click ignored: Piano roll is minimized');
            return;
        }
        // A plain click while notes are selected just clears the selection
        if (selectedIndices.size > 0) {
            setSelectedIndices(new Set());
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

        // Notes are stored in timeline units, so the grid is the same at any tempo
        let startTime = x / pixelsPerSecond;
        if (isSnapping) {
            const snapUnits = 0.0625; // 1/32 note
            startTime = Math.round(startTime / snapUnits) * snapUnits;
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

        await saveNotes(newNotes, notes);
    };

    useEffect(() => {
        drawGrid();
    }, [notes, zoom, bpm, timelineDuration, isMinimized, track.instrument_type, selectedIndices, lassoRect]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleMouseDown = (e) => {
            if (isMinimized) return;
            const rect = canvas.getBoundingClientRect();
            dragStateRef.current = {
                startX: e.clientX - rect.left,
                startY: e.clientY - rect.top,
                dragged: false,
            };
        };

        const handleMouseMove = (e) => {
            const drag = dragStateRef.current;
            if (!drag) return;
            const rect = canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
            if (!drag.dragged && Math.abs(x - drag.startX) < 4 && Math.abs(y - drag.startY) < 4) return;
            drag.dragged = true;
            setLassoRect({ x1: drag.startX, y1: drag.startY, x2: x, y2: y });
        };

        const handleMouseUp = () => {
            const drag = dragStateRef.current;
            if (!drag) return;
            dragStateRef.current = null;
            if (!drag.dragged) return;
            suppressClickRef.current = true; // swallow the click event that follows a drag
            // Finish lasso: select notes intersecting the rectangle
            setLassoRect((rect) => {
                if (rect) {
                    const lx1 = Math.min(rect.x1, rect.x2);
                    const lx2 = Math.max(rect.x1, rect.x2);
                    const ly1 = Math.min(rect.y1, rect.y2);
                    const ly2 = Math.max(rect.y1, rect.y2);
                    const picked = new Set();
                    notes.forEach((note, idx) => {
                        const noteIndex = notesList.indexOf(note.note);
                        if (noteIndex === -1) return;
                        const nx1 = note.start_time * pixelsPerSecond;
                        const nx2 = nx1 + note.duration * pixelsPerSecond;
                        const ny1 = noteIndex * rowHeight;
                        const ny2 = ny1 + rowHeight;
                        if (nx1 < lx2 && nx2 > lx1 && ny1 < ly2 && ny2 > ly1) {
                            picked.add(idx);
                        }
                    });
                    setSelectedIndices(picked);
                }
                return null;
            });
        };

        const handleClick = (e) => {
            if (suppressClickRef.current) {
                suppressClickRef.current = false;
                e.stopPropagation();
                return;
            }
            handleCanvasClick(e);
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('click', handleClick);
        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('click', handleClick);
        };
    }, [isMinimized, isSnapping, zoom, bpm, track.id, notesList, notes, selectedIndices]);

    // Delete/Backspace removes lassoed notes; Escape clears the selection
    useEffect(() => {
        if (selectedIndices.size === 0) return;
        const handleKeyDown = (e) => {
            const target = e.target;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const newNotes = notes.filter((_, idx) => !selectedIndices.has(idx));
                setSelectedIndices(new Set());
                saveNotes(newNotes, notes);
            } else if (e.key === 'Escape') {
                setSelectedIndices(new Set());
            }
        };
        // Capture phase so this wins over the page-level Delete (clip) handler
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [selectedIndices, notes]);

    return (
        <div
            className="relative"
            style={{ width: `${gridWidth}px`, height: `${currentHeight}px` }}
        >
            <canvas
                ref={canvasRef}
                width={gridWidth}
                height={currentHeight}
                className={`border border-white/10 ${isMinimized ? 'cursor-default' : 'cursor-pointer'}`}
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    imageRendering: 'pixelated',
                    background: '#0b0f1a',
                    zIndex: 20,
                    pointerEvents: isMinimized ? 'none' : 'auto',
                }}
            />
            {/* Over the canvas, not in it. Registered with the playback engine,
                which writes a transform every animation frame, so this sweeps
                at the frame rate while the grid underneath is repainted only
                when the notes themselves change. */}
            <div
                ref={registerPlayhead}
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '4px',
                    height: `${currentHeight}px`,
                    background: '#ef4444',
                    zIndex: 30,
                    pointerEvents: 'none',
                    transform: `translate3d(${playheadPosition * pixelsPerSecond}px, 0, 0)`,
                }}
            />
        </div>
    );
};

PianoRoll.propTypes = {
    track: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    playheadPosition: PropTypes.number.isRequired,
    registerPlayhead: PropTypes.func,
    zoom: PropTypes.number.isRequired,
    bpm: PropTypes.number.isRequired,
    isSnapping: PropTypes.bool.isRequired,
    timelineDuration: PropTypes.number.isRequired,
    onExtendTimeline: PropTypes.func.isRequired,
    onNotesChange: PropTypes.func.isRequired,
    isMinimized: PropTypes.bool.isRequired,
};

export default PianoRoll;