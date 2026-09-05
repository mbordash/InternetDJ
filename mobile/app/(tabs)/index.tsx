import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { usePlayer } from '@/lib/player';
import { colors, space, type } from '@/lib/theme';
import { AddToPlaylist } from '@/components/AddToPlaylist';
import { Page } from '@/components/Page';
import { useLayout } from '@/lib/layout';
import { Scrubber } from '@/components/Scrubber';

/**
 * The station: the whole app in one screen.
 *
 * Deliberately not a browse page. There is one thing to do here, and the line
 * under the artist is the endpoint's own ranking reasons, which is the closest
 * this app gets to explaining itself.
 */
export default function StationScreen() {
    const { track, because, isPlaying, loading, error, start, skip, toggle, like, liked, genre,
            position, duration, seek } = usePlayer();
    const [adding, setAdding] = useState(false);
    const { artSize, scale } = useLayout();

    if (!track) {
        return (
            <View style={[styles.screen, styles.centre]}>
                {/* The site's own mark, not a second one made for the app.
                    Checked at 40px before it was used anywhere: the cyan ring,
                    the sun, the horizon and the record hole all survive, which
                    is what makes it work as a home-screen icon too. */}
                <Image
                    source={require('@/assets/images/logo-mark.png')}
                    style={[styles.logo, { width: 132 * scale, height: 132 * scale }]}
                    accessibilityLabel="InternetDJ"
                />
                <Text style={styles.eyebrow}>// InternetDJ //</Text>
                <Text style={[styles.idleTitle, { fontSize: type.display.fontSize * scale }]}>Press play.</Text>
                <Text style={[styles.idleBody, { fontSize: type.body.fontSize * scale, maxWidth: 340 * scale }]}>
                    An endless mix built from what goes with what. No account, nothing to set up.
                </Text>
                <Pressable
                    style={({ pressed }) => [styles.bigButton, pressed && styles.pressed]}
                    onPress={() => start()}
                    disabled={loading}
                    accessibilityRole="button"
                >
                    {loading
                        ? <ActivityIndicator color={colors.void0} />
                        : <Text style={styles.bigButtonText}>Start listening</Text>}
                </Pressable>
                {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
        );
    }

    return (
        <Page centred>
            <Text style={styles.eyebrow}>
                {genre ? `// ${genre} station //` : '// station //'}
            </Text>

            {track.image
                ? <Image source={{ uri: track.image }} style={[styles.art, { width: artSize, height: artSize }]} />
                : <View style={[styles.art, styles.artEmpty, { width: artSize, height: artSize }]}>
                    <Text style={styles.artEmptyText}>InternetDJ</Text>
                  </View>}

            <Pressable onPress={() => router.push(`/track/${track.id}`)}>
                <Text style={[styles.title, { fontSize: type.display.fontSize * scale }]} numberOfLines={2}>{track.title}</Text>
            </Pressable>
            <Pressable onPress={() => router.push(`/artist/${track.profileId}`)}>
                <Text style={[styles.artist, { fontSize: type.title.fontSize * scale }]}>{track.artist}</Text>
            </Pressable>

            {/* Why this track followed the last one, in the server's words.
                This is also why there are no tempo and key chips here: when
                either is the reason the track is playing, this line already
                says so, and in a form that means something. They are still on
                the track page, which has no reason line to carry them. */}
            <Text style={styles.because}>{because}</Text>

            <Scrubber position={position} duration={duration} onSeek={seek} />

            <View style={styles.controls}>
                <Pressable onPress={like} hitSlop={12} accessibilityLabel={liked ? 'Liked' : 'Like this track'}>
                    <SymbolView
                        name={{ ios: liked ? 'heart.fill' : 'heart', android: 'favorite', web: 'favorite' }}
                        tintColor={liked ? colors.magenta : colors.inkDim}
                        size={30}
                    />
                </Pressable>

                <Pressable onPress={toggle} hitSlop={12} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
                    <SymbolView
                        name={{ ios: isPlaying ? 'pause.circle.fill' : 'play.circle.fill', android: 'play_circle', web: 'play_circle' }}
                        tintColor={colors.magenta}
                        size={68}
                    />
                </Pressable>

                <Pressable onPress={skip} hitSlop={12} disabled={loading} accessibilityLabel="Skip">
                    <SymbolView
                        name={{ ios: 'forward.fill', android: 'skip_next', web: 'skip_next' }}
                        tintColor={loading ? colors.inkFaint : colors.inkDim}
                        size={30}
                    />
                </Pressable>

                <Pressable onPress={() => setAdding(true)} hitSlop={12} accessibilityLabel="Add to a playlist">
                    <SymbolView
                        name={{ ios: 'text.badge.plus', android: 'playlist_add', web: 'playlist_add' }}
                        tintColor={colors.inkDim}
                        size={30}
                    />
                </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <AddToPlaylist
                visible={adding}
                onClose={() => setAdding(false)}
                track={{
                    id: track.id,
                    title: track.title,
                    image_url: track.image ?? null,
                    profile_name: track.artist,
                    mp3_url: track.url,
                }}
            />
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.xl, alignItems: 'center' },
    centre: { alignItems: 'center', justifyContent: 'center', padding: space.xl },

    eyebrow: { ...type.label, color: colors.cyan, marginBottom: space.lg },
    logo: { width: 132, height: 132, marginBottom: space.lg },

    idleTitle: { ...type.display, color: colors.ink, marginBottom: space.sm },
    idleBody: { ...type.body, color: colors.inkDim, textAlign: 'center', maxWidth: 300, marginBottom: space.xl },

    // Capped by height as well as width: on a small phone a square that
    // fills the width pushes the controls off the bottom.
    // Size comes from useLayout; only the chrome is fixed here.
    art: { borderWidth: 1, borderColor: colors.hair, marginBottom: space.lg },
    artEmpty: { backgroundColor: colors.void3, alignItems: 'center', justifyContent: 'center' },
    artEmptyText: { ...type.label, color: colors.cyan },

    title: { ...type.display, color: colors.ink, textAlign: 'center' },
    artist: { ...type.title, color: colors.inkDim, marginTop: space.xs, textAlign: 'center' },
    because: { ...type.meta, color: colors.cyan, marginTop: space.sm, textAlign: 'center' },

    chips: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    chip: {
        ...type.meta, color: colors.cyan, paddingHorizontal: space.sm, paddingVertical: 2,
        borderWidth: 1, borderColor: colors.hair, overflow: 'hidden',
    },

    controls: { flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.md },

    bigButton: {
        backgroundColor: colors.magenta, paddingHorizontal: space.xxl, paddingVertical: space.md,
        minWidth: 200, alignItems: 'center',
    },
    bigButtonText: { ...type.title, color: colors.void0, letterSpacing: 1 },
    pressed: { opacity: 0.75 },

    secondary: { marginTop: space.xl, paddingVertical: space.sm, paddingHorizontal: space.lg, borderWidth: 1, borderColor: colors.hair },
    secondaryText: { ...type.meta, color: colors.cyan },

    error: { ...type.meta, color: colors.danger, marginTop: space.lg, textAlign: 'center' },
});
