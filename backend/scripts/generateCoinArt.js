/**
 * Draws the IDJ Coin mark in the site's retro palette and writes the PNGs.
 *
 * WHEN THIS RUNS: by hand, never automatically. Unlike the migration scripts
 * this one is NOT in the fly release_command, because its output is committed
 * to the repo as a fixed asset. Run it, look at the PNGs, commit them.
 *
 *     node backend/scripts/generateCoinArt.js
 *
 * WHY IT IS DRAWN RATHER THAN DESIGNED: the mark has to exist at several sizes
 * and in two different SHAPES, and hand-scaling a raster loses the thin grid
 * lines first. Generating from one SVG means every size is drawn at its own
 * resolution.
 *
 * THE TWO SHAPES matter, because one file used to serve both jobs and could
 * only be right for one of them:
 *
 *   - og:image wants WIDE. twitter:card is summary_large_image site-wide, and
 *     X crops a square to 1.91:1, which slices the top and bottom off a coin.
 *     That is idj-share-card.png, 1200x675, matching the article covers.
 *   - Organization.logo in the JSON-LD wants the SQUARE mark on its own.
 *     That is idj-coin-512.png.
 *
 * idj-coin-200-nobg.png is still written even though nothing points at it any
 * more: it was the og:image for a long time, so scrapers and social posts have
 * that URL cached and it should keep resolving.
 *
 * TWO RASTERISER LIMITS shape the code below, both confirmed by testing rather
 * than assumed:
 *
 *   1. librsvg silently drops <textPath>. It renders nothing and reports no
 *      error, so the INTERNETDJ arc places each letter as its own <text> at a
 *      tangent rotation instead.
 *   2. It can only use fonts installed on the machine doing the rasterising.
 *      Orbitron, the site's display face, is a webfont and is NOT installed,
 *      so asking for it here would silently fall back. Arial Black and Futura
 *      are present and are what the artwork actually asks for.
 *
 * Both limits are why the output is committed rather than built on deploy: a
 * Fly build machine has neither the fonts nor a reason to run this.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ---------------------------------------------------------------- palette --
// Lifted from frontend/src/styles/retro.css so the coin and the page it sits
// on cannot drift apart. If those custom properties change, change these.
const NEON = {
    magenta: '#ff2f8e',
    pink: '#ff6ec7',
    cyan: '#00f0ff',
    purple: '#9d4edd',
    amber: '#ffb020',
    sunTop: '#ffd166',   // .retro-sun gradient stop 1
};

const SIZE = 1024;               // drawn once, downsampled per output
const C = SIZE / 2;              // centre
const R_EDGE = 502;              // outer rim
const R_FACE = 470;              // the struck face inside the rim
const HORIZON = 640;             // where the grid meets the sun

const CARD_W = 1200;             // matches backend/utils/articleCover.js
const CARD_H = 675;

const OUT = [
    { file: '../frontend/src/assets/idj-coin.png', size: 500 },   // the coin page
    { file: '../frontend/public/idj-coin-512.png', size: 512 },   // JSON-LD logo
    { file: '../frontend/public/idj-coin-200-nobg.png', size: 200 }, // legacy, cached
];

const deg = (d) => (d * Math.PI) / 180;
const r2 = (n) => Math.round(n * 100) / 100;

/* ----------------------------------------------------------------- defs -- */
const defs = () => `
<defs>
  <radialGradient id="face" cx="42%" cy="34%" r="78%">
    <stop offset="0%"   stop-color="#2a1152"/>
    <stop offset="55%"  stop-color="#160833"/>
    <stop offset="100%" stop-color="#07020f"/>
  </radialGradient>

  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%"   stop-color="${NEON.cyan}"/>
    <stop offset="38%"  stop-color="#bff8ff"/>
    <stop offset="62%"  stop-color="${NEON.purple}"/>
    <stop offset="100%" stop-color="${NEON.magenta}"/>
  </linearGradient>

  <!-- The .retro-sun gradient, top to bottom. -->
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="${NEON.sunTop}"/>
    <stop offset="55%"  stop-color="${NEON.pink}"/>
    <stop offset="100%" stop-color="${NEON.magenta}"/>
  </linearGradient>

  <!-- Struck metal: light band, hard shadow turn, light band again. -->
  <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#ffffff"/>
    <stop offset="26%"  stop-color="#d7f2ff"/>
    <stop offset="47%"  stop-color="#6f8fa8"/>
    <stop offset="53%"  stop-color="#ffffff"/>
    <stop offset="74%"  stop-color="#cfe7f5"/>
    <stop offset="100%" stop-color="#7d99ad"/>
  </linearGradient>

  <linearGradient id="solana" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%"   stop-color="${NEON.cyan}"/>
    <stop offset="100%" stop-color="${NEON.purple}"/>
  </linearGradient>

  <!-- Grid fades out before it reaches the rim, so the arc text stays legible. -->
  <linearGradient id="gridFade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#fff" stop-opacity="0.9"/>
    <stop offset="55%"  stop-color="#fff" stop-opacity="0.28"/>
    <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <mask id="gridMask">
    <rect x="0" y="${HORIZON}" width="${SIZE}" height="${216}" fill="url(#gridFade)"/>
  </mask>

  <clipPath id="faceClip">
    <circle cx="${C}" cy="${C}" r="${R_FACE}"/>
  </clipPath>
</defs>`;

