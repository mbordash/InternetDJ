#!/usr/bin/env node
/**
 * Writes the generated article covers into frontend/public/images/article-covers.
 *
 * Both formats are produced from the same source. The SVG is what the site
 * shows: it is a few kilobytes, stays sharp on a phone and on a 5K display, and
 * costs one cached request for every card that uses it. The PNG exists only for
 * og:image, because Facebook, Slack, Discord and X all refuse to render an SVG
 * share card - point og:image at one and the preview comes out blank.
 *
 * Deterministic by design: re-running this with no edits to
 * backend/utils/articleCover.js rewrites the same bytes, so it never shows up
 * as noise in a diff.
 *
 *   node backend/scripts/generateArticleCovers.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const {
    renderCoverSvg,
    CATEGORY_SLUGS,
    DEFAULT_SLUG,
    VARIANTS_PER_CATEGORY,
    WIDTH,
    HEIGHT,
} = require('../utils/articleCover');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'images', 'article-covers');
const ARTWORK_DIR = path.join(PUBLIC_DIR, 'images', 'articles');

/**
 * Hand-drawn article artwork is SVG too, and share-card scrapers refuse SVG the
 * same way. So every SVG in images/articles gets a PNG twin beside it, which is
 * what shareSafeImage in backend/utils/articleCover.js swaps to. Without this
 * the guide article advertises an og:image that Facebook and Slack will not
 * render, and its share card comes out blank.
 */
const rasteriseArtwork = async () => {
    if (!fs.existsSync(ARTWORK_DIR)) return [];
    const written = [];
    for (const file of fs.readdirSync(ARTWORK_DIR).sort()) {
        if (!file.toLowerCase().endsWith('.svg')) continue;
        const svg = fs.readFileSync(path.join(ARTWORK_DIR, file));
        const png = await sharp(svg, { density: 96 })
            .png({ compressionLevel: 9, palette: true, colours: 128 })
            .toBuffer();
        const out = path.join(ARTWORK_DIR, file.replace(/\.svg$/i, '.png'));
        fs.writeFileSync(out, png);
        written.push([path.basename(out), png.length]);
    }
    return written;
};

const main = async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const slugs = [...CATEGORY_SLUGS, DEFAULT_SLUG];
    let svgBytes = 0;
    let pngBytes = 0;
    let count = 0;

    for (const slug of slugs) {
        for (let i = 0; i < VARIANTS_PER_CATEGORY; i += 1) {
            const name = `${slug}-${i + 1}`;
            const svg = renderCoverSvg(slug, i);

            const svgPath = path.join(OUT_DIR, `${name}.svg`);
            fs.writeFileSync(svgPath, svg);
            svgBytes += Buffer.byteLength(svg);

            // 1200x675 is what every share-card scraper wants, and it is what
            // the SVG viewBox already is, so the raster is 1:1 with no scaling.
            const pngPath = path.join(OUT_DIR, `${name}.png`);
            const png = await sharp(Buffer.from(svg), { density: 96 })
                .resize(WIDTH, HEIGHT)
                .png({ compressionLevel: 9, palette: true, colours: 128 })
                .toBuffer();
            fs.writeFileSync(pngPath, png);
            pngBytes += png.length;

            count += 1;
        }
    }

    const artwork = await rasteriseArtwork();

    const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
    console.log(`Wrote ${count} covers to ${path.relative(process.cwd(), OUT_DIR)}`);
    console.log(`  ${count} SVG, ${kb(svgBytes)} total (${kb(svgBytes / count)} each)`);
    console.log(`  ${count} PNG, ${kb(pngBytes)} total (${kb(pngBytes / count)} each)`);
    if (artwork.length) {
        console.log(`Rasterised ${artwork.length} share twin(s) in images/articles`);
        artwork.forEach(([name, size]) => console.log(`  ${name}  ${kb(size)}`));
    }
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
