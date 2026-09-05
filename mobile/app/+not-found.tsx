import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '@/lib/theme';

export default function NotFoundScreen() {
    return (
        <>
            <Stack.Screen options={{ title: 'Not found' }} />
            <View style={styles.container}>
                <Text style={styles.title}>That screen does not exist.</Text>
                <Link href="/" style={styles.link}>
                    <Text style={styles.linkText}>Back to the station</Text>
                </Link>
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.void0 },
    title: { ...type.title, color: colors.ink },
    link: { marginTop: space.lg, paddingVertical: space.md },
    linkText: { ...type.body, color: colors.cyan },
});
