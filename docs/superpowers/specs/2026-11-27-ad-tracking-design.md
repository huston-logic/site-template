# Ad tracking and lead source: design

Run: "Ad tracking", a process run, 2026-11-27. Grant's brief is the approval of the direction; where it left something
open, the call is recorded below as a ruling with its cost if wrong. Repo rules: AGENTS.md, CLAUDE.md, docs/PROCESS.md.

## Intent

Sites built from this template are about to get paid ad traffic. The owner must see how many visitors each ad brought,
how far they got, and which ad produced each lead, including a visitor who clicked an ad and came back days later. Most
sites save leads to the Google Sheet, so the Sheet is a first-class destination. Later runs (gallery quotes, gift cards,
bookings) reuse the event layer and the source capture, so each is built as the one place those features call.

## Goals

- A `tracking` group in `site.config.ts` (GA4, Google Ads with lead and purchase labels, Meta Pixel), all null by
  default, owner-only. `sync:config` adds only the CSP origins the set IDs need; `check:config` validates the formats.
- gtag.js and the Meta Pixel load from the shared root layout, so every page has them, including pages added by chat.
  Production only, after the page has loaded, and never when the browser sends Global Privacy Control.
- One event layer with a fixed list, fired from inside the blocks and from phone and email links site-wide, and one file
  that maps each event to GA4, Google Ads conversions and Meta standard events.
- First-party source capture, always on: the first touch and the last tagged touch, kept 90 days in a cookie the
  site's own Worker sets in an HTTP response.
- Every submission (the contact form and every owner-made form) carries the source to the Sheet row, the notification
  email and the Pipeline post, attached by the Worker, not as a form field.

## Non-goals (this run)

Gallery, quotes, payments, bookings, server-side conversion sending (Google Ads offline conversions, Meta Conversions
API), a consent banner, a reporting page, Google Tag Manager, Microsoft (Bing) UET tag. Page copy does not change.

## Anti-goals (a failure even if it works)

- With no IDs set, a visitor's browser talks to any new host, or the CSP or a page's look changes.
- A tag loads on a preview, in `next dev`, or when the browser sends Global Privacy Control.
- A chat tool, a page file or a form file can set or change a tracking ID.
- A forged or oversized source fails a submission, reaches the email as more than one line, or reaches a Sheet cell as a
  formula.
- Personal data (names, emails, answers, phone numbers) is sent to Google or Meta.

## Settings (`site.config.ts`)

```ts
tracking: {
  ga4MeasurementId: null as string | null,        // "G-" + 6 to 12 capital letters or digits
  googleAds: {
    id: null as string | null,                    // "AW-" + 9 to 11 digits
    leadLabel: null as string | null,             // 6 to 40 letters, digits, "_" or "-"
    purchaseLabel: null as string | null,
  },
  metaPixelId: null as string | null,             // 15 to 17 digits
},
```

`check:config` fails on a bad format, a label without the Ads id, or a value that is a `[[placeholder]]`. The file is
owner-only by construction: the editor writes only content files (AGENTS.md, "Site editor"), and a test asserts that no
editor operation can name `site.config.ts`.

**CSP.** `src/tracking/config.ts` holds the one list of origins per product (from Google's "Use a Content Security
Policy" guide for Google tags, fetched 2026-11-27; Meta publishes no CSP list, so its two hosts come from the Pixel's own
base code):

| Set | script-src | img-src | connect-src | frame-src |
|---|---|---|---|---|
| GA4 | www.googletagmanager.com | www.googletagmanager.com, *.google-analytics.com | www.googletagmanager.com, *.google-analytics.com, *.analytics.google.com | none |
| Google Ads | www.googletagmanager.com, www.googleadservices.com, www.google.com, googleads.g.doubleclick.net | www.googletagmanager.com, www.googleadservices.com, googleads.g.doubleclick.net, pagead2.googlesyndication.com, www.google.com | the img-src list plus ad.doubleclick.net | www.googletagmanager.com |
| Meta Pixel | connect.facebook.net | www.facebook.com | www.facebook.com, connect.facebook.net | none |