/* ------------------------------------------------------------------ sun -- */
// A disc cut by horizontal bands. The CSS masks the real thing with
// repeating-linear-gradient; here the bands are drawn as gaps in the disc,
// widening downward the way the mask does below its 52% solid line.
const sun = () => {
    const cx = C;
    const cy = HORIZON - 40;
    const r = 232;
    const bands = [];
    // Solid to just past the middle, then progressively fatter gaps.
    let y = cy + 6;
    let gap = 7;
    while (y < cy + r) {
        bands.push(`<rect x="${cx - r - 4}" y="${r2(y)}" width="${r * 2 + 8}" height="${r2(gap)}" fill="#0d0320"/>`);
        y += gap + Math.max(9, gap * 1.5);
        gap += 2.4;
    }
    return `
  <g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sun)" opacity="0.95"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${NEON.sunTop}" stroke-width="2" opacity="0.5"/>
    ${bands.join('\n    ')}
  </g>`;
};

/* ----------------------------------------------------------------- grid -- */
// Perspective floor. Verticals converge on a vanishing point at the horizon;
// horizontals bunch up toward it. Same two colours as .retro-horizon.
const grid = () => {
    const vp = { x: C, y: HORIZON };
    const lines = [];

    for (let i = -9; i <= 9; i += 1) {
        const x = C + i * 118;
        lines.push(`<line x1="${vp.x}" y1="${vp.y}" x2="${r2(x)}" y2="${SIZE}" stroke="${NEON.cyan}" stroke-width="2.2"/>`);
    }
    let step = 7;
    let y = HORIZON + step;
    while (y < SIZE) {
        lines.push(`<line x1="0" y1="${r2(y)}" x2="${SIZE}" y2="${r2(y)}" stroke="${NEON.magenta}" stroke-width="2.2"/>`);
        step *= 1.42;
        y += step;
    }

    return `
  <g mask="url(#gridMask)" opacity="0.75">
    ${lines.join('\n    ')}
  </g>
  <line x1="${C - 470}" y1="${HORIZON}" x2="${C + 470}" y2="${HORIZON}"
        stroke="${NEON.cyan}" stroke-width="3" opacity="0.85"/>`;
};

/* --------------------------------------------------------------- solana -- */
// The three slanted bars, kept from the original coin because it is the one
// mark on there that means something specific: this is an SPL token.
const solanaMark = (cx, cy, w = 132, barH = 22, gap = 13, skew = 20) => {
    const bars = [0, 1, 2].map((i) => {
        const y = cy - (barH * 3 + gap * 2) / 2 + i * (barH + gap);
        // Outer bars lean one way, the middle bar the other.
        const lean = i === 1 ? -skew : skew;
        const x0 = cx - w / 2;
        const x1 = cx + w / 2;
        return `<path d="M ${r2(x0 + Math.max(0, lean))} ${r2(y)} H ${r2(x1)} L ${r2(x1 - Math.max(0, lean))} ${r2(y + barH)} H ${r2(x0)} Z"
          fill="url(#solana)" opacity="0.95"/>`;
    });
    return `<g>${bars.join('')}</g>`;
};

