import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { api, type Song } from '@/lib/api';
import { usePlayer } from '@/lib/player';
import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';
import { TrackRow } from '@/components/TrackRow';

/**
 * One genre: what is in it, and two ways to play it.
 *
 * This exists because tags were being rendered as chips in three places and
 * were dead everywhere. A chip that looks pressable has to be pressable, and
 * "what else is tagged techno" is a reasonable question that the app could not
 * previously answer at all - Browse went straight from a tag to playback,
 * which is fast but shows you nothing.
 *
 * Station first, because it is the thing this app is for. The list underneath
 * is for the times you want to look before you listen.
 */
export default function GenreScreen() {
    const { tag } = useLocalSearchParams<{ tag: string }>();
    const { start, playQueue } = usePlayer();
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await api.byTag(String(tag));
                if (!cancelled) setSongs(result.songs ?? []);
            } catch (err: any) {
                if (!cancelled) setError(err?.message ?? 'Could not load that genre.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [tag]);

    const asQueueTracks = songs.map((s) => ({
        id: s.id, title: s.title, image_url: s.image_url,
        profile_name: s.profile_name, mp3_url: s.mp3_url,
    }));

    return (
        <Page>
            <Text style={styles.eyebrow}>// genre //</Text>
            <Text style={styles.title}>{tag}</Text>
            {!loading ? (
                <Text style={styles.meta}>{songs.length} track{songs.length === 1 ? '' : 's'}</Text>
            ) : null}

            <View style={styles.actions}>
                <Pressable
                    style={({ pressed }) => [styles.primary, pressed && { opacity: 0.75 }]}
                    onPress={() => { start(String(tag)); router.push('/'); }}
                >
                    <Text style={styles.primaryText}>Start a {tag} station</Text>
                </Pressable>

                {songs.length > 0 ? (
                    <Pressable
                        hitSlop={8}
                        onPress={() => { playQueue(String(tag), asQueueTracks, { shuffle: true }); router.push('/'); }}
                        accessibilityLabel={`Shuffle ${tag}`}
                    >
                        <SymbolView
                            name={{ ios: 'shuffle', android: 'shuffle', web: 'shuffle' }}
                            tintColor={colors.cyan}
                            size={26}
                        />
                    </Pressable>
                ) : null}
            </View>

            <Text style={styles.hint}>
                The station keeps going past this list. Shuffle plays only what is here.
            </Text>

            {loading ? <ActivityIndicator color={colors.cyan} style={{ marginTop: space.xl }} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {songs.map((song, index) => (
                <TrackRow
                    key={song.id}
                    song={song}
                    onPlay={() => { playQueue(String(tag), asQueueTracks, { startIndex: index }); router.push('/'); }}
                />
            ))}
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.lg, paddingBottom: space.xxl },
    eyebrow: { ...type.label, color: colors.cyan },
    title: { ...type.display, color: colors.ink, marginTop: space.xs },
    meta: { ...type.meta, color: colors.inkFaint, marginTop: space.xs },
    actions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.lg },
    primary: { flex: 1, backgroundColor: colors.magenta, paddingVertical: space.md, alignItems: 'center' },
    primaryText: { ...type.title, color: colors.void0, letterSpacing: 0.5 },
    hint: { ...type.meta, color: colors.inkFaint, marginTop: space.sm, marginBottom: space.lg },
    error: { ...type.meta, color: colors.danger, marginTop: space.lg },
});
