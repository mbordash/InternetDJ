/**
 * Generated cover art for articles that have no usable artwork.
 *
 * Almost none of the recovered archive has a picture we can show. Every legacy
 * hero_image_url points at www.internetdj.com, which stopped resolving years
 * ago, so 957 of the 1,210 articles were already falling back to an empty
 * gradient, and the remaining 253 never had artwork at all. A grid of 24 cards
 * with 24 empty bands reads as a broken page rather than a sparse one.
 *
 * So each category gets a handful of covers, and an article is assigned one by
 * hashing its slug. Hashing rather than random means a given article always
 * shows the same cover - on the card, on the article page, and in a share
 * preview - and the spread across four variants keeps a scrolled grid from
 * looking tiled.
 *
 * The art is emitted as static files rather than inline SVG so that one asset
 * serves the card, the article page and the og:image, and so the browser caches
 * four files instead of re-parsing markup in every card. Run
 * backend/scripts/generateArticleCovers.js after changing anything here.
 *
 * No <text> anywhere on purpose. These are rasterised to PNG by librsvg inside
 * sharp, which can only draw fonts installed on the build machine, so a text
 * wordmark would render in the browser and silently vanish from the share card.
 * The brand mark is drawn as geometry instead.
 */

const WIDTH = 1200;
const HEIGHT = 675;
const VARIANTS_PER_CATEGORY = 4;
const COVER_DIR = '/images/article-covers';

// Straight from the --neon-* and --void-* custom properties in retro.css. The
// covers are site furniture, not illustrations, so they use the site's palette.
const NEON = {
    magenta: '#ff2f8e',
    pink: '#ff6ec7',
    cyan: '#00f0ff',
    blue: '#3b82f6',
    purple: '#9d4edd',
    amber: '#ffb020',
};
const VOID = ['#04010c', '#0a0418', '#140628', '#1d0a38'];

const PALETTES = [
    { a: NEON.magenta, b: NEON.cyan },
    { a: NEON.purple, b: NEON.pink },
    { a: NEON.cyan, b: NEON.blue },
    { a: NEON.amber, b: NEON.magenta },
];

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

const n = (value) => Number(value.toFixed(1));

