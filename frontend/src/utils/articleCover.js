/**
 * Picks the generated cover art for an article that has no usable picture.
 *
 * The art itself lives in frontend/public/images/article-covers, drawn by
 * backend/utils/articleCover.js and written out by
 * backend/scripts/generateArticleCovers.js. This file only chooses which one.
 *
 * The two selection functions below are deliberately mirrored from that backend
 * module rather than shared. The backend is CommonJS and picks the cover for
 * the og:image that crawlers and share previews read; this is ESM and picks the
 * cover the reader sees. They have to agree - a share card showing a different
 * picture from the page it links to looks like a mismatched link - so if you
 * change the hash or the variant count, change it in both places.
 */

const COVER_DIR = '/images/article-covers';
const VARIANTS_PER_CATEGORY = 4;
const CATEGORY_SLUGS = new Set(['news', 'interviews', 'features', 'reviews', 'guides']);
const DEFAULT_SLUG = 'default';

// FNV-1a, matching backend/utils/articleCover.js.
const hashSeed = (value) => {
    let h = 0x811c9dc5;
    const s = String(value == null ? '' : value);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
};

/**
 * Every legacy hero_image_url points at www.internetdj.com, which stopped
 * resolving years ago. Letting those through would mean 957 <img> tags that
 * each fire a request, wait for it to fail, and only then reveal the cover
 * underneath. Filtering them here means the cover is simply what renders.
 *
 * The column is left intact rather than blanked because the URLs are the only
 * surviving record of what the picture was, and some are still recoverable
 * from the Wayback Machine.
 */
const DEAD_IMAGE_HOSTS = /^https?:\/\/(www\.)?internetdj\.com\//i;

export const usableHeroImage = (url) => {
    const value = String(url || '').trim();
    if (!value) return null;
    if (DEAD_IMAGE_HOSTS.test(value)) return null;
    return value;
};

/**
 * Share-card scrapers refuse an SVG og:image. Site artwork has a PNG twin
 * written beside it by backend/scripts/generateArticleCovers.js; artwork on
 * another domain does not, so it returns null and the caller falls back to the
 * generated cover. Mirrors shareSafeImage in backend/utils/articleCover.js.
 */
export const shareSafeImage = (url) => {
    if (!url) return null;
    if (!/\.svg(\?|#|$)/i.test(url)) return url;
    if (!url.startsWith('/')) return null;
    return url.replace(/\.svg(?=(\?|#|$))/i, '.png');
};

/** Site-relative path of the cover for an article, e.g. /images/article-covers/news-3.svg */
export const articleCoverUrl = (category, seed) => {
    const key = String(category || '').trim().toLowerCase();
    const slug = CATEGORY_SLUGS.has(key) ? key : DEFAULT_SLUG;
    const index = (hashSeed(seed) % VARIANTS_PER_CATEGORY) + 1;
    return `${COVER_DIR}/${slug}-${index}.svg`;
};

/**
 * The picture to show for an article: its own artwork when it still exists,
 * a generated cover otherwise. Callers get a URL either way and never have to
 * handle the empty case.
 */
export const articleImage = (article) => {
    if (!article) return null;
    return usableHeroImage(article.hero_image_url)
        || articleCoverUrl(article.category, article.slug || article.id);
};
