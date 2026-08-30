#!/usr/bin/env python3
"""
Merge a fresh scrape against the previous one, keeping the better of each pair.

The parser was improved several times mid-recovery, and the re-fetch passes only
revisited records that came back under the thin threshold. A record that
extracted partially - above the threshold but truncated - was never revisited
and kept its early, worse version. The Carl Cox interview stored 313 characters
where the page holds 1,506.

Re-fetching everything fixes that, but a fresh fetch can also fail where the old
one succeeded, because the archive is not perfectly reliable. So neither file
wins outright: for each URL, whichever version recovered more text is kept.
"""
import json, sys

def load(path):
    out = {}
    try:
        for line in open(path):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            out[r['wayback']] = r
    except FileNotFoundError:
        pass
    return out

prev, new = load('articles.prev.jsonl'), load('articles.jsonl')
merged, improved, kept, added = {}, 0, 0, 0
for url in set(prev) | set(new):
    a, b = prev.get(url), new.get(url)
    if a and b:
        la, lb = len(a.get('body_text') or ''), len(b.get('body_text') or '')
        merged[url] = b if lb >= la else a
        if lb > la: improved += 1
        elif lb < la: kept += 1
    else:
        merged[url] = a or b
        if b and not a: added += 1

with open('articles.jsonl', 'w') as f:
    for r in merged.values():
        f.write(json.dumps(r) + '\n')

ok = sum(1 for r in merged.values() if len(r.get('body_text') or '') >= 120)
print(f'merged {len(merged)} records: {improved} improved by the re-fetch, '
      f'{kept} kept from the previous run, {added} new')
print(f'importable: {ok}')
