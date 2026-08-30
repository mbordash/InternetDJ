#!/usr/bin/env python3
"""
Fetch the archived InternetDJ.com articles named in the manifest.

The old site went through four visibly different templates between 2001 and
2017, and the first version of this script tried to recognise each one by its
body container. That failed repeatedly: the container is a <font> in 2001, a
<div> with an inline font-size in 2005, a <span> with a *different* inline
font-size in 2011, and a Bootstrap column in 2016. Every new era meant another
brittle selector.

So the body is not located by its container at all. Across all four templates
the article text is bounded by two things that *are* stable: it starts right
after the byline ("Written by ...", "by ...", "Posted by ... on ..."), and it
ends at the furniture that follows every article - the comments heading, the
register callout, the related-links block or the footer. Finding those two
offsets and taking what lies between is template-agnostic, and it is what this
script does.

Output is JSONL, one article per line, appended as it goes: the run takes half
an hour against a third-party archive, and a crash at article 1400 should not
mean starting over. Re-running skips whatever is already in the file.
"""

import json, re, os, time, html as htmllib, urllib.request, urllib.error, urllib.parse, threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, 'idj_articles_manifest.json')
OUT = os.path.join(HERE, 'articles.jsonl')
FAILED = os.path.join(HERE, 'failed.jsonl')

# One request at a time.
#
# This was tried at eight workers and then three, and both were slower than
# serial - archive.org refuses the connection outright above roughly two in
# flight, and once it starts refusing it keeps refusing for a while, so every
# subsequent fetch pays a backoff. Sequentially the same host answers in a few
# hundred milliseconds. Concurrency here is not a speed-up available to us; it
# is a way to get rate-limited into taking hours.
WORKERS = 1
DELAY = 0.5
MAX_RETRIES = 2
TIMEOUT = 60
UA = 'InternetDJ-article-recovery/1.0 (restoring our own archived content)'

# --repair: retry previously failed rows against alternate captures.
REPAIR = '--repair' in os.sys.argv

# Below this many characters of text, a record is not an article. Shared by
# the repair trigger and the thin-record tally so the two cannot drift.
MIN_BODY_CHARS = 120


# ---------------------------------------------------------------- fetching

def decode(raw):
    """Bytes to text, without trusting the declared charset.

    The archive serves every one of these pages as charset=utf-8, and for the
    older ones that is simply wrong: they were authored in Windows-1252, so a
    curly quote is a single 0x93 byte rather than a UTF-8 sequence. Decoding
    them as UTF-8 with errors='replace' does not fail - it quietly turns every
    apostrophe and quotation mark in the article into a replacement character.
    A third of the first batch came out full of them.

    So UTF-8 is tried strictly, and anything that is not valid UTF-8 is treated
    as cp1252, which is what these pages actually are. cp1252 is chosen over
    latin-1 because it is the encoding that has the smart quotes and dashes in
    the 0x80-0x9F range, which is exactly the range that was breaking.
    """
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1252', 'replace')


def fetch_once(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return decode(r.read())


def fetch(url):
    """Retry, including on 404.

    A 404 from the Wayback Machine does not reliably mean the capture is gone.
    It hands them out under load for URLs that serve fine a minute later - the
    Armin van Buuren interview 404'd on one pass and returned in full on the
    next. Treating 404 as fatal silently dropped real articles.
    """
    last = None
    for attempt in range(MAX_RETRIES):
        try:
            return fetch_once(url)
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code}'
            if e.code == 403:
                break
            time.sleep(min(20, 2 * (attempt + 1) ** 2))
        except Exception as e:
            last = str(e)[:120]
            # A refused connection is the rate limiter, not a broken URL, so it
            # is worth waiting out rather than burning the attempt quickly.
            refused = 'refused' in last.lower() or 'reset' in last.lower()
            time.sleep(min(45, (8 if refused else 2) * (attempt + 1) ** 2))
    raise RuntimeError(last or 'unknown fetch failure')


