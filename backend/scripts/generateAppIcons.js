/**
 * App icons and splash art for the mobile app, from the site's own logo.
 *
 * Run by hand, never on deploy, and the output is committed:
 *
 *     node backend/scripts/generateAppIcons.js
 *
 * It lives here rather than under mobile/ for the same reason
 * generateCoinArt.js does: sharp is a backend dependency, and the house keeps
 * its art generators together even when they write into another workspace.
 * That script writes into frontend/src/assets; this one writes into
 * mobile/assets/images.
 *
 * The source is frontend/public/logo-mark.svg, the synthwave sun-disc the site
 * already uses, so the app icon is the site's mark rather than a second one.
 *
 * On size, which is the thing that decides whether a mark works as an icon:
 * this one was checked at 180, 120, 87, 60 and 40 pixels before any of it was
 * written, because a home-screen icon is drawn at about 60. The disc survives
 * it. What softens is the concentric rings and the four thin bands at the
 * bottom; what carries the mark is the cyan outer ring, the gradient sun, the
 * horizon line and the record hole, and those four all hold at 40. Anything
 * added here later needs the same check rather than a look at 1024.
 *
 * Every output is square and generated at 1024 so it can be downsampled by the
 * platform rather than upscaled.
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { out, errOut, finish, pad } = require('../utils/cli');

const SOURCE = path.join(__dirname, '../../frontend/public/logo-mark.svg');
const OUT_DIR = path.join(__dirname, '../../mobile/assets/images');

/** The site's void-0, which is also the splash background in app.json. */
const GROUND = { r: 4, g: 1, b: 12, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

const SIZE = 1024;

/**
 * A stripped silhouette for the Android monochrome layer.
 *
 * Android tints that layer a single colour and drops everything else, so a
 * gradient is meaningless there. What is left is the shape that identifies the
 * mark: the outer ring, the horizon and the hole.
 */
const MONOCHROME = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <circle cx="60" cy="60" r="52" fill="none" stroke="#fff" stroke-width="7"/>
  <line x1="20" y1="60" x2="100" y2="60" stroke="#fff" stroke-width="7"/>
  <circle cx="60" cy="60" r="13" fill="#000"/>
  <circle cx="60" cy="60" r="13" fill="none" stroke="#fff" stroke-width="7"/>
</svg>`;

/**
 * Render the mark at `inset` of the canvas, centred on `background`.
 *
 * `inset` is the fraction of the canvas the mark itself occupies. It differs
 * per output because each platform crops differently: iOS masks a full-bleed
 * square to a rounded rect, while Android may crop an adaptive icon to a
 * circle and only guarantees the middle ~66%.
 */
const render = async (svg, { inset, background, density = 1200 }) => {
    const markSize = Math.round(SIZE * inset);
    const mark = await sharp(Buffer.from(svg), { density })
        .resize(markSize, markSize)
        .png()
        .toBuffer();

    const offset = Math.round((SIZE - markSize) / 2);
    return sharp({
        create: { width: SIZE, height: SIZE, channels: 4, background },
    })
        .composite([{ input: mark, left: offset, top: offset }])
        .png()
        .toBuffer();
};

const OUTPUTS = [
    // iOS home screen. Full bleed on the site's ground, with enough margin that
    // the rounded-rect mask never clips the cyan ring.
    { file: 'icon.png', inset: 0.78, background: GROUND },

    // The splash. app.json paints #04010c behind it, so this is the mark alone
    // and small enough not to fill a phone screen edge to edge.
    { file: 'splash-icon.png', inset: 0.55, background: CLEAR },

    // Android adaptive layers. The foreground sits inside the safe zone,
    // because launchers crop these to a circle, a squircle or a rounded square
    // depending on the device, and only the middle two thirds is guaranteed.
    { file: 'android-icon-foreground.png', inset: 0.62, background: CLEAR },
    { file: 'android-icon-background.png', inset: 0, background: GROUND },
    { file: 'android-icon-monochrome.png', inset: 0.62, background: CLEAR, svg: MONOCHROME },

    // In-app, on the idle station screen. Transparent so it sits on the page.
    { file: 'logo-mark.png', inset: 1, background: CLEAR },
];

(async () => {
    try {
        if (!fs.existsSync(SOURCE)) {
            errOut(`Source logo not found: ${SOURCE}`);
            await finish(1);
            return;
        }
        fs.mkdirSync(OUT_DIR, { recursive: true });

        const svg = fs.readFileSync(SOURCE, 'utf8');
        out(`Rendering ${OUTPUTS.length} assets from logo-mark.svg at ${SIZE}px...`);
        out('');

        for (const output of OUTPUTS) {
            const buffer = output.inset === 0
                // A flat colour layer has no mark on it at all.
                ? await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: output.background } })
                    .png().toBuffer()
                : await render(output.svg || svg, output);

            const target = path.join(OUT_DIR, output.file);
            fs.writeFileSync(target, buffer);

            const { width, height, size } = { ...(await sharp(buffer).metadata()), size: buffer.length };
            out(`  ${pad(output.file, 32)} ${width}x${height}  ${(size / 1024).toFixed(1)} KB`);
        }

        // The favicon is the only output that is not 1024, so it is done last
        // and from the finished icon rather than re-rendered.
        const favicon = await sharp(path.join(OUT_DIR, 'icon.png')).resize(48, 48).png().toBuffer();
        fs.writeFileSync(path.join(OUT_DIR, 'favicon.png'), favicon);
        out(`  ${pad('favicon.png', 32)} 48x48  ${(favicon.length / 1024).toFixed(1)} KB`);

        out('');
        out(`Written to ${path.relative(path.join(__dirname, '../..'), OUT_DIR)}`);
    } catch (err) {
        errOut(`Failed to generate app icons: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
