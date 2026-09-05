import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { playlistStore, type Playlist } from '@/lib/storage';
import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';
import { usePlayer } from '@/lib/player';
import { TrackRow } from '@/components/TrackRow';

/**
 * Playlists, which live on the phone.
 *
 * `playlists.profile_id` is NOT NULL on the server, so a playlist without an
 * account is not something the API can hold. The banner is the whole reason
 * this screen is honest: somebody who uses the website has Mixtapes on their
 * account, and silence here would read as those being broken rather than as
 * these being separate.
 */
export default function PlaylistsScreen() {
    const { playQueue, queueName } = usePlayer();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [name, setName] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);

    useFocusEffect(useCallback(() => {
        playlistStore.all().then(setPlaylists);
    }, []));

    const create = async () => {
        if (!name.trim()) return;
        setPlaylists(await playlistStore.create(name));
        setName('');
    };

    const confirmRemove = (playlist: Playlist) => {
        Alert.alert(
            `Delete "${playlist.name}"?`,
            'This removes the playlist from this phone. The tracks themselves are untouched.',
            [
                { text: 'Keep it', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => setPlaylists(await playlistStore.remove(playlist.id)),
                },
            ],
        );
    };

    return (
        <Page keyboardShouldPersistTaps="handled">
            <Text style={styles.banner}>Saved on this phone. These are not the Mixtapes on your account.</Text>

            <View style={styles.newRow}>
                <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    onSubmitEditing={create}
                    placeholder="New playlist"
                    placeholderTextColor={colors.inkFaint}
                    returnKeyType="done"
                />
                <Pressable style={styles.add} onPress={create}>
                    <Text style={styles.addText}>Create</Text>
                </Pressable>
            </View>

            {playlists.length === 0 ? (
                <Text style={styles.empty}>
                    Nothing yet. Add a track from the station and it will show up here.
                </Text>
            ) : playlists.map((playlist) => (
                <View key={playlist.id} style={styles.card}>
                    <Pressable
                        style={styles.cardHead}
                        onPress={() => setOpenId(openId === playlist.id ? null : playlist.id)}
                    >
                        <View style={{ flex: 1 }}>
                            <Text style={styles.cardName}>{playlist.name}</Text>
                            <Text style={styles.cardMeta}>
                                {playlist.tracks.length} track{playlist.tracks.length === 1 ? '' : 's'}
                                {queueName === playlist.name ? ' · playing' : ''}
                            </Text>
                        </View>

                        {/* A playlist you cannot play is a list. Both controls
                            are here rather than behind the expander, because
                            playing one is the common act and editing it is not. */}
                        {playlist.tracks.length > 0 ? (
                            <>
                                <Pressable
                                    hitSlop={8}
                                    onPress={() => { playQueue(playlist.name, playlist.tracks); router.push('/'); }}
                                    accessibilityLabel={`Play ${playlist.name}`}
                                >
                                    <SymbolView
                                        name={{ ios: 'play.circle.fill', android: 'play_circle', web: 'play_circle' }}
                                        tintColor={colors.magenta}
                                        size={34}
                                    />
                                </Pressable>
                                <Pressable
                                    hitSlop={8}
                                    onPress={() => { playQueue(playlist.name, playlist.tracks, { shuffle: true }); router.push('/'); }}
                                    accessibilityLabel={`Shuffle ${playlist.name}`}
                                >
                                    <SymbolView
                                        name={{ ios: 'shuffle', android: 'shuffle', web: 'shuffle' }}
                                        tintColor={colors.cyan}
                                        size={26}
                                    />
                                </Pressable>
                            </>
                        ) : null}
                    </Pressable>

                    {openId === playlist.id ? (
                        <View style={styles.tracks}>
                            <Pressable style={styles.deleteRow} onPress={() => confirmRemove(playlist)}>
                                <Text style={styles.delete}>Delete this playlist</Text>
                            </Pressable>
                            {playlist.tracks.length === 0
                                ? <Text style={styles.empty}>Empty.</Text>
                                : playlist.tracks.map((t, index) => (
                                    <TrackRow
                                        key={t.id}
                                        song={{ id: t.id, title: t.title, image_url: t.image_url, profile_name: t.profile_name, profile_id: 0 }}
                                        // Starts the whole list from here rather
                                        // than playing one track alone, which is
                                        // what tapping a track in a playlist means
                                        // everywhere else.
                                        onPlay={() => {
                                            playQueue(playlist.name, playlist.tracks, { startIndex: index });
                                            router.push('/');
                                        }}
                                    />
                                ))}
                        </View>
                    ) : null}
                </View>
            ))}
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.lg, paddingBottom: space.xxl },
    banner: { ...type.meta, color: colors.amber, marginBottom: space.lg },
    newRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
    input: {
        flex: 1, borderWidth: 1, borderColor: colors.hair, color: colors.ink,
        paddingHorizontal: space.md, paddingVertical: space.sm, ...type.body,
    },
    add: { backgroundColor: colors.magenta, paddingHorizontal: space.lg, justifyContent: 'center' },
    addText: { ...type.meta, color: colors.void0, fontWeight: '700' },
    card: { borderWidth: 1, borderColor: colors.hair, padding: space.md, marginBottom: space.md },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    cardName: { ...type.title, color: colors.ink },
    cardMeta: { ...type.meta, color: colors.inkFaint, marginTop: 2 },
    delete: { ...type.meta, color: colors.danger },
    deleteRow: { paddingVertical: space.sm, marginBottom: space.xs },
    tracks: { marginTop: space.md, borderTopWidth: 1, borderTopColor: colors.hair, paddingTop: space.sm },
    empty: { ...type.body, color: colors.inkDim, marginTop: space.md },
});