def other_captures(original_url, exclude_ts, limit=2):
    """Alternate snapshots of the same page, newest first."""
    q = ('http://web.archive.org/cdx/search/cdx?url=' + urllib.parse.quote(original_url, safe='')
         + '&output=json&filter=statuscode:200&fl=timestamp&limit=-6')
    try:
        data = json.loads(fetch_once(q))[1:]
    except Exception:
        return []
    seen = [d[0] for d in data if d[0] != exclude_ts]
    return list(dict.fromkeys(reversed(seen)))[:limit]


# ---------------------------------------------------------------- helpers

def strip_tags(s):
    s = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', s)
    s = re.sub(r'(?s)<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', htmllib.unescape(s)).strip()


def meta(s, name, attr='name'):
    m = re.search(r'<meta[^>]+%s=["\']%s["\'][^>]+content=["\'](.*?)["\']' % (attr, name), s, re.I | re.S)
    if not m:
        m = re.search(r'<meta[^>]+content=["\'](.*?)["\'][^>]+%s=["\']%s["\']' % (attr, name), s, re.I | re.S)
    return htmllib.unescape(m.group(1)).strip() if m else ''


def clean_body(frag):
    """Keep the prose and the media; drop the furniture."""
    frag = re.sub(r'(?is)<(script|style|noscript|form|iframe)[^>]*>.*?</\1>', ' ', frag)
    frag = re.sub(r'(?is)<ins[^>]*adsbygoogle.*?</ins>', ' ', frag)
    frag = re.sub(r'(?is)<div[^>]*class=["\'][^"\']*(addthis|sharethis|tools_container|breadcrumb|calloutblue|left_side|right_side)[^"\']*["\'][^>]*>.*?</div>', ' ', frag)
    frag = re.sub(r'(?is)<ul[^>]*class=["\']tools["\'].*?</ul>', ' ', frag)
    # Wayback rewrites every asset onto its own host; point them back at the
    # original so the importer can decide what to re-host.
    frag = re.sub(r'https?://web\.archive\.org/web/\d+(?:id_|im_)?/', '', frag)
    frag = re.sub(r'(?i)\s(?:style|border|align|width|height|class|id|onclick|hspace|vspace|target)=(["\']).*?\1', '', frag)
    allowed = r'p|br|b|strong|i|em|u|a|ul|ol|li|blockquote|h2|h3|h4|img|figure|figcaption|hr|pre|code'
    frag = re.sub(r'(?is)</?(?!(?:%s)\b)[a-z][a-z0-9]*[^>]*>' % allowed, ' ', frag)
    frag = re.sub(r'(?is)(\s*<br\s*/?>\s*){3,}', '<br /><br />', frag)
    frag = re.sub(r'(?is)<p>\s*</p>', ' ', frag)
    return re.sub(r'\s{2,}', ' ', frag).strip()


# ------------------------------------------------------------ byline / body

