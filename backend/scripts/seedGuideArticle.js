/**
 * Seeds the site's first original article.
 *
 *   node backend/scripts/seedGuideArticle.js
 *
 * Idempotent on slug: re-running refreshes the text rather than adding a second
 * copy. It goes in as 'published' with an explicit byline, because it is
 * editorial content written for the site rather than a member submission
 * waiting on review.
 *
 * Kept as a script instead of pasted through the submission form so the text
 * lives in version control, where it can be diffed and corrected, rather than
 * only in a database row.
 */
const pool = require('../config/database');
const { out, errOut, finish } = require('../utils/cli');
const { sanitizeArticleHtml, articleHtmlToText } = require('../utils/articleHtml');

const SLUG = 'how-to-promote-your-electronic-music-in-2026';
const TITLE = 'How to Promote Your Electronic Music in 2026';
const DECK = 'The tactics that worked in 2019 mostly do not any more. Here is what actually moves a track now.';
const AUTHOR = 'Michael Bordash';
const CATEGORY = 'guides';
// Served from frontend/public, so it ships with the build rather than living in
// object storage: it is drawn artwork committed alongside the article text, and
// the two should version together.
const HERO = '/images/articles/promote-electronic-music-2026.svg';

const BODY = `
<p>Every year the advice about promoting music gets louder and less useful. Post more. Be consistent. Build your brand. None of it tells you what to actually do on a Tuesday afternoon with a finished track and no audience.</p>

<p>So here is a straight account of what works now, in 2026, for an independent electronic producer with no label, no budget and no existing following. Some of it is unglamorous. Most of the popular advice is missing from it, and that is deliberate.</p>

<h2>What changed</h2>

<p>Three things happened over the last few years that broke the old playbook.</p>

<p><b>The feed stopped being a discovery engine.</b> Short-form video was a genuine opportunity in 2020 and 2021. It is now a lottery with worse odds and a much higher production cost. Producers who post daily clips for a year and end up with four thousand passive followers and no listeners are the norm, not the exception. The follower count was never the thing you wanted.</p>

<p><b>Generated music flooded the low end of every platform.</b> The practical effect is not that AI tracks are competing with yours on quality. It is that the sheer volume has made every algorithmic recommendation system more conservative. Platforms lean harder on signals they trust (existing engagement, editorial curation, established artists), which means an unknown track has a narrower path than it did.</p>

<p><b>Listeners retreated into smaller rooms.</b> Discords, group chats, newsletters, forums, small label communities. The open internet got noisier so people went somewhere quieter. That is where taste is actually being formed now, and it is not somewhere you can advertise your way into.</p>

<blockquote>The uncomfortable conclusion: broadcasting to strangers has got harder, and being known by a small number of the right people has got more valuable.</blockquote>

<h2>Get the track heard by people who make music</h2>

<p>Before you promote anything, find out whether the track is finished. Not whether you are tired of it. Whether it is finished.</p>

<p>The fastest way is to put it in front of other producers and ask for specifics. Not "what do you think", which gets you "sounds good man", but "does the low end translate on your monitors" and "does the breakdown run too long". A producer who has spent six hours on their own mixdown this week will hear things in yours that no amount of solo listening will surface.</p>

<p>This is unglamorous and it is the single highest-return thing on this list. A track that is 15% better converts a first listen into a second listen, and everything that follows from that (the playlist add, the DJ support, the follow) starts with someone listening twice.</p>

<p>Return the favour properly. The producers who get useful feedback are the ones who give it. Leave real reviews on other people's tracks, in words, and the same people will do it for you.</p>

<h2>Release strategy that matches how people listen</h2>

<p>Singles, spaced out. An album from an unknown artist is a large ask of a stranger and it uses up your entire release in one moment. Four singles across a year gives you four chances to be found and four sets of material to talk about.</p>

<p>Give yourself three to four weeks between finishing a track and releasing it. Not to build hype, but to give yourself time to send it to people. Nearly all the useful promotion for a small release happens before it comes out and almost none of it happens after.</p>

<p>In those weeks:</p>

<ul>
<li>Send private links to DJs who play your genre. Not a mass email. Ten specific people whose sets you have actually heard, with one sentence about why you think it fits what they play.</li>
<li>Send it to the small labels in your niche, even when you are not asking to be signed. Label owners are the most connected listeners in any scene.</li>
<li>Ask three producers you trust for a last-pass listen while it can still be changed.</li>
<li>Get it registered and get your metadata right. Wrong or missing credits are how royalties quietly fail to arrive.</li>
</ul>

<h2>Where to put it</h2>

<p>Put your music in more than one place, and understand what each place is for.</p>

<p><b>Streaming platforms are a destination, not a discovery tool.</b> Your track should be on them because that is where people go when they have already heard your name. Expect nothing else from them at your size. Pitching editorial playlists is worth the ten minutes it takes and is not worth building a strategy around.</p>

<p><b>Paid playlist placement is a waste of money.</b> The plays are real in the sense that a number goes up. They come from accounts that do not care, they do not convert to anything, and platforms are increasingly good at spotting them. If someone guarantees placements, they are selling you a number.</p>

<p><b>Download and DJ platforms matter more than their traffic suggests</b> if you make club music, because the people buying there are the people who will play your record to a room.</p>

<p><b>Community sites are where feedback and early listeners come from.</b> That is what InternetDJ is for: publish the track, get written critique from other producers, and end up on a page that search engines index under your name and your genre. It costs nothing and you keep every right to the music.</p>

<h2>Build something you own</h2>

<p>Every platform in the previous section can change its rules tomorrow. Producers who built entirely on one feed have been reset to zero more than once.</p>

<p>So keep a direct line to the people who actually like your music. An email list of two hundred people who chose to be there is worth more than twenty thousand passive followers, and it is worth more precisely because it is smaller: those two hundred opened something, which no algorithm decided for them.</p>

<p>You do not need a newsletter strategy. You need a way for someone who liked a track to hear about the next one. Collect addresses, send something when you release, do not send anything else.</p>

<h2>The part nobody wants to hear</h2>

<p>Promotion cannot fix an audience problem that is really a music problem, and it cannot make three years happen in three months.</p>

<p>The producers who break through from nothing almost always have the same unremarkable story: they released consistently for a couple of years, they were genuinely present in one scene rather than shouting at all of them, and they got better in public. There is no version of this where a tactic replaces that.</p>

<p>What promotion can do is make sure that when the music is good, it is not invisible. That is a real and worthwhile job. It is just a smaller one than the industry that sells promotion would like you to believe.</p>

<h2>The short version</h2>

<ul>
<li>Get real critique from other producers before you release anything.</li>
<li>Release singles, spaced out, and do the work in the weeks before release rather than after.</li>
<li>Send personal messages to ten specific people instead of a mass email to a thousand.</li>
<li>Be on the streaming platforms; expect nothing from them.</li>
<li>Never pay for playlist placement.</li>
<li>Be genuinely present in one community rather than posting into five.</li>
<li>Own a direct line to your listeners that no platform controls.</li>
<li>Keep making music. It is still the largest variable by a distance.</li>
</ul>
`;

