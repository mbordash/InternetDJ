# Server-rendered metadata for crawlers

## Overview

The frontend is a client-rendered SPA, so the HTML a crawler receives is an
empty `<div id="root">`. This middleware detects a crawler, looks the entity up,
and rewrites the shell before it goes out — meta tags in the `<head>`, and a
plain-HTML summary of the entity inside `#root`.

## How It Works

1. **Crawler detection** — the User-Agent is matched against `CRAWLER_AGENTS`.
2. **URL parsing** — `extractMetadata()` decides which entity, if any, a path
   refers to.
3. **Data fetching** — the matching fetcher queries the database. Results are
   cached for 15 minutes, keyed by entity.
4. **Injection** — `injectOGMetaTags()` writes the tags into `<head>` and the
   summary into `<body>`.
5. **Everyone else** — a normal browser gets the untouched shell and
   react-helmet-async handles its tags client-side.

## Two audiences, two problems

**Share crawlers and search engines** (`SHARE_CRAWLER_AGENTS`) mostly want a
link preview, and the ones that matter for ranking — Googlebot, Bingbot —
execute JavaScript. For them the injected `<head>` is enough: they render the
real React app for the page content.

**Assistant and answer-engine crawlers** (`AI_CRAWLER_AGENTS` — GPTBot,
ClaudeBot, PerplexityBot and friends) almost never execute JavaScript. They
fetch the HTML once and read what is in it. Meta tags describe a page but are
not the page, so a correct `<head>` on an empty document let them render a link
preview and told them nothing about the track. That is what the crawler body
below is for.

## The crawler body

Each fetcher may return a `body` alongside its tags. It is **plain data, not
markup**:

```javascript
body: {
    heading: 'Acid Rain by dj_subspace',
    paragraphs: ['...'],
    facts: [{ label: 'Tempo', value: '138 BPM' }],
    sections: [
        { heading: 'Producer feedback', items: [{ text: '...' }] },
        { heading: 'More', items: [{ text: 'Artist page', href: '/profile/x' }] },
    ],
}
```

`renderCrawlerBody()` turns that into `<h1>`, `<p>`, `<dl>`, `<h2>` and `<ul>`.
Keeping it as data rather than markup means a fetcher cannot inject unescaped
user content by accident: every string goes through `escapeHtml`, every `href`
through `toAbsoluteUrl`. Null and empty values are dropped, and a section with
no items is omitted entirely.

It is rendered **inside** `<div id="root">`, which is the whole trick.
`createRoot().render()` replaces the container's children, so a crawler that
runs JavaScript sees the real app and never the summary, while one that does not
sees the summary and never an empty page. Rendering it beside `#root` instead
would leave both versions on the page for Googlebot and read as duplicated
content. Ordinary browsers never reach this code path — `server.js` only calls
it behind `isCrawler()` — so there is no flash of this markup for a real
visitor.

## Structured data

JSON-LD is emitted from the fetcher's `jsonLd(base)` function. The frontend
should **not** also emit JSON-LD for the same page: Helmet's copy and this one
would both survive in the DOM for a JavaScript-rendering crawler, leaving two
entities for one URL. `/promote` is the worked example — its FAQ text lives in
`frontend/src/pages/Promote.js` for display and its `FAQPage` structured data
lives in `PROMOTE_FAQ` here.

## Supported Pages

| Path | Type | Structured data |
| --- | --- | --- |
| `/` | staticPage | `Organization` + `WebSite` (sitewide identity) |
| `/promote` | staticPage | `WebPage` + `FAQPage` |
| `/loops` | staticPage | `WebApplication` |
| `/song/:id` | song | `MusicRecording` |
| `/profile/:idOrSlug` | profile | `MusicGroup` |
| `/crate/:id` | crate | `MusicPlaylist` |
| `/forum/post/:id` | forumPost | `DiscussionForumPosting` |
| `/tag/:tag` | tag | `CollectionPage` |

Hand-written pages live in `STATIC_PAGES`, keyed by path; entity pages get a
pattern in `extractMetadata()` and a fetcher in `FETCHERS`.

### Adding Support for More Pages

**A hand-written page** (no database row behind it) is one entry in
`STATIC_PAGES`, keyed by path — see `/promote`.

**An entity page** takes three steps:

1. **Match the URL** in `extractMetadata()`. Anchor the pattern so a sub-route
   cannot claim the parent's card:
   ```javascript
   const postMatch = urlPath.match(/^\/forum\/post\/(\d+)\/?$/);
   if (postMatch) return { type: 'forumPost', id: postMatch[1] };
   ```

