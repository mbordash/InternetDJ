import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { PlayerProvider } from '@/lib/player';
import { colors } from '@/lib/theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync();

/**
 * The player lives above the navigator on purpose.
 *
 * Moving between tabs unmounts screens; playback has to survive that, and the
 * station's queue and taste have to survive it too. Nothing about audio
 * belongs to a route.
 */
export default function RootLayout() {
    useEffect(() => { SplashScreen.hideAsync(); }, []);

    return (
        <PlayerProvider>
            <StatusBar style="light" />
            <Stack
                screenOptions={{
                    headerStyle: { backgroundColor: colors.void1 },
                    headerTintColor: colors.ink,
                    headerTitleStyle: { fontWeight: '800' },
                    contentStyle: { backgroundColor: colors.void0 },
                }}
            >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="track/[id]" options={{ title: 'Track' }} />
                <Stack.Screen name="artist/[id]" options={{ title: 'Artist' }} />
                <Stack.Screen name="genre/[tag]" options={{ title: 'Genre' }} />
                <Stack.Screen name="about" options={{ title: 'About' }} />
            </Stack>
        </PlayerProvider>
    );
}
