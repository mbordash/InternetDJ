import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { api, type Release, type Song } from '@/lib/api';
import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';
import { TrackRow } from '@/components/TrackRow';

/** An artist, their releases and their tracks. Public endpoints only. */
export default function ArtistScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const [name, setName] = useState('');
    const [songs, setSongs] = useState<Song[]>([]);
    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [profile, rel] = await Promise.all([
                    api.profile(Number(id)),
                    api.releases(Number(id)).catch(() => ({ releases: [] as Release[] })),
                ]);
                if (cancelled) return;
                setName(profile?.profile?.name ?? 'Artist');
                setSongs(profile?.songs ?? []);
                setReleases(rel.releases ?? []);
            } catch (err: any) {
                if (!cancelled) setError(err?.message ?? 'Could not load that artist.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [id]);

    if (loading) return <View style={styles.centre}><ActivityIndicator color={colors.cyan} /></View>;
    if (error) return <View style={styles.centre}><Text style={styles.error}>{error}</Text></View>;

    return (
        <Page>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.meta}>{songs.length} track{songs.length === 1 ? '' : 's'}</Text>

            {releases.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.label}>Releases</Text>
                    {releases.map((release) => (
                        <Text key={release.id} style={styles.release}>
                            {release.title}
                            <Text style={styles.meta}>
                                {`  ${release.release_type === 'ep' ? 'EP' : release.release_type}`}
                                {release.track_count ? ` · ${release.track_count} tracks` : ''}
                            </Text>
                        </Text>
                    ))}
                </View>
            ) : null}

            <View style={styles.section}>
                <Text style={styles.label}>Tracks</Text>
                {songs.map((song) => <TrackRow key={song.id} song={song} />)}
            </View>
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.lg, paddingBottom: space.xxl },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.void0 },
    name: { ...type.display, color: colors.ink },
    meta: { ...type.meta, color: colors.inkFaint, marginTop: space.xs },
    section: { marginTop: space.xl },
    label: { ...type.label, color: colors.cyan, marginBottom: space.sm },
    release: { ...type.body, color: colors.ink, paddingVertical: space.xs },
    error: { ...type.body, color: colors.danger, padding: space.xl, textAlign: 'center' },
});
