import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { colors } from '@/lib/theme';

/**
 * Four tabs. Station is first and is where the app opens, because the point of
 * the app is that it is already playing; the other three are how you steer it.
 */
const TABS = [
    { name: 'index', title: 'Station', ios: 'dot.radiowaves.left.and.right', android: 'radio' },
    { name: 'browse', title: 'Browse', ios: 'square.grid.2x2', android: 'grid_view' },
    { name: 'search', title: 'Search', ios: 'magnifyingglass', android: 'search' },
    { name: 'playlists', title: 'Playlists', ios: 'music.note.list', android: 'queue_music' },
] as const;

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: colors.magenta,
                tabBarInactiveTintColor: colors.inkFaint,
                tabBarStyle: { backgroundColor: colors.void1, borderTopColor: colors.hair },
                headerStyle: { backgroundColor: colors.void1 },
                headerTintColor: colors.ink,
                headerTitleStyle: { fontWeight: '800', letterSpacing: 0.5 },
                sceneStyle: { backgroundColor: colors.void0 },
            }}
        >
            {TABS.map((tab) => (
                <Tabs.Screen
                    key={tab.name}
                    name={tab.name}
                    options={{
                        title: tab.title,
                        headerRight: tab.name === 'index' ? () => (
                            <Link href="/about" asChild>
                                <Pressable hitSlop={10} style={{ marginRight: 16 }} accessibilityLabel="About InternetDJ">
                                    <SymbolView
                                        name={{ ios: 'info.circle', android: 'info', web: 'info' }}
                                        tintColor={colors.cyan}
                                        size={24}
                                    />
                                </Pressable>
                            </Link>
                        ) : undefined,
                        tabBarIcon: ({ color }) => (
                            <SymbolView
                                name={{ ios: tab.ios, android: tab.android, web: tab.android }}
                                tintColor={color}
                                size={26}
                            />
                        ),
                    }}
                />
            ))}
        </Tabs>
    );
}