# Ordered most specific first.
#
# Named groups rather than positional ones, because the templates do not agree
# on the order: the 2006 "nifty" layout prints the date immediately after the
# headline and the byline several tags later, while every other template puts
# the author first. Positional groups forced a pattern per ordering and quietly
# failed on the odd one out.
BYLINE_PATTERNS = [
    # 2016 Bootstrap: <h3>Posted by <a>Nelo</a> on Thu Jul 21, 2016</h3>.
    # Any heading level - the same rebuild used <h3> on some pages and <h4> on
    # others, and pinning it to <h3> silently lost every page that used <h4>.
    re.compile(r'(?is)<h[1-6][^>]*>\s*Posted\s*by\s*(?P<author>.*?)\s*on\s*(?P<date>.{4,40}?)\s*</h[1-6]>'),
    # 2011: <p ...>Posted by <a href="/user/michael">Michael Bordash</a> on Tuesday, December 06 2011</p>
    re.compile(r'(?is)<p[^>]*>\s*Posted\s*by\s*(?P<author>.*?)\s*on\s*(?P<date>.{4,40}?)\s*</p>'),
    # 2006 "nifty": headline, then <br>date<br><br>, then
    # <font class="special">Written by Michael Bordash</font>. Date first.
    re.compile(r'(?is)<br\s*/?>\s*(?P<date>[A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2}\s+\d{4})\s*'
               r'<br\s*/?>.{0,200}?Written by\s*(?P<author>[^<]{2,60})'),
    # 2009: <p ...font-size: 12px...>Press Release Posted by Michael Bordash<br>
    # Thursday, December 10 2009</p>. Two differences from the 2011 form above:
    # a <br> separates author from date instead of the word "on", and the line
    # may open with a prefix such as "Press Release".
    re.compile(r'(?is)<p[^>]*font-size:\s*12px[^>]*>[^<]{0,40}?Posted by\s*'
               r'(?P<author>[^<]{2,60})<br\s*/?>\s*(?P<date>.{4,40}?)\s*</p>'),
    # 2001 classic: <font size="2">Written by <a>internetdj</a></font><br>Saturday, August 18 2001<br>
    re.compile(r'(?is)<font[^>]*>\s*Written by\s*(?P<author>.*?)</font>\s*<br\s*/?>\s*(?P<date>.{4,40}?)\s*<br'),
    # 2005: <p ...> by <a>nelo</a> & <a>risda</a> ... <br>Monday, September 12 2005 </p>
    re.compile(r'(?is)<p[^>]*font-size:\s*12px[^>]*>\s*by\s*(?P<author>.*?)<br\s*/?>\s*(?P<date>.{4,40}?)\s*</p>'),
    # Last resort: a bare "Written by NAME" anywhere, with no date attached.
    # Recovers the byline on pages whose date sits somewhere this list does not
    # reach; parse_date simply returns None and the article still imports.
    re.compile(r'(?is)Written by\s*(?P<author>[^<]{2,60})'),
]

# Everything that reliably follows the article text on one template or another.
END_MARKERS = [
    r'<h3>\s*Article Comments', r'Article Comments', r'class=["\']calloutblue',
    r'Related links', r'<h3>\s*Comments', r'Post a comment', r'printer[- ]friendly',
    r'<div class=["\']col-md-[34]', r'<footer', r'</body>',
]
END_RE = re.compile('(?is)(' + '|'.join(END_MARKERS) + ')')

# Where the article text starts, for the templates that put furniture between
# the byline and the body.
#
# This is not a nicety. On the 2001-2006 pages the byline is followed by a
# share-and-print toolbar - "Send this Story to a Friend", "Printer Friendly
# Page" - and only then the article. "Printer Friendly" is also a perfectly good
# end-of-article marker on other templates, where the same toolbar sits at the
# foot. Slicing from the byline to the first end marker therefore captured 354
# characters of toolbar links and stopped, which is why four out of five
# storyid-era articles came back empty while the slug-era ones were fine.
#
# So: if a recognisable body container opens shortly after the byline, start
# there and let the toolbar fall behind us.
BODY_OPENERS = [
    r'<font class=["\']content["\'] color=["\']#505050["\']>',   # 2001-2006 tables
    r'<span[^>]*font-size:\s*1[46]px[^>]*>',                     # 2011 layout
    r'<div[^>]*font-size:\s*1[46]px[^>]*>',                       # 2005 layout
    r'<div class=["\']col-md-\d+["\']>',                           # 2016 Bootstrap (col-md-8 or -9)
    # 2006 "nifty": no wrapper around the article at all. The headline, byline
    # and toolbar share one table, and the prose simply follows it closing.
    r'</td>\s*</tr>\s*</table>\s*<br\s*/?>',
]
BODY_OPEN_RE = re.compile('(?is)(' + '|'.join(BODY_OPENERS) + ')')

# How far past the byline to look for that opener. Wide enough to clear a
# toolbar and a thumbnail, narrow enough not to skip into the next article in a
# sidebar listing.
BODY_OPENER_WINDOW = 3000


