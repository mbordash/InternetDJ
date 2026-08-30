/**
 * Sanitiser for article bodies.
 *
 * One function, used by both paths that can put HTML into the `articles`
 * table: the legacy importer, which handles two decades of scraped markup, and
 * the member submission endpoint, which handles whatever someone pastes into a
 * form. Sharing it means a tightening in one place cannot be forgotten in the
 * other.
 *
 * It is built on the sanitize-html package rather than regular expressions. An
 * earlier hand-rolled version stripped every tag in the document because an
 * escaping slip turned a `\b` in its negative lookahead into a literal
 * backslash-b, so the lookahead always succeeded - a failure that produced
 * plausible-looking output and was only caught by reading a rendered page.
 * Parsing HTML with regexes invites exactly that; a real parser does not.
 *
 * Articles allow more than forum posts do - headings, images and blockquotes -
 * because an article is a document rather than a comment. What they do not
 * allow is anything that executes: no script, no style, no iframe, no event
 * handlers, and only http/https URLs.
 */

const sanitizeHtml = require('sanitize-html');

const ARTICLE_OPTIONS = {
    allowedTags: [
        'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li',
        'blockquote', 'h2', 'h3', 'h4', 'img', 'figure', 'figcaption', 'hr',
        'pre', 'code',
    ],
    allowedAttributes: {
        a: ['href'],
        img: ['src', 'alt'],
    },
    // No data: or javascript:. An article body has no legitimate need for
    // either, and both are how a sanitiser gets walked past.
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { img: ['http', 'https'], a: ['http', 'https'] },
    disallowedTagsMode: 'discard',
    // Drop the contents too, rather than leaving the code as visible text.
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed'],
    transformTags: {
        a: (tagName, attribs) => {
            const href = String(attribs.href || '');
            // A relative link is legitimate here: legacy articles link to other
            // articles and to artist pages on this site. Anything else has to
            // be an absolute http(s) URL, and leaves in a new tab without
            // handing the destination a window reference.
            if (/^\//.test(href)) {
                return { tagName: 'a', attribs: { href } };
            }
            if (!/^https?:\/\//i.test(href)) {
                return { tagName: 'a', attribs: {} };
            }
            return {
                tagName: 'a',
                attribs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' },
            };
        },
    },
};

const sanitizeArticleHtml = (html) => {
    if (!html) return null;
    const clean = sanitizeHtml(String(html), ARTICLE_OPTIONS).trim();
    return clean || null;
};

/**
 * Plain text for search, excerpts and the crawler body.
 *
 * Block boundaries become spaces before the tags are dropped. Stripping tags
 * alone concatenates across them, so "<h2>Title</h2><p>Hello" came out as
 * "TitleHello" - which then reaches the search index and the crawler summary as
 * a word that does not exist.
 */
const BLOCK_BOUNDARY = /<\/?(p|br|div|h[1-6]|li|ul|ol|blockquote|tr|figure|figcaption|hr|pre)\b[^>]*>/gi;

const articleHtmlToText = (html) => {
    if (!html) return '';
    const spaced = String(html).replace(BLOCK_BOUNDARY, ' $&');
    return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
        .replace(/\s+/g, ' ')
        .trim();
};

module.exports = { sanitizeArticleHtml, articleHtmlToText, ARTICLE_OPTIONS };