const polar = (cx, cy, r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

const arc = (cx, cy, r, from, to) => {
    const [x1, y1] = polar(cx, cy, r, from);
    const [x2, y2] = polar(cx, cy, r, to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M${n(x1)} ${n(y1)} A${n(r)} ${n(r)} 0 ${large} 1 ${n(x2)} ${n(y2)}`;
};

/**
 * Neon is three passes of the same shape, not one stroke and a blur filter:
 * a wide faint halo, a mid bloom, then the hot core. It costs three paths but
 * it survives rasterisation identically and renders far faster than a real
 * feGaussianBlur repeated across a grid of cards.
 */
const neon = (d, color, width, opacity = 1) => (
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width * 3.2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(0.14 * opacity)}"/>`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width * 1.9)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(0.32 * opacity)}"/>`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(0.95 * opacity)}"/>`
);

// Deterministic so regenerating the files produces byte-identical output. A
// Math.random() here would make every run a diff.
const rng = (seed) => {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

// ---------------------------------------------------------------------------
// backdrops - one per variant, rotated against the category so that two
// categories sharing a variant index do not also share a background
// ---------------------------------------------------------------------------

const backdropGrid = (p) => {
    const horizon = 415;
    const vx = WIDTH / 2;
    let out = `<line x1="0" y1="${horizon}" x2="${WIDTH}" y2="${horizon}" stroke="${p.b}" stroke-width="2" opacity="0.5"/>`;
    for (let i = -16; i <= 16; i += 1) {
        out += `<line x1="${vx}" y1="${horizon}" x2="${n(vx + i * 130)}" y2="${HEIGHT}" stroke="${p.b}" stroke-width="1.4" opacity="0.22"/>`;
    }
    let y = horizon;
    let step = 3.5;
    while (y < HEIGHT) {
        y += step;
        step *= 1.5;
        if (y >= HEIGHT) break;
        out += `<line x1="0" y1="${n(y)}" x2="${WIDTH}" y2="${n(y)}" stroke="${p.b}" stroke-width="1.4" opacity="${n(0.14 + (y - horizon) / (HEIGHT - horizon) * 0.24)}"/>`;
    }
    return out;
};

const backdropRays = (p) => {
    const cx = WIDTH / 2;
    const cy = 330;
    let out = '';
    for (let i = 0; i < 24; i += 1) {
        const a = (i * 360) / 24 + 7.5;
        const [x1, y1] = polar(cx, cy, 120, a - 3.2);
        const [x2, y2] = polar(cx, cy, 1250, a - 3.2);
        const [x3, y3] = polar(cx, cy, 1250, a + 3.2);
        const [x4, y4] = polar(cx, cy, 120, a + 3.2);
        out += `<path d="M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)} L${n(x3)} ${n(y3)} L${n(x4)} ${n(y4)} Z" fill="${p.a}" opacity="${i % 2 ? 0.05 : 0.09}"/>`;
    }
    return out;
};

const backdropBands = (p) => {
    const r = rng(7);
    let out = '';
    let y = 0;
    while (y < HEIGHT) {
        const h = 6 + r() * 54;
        out += `<rect x="0" y="${n(y)}" width="${WIDTH}" height="${n(h)}" fill="${r() > 0.5 ? p.a : p.b}" opacity="${n(0.02 + r() * 0.05)}"/>`;
        y += h + 4 + r() * 30;
    }
    return out;
};

const backdropDots = (p) => {
    let out = '';
    for (let gy = 0; gy < 17; gy += 1) {
        for (let gx = 0; gx < 30; gx += 1) {
            const x = 20 + gx * 41;
            const y = 20 + gy * 41;
            // Densest bottom-left, thinning towards the top right, so the motif
            // in the middle is never fighting a full field of dots.
            const fade = 1 - ((x / WIDTH) * 0.55 + (1 - y / HEIGHT) * 0.45);
            if (fade < 0.12) continue;
            out += `<circle cx="${x}" cy="${y}" r="${n(1.4 + fade * 2.2)}" fill="${p.b}" opacity="${n(fade * 0.32)}"/>`;
        }
    }
    return out;
};

const BACKDROPS = [backdropGrid, backdropRays, backdropBands, backdropDots];

// ---------------------------------------------------------------------------
// category motifs
// ---------------------------------------------------------------------------

// A broadcast mast throwing signal arcs: the archive is mostly wire copy.
const motifNews = (p) => {
    const apexX = 600;
    const apexY = 175;
    const baseY = 470;
    const halfTop = 16;
    const halfBottom = 68;
    let out = '';

    for (let side = 0; side < 2; side += 1) {
        const dir = side ? 1 : -1;
        for (let i = 1; i <= 4; i += 1) {
            const r = 90 + i * 62;
            const from = side ? -46 : 226;
            const to = side ? 46 : 134;
            out += neon(arc(apexX, apexY + 4, r, from, to), i % 2 ? p.b : p.a, 4, 0.85 - i * 0.13);
        }
        void dir;
    }

    const legs = `M${apexX - halfTop} ${apexY + 30} L${apexX - halfBottom} ${baseY} M${apexX + halfTop} ${apexY + 30} L${apexX + halfBottom} ${baseY}`;
    out += neon(legs, p.a, 6);
    for (let i = 0; i < 6; i += 1) {
        const t0 = i / 6;
        const t1 = (i + 1) / 6;
        const y0 = apexY + 30 + (baseY - apexY - 30) * t0;
        const y1 = apexY + 30 + (baseY - apexY - 30) * t1;
        const w0 = halfTop + (halfBottom - halfTop) * t0;
        const w1 = halfTop + (halfBottom - halfTop) * t1;
        out += neon(`M${n(apexX - w0)} ${n(y0)} L${n(apexX + w1)} ${n(y1)} M${n(apexX + w0)} ${n(y0)} L${n(apexX - w1)} ${n(y1)}`, p.a, 3, 0.75);
    }
    out += neon(`M${apexX} ${apexY - 34} L${apexX} ${apexY + 32}`, p.b, 5);
    out += `<circle cx="${apexX}" cy="${apexY - 40}" r="13" fill="${p.b}"/>`;
    out += `<circle cx="${apexX}" cy="${apexY - 40}" r="30" fill="${p.b}" opacity="0.22"/>`;
    return out;
};

// Mic capsule and a waveform: 34 of these are sit-down interviews with artists.
const motifInterviews = (p) => {
    const mx = 400;
    let out = '';
    out += `<rect x="${mx - 62}" y="170" width="124" height="212" rx="62" fill="none" stroke="${p.a}" stroke-width="18" opacity="0.16"/>`;
    out += `<rect x="${mx - 62}" y="170" width="124" height="212" rx="62" fill="none" stroke="${p.a}" stroke-width="6"/>`;
    for (let i = 0; i < 7; i += 1) {
        const y = 202 + i * 26;
        out += `<line x1="${mx - 44}" y1="${y}" x2="${mx + 44}" y2="${y}" stroke="${p.a}" stroke-width="4" opacity="0.55"/>`;
    }
    out += neon(arc(mx, 352, 104, 8, 172), p.b, 6);
    out += neon(`M${mx} ${456} L${mx} ${516}`, p.b, 6);
    out += neon(`M${mx - 74} ${518} L${mx + 74} ${518}`, p.b, 8);

    const r = rng(21);
    for (let i = 0; i < 23; i += 1) {
        const x = 596 + i * 21;
        const h = 20 + Math.abs(Math.sin(i * 0.72)) * 150 * (0.45 + r() * 0.55);
        out += `<rect x="${n(x)}" y="${n(340 - h / 2)}" width="9" height="${n(h)}" rx="4.5" fill="${i % 3 === 0 ? p.a : p.b}" opacity="${n(0.55 + r() * 0.4)}"/>`;
    }
    return out;
};

// The vaporwave sun, slit and setting. Features are the long reads.
const motifFeatures = (p) => {
    const cx = 600;
    const cy = 320;
    const r = 158;
    let slits = '';
    let y = cy + 14;
    let h = 4;
    while (y < cy + r) {
        slits += `<rect x="${cx - r - 10}" y="${n(y)}" width="${r * 2 + 20}" height="${n(h)}" fill="#000"/>`;
        y += h + 13;
        h += 3.4;
    }
    return `<mask id="sun"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>${slits}</mask>`
        + `<circle cx="${cx}" cy="${cy}" r="${n(r + 26)}" fill="${p.a}" opacity="0.12"/>`
        + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sungrad)" mask="url(#sun)"/>`
        + neon(arc(cx, cy, r + 40, 190, 350), p.b, 4, 0.8);
};

