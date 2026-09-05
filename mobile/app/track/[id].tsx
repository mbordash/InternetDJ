import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { api, genreTags, type Song } from '@/lib/api';
import { usePlayer } from '@/lib/player';
import { Scrubber } from '@/components/Scrubber';
import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';
import { TrackRow } from '@/components/TrackRow';

/**
 * One track, and what goes with it.
 *
 * "Goes with" is the same /similar call the station runs on, shown rather than
 * played, so the ranking is visible as well as audible.
 */
export default function TrackScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { startFrom, toggle, isCurrent, isPlaying, position, duration, seek, loading } = usePlayer();
    const [song, setSong] = useState<Song | null>(null);
    const [similar, setSimilar] = useState<Song[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [{ song: found }, near] = await Promise.all([
                    api.song(Number(id)),
                    api.similar(Number(id)).catch(() => ({ songs: [] as Song[] })),
                ]);
                if (cancelled) return;
                setSong(found);
                setSimilar(near.songs ?? []);
            } catch (err: any) {
                if (!cancelled) setError(err?.message ?? 'Could not load that track.');
            }
        })();
        return () => { cancelled = true; };
    }, [id]);

    if (error) return <View style={styles.centre}><Text style={styles.error}>{error}</Text></View>;
    if (!song) return <View style={styles.centre}><ActivityIndicator color={colors.cyan} /></View>;

    const tags = genreTags(song.genre);
    const playingThis = isCurrent(song.id);

    return (
        <Page>
            {song.image_url
                ? <Image source={{ uri: song.image_url }} style={styles.art} />
                : <View style={[styles.art, styles.artEmpty]} />}

            <Text style={styles.title}>{song.title}</Text>
            <Pressable onPress={() => router.push(`/artist/${song.profile_id}`)}>
                <Text style={styles.artist}>{song.profile_name}</Text>
            </Pressable>

            {/* Tempo and key are facts; genres are doors. They were drawn
                identically, so all four read as pressable and none were. The
                genre chips now go somewhere and are tinted to say so. */}
            <View style={styles.chips}>
                {song.bpm ? <Text style={styles.chip}>{Math.round(song.bpm)} BPM</Text> : null}
                {song.camelot || song.musical_key ? <Text style={styles.chip}>{song.camelot ?? song.musical_key}</Text> : null}
                {tags.map((t) => (
                    <Pressable
                        key={t}
                        onPress={() => router.push(`/genre/${encodeURIComponent(t)}`)}
                        accessibilityRole="link"
                        accessibilityLabel={`Browse ${t}`}
                    >
                        <Text style={[styles.chip, styles.chipLink]}>{t}</Text>
                    </Pressable>
                ))}
            </View>

            {/* Real transport, not a button that quietly hijacks the station.
                It is still one player though, and deliberately so: a second
                playback path means two things that can be making noise, or a
                mode you can get stuck in. So this plays the track you are
                looking at, and when it ends the station carries on from here
                rather than stopping dead. The caption says that out loud so it
                is a promise rather than a surprise. */}
            <View style={styles.transport}>
                <Pressable
                    onPress={() => (playingThis ? toggle() : startFrom(song.id))}
                    hitSlop={12}
                    disabled={loading}
                    accessibilityLabel={playingThis && isPlaying ? 'Pause' : 'Play this track'}
                >
                    <SymbolView
                        name={{
                            ios: playingThis && isPlaying ? 'pause.circle.fill' : 'play.circle.fill',
                            android: 'play_circle',
                            web: 'play_circle',
                        }}
                        tintColor={colors.magenta}
                        size={58}
                    />
                </Pressable>

                <View style={styles.transportBar}>
                    {playingThis
                        ? <Scrubber position={position} duration={duration} onSeek={seek} />
                        : <Text style={styles.transportHint}>
                            Plays this track, then keeps going with what goes with it.
                          </Text>}
                </View>
            </View>

            <Pressable style={styles.stationLink} onPress={() => router.push('/')}>
                <Text style={styles.stationLinkText}>Open the station</Text>
            </Pressable>

            {similar.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.label}>Goes with</Text>
                    {similar.map((s) => (
                        <View key={s.id}>
                            <TrackRow song={s} />
                            {s.match_reasons?.length
                                ? <Text style={styles.reason}>{s.match_reasons.join(' · ')}</Text>
                                : null}
                        </View>
                    ))}
                </View>
            ) : null}

            {/* The catalogue is member-uploaded, which puts the app under
                Apple's user-generated-content rules. A report route is the
                cheap part of satisfying them. */}
            <Pressable
                style={styles.report}
                onPress={() => Linking.openURL(
                    `mailto:internetdjco@gmail.com?subject=${encodeURIComponent(`Report track ${song.id}`)}`
                )}
            >
                <Text style={styles.reportText}>Report this track</Text>
            </Pressable>
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.lg, paddingBottom: space.xxl },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.void0 },
    art: { width: '100%', aspectRatio: 1, maxHeight: 300, borderWidth: 1, borderColor: colors.hair },
    artEmpty: { backgroundColor: colors.void3 },
    title: { ...type.display, color: colors.ink, marginTop: space.lg },
    artist: { ...type.title, color: colors.cyan, marginTop: space.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
    chip: {
        ...type.meta, color: colors.inkDim, paddingHorizontal: space.sm, paddingVertical: 2,
        borderWidth: 1, borderColor: colors.hair, overflow: 'hidden',
    },
    // Tinted to the accent so a chip that does something is distinguishable
    // from one that only states a number.
    chipLink: { color: colors.cyan, borderColor: 'rgba(0,240,255,0.5)' },
    transport: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
    transportBar: { flex: 1, minWidth: 0 },
    transportHint: { ...type.meta, color: colors.inkFaint },
    stationLink: { marginTop: space.md, alignSelf: 'flex-start', paddingVertical: space.sm },
    stationLinkText: { ...type.meta, color: colors.cyan },
    section: { marginTop: space.xl },
    label: { ...type.label, color: colors.cyan, marginBottom: space.sm },
    reason: { ...type.meta, color: colors.inkFaint, marginTop: -space.xs, marginBottom: space.sm, marginLeft: 58 },
    report: { marginTop: space.xxl, alignItems: 'center', paddingVertical: space.md },
    reportText: { ...type.meta, color: colors.inkFaint },
    error: { ...type.body, color: colors.danger, padding: space.xl, textAlign: 'center' },
});