def find_byline(s):
    for pat in BYLINE_PATTERNS:
        m = pat.search(s)
        if not m:
            continue
        seg = m.groupdict().get('author') or ''
        datetxt = m.groupdict().get('date') or ''
        names = re.findall(r'(?is)(?:uname=|/user/)([A-Za-z0-9_\-\.]+)', seg)
        if names:
            seen, uniq = set(), []
            for n in names:
                if n.lower() not in seen:
                    seen.add(n.lower()); uniq.append(n)
            author = ' & '.join(uniq)
            # A display name inside the link beats the username slug.
            disp = strip_tags(seg)
            if disp and len(disp) < 60 and not disp.lower().startswith('http'):
                author = disp
        else:
            author = strip_tags(seg)
        return author.strip(' &'), strip_tags(datetxt), m.end()
    return '', '', None


def find_body(s, start):
    """The text between the byline and whatever furniture follows it."""
    if start is None:
        return ''
    rest = s[start:]
    opener = BODY_OPEN_RE.search(rest[:BODY_OPENER_WINDOW])
    if opener:
        rest = rest[opener.end():]
    m = END_RE.search(rest)
    frag = rest[:m.start()] if m else rest[:60000]
    return clean_body(frag)


def find_title(s):
    # 2006 "nifty" headline. Checked before <h1> because these pages have no
    # <h1> at all and would otherwise fall through to <title>, which on this
    # template is the site name and gets rejected by the importer.
    m = re.search(r'(?is)<font class=["\']speciallarger["\']>(.*?)</font>', s)
    if m:
        t = strip_tags(m.group(1))
        if t:
            return t

    m = re.search(r'(?is)<h1[^>]*>(.*?)</h1>', s)
    if m:
        inner = re.sub(r'(?is)<small>.*?</small>', '', m.group(1))
        t = strip_tags(inner)
        if t:
            return t
    # The classic table layout has no <h1>; its headline is the last header
    # cell before the byline.
    _, _, pos = find_byline(s)
    if pos:
        # The header cell pads its headline with &nbsp; entities, which \s does
        # not match. Requiring <b> to follow the tag with only whitespace
        # between meant the headline was skipped on every 2001-2003 page and
        # the title fell back to <title>, which on those pages is the site
        # name - so 97 perfectly good articles were being discarded by the
        # importer's junk-title check for want of one character class.
        heads = [(mm.start(), mm.group(1)) for mm in
                 re.finditer(r'(?is)<font class=["\']content["\'] color=["\']#848284["\']>'
                             r'(?:\s|&nbsp;|&#160;)*<b>(.*?)</b>\s*</font>', s)]
        before = [h for h in heads if h[0] < pos]
        if before:
            inner = before[-1][1]
            # The headline is prefixed with a link to its category, rendering
            # as "Other: A Union of Diversity". That prefix is navigation, not
            # part of the title. Matched on the categories.php link specifically
            # so a real title of the form "Interview: ..." is left alone.
            inner = re.sub(r'(?is)^\s*<a[^>]*categories\.php[^>]*>.*?</a>\s*:\s*', '', inner)
            title = strip_tags(inner)
            if title:
                return title
    m = re.search(r'(?is)<h2[^>]*>(.*?)</h2>', s)
    if m:
        t = strip_tags(m.group(1))
        # An <h2> that is the category breadcrumb, not the headline.
        if t and '>' not in t and len(t) > 3:
            return t
    m = re.search(r'(?is)<title>(.*?)</title>', s)
    if not m:
        return ''
    # These pages title themselves "Headline - InternetDJ.com"; the suffix is
    # site furniture, not part of the headline.
    return re.sub(r'\s*[-|]\s*InternetDJ\.com\s*$', '', strip_tags(m.group(1)), flags=re.I)


def find_deck(s):
    m = re.search(r'(?is)<h1[^>]*>.*?<small>(.*?)</small>.*?</h1>', s)
    if m:
        return strip_tags(m.group(1))
    m = re.search(r'(?is)<p class=["\']lead["\']>(.*?)</p>', s)
    if m:
        return strip_tags(m.group(1))
    return meta(s, 'description')