// A VU needle sitting high and a row of levels: the shape of a verdict.
const motifReviews = (p) => {
    const cx = 600;
    const cy = 505;
    const r = 250;
    let out = neon(arc(cx, cy, r, 202, 338), p.b, 5);
    for (let i = 0; i <= 12; i += 1) {
        const a = 202 + (i * 136) / 12;
        const inner = i % 3 === 0 ? r - 30 : r - 17;
        const [x1, y1] = polar(cx, cy, inner, a);
        const [x2, y2] = polar(cx, cy, r, a);
        out += `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${i > 9 ? p.a : p.b}" stroke-width="${i % 3 === 0 ? 6 : 3}" opacity="0.85"/>`;
    }
    const [nx, ny] = polar(cx, cy, r - 46, 310);
    out += neon(`M${cx} ${cy} L${n(nx)} ${n(ny)}`, p.a, 6);
    out += `<circle cx="${cx}" cy="${cy}" r="18" fill="${p.a}"/>`;
    out += `<circle cx="${cx}" cy="${cy}" r="34" fill="${p.a}" opacity="0.2"/>`;
    for (let i = 0; i < 16; i += 1) {
        const x = 316 + i * 36;
        const on = i < 11;
        out += `<rect x="${x}" y="188" width="22" height="46" rx="3" fill="${on ? (i > 8 ? p.a : p.b) : p.b}" opacity="${on ? 0.9 : 0.16}"/>`;
    }
    return out;
};

