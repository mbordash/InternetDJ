/**
 * The site's skin, as tokens.
 *
 * Lifted from frontend/src/styles/retro.css so the app and the website look
 * like the same product. The site commits to one dark neon world rather than
 * offering a light mode, and the app does the same: `userInterfaceStyle` is
 * pinned to "dark" in app.json, so nothing here needs a light variant.
 */
export const colors = {
    magenta: '#ff2f8e',
    pink: '#ff6ec7',
    cyan: '#00f0ff',
    purple: '#9d4edd',

    /* Semantic, kept separate from the accent so state does not read as brand. */
    amber: '#ffb020',
    good: '#4ade80',
    danger: '#ff4d6d',

    void0: '#04010c',
    void1: '#0a0418',
    void2: '#140628',
    void3: '#1d0a38',

    ink: '#e8f6ff',
    /* Neutrals biased toward the cyan accent rather than a flat grey. */
    inkDim: '#9db3c4',
    inkFaint: '#6b7f92',

    hair: 'rgba(0, 240, 255, 0.22)',
    hairHot: 'rgba(255, 47, 142, 0.45)',
    surface: 'rgba(255, 255, 255, 0.05)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * The site uses Orbitron, VT323 and Press Start 2P. None ships with the app
 * yet, so these map to the platform stack and the sizes are chosen to read
 * correctly with it. Swap in the real faces via expo-font when the design is
 * settled; every size below is already in one place.
 */
export const type = {
    display: { fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
    title: { fontSize: 17, fontWeight: '700' },
    body: { fontSize: 15, fontWeight: '400' },
    meta: { fontSize: 13, fontWeight: '400' },
    label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
} as const;