With no ID set, `public/_headers` is byte-identical to `main`.

## Loading

`trackingForBuild(config, env)` decides at build time: null (nothing rendered) unless at least one ID is set and the
build is the production build (`isProductionBuild`, the rule drafts and `/blocks` already use). The root layout renders
`<TagsSlot />` from `src/tracking/tags-slot.tsx`, which renders nothing and imports nothing; when `trackingForBuild` is
not null, `next.config.ts` aliases that import to `tags-slot-on.tsx`, which renders the client component `TrackingTags`.
This Next version cannot code-split a client component imported by a server layout, so a plain conditional render
would still ship and preload the loader's chunk on every page of a build with no IDs. At run time `TrackingTags` does nothing when
`navigator.globalPrivacyControl` is true or the host is not the site's own domain (or its `www.` twin). Otherwise it sets
up the gtag and fbq queues at once, so no event is lost, and adds the two script tags after the `load` event, in an idle
callback, so they never compete with first paint.

A local test build can set `TRACKING_FIXTURE=1`: it uses the fixture IDs in `src/tracking/config.ts` (obviously fake),
skips the host check, and makes `scripts/finish-build.mjs` rewrite `out/_headers` with the fixture CSP. Any Workers
Builds build (production or preview) with the variable set fails.

## The event layer

`src/tracking/events.ts` is the one map. `track(name, params)` (`src/tracking/track.ts`) is what blocks call; it hands
the event to `TrackingTags` (`window.hlTrack`) when present and otherwise does nothing, so with no IDs it makes no
request. There is no queue: blocks report only after hydration, when the loader is already set up, and a queue made the
shared chunk of every page bigger.

| Event | Fired by | GA4 | Google Ads | Meta |
|---|---|---|---|---|
| page_view | `TrackingTags`, every path change including the first | page_view (send_to GA4; page_location without fragment, only campaign and click-ID parameters) | none (ruling 17) | PageView |
| form_start | contact form and form block, first focus | form_start {form_id} | none | none |
| lead | contact form and form block, on the Worker's success | generate_lead {form_id} | conversion, send_to lead label | Lead |
| click_call | any `tel:` link, one document listener | click_call | none | Contact |
| click_email | any `mailto:` link, one document listener | click_email | none | Contact |
| view_item | reserved | view_item {item_id, item_name} | none | ViewContent |
| quote_start | reserved | quote_start {item_id} | none | none |
| begin_checkout | reserved | begin_checkout {value, currency} | none | InitiateCheckout |
| purchase | reserved | purchase {value, currency, transaction_id} | conversion, send_to purchase label, value, currency, transaction_id | Purchase {value, currency} |

Parameters are allow-listed per event; `value` must be a finite number of at least 0 and `currency` three capital
letters, or the parameter is dropped. No event carries a name, email, phone number, answer or link target.

## Source capture

**The cookie.** `hl_src`, set only by the Worker: `Path=/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax`, on a
same-origin `POST /api/visit` response with `Cache-Control: no-store`. The value is base64url JSON
`{ "f": Touch, "l"?: Touch }`: the first touch and the last tagged touch. A touch holds its time (`at`, Unix seconds),
landing path (no query, at most 200 characters), referrer host (only when it is another site, at most 100), the five
`utm_*` values (at most 100 each, control characters removed) and the five click IDs (`gclid`, `gbraid`, `wbraid`,
`fbclid`, `msclkid`; at most 200 each, letters, digits and `._~-` only). A touch is tagged when it has any `utm_*` or
click ID. A new tagged touch replaces `l`; `f` is kept until it is 90 days old, when the oldest surviving touch takes its
place. If the encoded value is over 3,600 bytes, `utm_content`, `utm_term` and all but the first click ID are dropped,
then `f` is dropped.

**The trigger.** An inline script in the root layout's `<head>` (`src/tracking/capture-script.ts`) posts
`{ path, referrer }` to `/api/visit` only when the URL carries a `utm_*` or click-ID parameter or the referrer is another
site. A visitor who arrives directly, and every internal navigation, sends nothing.