// Steps climbing to the right with a node at every turn: guides are procedures.
const motifGuides = (p) => {
    const pts = [[228, 512], [400, 512], [400, 424], [572, 424], [572, 336], [744, 336], [744, 248], [960, 248]];
    const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0]} ${pt[1]}`).join(' ');
    let out = neon(d, p.b, 7);
    pts.forEach((pt, i) => {
        if (i % 2) return;
        out += `<circle cx="${pt[0]}" cy="${pt[1]}" r="26" fill="${VOID[0]}" opacity="0.85"/>`;
        out += `<circle cx="${pt[0]}" cy="${pt[1]}" r="26" fill="none" stroke="${p.a}" stroke-width="5"/>`;
        out += `<circle cx="${pt[0]}" cy="${pt[1]}" r="9" fill="${p.a}"/>`;
    });
    out += `<circle cx="960" cy="248" r="40" fill="none" stroke="${p.a}" stroke-width="5" opacity="0.5"/>`;
    out += `<circle cx="960" cy="248" r="58" fill="none" stroke="${p.a}" stroke-width="3" opacity="0.22"/>`;
    return out;
};

// Anything filed under a category we have not drawn yet still gets a cover
// rather than the empty band this whole module exists to remove.
const motifDefault = (p) => {
    const r = rng(5);
    let out = '';
    for (let i = 0; i < 17; i += 1) {
        const x = 250 + i * 42;
        const h = 60 + Math.abs(Math.sin(i * 0.55 + 0.4)) * 250 * (0.5 + r() * 0.5);
        out += `<rect x="${n(x)}" y="${n(430 - h)}" width="26" height="${n(h)}" rx="6" fill="${i % 2 ? p.a : p.b}" opacity="${n(0.5 + r() * 0.45)}"/>`;
        out += `<rect x="${n(x)}" y="${n(430 - h)}" width="26" height="10" rx="5" fill="#ffffff" opacity="0.5"/>`;
    }
    out += `<line x1="228" y1="446" x2="982" y2="446" stroke="${p.b}" stroke-width="4" opacity="0.6"/>`;
    return out;
};

const MOTIFS = {
    news: motifNews,
    interviews: motifInterviews,
    features: motifFeatures,
    reviews: motifReviews,
    guides: motifGuides,
};

const CATEGORY_SLUGS = Object.keys(MOTIFS);
const DEFAULT_SLUG = 'default';

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

const brandMark = (p) => (
    `<g opacity="0.22" transform="translate(1116 596)">`
    + `<circle r="23" fill="none" stroke="${p.b}" stroke-width="2.5"/>`
    + `<circle r="14" fill="none" stroke="${p.b}" stroke-width="1.8" opacity="0.6"/>`
    + `<circle r="4.5" fill="${p.a}"/>`
    + `</g>`
);

/**
 * Each variant frames its motif slightly differently.
 *
 * Without this the only thing separating one variant from another is colour,
 * and News is 858 of the 1,210 articles - so scrolling the index meant the same
 * transmitter at the same size in the same place, over and over, in four
 * colourways. Nudging the scale and position breaks that up at no extra cost.
 */
const MOTIF_FRAMES = [
    { scale: 1, dx: 0, dy: 0 },
    { scale: 0.86, dx: -74, dy: -18 },
    { scale: 1.05, dx: 24, dy: 12 },
    { scale: 0.93, dx: 40, dy: -26 },
];

const framed = (svg, frame) => {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    return `<g transform="translate(${n(frame.dx)} ${n(frame.dy)}) translate(${cx} ${cy}) `
        + `scale(${frame.scale}) translate(${-cx} ${-cy})">${svg}</g>`;
};

