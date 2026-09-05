import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { colors, space, type } from '@/lib/theme';

/**
 * Position, and the ability to change it.
 *
 * PanResponder rather than a gesture library: this is one horizontal drag on a
 * bar whose width is already known from onLayout, and it is not worth a
 * dependency. Built with a generous hit area, because the visible bar is 4px
 * and nobody can hit 4px with a thumb.
 *
 * While dragging, the bar shows the finger rather than the player. Letting the
 * twice-a-second time updates keep writing to it would make the handle jump
 * backwards under the thumb between seek and the next update.
 */
const format = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function Scrubber({
    position, duration, onSeek,
}: { position: number; duration: number; onSeek: (seconds: number) => void }) {
    const [width, setWidth] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [dragAt, setDragAt] = useState(0);

    // Refs so the responder, created once, always reads current values.
    const widthRef = useRef(0);
    const durationRef = useRef(0);
    widthRef.current = width;
    durationRef.current = duration;

    const responder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
            if (!durationRef.current || !widthRef.current) return;
            setDragging(true);
            setDragAt((event.nativeEvent.locationX / widthRef.current) * durationRef.current);
        },
        onPanResponderMove: (event, gesture) => {
            if (!durationRef.current || !widthRef.current) return;
            const x = Math.max(0, Math.min(gesture.moveX - gesture.x0 + event.nativeEvent.locationX, widthRef.current));
            setDragAt((x / widthRef.current) * durationRef.current);
        },
        onPanResponderRelease: () => {
            if (durationRef.current) onSeek(dragAtRef.current);
            setDragging(false);
        },
        onPanResponderTerminate: () => setDragging(false),
    }), [onSeek]);

    // The responder closes over its own creation, so the release handler needs
    // the latest drag position rather than the one captured at creation.
    const dragAtRef = useRef(0);
    dragAtRef.current = dragAt;

    const shown = dragging ? dragAt : position;
    const pct = duration > 0 ? Math.max(0, Math.min(shown / duration, 1)) : 0;

    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

    return (
        <View style={styles.wrap}>
            {/* The touch target is the padded row; the bar inside it is thin. */}
            <View style={styles.touch} onLayout={onLayout} {...responder.panHandlers}>
                <View style={styles.track}>
                    <View style={[styles.fill, { width: `${pct * 100}%` }]} />
                    <View style={[styles.handle, { left: `${pct * 100}%` }, dragging && styles.handleBig]} />
                </View>
            </View>
            <View style={styles.times}>
                <Text style={styles.time}>{format(shown)}</Text>
                <Text style={styles.time}>{duration > 0 ? format(duration) : '--:--'}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { width: '100%', maxWidth: 300 },
    touch: { paddingVertical: space.md, justifyContent: 'center' },
    track: { height: 4, backgroundColor: 'rgba(0,240,255,0.2)' },
    fill: { height: 4, backgroundColor: colors.magenta },
    handle: {
        position: 'absolute', top: -4, width: 12, height: 12, marginLeft: -6,
        backgroundColor: colors.magenta, borderRadius: 6,
    },
    handleBig: { transform: [{ scale: 1.5 }] },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
    time: { ...type.meta, color: colors.inkFaint, fontVariant: ['tabular-nums'] },
});