2. **Write a fetcher** returning tags, a `body`, and `jsonLd`:
   ```javascript
   const fetchPostMetadata = async (postId) => {
       const posts = await pool.query('SELECT ... WHERE id = ? LIMIT 1', [postId]);
       if (!posts || posts.length === 0) return null;
       const post = posts[0];
       return {
           title: post.title,
           description: toPlainText(post.content),
           image: post.image_url || FALLBACK_IMAGE,
           url: `/post/${post.id}`,
           type: 'article',
           body: { heading: post.title, paragraphs: [toPlainText(post.content, 1500)] },
           jsonLd: (base) => ({ '@context': 'https://schema.org', /* ... */ }),
       };
   };
   ```
   Return `null` for anything that should not be described — a missing row, or a
   private one. The caller falls back to the generic site card.

3. **Register it** in `FETCHERS`. `server.js` needs no change; it dispatches
   through `fetchMetadata()` rather than branching per type.

Include a `body` unless there is genuinely nothing to say. A page without one
is a page the assistant crawlers cannot read.

## Detected Crawler User Agents

Matched as substrings of a lowercased User-Agent, so `claudebot` also covers
`ClaudeBot/1.0`. Two lists, for the two audiences described above.

`SHARE_CRAWLER_AGENTS` — Facebook and Meta, Twitter, LinkedIn, WhatsApp,
Telegram, Discord, Pinterest, Slack, Reddit, Mastodon, Bluesky, Embedly,
Googlebot, Bingbot, Yahoo, Yandex, Baidu, Applebot, DuckDuckBot, Archive.org,
and curl/wget/python-requests for testing.

`AI_CRAWLER_AGENTS` — OpenAI (`gptbot`, `oai-searchbot`, `chatgpt-user`),
Anthropic (`claudebot`, `claude-web`, `claude-user`, `claude-searchbot`,
`anthropic-ai`), Perplexity (`perplexitybot`, `perplexity-user`), Common Crawl
(`ccbot`), plus `amazonbot`, `bytespider`, `youbot`, `diffbot`, `cohere-ai`,
`mistralai-user` and `timpibot`.

The same agents are named explicitly in the `robots.txt` served from
`backend/routes/sitemap.js`, along with the opt-out-only `Google-Extended` and
`Applebot-Extended` tokens.

## Testing

### Test with curl (simulates a crawler):
```bash
# A share crawler: check the tags.
curl -H "User-Agent: facebookexternalhit/1.1" http://localhost:3001/song/123

# An assistant crawler: check that real content comes back in the body.
curl -H "User-Agent: GPTBot/1.2" http://localhost:3001/song/123
curl -H "User-Agent: ClaudeBot/1.0" http://localhost:3001/promote
```

### Test with regular browser (no injection):
```bash
curl http://localhost:3001/song/123
```

### Check OG tags in response:
```bash
curl -H "User-Agent: facebookexternalhit/1.1" http://localhost:3001/song/123 | grep "og:"
```

### Check the crawler body:
```bash
curl -H "User-Agent: GPTBot/1.2" http://localhost:3001/song/123 | grep -A 20 'id="root"'
```

## React Helmet Configuration

The frontend still uses React Helmet for:
- Client-side navigation between pages
- Non-crawler browsers
- Dynamic content updates after page load

The server-side OG injection complements (not replaces) React Helmet.

## Performance Considerations

- **Caching**: `fetchMetadata()` caches per entity for 15 minutes, holding the
  in-flight promise so a burst of parallel crawlers shares one round of queries
  rather than each running its own. This matters more than it used to: the
  assistant crawlers walk the sitemap, which is one request per song in the
  catalogue, and several of them do it independently.
- **Database Optimization**: Ensure indexes exist on `songs.id`, `users.username`, etc.
- **Query Optimization**: The metadata queries only fetch essential fields to minimize database load

## Troubleshooting

### OG tags not appearing for a crawler:
1. Check that the User-Agent is in the `CRAWLER_AGENTS` list
2. Verify the URL pattern matches in `extractMetadata()`
3. Check database queries return results
4. Review server logs for errors

### Regular users seeing injected tags:
- This should not happen; only crawlers with matching User-Agents receive injected tags
- Regular browsers get the original HTML and rely on React Helmet

## Files Modified

- `/backend/middleware/ogMetaTags.js` - Main middleware logic
- `/backend/server.js` - Integration with Express app
- `/frontend/public/index.html` - No changes needed (still uses React Helmet)
