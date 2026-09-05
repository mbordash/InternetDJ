/**
 * App Store marketing screenshots for the mobile app.
 *
 * Run by hand, output committed:
 *
 *     node backend/scripts/generateStoreFrames.js
 *
 * Takes the raw device captures in mobile/store-screenshots/raw and composes
 * each one into a framed marketing shot: a headline, a line of supporting copy,
 * and the screenshot below it on the site's own ground. Same reasoning as
 * generateAppIcons.js for why an art generator lives in backend/scripts - sharp
 * is a backend dependency.
 *
 * On type: the site uses Orbitron, which is not installed on the machine that
 * rasterises this, and librsvg silently falls back rather than failing when a
 * family is missing. Futura is used instead - installed by default on macOS,
 * geometric, and genuinely period-correct for the synthwave direction rather
 * than a compromise. If Orbitron is ever installed, change HEADLINE_FAMILY.
 *
 * Output is 1284 x 2778, the 6.5"/6.7" iPhone slot. The raw captures must
 * already be that size; they are never upscaled, only inset.
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { out, errOut, finish, pad } = require('../utils/cli');

const ROOT = path.join(__dirname, '../../mobile/store-screenshots');

/**
 * The two slots App Store Connect asks for. Proportions differ, not just size:
 * an iPad canvas is much less tall relative to its width, so the caption block
 * and the inset are set per device rather than scaled from one another.
 */
const DEVICES = [
    {
        name: 'iPhone 6.5\"',
        dir: ROOT,
        W: 1284, H: 2778,
        captionHeight: 560,
        headlineSize: 88, headlineGap: 104, subSize: 40,
        subY: 384, ruleY: 430,
        inset: 0.78, shotTop: 648,
    },
    {
        name: 'iPad 12.9\"',
        dir: path.join(ROOT, 'ipad'),
        W: 2048, H: 2732,
        captionHeight: 700,
        headlineSize: 118, headlineGap: 140, subSize: 54,
        subY: 512, ruleY: 574,
        inset: 0.74, shotTop: 764,
    },
];

/* The site's tokens, from frontend/src/styles/retro.css. */
const CYAN = '#00f0ff';
const MAGENTA = '#ff2f8e';
const INK = '#e8f6ff';
const INK_DIM = '#9db3c4';

const HEADLINE_FAMILY = 'Futura, Avenir Next, Helvetica Neue, sans-serif';
const BODY_FAMILY = 'Avenir Next, Helvetica Neue, sans-serif';

/**
 * The copy. One promise per screen, in the order they should be uploaded:
 * App Store Connect shows the first two or three in search results, so the
 * strongest claim goes first.
 */
const FRAMES = [
    {
        file: '01-station.png',
        headline: ['Press play.', 'It never stops.'],
        sub: 'An endless mix built from what actually goes together',
    },
    {
        file: '02-browse.png',
        headline: ['Every genre,', 'one tap from playing'],
        sub: 'Techno, house, drum and bass, and the rest of the crate',
    },
    {
        file: '03-genre.png',
        headline: ['Start a station', 'from anything'],
        sub: 'Or look inside first. Both are one tap.',
    },
    {
        file: '04-search.png',
        headline: ['Search by tempo', 'and key'],
        sub: 'Made for people who actually mix records',
    },
    {
        file: '05-playlists.png',
        headline: ['Keep what', 'you find'],
        sub: 'Saved on your phone. No account, ever.',
    },
];

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
));

/**
 * The ground: the same radial washes .retro-page lays over the site, so a
 * frame reads as part of InternetDJ rather than a generic dark template.
 */
