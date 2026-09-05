import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { api, type Song } from '@/lib/api';
import { usePlayer } from '@/lib/player';
import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';
import { TrackRow } from '@/components/TrackRow';

/**
 * Search.
 *
 * Tempo and key are on the front, not behind an "advanced" disclosure. The
 * server has supported both for a while, and for an audience that mixes
 * records they are the reason to search at all rather than a power-user extra.
 */
const BPM_BANDS = [
    { label: 'any', min: undefined, max: undefined },
    { label: '90-110', min: 90, max: 110 },
    { label: '118-126', min: 118, max: 126 },
    { label: '126-134', min: 126, max: 134 },
    { label: '140+', min: 140, max: 200 },
];

export default function SearchScreen() {
    const { startFrom } = usePlayer();
    const [query, setQuery] = useState('');
    const [band, setBand] = useState(0);
    const [songs, setSongs] = useState<Song[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        const { min, max } = BPM_BANDS[band];
        // The endpoint refuses a search with nothing in it at all, which is
        // correct, so do not send one.
        if (!query.trim() && min === undefined) {
            setSongs(null);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await api.search({ q: query.trim(), bpmMin: min, bpmMax: max, limit: 40 });
            setSongs(result.songs ?? []);
        } catch (err: any) {
            setError(err?.message ?? 'Search failed.');
            setSongs([]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Page keyboardShouldPersistTaps="handled">
            <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={run}
                placeholder="Tracks, artists, genres"
                placeholderTextColor={colors.inkFaint}
                returnKeyType="search"
                autoCorrect={false}
            />

            <Text style={styles.label}>Tempo</Text>
            <View style={styles.bands}>
                {BPM_BANDS.map((b, i) => (
                    <Pressable
                        key={b.label}
                        style={[styles.band, i === band && styles.bandOn]}
                        onPress={() => setBand(i)}
                    >
                        <Text style={[styles.bandText, i === band && styles.bandTextOn]}>{b.label}</Text>
                    </Pressable>
                ))}
            </View>

            <Pressable style={styles.go} onPress={run}>
                <Text style={styles.goText}>Search</Text>
            </Pressable>

            {loading ? <ActivityIndicator color={colors.cyan} style={{ marginTop: space.xl }} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {songs && !loading ? (
                songs.length === 0
                    ? <Text style={styles.empty}>Nothing matched.</Text>
                    : (
                        <View style={{ marginTop: space.lg }}>
                            <Text style={styles.label}>{songs.length} track{songs.length === 1 ? '' : 's'}</Text>
                            {songs.map((song) => (
                                <TrackRow key={song.id} song={song} onPlay={(s) => { startFrom(s.id); router.push('/'); }} />
                            ))}
                        </View>
                    )
            ) : null}
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.lg, paddingBottom: space.xxl },
    input: {
        borderWidth: 1, borderColor: colors.hair, color: colors.ink,
        paddingHorizontal: space.md, paddingVertical: space.md, ...type.body,
    },
    label: { ...type.label, color: colors.cyan, marginTop: space.lg, marginBottom: space.sm },
    bands: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    band: { borderWidth: 1, borderColor: colors.hair, paddingHorizontal: space.md, paddingVertical: space.sm },
    bandOn: { borderColor: colors.cyan, backgroundColor: colors.void3 },
    bandText: { ...type.meta, color: colors.inkFaint },
    bandTextOn: { color: colors.cyan },
    go: { marginTop: space.lg, backgroundColor: colors.magenta, paddingVertical: space.md, alignItems: 'center' },
    goText: { ...type.title, color: colors.void0, letterSpacing: 1 },
    empty: { ...type.body, color: colors.inkDim, marginTop: space.xl },
    error: { ...type.meta, color: colors.danger, marginTop: space.lg },
});
