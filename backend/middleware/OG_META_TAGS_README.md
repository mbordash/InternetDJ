# OG Metatags for Social Media Crawlers

## Overview

This solution injects Open Graph (OG) metatags server-side for social media crawlers (Facebook, Twitter, LinkedIn, WhatsApp, etc.) that don't execute JavaScript.

## How It Works

1. **Crawler Detection**: The middleware detects crawlers by analyzing the User-Agent header
2. **URL Parsing**: Extracts resource IDs (songId, username) from the URL path
3. **Data Fetching**: Queries the database for the resource metadata
4. **HTML Injection**: Injects OG metatags into the HTML `<head>` before serving to crawlers
5. **Normal Users**: Regular browser requests receive the standard HTML (client-side React Helmet handles OG tags)

## Supported Pages

### Currently Implemented
- **Song Pages** (`/song/:songId`)
  - Fetches title, description, image, and profile information
  - Sets `og:type` to `music.song`
  
- **Profile Pages** (`/profile/:username`)
  - Fetches username, bio, and avatar
  - Sets `og:type` to `profile`

### Adding Support for More Pages

To add OG metatag support for additional pages:

1. **Add URL pattern extraction** in `ogMetaTags.js`:
   ```javascript
   const postMatch = urlPath.match(/\/post\/(\d+)/);
   if (postMatch) {
       return { type: 'post', id: postMatch[1] };
   }
   ```

2. **Create a metadata fetching function**:
   ```javascript
   const fetchPostMetadata = async (postId) => {
       try {
           const [posts] = await pool.query(`
               SELECT id, title, content, image_url
               FROM posts WHERE id = ?
           `, [postId]);
           
           if (!posts || posts.length === 0) return null;
           
           const post = posts[0];
           return {
               title: post.title,
               description: post.content.substring(0, 160),
               image: post.image_url || '/default.jpg',
               url: `/post/${post.id}`,
               type: 'article',
           };
       } catch (err) {
           logger.error('Error fetching post metadata:', err);
           return null;
       }
   };
   ```

3. **Handle the new type** in `server.js`:
   ```javascript
   let ogMetadata = null;
   if (metadata.type === 'song') {
       ogMetadata = await fetchSongMetadata(metadata.id);
   } else if (metadata.type === 'profile') {
       ogMetadata = await fetchProfileMetadata(metadata.id);
   } else if (metadata.type === 'post') {
       ogMetadata = await fetchPostMetadata(metadata.id);
   }
   ```

## Detected Crawler User Agents

The following crawlers are detected and served with OG metatags:
- Facebook (`facebookexternalhit`)
- Twitter (`twitterbot`)
- LinkedIn (`linkedinbot`)
- WhatsApp (`whatsapp`)
- Telegram (`telegram`)
- Pinterest (`pinterest`)
- Slurp (Yahoo)
- Google (`googlebot`)
- Bing (`bingbot`)
- Yandex
- Baidu (`baiduspider`)
- Archive.org (`ia_archiver`)
- curl/wget/Python requests (useful for testing)

## Testing

### Test with curl (simulates a crawler):
```bash
curl -H "User-Agent: facebookexternalhit/1.1" http://localhost:3001/song/123
```

### Test with regular browser (no injection):
```bash
curl http://localhost:3001/song/123
```

### Check OG tags in response:
```bash
curl -H "User-Agent: facebookexternalhit/1.1" http://localhost:3001/song/123 | grep "og:"
```

## React Helmet Configuration

The frontend still uses React Helmet for:
- Client-side navigation between pages
- Non-crawler browsers
- Dynamic content updates after page load

The server-side OG injection complements (not replaces) React Helmet.

## Performance Considerations

- **Caching**: Consider adding Redis caching for frequently accessed metadata
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