def find_category(s):
    m = re.search(r'(?is)<li class=["\']active["\']>\s*<a[^>]*>(.*?)</a>', s)
    if m:
        return strip_tags(m.group(1))
    m = re.search(r'(?is)<h2[^>]*>.*?topics?\.php\?topic=\d+["\'][^>]*>(.*?)</a>', s)
    if m:
        return strip_tags(m.group(1))
    m = re.search(r'(?is)Alt=["\'](DJ News|Music News|Reviews?|Interviews?|Features?|Guides?)["\']', s)
    return strip_tags(m.group(1)) if m else ''


DATE_FORMATS = [
    '%a %b %d, %Y', '%A, %B %d %Y', '%A, %B %d, %Y', '%B %d, %Y', '%B %d %Y',
    '%a, %d %b %Y', '%d %B %Y', '%Y-%m-%d', '%A %B %d %Y',
]


def parse_date(text):
    if not text:
        return None
    t = re.sub(r'\s+', ' ', text).strip().strip(',')
    t = re.sub(r'(\d)(st|nd|rd|th)\b', r'\1', t, flags=re.I)
    for f in DATE_FORMATS:
        try:
            return datetime.strptime(t, f).strftime('%Y-%m-%d')
        except ValueError:
            pass
    m = re.search(r'\b(19|20)\d{2}\b', t)
    return f'{m.group(0)}-01-01' if m else None


def hero_image(s):
    for pat in (r'(?i)src=["\']([^"\']*?/images/articles/[^"\']+)["\']',
                r'(?i)src=["\']([^"\']*?thumb\.php\?src=[^"\']*articles[^"\']+)["\']'):
        m = re.search(pat, s)
        if not m:
            continue
        u = htmllib.unescape(m.group(1).strip())
        u = re.sub(r'https?://web\.archive\.org/web/\d+(?:id_|im_)?/', '', u)
        if 'default_article' in u:
            return None
        if u.startswith('//'):
            return 'http:' + u
        if u.startswith('/'):
            return 'http://www.internetdj.com' + u
        return u
    return None


def extract(s):
    author, date_text, pos = find_byline(s)
    return {
        'title': find_title(s),
        'deck': find_deck(s),
        'author': author or meta(s, 'author'),
        'date_text': date_text,
        'published_on': parse_date(date_text),
        'category': find_category(s),
        'hero_image': hero_image(s),
        'body_html': find_body(s, pos),
        'keywords': meta(s, 'keywords'),
        'topic_id': int(re.search(r'topics?\.php\?topic=(\d+)', s).group(1))
                    if re.search(r'topics?\.php\?topic=(\d+)', s) else None,
    }


def process(r):
    """Fetch and extract one article. Returns (record_or_None, error_or_None)."""
    original = r['wayback'].split('id_/', 1)[1]
    try:
        s = fetch(r['wayback'])
    except Exception as e:
        s = None
        # Hunting for an alternate snapshot costs an extra CDX round trip plus
        # another fetch, which on a slow archive is most of a minute per
        # failure. Too expensive for the main crawl; run with --repair to make
        # a second pass over just the rows that failed.
        for ts in (other_captures(original, r['timestamp']) if REPAIR else []):
            try:
                s = fetch_once(f'https://web.archive.org/web/{ts}id_/{original}')
                r = {**r, 'timestamp': ts}
                break
            except Exception:
                time.sleep(DELAY)
        if s is None:
            return None, str(e)

    rec = extract(s)
    rec['body_text'] = strip_tags(rec.get('body_html') or '')

    # In repair mode, a successful fetch that yields no article is worth as much
    # as a failed one, and it is the more common failure by far: the archive
    # answers 200 and serves a capture of the site's home page instead of the
    # article, because that is what the crawler got when it visited. Nothing is
    # wrong with the parse - the article simply is not in that snapshot.
    #
    # So retry against the URL's other snapshots and keep whichever recovers the
    # most text. This is the only path that can rescue those, which is why the
    # main crawl leaves them alone and repair goes looking.
    if REPAIR and len(rec['body_text']) < MIN_BODY_CHARS:
        for ts in other_captures(original, r['timestamp'], limit=4):
            try:
                alt = fetch_once(f'https://web.archive.org/web/{ts}id_/{original}')
            except Exception:
                time.sleep(DELAY)
                continue
            candidate = extract(alt)
            candidate['body_text'] = strip_tags(candidate.get('body_html') or '')
            if len(candidate['body_text']) > len(rec['body_text']):
                rec = candidate
                r = {**r, 'timestamp': ts}
            if len(rec['body_text']) >= MIN_BODY_CHARS:
                break
            time.sleep(DELAY)

    rec.update({'slug': r['slug'], 'legacy_id': r['id'], 'kind': r['kind'],
                'timestamp': r['timestamp'], 'wayback': r['wayback']})
    return rec, None


