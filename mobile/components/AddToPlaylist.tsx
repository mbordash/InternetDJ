import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { playlistStore, type Playlist, type PlaylistTrack } from '@/lib/storage';
import { colors, space, type } from '@/lib/theme';

/**
 * Put the playing track into a device playlist.
 *
 * The line about where these live is not decoration. Someone who uses the
 * website has Mixtapes on their account, and would reasonably expect these to
 * be the same list. They are not, and cannot be without a sign-in that does
 * not exist yet, so the sheet says so before they invest in one.
 */
export function AddToPlaylist({
    visible, onClose, track,
}: { visible: boolean; onClose: () => void; track: PlaylistTrack }) {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [name, setName] = useState('');
    const [saved, setSaved] = useState<string | null>(null);

    useEffect(() => {
        if (visible) {
            playlistStore.all().then(setPlaylists);
            setSaved(null);
            setName('');
        }
    }, [visible]);

    const add = async (playlistId: string, playlistName: string) => {
        setPlaylists(await playlistStore.addTrack(playlistId, track));
        setSaved(playlistName);
    };

    const create = async () => {
        if (!name.trim()) return;
        const next = await playlistStore.create(name);
        setPlaylists(next);
        setName('');
        await add(next[0].id, next[0].name);
    };

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.eyebrow}>Add to a playlist</Text>
                <Text style={styles.note}>Saved on this phone.</Text>

                <ScrollView style={styles.list}>
                    {playlists.length === 0 ? (
                        <Text style={styles.empty}>No playlists yet. Make one below.</Text>
                    ) : playlists.map((playlist) => (
                        <Pressable key={playlist.id} style={styles.row} onPress={() => add(playlist.id, playlist.name)}>
                            <Text style={styles.rowName}>{playlist.name}</Text>
                            <Text style={styles.rowMeta}>{playlist.tracks.length}</Text>
                        </Pressable>
                    ))}
                </ScrollView>

                <View style={styles.newRow}>
                    <TextInput
                        style={styles.input}
                        value={name}
                        onChangeText={setName}
                        placeholder="New playlist"
                        placeholderTextColor={colors.inkFaint}
                        onSubmitEditing={create}
                        returnKeyType="done"
                    />
                    <Pressable style={styles.add} onPress={create}>
                        <Text style={styles.addText}>Create</Text>
                    </Pressable>
                </View>

                {saved ? <Text style={styles.saved}>Added to {saved}.</Text> : null}

                <Pressable style={styles.close} onPress={onClose}>
                    <Text style={styles.closeText}>Done</Text>
                </Pressable>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
        backgroundColor: colors.void2, borderTopWidth: 1, borderColor: colors.hair,
        padding: space.xl, paddingBottom: space.xxl, maxHeight: '70%',
    },
    eyebrow: { ...type.label, color: colors.cyan },
    note: { ...type.meta, color: colors.amber, marginTop: space.xs, marginBottom: space.md },
    list: { maxHeight: 240 },
    empty: { ...type.body, color: colors.inkDim, paddingVertical: space.md },
    row: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.hair,
    },
    rowName: { ...type.body, color: colors.ink },
    rowMeta: { ...type.meta, color: colors.inkFaint },
    newRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
    input: {
        flex: 1, borderWidth: 1, borderColor: colors.hair, color: colors.ink,
        paddingHorizontal: space.md, paddingVertical: space.sm, ...type.body,
    },
    add: { backgroundColor: colors.magenta, paddingHorizontal: space.lg, justifyContent: 'center' },
    addText: { ...type.meta, color: colors.void0, fontWeight: '700' },
    saved: { ...type.meta, color: colors.good, marginTop: space.md },
    close: { marginTop: space.lg, alignItems: 'center', paddingVertical: space.sm },
    closeText: { ...type.body, color: colors.cyan },
});