/* ---------------------------------------------------------------- tools -- */
// Faders, knobs and a scope. These are why the coin reads as a music token
// rather than a generic crypto disc, so they are kept from the original.
const faders = (x, y) => {
    const out = [];
    [0, 1, 2].forEach((i) => {
        const fx = x + i * 52;
        const capAt = y + [64, 30, 82][i];
        out.push(`<line x1="${fx}" y1="${y}" x2="${fx}" y2="${y + 124}" stroke="${NEON.cyan}" stroke-width="4" opacity="0.55"/>`);
        out.push(`<rect x="${fx - 15}" y="${capAt}" width="30" height="15" rx="2" fill="${NEON.pink}" opacity="0.95"/>`);
    });
    return `<g>${out.join('')}</g>`;
};

const knobs = (x, y) => {
    const out = [];
    [0, 1, 2].forEach((i) => {
        const kx = x + i * 52;
        const a = deg([-125, -40, 55][i]);
        out.push(`<circle cx="${kx}" cy="${y}" r="17" fill="none" stroke="${NEON.cyan}" stroke-width="3.5" opacity="0.8"/>`);
        out.push(`<line x1="${kx}" y1="${y}" x2="${r2(kx + Math.cos(a) * 15)}" y2="${r2(y + Math.sin(a) * 15)}" stroke="${NEON.magenta}" stroke-width="3.5"/>`);
    });
    return `<g>${out.join('')}</g>`;
};

