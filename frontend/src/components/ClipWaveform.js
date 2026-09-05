import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import { getToneBuffer, peaksFromBuffer } from '../utils/audioBuffers';

/**
 * The waveform inside a clip on the timeline.
 *
 * This replaces WaveSurfer, which the sampler used only to draw pictures. It
 * was a capable player being asked to be a thumbnail, and it insisted on
 * fetching and decoding its own copy of every file, so each clip's audio was
 * downloaded twice: once for the drawing and once for playback. Drawing from
 * the buffer that playback already decoded costs nothing extra and removes the
 * second download entirely.
 *
 * A trimmed clip draws only the part it plays. WaveSurfer always drew the whole
 * file, so a clip trimmed to its last two seconds showed a waveform whose shape
 * had nothing to do with what you heard.
 *
 * Drawn on a canvas sized to the device pixel ratio, because a waveform is the
 * one thing on this page where a blurry line is obvious.
 */
export default function ClipWaveform({ url, from = 0, to = null, className = '', height = 40 }) {
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const bufferRef = useRef(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setReady(false);
        setFailed(false);

        getToneBuffer(url)
            .then((buffer) => {
                if (cancelled) return;
                bufferRef.current = buffer;
                setReady(true);
            })
            .catch(() => { if (!cancelled) setFailed(true); });

        return () => { cancelled = true; };
    }, [url]);

    // Redraw on resize as well as on load: clips are resized by zoom and by
    // trim, and a canvas stretched by CSS instead of redrawn looks smeared.
    useEffect(() => {
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        if (!wrap || !canvas) return undefined;

        const draw = () => {
            const buffer = bufferRef.current;
            const width = Math.max(1, Math.floor(wrap.clientWidth));
            const dpr = window.devicePixelRatio || 1;

            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);
            if (!buffer) return;

            const peaks = peaksFromBuffer(buffer, width, { from, to });
            const mid = height / 2;

            // currentColor, so the clip's own text colour drives the waveform
            // and each track keeps the tint it already had.
            ctx.fillStyle = getComputedStyle(canvas).color;
            for (let x = 0; x < peaks.length; x += 1) {
                // Always at least a hairline, so silence still reads as a clip
                // rather than as a hole in the timeline.
                const h = Math.max(1, peaks[x] * (height - 2));
                ctx.fillRect(x, mid - h / 2, 1, h);
            }
        };

        draw();

        const observer = new ResizeObserver(draw);
        observer.observe(wrap);
        return () => observer.disconnect();
    }, [ready, from, to, height]);

    return (
        <div ref={wrapRef} className={`relative flex-1 overflow-hidden ${className}`} style={{ height }}>
            {!ready && !failed && (
                <div className="absolute inset-0 bg-cyan-400/10 animate-pulse" aria-hidden="true" />
            )}
            <canvas ref={canvasRef} className="block" aria-hidden="true" />
        </div>
    );
}

ClipWaveform.propTypes = {
    url: PropTypes.string.isRequired,
    from: PropTypes.number,
    to: PropTypes.number,
    className: PropTypes.string,
    height: PropTypes.number,
};
