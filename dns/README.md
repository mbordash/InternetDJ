# DNS for internetdj.co

Hosting moved from GoDaddy to Cloudflare on 2026-08-31. This file records where
things ended up and which parts are load bearing. `internetdj.co.zone` is a BIND
export of the zone as it stood on GoDaddy immediately before the move, kept as
the reference copy of the original values.

## Current state

| | |
|---|---|
| Registrar | GoDaddy (unchanged; only DNS hosting moved) |
| Nameservers | `wanda.ns.cloudflare.com`, `amos.ns.cloudflare.com` |
| DNSSEC | off, no DS record at the registry |
| Apex | **proxied** through Cloudflare to Fly.io (`37.16.13.92`, `2a09:8280:1::73:fe2:0`) |
| www | proxied placeholder plus a Single Redirect rule, 301 to the apex |
| Mail | Mailgun on `mail.internetdj.co`, five records, all DNS-only |
| Apex MX | none. No mailbox receives at `@internetdj.co` |

The registrar locks (`clientTransferProhibited` and friends) block a *registrar*
transfer, not a nameserver change, which is why they never needed touching.

## The records that carry real weight

**Google Search Console verification** is a single apex TXT record. Lose it and
the property goes unverified.

**Mailgun** is five records under `mail.internetdj.co`: two MX, SPF, the `k1`
DKIM key, the `email.mail` tracking CNAME, and DMARC.
`backend/utils/notifications.js` sends as `noreply@$MAILGUN_DOMAIN`, so these
carry every password reset and email verification the site sends.

Their failure mode is the dangerous kind. Mail keeps being accepted by Mailgun,
the application logs no error, and delivery quietly degrades at the receiving
end. Nothing in the app will tell you. DMARC is `p=none`, so a DKIM failure
does not bounce, it just raises the odds of landing in spam.

All five must stay **DNS-only (grey cloud)**. Cloudflare cannot proxy MX or TXT
anyway, but `email.mail` is a CNAME and will be proxied by default if added
carelessly, which breaks Mailgun open and click tracking.

## www

`www` is a proxied placeholder record pointing at `100::`, the IPv6 discard
prefix, plus a Single Redirect rule under Rules:

- When: `http.host eq "www.internetdj.co"`
- Then: dynamic 301 to `concat("https://internetdj.co", http.request.uri.path)`
- Preserve query string: on

Three things about that shape are easy to get wrong later:

**The record must stay proxied.** The rule is an edge feature and only runs for
traffic passing through Cloudflare. Grey-cloud the record and visitors are sent
straight to `100::`, which is a black hole by design, so www goes completely
dark. A 522 on www means the record is proxied but no rule matched, which is
the expected state before the rule exists and a useful signal if it ever stops
matching.

**The redirect must be dynamic, not static.** A static redirect sends every URL
to the apex root, so `www.internetdj.co/song/1` would land on the home page.
That is what GoDaddy's forwarding did, and Google classifies a redirect to an
unrelated page as a soft 404, so a static rule trades one soft 404 for another.

**Preserve query string is a separate toggle.** `http.request.uri.path` does not
include `?utm_source=...`, so without it every campaign link loses its tags.

Verified working: one hop, path preserved, query string preserved.

## Things that will bite later

**Fly certificate renewal, due before 2026-11-26.** The origin certificate was
issued 2026-08-28 and runs to 2026-11-26. Renewal happens over ACME, and now
that the apex is proxied, Cloudflare answers `/.well-known/acme-challenge/`
with a 301 to HTTPS. Let's Encrypt follows redirects so this should keep
working, but proxying an apex is exactly the change that breaks renewal
quietly, months later, rather than at the moment it is made. If a renewal ever
fails, switch Fly to DNS-01 validation.

**Do not cache HTML at the edge.** `backend/middleware/ogMetaTags.js` serves
different markup to crawlers than to people, keyed on User-Agent. Edge caching
HTML would pin one variant for everybody, so either visitors get crawler markup
or Facebook gets a bare shell. The apex currently reports
`cf-cache-status: DYNAMIC`, which is correct. Leave it that way.

**DNSSEC is off and should be turned off before any future nameserver change.**
It is not enabled today, so nothing to do, but enabling it later adds a step:
disable it and let the DS record expire *before* moving nameservers, or the
domain goes fully dark for validating resolvers.

## What the migration itself taught

The zone was moved using Cloudflare's automatic scan rather than by importing
`internetdj.co.zone`. The scan discovers records by guessing common names, so it
found the apex, the Google verification TXT, and three of the five Mailgun
records, and missed the two that are nested two labels deep:

- `k1._domainkey.mail` (DKIM)
- `email.mail` (tracking CNAME)

Both had to be re-added by hand from the zone file. Neither absence produced an
error anywhere; email kept sending and kept reporting success.

The scan also faithfully copied the two `www` A records pointing at GoDaddy's
forwarding service, which were already broken before the move and became a 522
once proxied.

So for any future zone move: import the zone file, then verify record by record
against it by querying the new nameservers directly, for example
`dig +short TXT k1._domainkey.mail.internetdj.co @wanda.ns.cloudflare.com`.
Querying a public resolver instead can show stale answers for hours, and a
local resolver cache can keep returning pre-migration addresses well after the
change is live. Several confusing results during this migration, including a
405 and a 404 that appeared to come from Cloudflare, were a stale macOS
resolver cache still holding GoDaddy's forwarding addresses.