def main():
    rows = json.load(open(MANIFEST))
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                done.add(json.loads(line)['wayback'])
            except Exception:
                pass
    todo = [r for r in rows if r['wayback'] not in done]

    # Fetch the good stuff first.
    #
    # The archive answers in five to ten seconds per page and will not be
    # hurried, so the full manifest is a multi-hour crawl. That is fine as a
    # background job, but it should not mean the interviews with Armin van
    # Buuren and Paul Oakenfold arrive last because their slugs start with a
    # letter late in the alphabet. Anything that reads like an interview or
    # names a well-known act is fetched first, so the archive is worth
    # publishing long before the crawl finishes.
    MARQUEE = ('interview', 'armin', 'oakenfold', 'tiesto', 'carl-cox', 'van-dyk', 'deadmau5',
               'daft-punk', 'crystal-method', 'fatboy', 'pendulum', 'faithless', 'prodigy',
               'chemical-brothers', 'moby', 'sasha', 'digweed', 'picotto', 'ferry-corsten',
               'swedish-house', 'guetta', 'avicii', 'skrillex', 'kaskade', 'benassi',
               'cosmic-gate', 'markus-schulz', 'infected-mushroom', 'hawtin')

    def priority(r):
        slug = (r.get('slug') or '').lower()
        if not slug:
            return 2               # storyid-only rows: no headline to judge on
        if any(k in slug for k in MARQUEE):
            return 0
        return 1

    todo.sort(key=priority)
    print(f'{len(rows)} in manifest, {len(done)} already fetched, {len(todo)} to go', flush=True)
    print(f'  {sum(1 for r in todo if priority(r) == 0)} marquee article(s) queued first', flush=True)

    counts = {'ok': 0, 'thin': 0, 'fail': 0, 'n': 0}
    lock = threading.Lock()
    out = open(OUT, 'a')
    bad = open(FAILED, 'a')

    def handle(r):
        rec, err = process(r)
        # One writer at a time: JSONL only stays parseable if a line is never
        # interleaved with another thread's line.
        with lock:
            counts['n'] += 1
            if rec is None:
                counts['fail'] += 1
                bad.write(json.dumps({**r, 'error': err}) + '\n'); bad.flush()
            else:
                if len(rec['body_text']) < MIN_BODY_CHARS:
                    counts['thin'] += 1
                    bad.write(json.dumps({**r, 'error': f"thin body ({len(rec['body_text'])} chars)"}) + '\n')
                    bad.flush()
                else:
                    counts['ok'] += 1
                out.write(json.dumps(rec) + '\n'); out.flush()
            if counts['n'] % 25 == 0:
                print(f"[{counts['n']}/{len(todo)}] ok={counts['ok']} thin={counts['thin']} fail={counts['fail']}",
                      flush=True)
        time.sleep(DELAY)

    try:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(handle, todo))
    finally:
        out.close(); bad.close()

    print(f"DONE ok={counts['ok']} thin={counts['thin']} failed={counts['fail']}", flush=True)


if __name__ == '__main__':
    main()
