import { ScrollView, StyleSheet, View,
    type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';

import { useLayout } from '@/lib/layout';
import { colors, space } from '@/lib/theme';

/**
 * The scrolling body of a screen, capped and centred.
 *
 * Exists so the tablet decision is made once. Every screen used to be a bare
 * ScrollView whose content grew to whatever width it was given, which is right
 * on a phone and wrong on an iPad. Wrapping the children in a column that stops
 * at `maxWidth` and centres itself keeps a row's two ends within one glance on
 * any window, and leaves phones untouched because there the cap is the width.
 *
 * `centred` is for screens whose content is a single stack rather than a list -
 * the station, mainly - where the column should also be horizontally centred
 * inside itself.
 */
export function Page({
    children,
    centred = false,
    contentContainerStyle,
    // Forwarded so a screen with a text field can still keep taps alive while
    // the keyboard is up, which is a ScrollView concern rather than a layout one.
    ...scrollProps
}: {
    children: React.ReactNode;
    centred?: boolean;
    contentContainerStyle?: StyleProp<ViewStyle>;
} & Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'style'>) {
    const { maxWidth, gutter } = useLayout();

    return (
        <ScrollView
            {...scrollProps}
            style={styles.screen}
            contentContainerStyle={[
                { paddingHorizontal: gutter, paddingBottom: space.xxl },
                contentContainerStyle,
            ]}
        >
            <View style={[styles.column, { maxWidth }, centred && styles.centred]}>
                {children}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.void0 },
    column: { width: '100%', alignSelf: 'center' },
    centred: { alignItems: 'center' },
});
