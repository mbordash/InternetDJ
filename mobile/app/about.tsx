import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { colors, space, type } from '@/lib/theme';
import { Page } from '@/components/Page';

/**
 * What InternetDJ is, and where to go to be part of it.
 *
 * The copy about 1997 is the site's own, lifted from frontend/src/pages/About.js
 * rather than rewritten, so the two do not drift into telling different stories
 * about the same place.
 *
 * Deliberately absent: any mention of IDJC. The token is a real part of the
 * site and it is the one part that stays on the web. Apple's rules are hostile
 * to crypto, and "earn coins for listening" is close to the language that gets
 * apps rejected under 3.1.5 - an About screen describing it would be doing that
 * without even shipping the feature. Publishing and written feedback are the
 * reasons an artist joins anyway.
 */
const SITE = 'https://internetdj.co';

const openSite = (path = '') => Linking.openURL(`${SITE}${path}`);

export default function AboutScreen() {
    const version = Constants.expoConfig?.version ?? '0.1.0';

    return (
        <Page>
            <Image
                source={require('@/assets/images/logo-mark.png')}
                style={styles.logo}
                accessibilityLabel="InternetDJ"
            />
            <Text style={styles.eyebrow}>// est. 1997 //</Text>
            <Text style={styles.title}>InternetDJ</Text>

            <Text style={styles.body}>
                Founded in 1997, InternetDJ emerged during the early days of the internet as a
                platform for independent artists to share their music without the barriers of
                traditional record labels. It is still artist-first, and still run for the people
                making the music.
            </Text>

            <View style={styles.rule} />

            <Text style={styles.section}>This app</Text>
            <Text style={styles.body}>
                A way to listen. It builds an endless mix out of what actually goes together,
                using the tempo, key and genre of every track in the catalogue. No account, no
                sign-up, nothing to configure.
            </Text>

            <Text style={styles.section}>Make music?</Text>
            <Text style={styles.body}>
                Publishing happens on the main site. Upload your tracks, get written feedback from
                other producers, and put your work in front of people who listen properly. It is
                free, and it has been since the start.
            </Text>

            <Pressable
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.75 }]}
                onPress={() => openSite('/register')}
            >
                <Text style={styles.primaryText}>Upload your music</Text>
            </Pressable>

            <Pressable style={styles.link} onPress={() => openSite()}>
                <Text style={styles.linkText}>Open internetdj.co</Text>
            </Pressable>

            <View style={styles.rule} />

            <Text style={styles.section}>The catalogue</Text>
            <Text style={styles.body}>
                Everything you hear here was uploaded by a member. Plays counted in this app count
                on the site too, so listening supports the artist exactly as it does on the web.
            </Text>

            <View style={styles.links}>
                <Pressable style={styles.link} onPress={() => openSite('/privacy')}>
                    <Text style={styles.linkText}>Privacy policy</Text>
                </Pressable>
                <Pressable style={styles.link} onPress={() => openSite('/terms')}>
                    <Text style={styles.linkText}>Terms of service</Text>
                </Pressable>
                <Pressable
                    style={styles.link}
                    onPress={() => Linking.openURL('mailto:internetdjco@gmail.com?subject=InternetDJ%20app')}
                >
                    <Text style={styles.linkText}>Contact and report content</Text>
                </Pressable>
            </View>

            <Text style={styles.version}>Version {version}</Text>
        </Page>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    content: { padding: space.xl, paddingBottom: space.xxl, alignItems: 'flex-start' },
    logo: { width: 96, height: 96, alignSelf: 'center', marginBottom: space.md },
    eyebrow: { ...type.label, color: colors.cyan, alignSelf: 'center' },
    title: { ...type.display, color: colors.ink, alignSelf: 'center', marginBottom: space.lg },
    section: { ...type.label, color: colors.cyan, marginTop: space.lg, marginBottom: space.sm },
    body: { ...type.body, color: colors.inkDim, lineHeight: 22 },
    rule: { height: 1, backgroundColor: colors.hair, alignSelf: 'stretch', marginTop: space.xl },
    primary: {
        alignSelf: 'stretch', backgroundColor: colors.magenta,
        paddingVertical: space.md, alignItems: 'center', marginTop: space.lg,
    },
    primaryText: { ...type.title, color: colors.void0, letterSpacing: 0.5 },
    links: { marginTop: space.md },
    link: { paddingVertical: space.sm },
    linkText: { ...type.body, color: colors.cyan },
    version: { ...type.meta, color: colors.inkFaint, marginTop: space.xl, alignSelf: 'center' },
});
