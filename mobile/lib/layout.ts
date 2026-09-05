import { useWindowDimensions } from 'react-native';

/**
 * Screen size, as decisions rather than numbers.
 *
 * Every screen in this app is a single column, which is right on a phone and
 * wrong on a tablet: a 1024pt-wide iPad renders the same column full width, so
 * a track row becomes a title on the far left and a play button on the far
 * right with a hand-span of nothing between them, and the station becomes a
 * small phone-shaped island in a large black field.
 *
 * The fix is not a second layout. It is to cap the column at a width the
 * content was designed for and centre it, and to let the artwork and the type
 * grow into the space they now have. That reads as deliberate on both, and it
 * is one hook rather than a fork in every screen.
 *
 * Reads from useWindowDimensions rather than a device check so it follows the
 * actual window: an iPad in Split View is phone-shaped and should be laid out
 * that way.
 */
export function useLayout() {
    const { width } = useWindowDimensions();

    // 768 is where a window stops being a phone in one hand. Below it nothing
    // changes from what shipped for iPhone.
    const isWide = width >= 768;

    return {
        isWide,

        /**
         * The reading column. Lists stop growing here and centre instead: past
         * roughly this width a row's two ends stop being one glance apart.
         */
        maxWidth: isWide ? 720 : width,

        /**
         * Now-playing artwork. On a phone it is capped so the transport still
         * clears the fold; a tablet has the height to spare, so it grows.
         */
        artSize: isWide ? Math.min(width * 0.42, 460) : 300,

        /** Type steps up a little on a tablet, where reading distance is longer. */
        scale: isWide ? 1.15 : 1,

        /** Outer padding. A wide window can afford more air at the edges. */
        gutter: isWide ? 32 : 16,
    };
}