**Reading it.** `worker/attribution.ts` is the one place that parses, cleans and summarises the cookie, for the contact
form, every owner-made form and later features. It never throws: anything that does not parse or fails a rule is dropped
field by field, or whole, and the submission goes on without a source.

## Delivery

Every row gains five cells at the end, in this order (contact tab 11 + 5 = 16 columns, forms tabs 6 + 5 = 11; the Apps
Script already accepts up to 20, so Sheets in use keep saving):

`Came from | Campaign | Click ID | First seen (UTC) | Days to note`

- **Came from:** the attributed touch (`l`, or `f` when there is no tagged touch): `utm_source / utm_medium`; else
  `Google Ads` (gclid, gbraid, wbraid), `Facebook or Instagram` (fbclid), `Microsoft Ads` (msclkid); else
  `Referral: <host>`; else `Direct`; and `Not known` with no cookie.
- **Campaign:** `utm_campaign` of the attributed touch. **Click ID:** `gclid: <value>` (the first one present).
- **First seen (UTC):** the date of `f`. **Days to note:** whole days from `f` to the submission.

The notification email gains one line: `Came from: google / cpc, campaign spring-sale, first visit 2026-11-20 (7 days
before this note)`, or `Came from: not known`. The Pipeline post gains `source` (the summary, at most 60 characters) and
`attribution` (`{ first, last, daysToNote }` with the raw cleaned values and ISO times); today's `/intake` stores
`source` and ignores unknown keys.

## Rulings (each with its cost if wrong)

1. **The cookie is set by `POST /api/visit`, not by running the Worker before every page.** Running the Worker first on
   page requests would set the cookie on the page response itself, but Cloudflare's docs say `_headers` rules are not
   applied to responses the Worker produces, so every page would lose its CSP and security headers unless the Worker
   re-created them, and a Worker bug would take the whole site down. Cost if wrong: one small same-origin request on
   tagged landings that a Worker-first design would avoid.
2. **Safari (WebKit, checked 2026-11-27 at webkit.org/tracking-prevention).** Script-written cookies and storage are
   deleted after 7 days without interaction, and capped at 24 hours on a landing page reached through link decoration.
   Cookies set in an HTTP response are capped at 7 days only for third-party CNAME or IP cloaking. `/api/visit` is the
   page's own host on the same Cloudflare addresses, so the cookie keeps its 90 days. Cost if wrong: Safari visitors who
   return after 7 days show `Not known` instead of the ad.
3. **Capture only when there is something to record.** A direct first visit is not recorded, so "First seen" and "Days
   to note" can start at a later, tagged visit. This keeps "no new requests" true for direct visits and every test page.
   Cost if wrong: days-to-note reads short for people who first came directly.
4. **"Matches main" with no IDs** means: `public/_headers` and the CSP are identical, no page asks any new host or
   `/api/visit` on a direct visit, the pages look the same (pixel comparison), and the only additions are the inline
   capture script (387 characters per page) and the no-op `track` calls in the two forms. Measured on the built site: every
   page makes one more same-origin request than `main`, because Turbopack split the shared chunk that holds the forms,
   `EnterObserver` and the video players into two files after it grew by about 460 bytes; no tag code is in either.
   The capture script is kept under 400 characters because the root layout's prefetch data must stay under Next's
   2,048-byte (gzipped) inlining limit: at 683 characters it crossed it and every page fetched one more file
   (`__next._index.txt`). Cost if wrong: if no extra same-origin file at all was meant, the form events would have to
   move into code that is already in that chunk, or the chunking tuned.
5. **GPC stops the tags, not the first-party source capture.** The source never leaves the site's own Worker except to
   the owner's own Sheet, inbox and Pipeline app, and nothing is sent to an ad network. Cost if wrong: a privacy review
   could ask to skip capture when `Sec-GPC: 1` is sent; that is one check in `worker/visit.ts`.