(async () => {
    try {
        const bodyHtml = sanitizeArticleHtml(BODY);
        const bodyText = articleHtmlToText(bodyHtml);

        if (!bodyHtml || bodyText.length < 1000) {
            errOut(`Refusing to seed: body came out at ${bodyText.length} characters.`);
            await finish(1);
            return;
        }

        // The byline is attached to a real profile where one exists, so the
        // article links to its author's page like any other.
        const profiles = await pool.query(
            'SELECT id FROM profiles WHERE name = ? ORDER BY id LIMIT 1', [AUTHOR]);
        const profileId = profiles.length ? profiles[0].id : null;

        const result = await pool.query(
            `INSERT INTO articles
                (slug, title, deck, body_html, body_text, category, category_slug,
                 author_name, profile_id, hero_image_url, published_at, status, is_legacy)
             VALUES (?, ?, ?, ?, ?, 'Guides', ?, ?, ?, ?, CURRENT_DATE, 'published', FALSE)
             ON DUPLICATE KEY UPDATE
                title = VALUES(title), deck = VALUES(deck),
                body_html = VALUES(body_html), body_text = VALUES(body_text),
                category = VALUES(category), category_slug = VALUES(category_slug),
                author_name = VALUES(author_name), profile_id = VALUES(profile_id),
                hero_image_url = VALUES(hero_image_url)`,
            [SLUG, TITLE, DECK, bodyHtml, bodyText, CATEGORY, AUTHOR, profileId, HERO]
        );

        out(`Seeded "${TITLE}"`);
        out(`  slug      : /articles/${SLUG}`);
        out(`  category  : Guides`);
        out(`  byline    : ${AUTHOR}${profileId ? ` (profile ${profileId})` : ' (no matching profile)'}`);
        out(`  body      : ${bodyText.length} characters of text`);
        out(`  ${Number(result.affectedRows) === 1 ? 'inserted' : 'updated in place'}`);
        out(`  artwork   : ${HERO}`);
    } catch (err) {
        errOut(`Failed to seed the guide: ${err.message}`);
        errOut(err.stack);
        await finish(1);
        return;
    }

    await finish(0);
})();