const background = ({ W, H }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="purple" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="#9d4edd" stop-opacity="0.34"/>
      <stop offset="60%" stop-color="#9d4edd" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pink" cx="6%" cy="16%" r="55%">
      <stop offset="0%" stop-color="${MAGENTA}" stop-opacity="0.20"/>
      <stop offset="65%" stop-color="${MAGENTA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cyan" cx="96%" cy="30%" r="55%">
      <stop offset="0%" stop-color="${CYAN}" stop-opacity="0.16"/>
      <stop offset="65%" stop-color="${CYAN}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="void" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0418"/>
      <stop offset="100%" stop-color="#04010c"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#void)"/>
  <rect width="${W}" height="${H}" fill="url(#purple)"/>
  <rect width="${W}" height="${H}" fill="url(#pink)"/>
  <rect width="${W}" height="${H}" fill="url(#cyan)"/>
</svg>`;

/**
 * The caption block.
 *
 * Drawn as one SVG rather than three composites so the baselines are set once
 * and cannot drift between frames. Headline is two lines by construction: a
 * single long line would either shrink below the size that reads on a store
 * listing thumbnail, or wrap somewhere the copy did not choose.
 */
const caption = ({ headline, sub }, d) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${d.W}" height="${d.captionHeight}">
  <g text-anchor="middle" font-family="${HEADLINE_FAMILY}">
    <text x="${d.W / 2}" y="${d.headlineGap * 1.9}" font-size="${d.headlineSize}" font-weight="600"
          fill="${INK}" letter-spacing="-1">${escapeXml(headline[0])}</text>
    <text x="${d.W / 2}" y="${d.headlineGap * 1.9 + d.headlineGap}" font-size="${d.headlineSize}"
          font-weight="600" fill="${MAGENTA}" letter-spacing="-1">${escapeXml(headline[1] || '')}</text>
  </g>
  <text x="${d.W / 2}" y="${d.subY}" text-anchor="middle" font-family="${BODY_FAMILY}"
        font-size="${d.subSize}" fill="${INK_DIM}">${escapeXml(sub)}</text>
  <g transform="translate(${d.W / 2 - 60}, ${d.ruleY})">
    <rect width="120" height="4" fill="${CYAN}" opacity="0.75"/>
  </g>
</svg>`;

(async () => {
    try {
        let composed = 0;

        for (const d of DEVICES) {
            const raw = path.join(d.dir, 'raw');
            if (!fs.existsSync(raw)) {
                out(`Skipping ${d.name}: no captures in ${path.relative(process.cwd(), raw)}`);
                continue;
            }

            out(`${d.name} - composing at ${d.W}x${d.H}`);

            const shotWidth = Math.round(d.W * d.inset);
            const shotHeight = Math.round(d.H * d.inset);

            for (const frame of FRAMES) {
                const source = path.join(raw, frame.file);
                if (!fs.existsSync(source)) {
                    errOut(`  missing ${frame.file}`);
                    continue;
                }

                const meta = await sharp(source).metadata();
                if (meta.width !== d.W || meta.height !== d.H) {
                    errOut(`  ${frame.file} is ${meta.width}x${meta.height}, expected ${d.W}x${d.H}`);
                    continue;
                }

                // A hairline in the accent, because the capture and the ground
                // behind it are nearly the same black.
                const shot = await sharp(source)
                    .resize(shotWidth)
                    .composite([{
                        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${shotWidth}" height="${shotHeight}">
                            <rect x="0.5" y="0.5" width="${shotWidth - 1}" height="${shotHeight - 1}"
                                  fill="none" stroke="${CYAN}" stroke-opacity="0.35" stroke-width="2"/>
                        </svg>`),
                        top: 0,
                        left: 0,
                    }])
                    .png()
                    .toBuffer();

                const image = await sharp(Buffer.from(background(d)))
                    .composite([
                        { input: Buffer.from(caption(frame, d)), top: 0, left: 0 },
                        // Runs off the bottom edge: a shot that stops short
                        // leaves a sliver of ground and reads as a picture
                        // pasted onto a poster.
                        { input: shot, top: d.shotTop, left: Math.round((d.W - shotWidth) / 2) },
                    ])
                    .png()
                    .toBuffer();

                fs.writeFileSync(path.join(d.dir, frame.file), image);
                out(`  ${pad(frame.file, 22)} ${d.W}x${d.H}  ${(image.length / 1024).toFixed(0)} KB`);
                composed += 1;
            }
            out('');
        }

        if (!composed) {
            errOut('Nothing composed. Capture raw shots first, at the exact device size.');
            await finish(1);
            return;
        }
        out(`${composed} frame(s) written. Raw captures are kept so frames can be recomposed.`);
    } catch (err) {
        errOut(`Failed to compose store frames: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