6. **GA4 gets `generate_lead`, not `lead`**, its recommended name, so GA4's lead reports work; every other name is ours
   as listed. Docs tell Grant to mark `generate_lead` and `purchase` as key events. Cost if wrong: one string.
7. **Page views are sent by the event layer** (`send_page_view: false`) so every path change is counted once and
   reaches Meta too. Grant switches off two GA4 enhanced-measurement options ("page changes based on browser history
   events" and "form interactions") so they are not counted twice (docs/TRACKING.md). Cost if wrong: if that step is
   skipped, page views and form starts double in GA4; ad conversions are unaffected.
8. **Country Google domains are not listed.** Google's guide wants every `www.google.<TLD>` listed one by one; the CSP
   lists `www.google.com` only. Cost if wrong: some remarketing pings from visitors abroad are blocked; conversions still
   count. A site can add domains with `csp.extraConnectSrc`.
9. **GA4 Google Signals and its `*.g.doubleclick.net` and `*.google.com` hosts are not allowed.** Cost if wrong: if
   Grant turns Signals on, cross-device reports stay empty until those hosts are added (one list in
   `src/tracking/config.ts`).
10. **Meta's hosts come from its base code**, since Meta publishes no CSP list. Cost if wrong: a blocked request in the
    console on a live site, fixed by one entry.
11. **Meta gets no event for form_start and quote_start**, and click_call and click_email both map to `Contact`, so Meta
    receives only standard events. Cost if wrong: a custom event to add later.
12. **The attributed touch is the last tagged touch**, the same last-non-direct-click rule GA4 and Google Ads use, and
    the first touch is still shown in the date and the Pipeline object. Cost if wrong: the "Came from" cell names the
    later ad where the owner wanted the first.
13. **No rate limit on `/api/visit`.** It stores nothing and sends nothing; it only answers the visitor's own cookie.
    Cost if wrong: Worker requests billed for abuse traffic, which a rate-limit binding would not prevent anyway.
14. **Preview Sheet rows and previews also carry the source**, so the whole path can be tested on a branch preview. Tags
    still never load there. Cost if wrong: none found.
15. **New Sheet columns have no header until Grant adds them** (Needs Grant). Rows save either way. The service-account
    writer's range grows from `A:K` to `A:T`. Cost if wrong: unlabelled columns until the owner step is done.
16. **`TRACKING_FIXTURE` is a new build variable**, read only by `src/tracking/config.ts` and `scripts/finish-build.mjs`,
    and refused on every Workers Builds build. Cost if wrong: one more variable in AGENTS.md's list.
17. **Google Ads gets conversions only, no page views.** A fixture Lighthouse run showed that a page_view reaching the
    Ads tag is a remarketing ping that sets doubleclick third-party cookies on every page (best practices 73 on every
    page) and loads a fallback script from googleads.g.doubleclick.net, which Google's CSP guide does not list (now
    allowed). The brief needs visitors per ad, the funnel and the lead per ad, which GA4, the conversion and the Sheet
    give. Cost if wrong: no remarketing audiences in Google Ads; turning them on is one `send_to` in `events.ts` and
    accepting the cookie warning.
18. **The tags get no chance to read forms.** The Pixel is set to `autoConfig` false before `init`, GA4 to
    `allow_google_signals: false`, and docs/TRACKING.md has Grant switch off Meta's Automatic advanced matching and leave
    Google's enhanced conversions and user-provided data collection off (account settings code cannot reach). Cost if
    wrong: if an account setting is switched on anyway, hashed emails and phone numbers reach Meta or Google.

## Done when

As in the brief: no IDs gives the same `_headers`, pixel-identical pages and no new request; fixture IDs load the tags,
fire each event under its mapped name and allow exactly the listed origins; a page made by the editor's operations fires
page_view and its form fires lead; GPC loads no tag; a tagged visit, an untagged return visit, then the contact form and
an owner-made form give a Sheet row, an email and a Pipeline post with the original source; a forged or oversized cookie
is cleaned or dropped and the submission succeeds; every required check passes at unchanged thresholds, and the
Lighthouse scores with fixture tags on are reported.
