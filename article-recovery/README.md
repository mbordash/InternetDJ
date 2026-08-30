# InternetDJ.com article recovery

A manifest of the editorial articles published on the old InternetDJ.com
(2002–2017), recovered from the Internet Archive. The articles themselves are
not in this directory — the manifest is the map that lets a fetcher go get them.

## Where the content actually is

**Not on GitHub.** `mbordash/InternetDJ.com` was searched exhaustively: every
blob in all 363 commits of history, including files added and later deleted, was
scanned for MySQL dump signatures. The only matches are phpMyAdmin's own
documentation and its SQL export library. No database dump was ever committed,
so the article text is not recoverable from git.

The repo history is still useful for a different reason: it contains the
article-era CMS source (a PHP-Nuke derivative), which is what establishes the
URL scheme the manifest relies on.

**The Internet Archive has the articles.** Verified end to end: a fetch of an
archived page yields the headline, the editorial deck, the byline and date, the
category breadcrumb, and the complete body text.

## The manifest

`idj_articles_manifest.csv` / `.json` — 1,524 unique articles.

| column | meaning |
| --- | --- |
| `kind` | `slug` for the pretty-URL era, `storyid` for the older query-string era |
| `id` | the CMS story id, where known |
| `slug` | the pretty URL slug, for `kind=slug` rows |
| `timestamp` | the Wayback capture chosen — the most recent successful one |
| `wayback` | a direct fetch URL, already in `id_` raw form (no Archive chrome) |

Two publishing eras are folded together here. `article.php?storyid=N` ran
roughly 2002–2012; pretty `/article/<slug>` URLs ran roughly 2010–2017 and
usually end in the same story id, which is what allows the two to be
de-duplicated. 679 rows come from pretty URLs, 845 from story ids that never
got a pretty-URL capture.

Coverage is continuous, every year from 2002 to 2017, with a peak around
2005–2011.

## Not included

The 1998–2001 site was a different thing: an ASP application built around a DJ
database (`/djdb`) and artist pages with user reviews (`/archive`). It had no
editorial articles section, so there is nothing from that era in this manifest.

## The pipeline

Four steps. The last three are idempotent, so a partial run is safe to repeat.

```bash
# 1. Fetch the archived pages (long-running; resumable, see below)
python3 article-recovery/scrape.py

# 2. Retry whatever failed, against alternate snapshots
python3 article-recovery/scrape.py --repair

# 3. Create the table (also runs automatically on deploy, via fly release_command)
node backend/scripts/migrateArticles.js

# 4. Load the results
node backend/scripts/importArticles.js article-recovery/articles.jsonl --dry-run
node backend/scripts/importArticles.js article-recovery/articles.jsonl
```

### About the crawl

It is slow, and that is not fixable. The archive answers in five to ten seconds
per page and refuses connections above roughly two in flight; running it at
three and at eight workers were both **slower** than serial, because once it
starts refusing it keeps refusing and every fetch then pays a backoff. The
crawler runs one request at a time for that reason. Budget several hours for the
full manifest.

Two things make that tolerable:

- **It resumes.** Results are appended to `articles.jsonl` as they arrive, and a
  re-run skips anything already in the file. Interrupt it freely.
- **It fetches the good material first.** Anything whose slug reads like an
  interview or names a well-known act is queued ahead of routine news, so the
  archive is worth importing long before the crawl finishes.

`importArticles.js` matches on slug and updates in place, so re-running it after
more of the crawl completes tops up the table rather than duplicating it. It
only overwrites rows still flagged `is_legacy`, so an article edited on the
current site is never clobbered by a re-import.

### Quality gate

The import rejects records that came back too thin to be an article (under 200
characters of body text) and ones whose title is the site's own `<title>` rather
than a headline, which is what a broken capture yields. Expect roughly one in
eight to be dropped this way.

### Categories

Everything is mapped onto five: News, Interviews, Features, Reviews and Guides.
The old CMS drifted between labels for the same section and reused topic ids
inconsistently, so neither its category strings nor its topic numbers are
trusted on their own - headline shape decides the two that matter, since the old
site filed interviews under whichever topic the artist belonged to rather than
under an interview topic. **Guides** is not a legacy category; it exists for the
how-to writing the site publishes now.

## Notable recoveries

Ten original InternetDJ interviews, including Armin van Buuren, Pendulum, The
Crystal Method, Faithless, Swedish House Mafia, Mauro Picotto and Yahel Sherman.
Roughly 108 further articles cover named acts (Carl Cox, Paul van Dyk, Daft
Punk, Tiësto, deadmau5, Ferry Corsten and others).

## Before republishing

Articles carry bylines — "Posted by Nelo", and others. Whatever the arrangement
was with those writers, the attribution is in the archived HTML and should be
carried across with the text rather than dropped.
