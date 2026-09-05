import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { api, type GenreTag, type Song } from '@/lib/api';
import { usePlayer } from '@/lib/player';
import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';
import { TrackRow } from '@/components/TrackRow';

/**
 * Browse.
 *
 * Tapping a genre opens it. That screen leads with "start a station", so the
 * fast path is still one extra tap, but a tag that went straight to playback
 * could never answer "what else is in here", and the chips looked pressable
 * in three places while only being pressable in one.
 */
export default function BrowseScreen() {
    const { startFrom } = usePlayer();
    const [tags, setTags] = useState<GenreTag[]>([]);
    const [justAdded, setJustAdded] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const [genres, recent] = await Promise.all([api.genres(), api.recent()]);
                // Already ordered by count server side, so the head of the list
                // is the part of the catalogue worth putting in front of people.
                setTags(genres.filter((g) => g.key).slice(0, 24));
                setJustAdded(recent.justAdded ?? []);
            } catch (err: any) {
                setError(err?.message ?? 'Could not load the catalogue.');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return <View style={styles.centre}><ActivityIndicator color={colors.cyan} /></View>;

    return (
        <Page>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.section}>Genres</Text>
            <Text style={styles.hint}>Tap one to look inside, or start a station from it.</Text>
            <View style={styles.tags}>
                {tags.map(({ key, label, count }) => (
                    <Pressable
                        key={key}
                        style={({ pressed }) => [styles.tag, pressed && styles.tagPressed]}
                        // The key is what /music/by-tag matches on; the label is
                        // only ever for reading. This used to start a station
                        // straight from here, which was fast but showed you
                        // nothing; the genre screen leads with that same button
                        // and adds the ability to look first.
                        onPress={() => router.push(`/genre/${encodeURIComponent(key)}`)}
                    >
                        <Text style={styles.tagText}>{label}{count ? ` ${count}` : ''}</Text>
                    </Pressable>
                ))}
            </View>

            <Text style={styles.section}>New this week</Text>
            {justAdded.slice(0, 12).map((song) => (
                <TrackRow key={song.id} song={song} onPlay={(s) => { startFrom(s.id); router.push('/'); }} />
            ))}
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.lg, paddingBottom: space.xxl },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.void0 },
    section: { ...type.label, color: colors.cyan, marginTop: space.lg, marginBottom: space.xs },
    hint: { ...type.meta, color: colors.inkFaint, marginBottom: space.md },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    tag: { borderWidth: 1, borderColor: colors.hair, paddingHorizontal: space.md, paddingVertical: space.sm },
    tagPressed: { backgroundColor: colors.void3 },
    tagText: { ...type.meta, color: colors.cyan },
    error: { ...type.meta, color: colors.danger, marginBottom: space.md },
});