const scope = (x, y, w, h) => {
    const pts = [];
    const mid = y + h / 2;
    for (let i = 0; i <= 48; i += 1) {
        const t = i / 48;
        const px = x + t * w;
        const env = Math.sin(t * Math.PI);
        const py = mid - Math.sin(t * 22) * (h * 0.36) * env;
        pts.push(`${r2(px)},${r2(py)}`);
    }
    return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#08021a" stroke="${NEON.cyan}" stroke-width="3" opacity="0.9"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${NEON.pink}" stroke-width="3.5" stroke-linejoin="round"/>
  </g>`;
};

/* ------------------------------------------------------------ arc legend -- */
// <textPath> renders nothing under librsvg, so each glyph is positioned and
// rotated by hand along the bottom of the coin.
const arcText = (text, radius, opts = {}) => {
    const { sweep = 96, size = 46, fill = '#d8f6ff', opacity = 1, family = 'Futura' } = opts;
    const chars = [...text];
    const start = 90 + sweep / 2;               // bottom-left
    const stepA = sweep / (chars.length - 1);

    const glyphs = chars.map((ch, i) => {
        const a = deg(start - i * stepA);
        const x = C + Math.cos(a) * radius;
        const y = C + Math.sin(a) * radius;
        // Tangent of the path, so letter tops point at the centre.
        const rot = (Math.atan2(-Math.cos(a), Math.sin(a)) * 180) / Math.PI;
        return `<text x="${r2(x)}" y="${r2(y)}" font-family="${family}" font-size="${size}"
        font-weight="700" fill="${fill}" text-anchor="middle"
        stroke="#0a0320" stroke-width="5" paint-order="stroke"
        transform="rotate(${r2(rot)} ${r2(x)} ${r2(y)})">${ch}</text>`;
    });
    return `<g opacity="${opacity}">${glyphs.join('\n    ')}</g>`;
};

/* -------------------------------------------------------------- scanlines -- */
const scanlines = () => {
    const rows = [];
    for (let y = 0; y < SIZE; y += 6) {
        rows.push(`<rect x="0" y="${y}" width="${SIZE}" height="2.4" fill="#000"/>`);
    }
    return `<g clip-path="url(#faceClip)" opacity="0.17">${rows.join('')}</g>`;
};

/* ------------------------------------------------------------------ coin -- */
const renderCoinSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
${defs()}

  <!-- rim -->
  <circle cx="${C}" cy="${C}" r="${R_EDGE}" fill="url(#rim)"/>
  <circle cx="${C}" cy="${C}" r="${R_EDGE - 13}" fill="#0b0320"/>
  <circle cx="${C}" cy="${C}" r="${R_FACE + 9}" fill="none" stroke="${NEON.magenta}" stroke-width="3" opacity="0.75"/>

  <!-- struck face -->
  <circle cx="${C}" cy="${C}" r="${R_FACE}" fill="url(#face)"/>

  <g clip-path="url(#faceClip)">
    ${sun()}
    ${grid()}
  </g>

  <!-- IDJ, over the sun. Two passes: a dark body for weight, chrome on top. -->
  <g>
    <text x="${C}" y="596" font-family="Arial Black, Arial, sans-serif" font-size="248"
      font-weight="900" letter-spacing="6" text-anchor="middle"
      fill="#05010e" opacity="0.85" transform="translate(5 6)">IDJ</text>
    <text x="${C}" y="596" font-family="Arial Black, Arial, sans-serif" font-size="248"
      font-weight="900" letter-spacing="6" text-anchor="middle"
      fill="url(#chrome)" stroke="#0a0320" stroke-width="4">IDJ</text>
  </g>

  ${solanaMark(C, 250, 186, 30, 18, 27)}
  ${faders(214, 210)}
  ${scope(654, 214, 190, 118)}

  ${arcText('INTERNETDJ', 400, { sweep: 92, size: 52 })}

  ${scanlines()}

  <!-- rim highlight last, so nothing sits on top of the edge -->
  <circle cx="${C}" cy="${C}" r="${R_EDGE - 6}" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.22"/>
</svg>`;


/* ------------------------------------------------------------ share card -- */
// Text width is MEASURED, not guessed. The first version of this card ran
// "Get written feedback." off the right edge, because a font's advance widths
// are not knowable from the string length. Each line is rendered alone,
// trimmed to its ink, and scaled down if it overflows its column, so changing
// the wording below cannot silently produce a card with the end chopped off.
const escapeXml = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const measureText = async (text, { family, size, weight = 400, spacing = 0 }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${Math.ceil(size * 2.4)}">
      <text x="20" y="${r2(size * 1.5)}" font-family="${family}" font-size="${size}"
        font-weight="${weight}" letter-spacing="${spacing}" fill="#ffffff">${escapeXml(text)}</text></svg>`;
    const { info } = await sharp(Buffer.from(svg)).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    return info.width;
};

// Advance widths scale linearly with font-size, so one measurement is enough
// to solve for the largest size that fits.
const fitSize = async (text, opts, maxWidth) => {
    const measured = await measureText(text, opts);
    if (measured <= maxWidth) return opts.size;
    return Math.floor(opts.size * (maxWidth / measured) * 100) / 100;
};

// The site-wide og:image fallback: every page with no picture of its own
// shares with this. Deliberately calmer than the coin. The coin already
// carries the sun, so repeating it behind the wordmark would only fight the
// type; the card gets the grid horizon and a glow, and leaves the text alone.
const renderCardSvg = async () => {
    const horizon = 470;
    const TEXT_X = 486;
    const COL = CARD_W - TEXT_X - 64;        // right margin

    const LINES = {
        mark: { text: 'INTERNETDJ', family: 'Arial Black, Arial, sans-serif', weight: 900, spacing: 1, size: 78 },
        lead: { text: 'Publish your music. Get written feedback.', family: 'Futura, Avenir Next, sans-serif', weight: 700, spacing: 1, size: 30 },
        sub: { text: 'Independent electronic music since 1997', family: 'Futura, Avenir Next, sans-serif', weight: 400, spacing: 2, size: 25 },
    };
    for (const key of Object.keys(LINES)) {
        LINES[key].size = await fitSize(LINES[key].text, LINES[key], COL);
    }

    const lines = [];
    for (let i = -12; i <= 12; i += 1) {
        lines.push(`<line x1="${CARD_W * 0.62}" y1="${horizon}" x2="${r2(CARD_W * 0.62 + i * 132)}" y2="${CARD_H}" stroke="${NEON.cyan}" stroke-width="2"/>`);
    }
    let step = 6;
    let y = horizon + step;
    while (y < CARD_H) {
        lines.push(`<line x1="0" y1="${r2(y)}" x2="${CARD_W}" y2="${r2(y)}" stroke="${NEON.magenta}" stroke-width="2"/>`);
        step *= 1.5;
        y += step;
    }

    const rows = [];
    for (let sy = 0; sy < CARD_H; sy += 4) {
        rows.push(`<rect x="0" y="${sy}" width="${CARD_W}" height="1.6" fill="#000"/>`);
    }

    const line = (l, ly, fill, extra = '') => `<text x="${TEXT_X}" y="${ly}" font-family="${l.family}"
    font-size="${l.size}" font-weight="${l.weight}" letter-spacing="${l.spacing}" fill="${fill}" ${extra}>${escapeXml(l.text)}</text>`;

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%"   stop-color="#1d0a38"/>
      <stop offset="60%"  stop-color="#0f0524"/>
      <stop offset="100%" stop-color="#06010f"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${NEON.magenta}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${NEON.magenta}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="30%"  stop-color="#d7f2ff"/>
      <stop offset="49%"  stop-color="#7794ab"/>
      <stop offset="55%"  stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#9fbdd0"/>
    </linearGradient>
    <linearGradient id="gridFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#fff" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="gridMask">
      <rect x="0" y="${horizon}" width="${CARD_W}" height="${CARD_H - horizon}" fill="url(#gridFade)"/>
    </mask>
  </defs>

  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
  <ellipse cx="264" cy="${CARD_H / 2}" rx="300" ry="280" fill="url(#halo)"/>
  <g mask="url(#gridMask)" opacity="0.6">${lines.join('')}</g>
  <line x1="0" y1="${horizon}" x2="${CARD_W}" y2="${horizon}" stroke="${NEON.cyan}" stroke-width="2.5" opacity="0.7"/>

  ${line(LINES.mark, 306, 'url(#chrome)', 'stroke="#0a0320" stroke-width="3" paint-order="stroke"')}
  ${line(LINES.lead, 364, NEON.pink)}
  ${line(LINES.sub, 412, '#9fd8e6', 'opacity="0.85"')}

  <g opacity="0.14">${rows.join('')}</g>
</svg>`;
};

/* ------------------------------------------------------------------ main -- */
async function main() {
    const svg = renderCoinSvg();
    const svgPath = path.join(__dirname, '../../frontend/src/assets/idj-coin.svg');
    fs.writeFileSync(svgPath, svg, 'utf8');
    console.log(`wrote ${path.relative(process.cwd(), svgPath)}`);

    for (const { file, size } of OUT) {
        const dest = path.join(__dirname, '..', file);
        await sharp(Buffer.from(svg))
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9 })
            .toFile(dest);
        const { size: bytes } = fs.statSync(dest);
        console.log(`wrote ${file.replace('../', '')}  ${size}x${size}  ${(bytes / 1024).toFixed(1)} KB`);
    }

    // The coin is composited rather than re-drawn at card scale: it is already
    // one self-contained SVG, and rendering it once then placing it keeps a
    // single definition of the artwork.
    const COIN_PX = 340;
    const coin = await sharp(Buffer.from(svg))
        .resize(COIN_PX, COIN_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    const cardPath = path.join(__dirname, '../../frontend/public/idj-share-card.png');
    await sharp(Buffer.from(await renderCardSvg()))
        .composite([{ input: coin, left: 94, top: Math.round((CARD_H - COIN_PX) / 2) }])
        .png({ compressionLevel: 9 })
        .toFile(cardPath);
    const cardBytes = fs.statSync(cardPath).size;
    console.log(`wrote frontend/public/idj-share-card.png  ${CARD_W}x${CARD_H}  ${(cardBytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