const renderCoverSvg = (categorySlug, variantIndex) => {
    const slug = MOTIFS[categorySlug] ? categorySlug : DEFAULT_SLUG;
    const motif = MOTIFS[slug] || motifDefault;
    const index = ((variantIndex % VARIANTS_PER_CATEGORY) + VARIANTS_PER_CATEGORY) % VARIANTS_PER_CATEGORY;
    const palette = PALETTES[index];
    // Offset by the category so that, say, news-1 and guides-1 do not come out
    // with the same palette on the same backdrop.
    const categoryOffset = CATEGORY_SLUGS.indexOf(slug) + 1;
    const backdrop = BACKDROPS[(index + categoryOffset) % BACKDROPS.length];

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img">`
        + '<defs>'
        + `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`
        + `<stop offset="0" stop-color="${VOID[3]}"/><stop offset="0.55" stop-color="${VOID[2]}"/><stop offset="1" stop-color="${VOID[0]}"/>`
        + '</linearGradient>'
        + `<linearGradient id="sungrad" x1="0" y1="0" x2="0" y2="1">`
        + `<stop offset="0" stop-color="${palette.b}"/><stop offset="0.5" stop-color="${palette.a}"/><stop offset="1" stop-color="${palette.a}"/>`
        + '</linearGradient>'
        + `<radialGradient id="bloom" cx="0.5" cy="0.45" r="0.55">`
        + `<stop offset="0" stop-color="${palette.a}" stop-opacity="0.34"/><stop offset="1" stop-color="${palette.a}" stop-opacity="0"/>`
        + '</radialGradient>'
        + `<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.78">`
        + `<stop offset="0.45" stop-color="${VOID[0]}" stop-opacity="0"/><stop offset="1" stop-color="${VOID[0]}" stop-opacity="0.82"/>`
        + '</radialGradient>'
        + `<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">`
        + `<rect width="4" height="1.4" fill="#000000" opacity="0.34"/>`
        + '</pattern>'
        + '</defs>'
        + `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>`
        + backdrop(palette)
        + `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bloom)"/>`
        + framed(motif(palette), MOTIF_FRAMES[index])
        + `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>`
        + `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scan)"/>`
        + brandMark(palette)
        + '</svg>';
};

// ---------------------------------------------------------------------------
// selection - MIRRORED IN frontend/src/utils/articleCover.js
// ---------------------------------------------------------------------------

// FNV-1a. Any stable hash would do; the requirement is only that the backend
// and the frontend agree, so that the og:image on a share card is the same
// picture the reader sees when they follow the link.
const hashSeed = (value) => {
    let h = 0x811c9dc5;
    const s = String(value == null ? '' : value);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
};

const coverSlug = (category) => {
    const key = String(category || '').trim().toLowerCase();
    return MOTIFS[key] ? key : DEFAULT_SLUG;
};

/** Site-relative path of the cover for an article, e.g. /images/article-covers/news-3.svg */
const articleCoverPath = (category, seed, ext = 'svg') => {
    const slug = coverSlug(category);
    const index = (hashSeed(seed) % VARIANTS_PER_CATEGORY) + 1;
    return `${COVER_DIR}/${slug}-${index}.${ext}`;
};

/**
 * Legacy artwork all lives on www.internetdj.com, which no longer resolves.
 * Rather than blanking the column - the URLs are the only record of what the
 * picture was, and 185 of them are still recoverable from the Wayback Machine -
 * the dead host is filtered at render time. Narrow this once images are back.
 */
const DEAD_IMAGE_HOSTS = /^https?:\/\/(www\.)?internetdj\.com\//i;

const usableHeroImage = (url) => {
    const value = String(url || '').trim();
    if (!value) return null;
    if (DEAD_IMAGE_HOSTS.test(value)) return null;
    return value;
};

/**
 * Every share-card scraper worth caring about - Facebook, Slack, Discord, X -
 * refuses an SVG og:image and renders the card with no picture at all, which is
 * worse than the picture being plain.
 *
 * Site artwork gets a PNG twin written beside it by
 * backend/scripts/generateArticleCovers.js, so a site-relative .svg can simply
 * be swapped for .png. Artwork on someone else's domain has no twin, so it
 * returns null and the caller falls through to the generated cover.
 */
const shareSafeImage = (url) => {
    if (!url) return null;
    if (!/\.svg(\?|#|$)/i.test(url)) return url;
    if (!url.startsWith('/')) return null;
    return url.replace(/\.svg(?=(\?|#|$))/i, '.png');
};

module.exports = {
    shareSafeImage,
    WIDTH,
    HEIGHT,
    VARIANTS_PER_CATEGORY,
    COVER_DIR,
    CATEGORY_SLUGS,
    DEFAULT_SLUG,
    renderCoverSvg,
    articleCoverPath,
    usableHeroImage,
    hashSeed,
};
