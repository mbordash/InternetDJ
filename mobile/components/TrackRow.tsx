import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { genreTags, type Song } from '@/lib/api';
import { colors, space, type } from '@/lib/theme';

/** One track in any list. Tapping opens it; the play button starts a station. */
export function TrackRow({ song, onPlay }: { song: Song; onPlay?: (song: Song) => void }) {
    const tags = genreTags(song.genre);
    return (
        <Pressable style={styles.row} onPress={() => router.push(`/track/${song.id}`)}>
            {song.image_url
                ? <Image source={{ uri: song.image_url }} style={styles.art} />
                : <View style={[styles.art, styles.artEmpty]} />}
            <View style={styles.body}>
                <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                    {[song.profile_name, song.bpm ? `${Math.round(song.bpm)} BPM` : null,
                      song.camelot ?? song.musical_key, tags[0]].filter(Boolean).join(' · ')}
                </Text>
            </View>
            {onPlay ? (
                <Pressable hitSlop={10} onPress={() => onPlay(song)} accessibilityLabel={`Start a station from ${song.title}`}>
                    <Text style={styles.play}>▶</Text>
                </Pressable>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
    art: { width: 46, height: 46, borderWidth: 1, borderColor: colors.hair },
    artEmpty: { backgroundColor: colors.void3 },
    body: { flex: 1, minWidth: 0 },
    title: { ...type.body, color: colors.ink },
    meta: { ...type.meta, color: colors.inkFaint, marginTop: 2 },
    play: { color: colors.magenta, fontSize: 20, paddingHorizontal: space.sm },
});
