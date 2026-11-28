# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-27.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #40, all merged except #3 (Dependabot, closed unmerged). #40 (booking) merged on 2026-11-27.
- **Open:** #41, catalog photo views (`feat/catalog-photo-views`), queued for auto-merge behind the required checks.
- **In `main`:** the site editor, uploads, collections, brand, forms and ad tracking (owners change pages, photos,
  PDFs, posts, videos, episodes, testimonials, team, business details, brand, a notice and forms by chatting; editor and
  uploads off by default, mocks only; tags off until IDs are set); catalog and quotes (#37; `/blocks` shows a 60-piece
  example); fonts loading only the faces the design uses (#38: photo-led pages 89 to 92, every page pixel-identical).
- **Payments and gift cards (#39, in `main`):** off by default (`payments: null`). Stripe hosted Checkout,
  Worker-computed amounts, a PDF certificate by email, ledger row, owner email, owner tools. Mocked Stripe only.
- **Catalog photo views (#41):** a gallery card shows its second photo on hover or keyboard focus, loaded only then;
  a piece's page swipes between photos and opens them larger. A one-photo piece is unchanged.
- **Booking (#40, in `main`):** off by default (`booking: null`; a production build ships none of it). Google Calendar is the one
  record; services, sessions, deposits and hours by chat; holds, a lock, exactly-once confirmation. Mocked Google and
  Stripe only (`docs/BOOKING.md`).
- **Still open per `docs/TEMPLATE.md`:** README polish; which Huston content rules in AGENTS.md stay as defaults.

## Needs Grant

In order:

1. Check that #41 (catalog photo views) merged (auto-merge queued). "Needs your eyes": AGENTS.md (one line naming the
   photo strip and larger view). Copy: the six new interface words in `src/content/catalog.ts` ("Open photo 2 of 4
   larger", "Photos of <name>", "Previous photo", "Next photo", "Close", "Photo 2 of 4"). On a real phone, swipe a
   piece's photos and open the larger view once (emulated touch only). From #40 (merged): AGENTS.md (Booking paragraph, Worker imports,
   secrets, `BOOKING_FIXTURE`), README, package.json (test globs; no dependency). Copy: `src/content/booking.ts`,
   `booking-emails.ts`, event text in `worker/booking/events.ts`, `src/content/forms/booking.json`, `booking.json`'s and
   (from #39) `gift-cards.json`'s placeholders, `gift-cards.ts`, `gift-card-emails.ts`, `gift-certificate.ts`.
2. First booking site (accounts, so yours): `docs/BOOKING.md` sections 3 and 4 (key, calendar sharing, test calendar,
   time zone, `checkout.session.expired`, Bookings tabs, test booking). Confirm what mocks could not: the two Google
   scopes on a shared calendar, the lock (a Durable Object) deploys, the 15-minute cron runs on the live Worker.
3. Decide whether booking's times route needs its own rate-limit binding (design R8's cost; one more namespace id per site).
4. Before the first site sells gift cards, with a real Stripe test-mode key (accounts, so yours; `docs/PAYMENTS.md`):
   confirm the restricted key works with Checkout Sessions write, PaymentIntents write and Charges read (the Worker
   expands the charge; a missing permission fails every confirm), that the pinned `Stripe-Version` (`2025-10-29.clover`)
   is accepted, that Resend accepts the PDF attachment, and walk one test purchase with card 4242 4242 4242 4242.
5. For each site that sells gift cards on the Google Sheet: add the tabs "Gift cards" and "Gift cards preview" with the
   header row in `docs/PAYMENTS.md`, paste the new `docs/apps-script/contact-sheet.gs` and deploy a new version.
6. Pipeline app (separate repo): `/intake` has no idempotency key, so a same-second duplicate webhook could add a gift
   card or booking lead twice; consider accepting the payment id as a key. Certificates draw the logo through the Images binding.
7. First catalog site: `docs/EDITING.md`, "Catalog" (settings, import dry run then `--write`, a page with the `catalog`
   block), then one real quote on the preview (Sheet row, both emails); delete the test row.
8. Watch item (design R7): about 1,600 pieces at 3 photos reaches Workers' default 20,000 asset files; each uploaded
   photo now takes 3 to 6 Images transformations (5,000 free a month across all sites).
9. For each site that saves to the Google Sheet: add five header cells to row 1, `Came from | Campaign | Click ID |
   First seen (UTC) | Days to note`: columns L to P on "Submissions" and "Preview", G to K on "Forms" and "Forms
   preview". First check those columns are empty and move any column the owner added there to the right. Rows already
   save with the new cells (the Apps Script takes up to 20 columns); sites on the Pipeline app need nothing. Every
   site's privacy page should mention the source cookie, tags or not (`docs/TRACKING.md`, wording).
10. Before ads run on a site (accounts, so yours): `docs/TRACKING.md`, "Set up one site", steps 1 to 11: GA4 property and
   two enhanced-measurement switches off, Google Ads Lead and Purchase conversion actions and labels, auto-tagging on,
   enhanced conversions off, link Ads to GA4, key events, the Meta Pixel with Automatic advanced matching off. Put the
   IDs in `site.config.ts`, `npm run sync:config`, PR. Then test each tag on the live site and update the privacy page
   (`docs/LAUNCH-CHECKLIST.md` D12 to D15; the privacy wording is a copy decision for you and the client).
11. On the first live site with tracking, confirm what local tests could not: GA4 DebugView and Meta Test events show the
   events, the console has no CSP error, and a Safari visitor back after 7+ days still shows the ad (ruling 2).
12. Pipeline app (separate repo): confirm `/intake` treats the new `source` and `attribution` as outside text (a visitor
   can forge the cookie), and decide whether to store `attribution`.
13. Decide whether Google Ads should build remarketing lists. Off now: page views go to GA4 only, because a page view to
   Ads sets third-party cookies on every page (best practices fell to 73). Ruling 17 in
   `docs/superpowers/specs/2026-11-27-ad-tracking-design.md`.
14. For each site that saves to the Google Sheet, before its owner adds a form: open the Sheet, add two tabs named
   "Forms" and "Forms preview", each with the header row `Received (UTC) | Form | Name | Email | Answers | Mode`; for the
   Apps Script writer, paste the new `docs/apps-script/contact-sheet.gs` into the script, set Script Properties
   `TAB_FORMS` and `TAB_FORMS_PREVIEW` only if you named the tabs differently, then Deploy, Manage deployments, edit the
   web app, New version (same URL, so no Worker secret changes). Until then a new form's answers still reach the owner
   by email, which says "Sheet: NOT saved - add this one by hand". Sites on the Pipeline app need nothing.
15. On the first real site with a download form, send one test submission and look at the email the visitor gets (only
   mocked so far), then delete the test row or lead.
16. For each client site, set the per-client values from the last run: `business.timeZone` in `site.config.ts`, the
   palette, fonts and logo in `src/content/brand.json`, the business details in `src/content/business.json`, then
   `npm run sync:config`. Remove or archive the template's example posts, videos, episodes, testimonials and team member
   the site does not use (the launch gate fails on their placeholders).
17. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 6, whose file already includes them.
18. Decide the content fast lane: `docs/proposals/content-fast-lane.md` (its rule is now numbered 18). To adopt it: first
   change the "Protect main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 18 to
   PROCESS.md (text in the proposal). Forms add to the reasons: the scope check's form rules block an editor change only
   once `change-scope` is required.
19. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Brand changes by chat also need `editor.workersSubdomain` set.
20. On that first site, confirm what mocks could not: a real AI app connects; `/site-version.json` shows the deployed
   commit and `drafts: false`; `/blocks` is the 404 page; a preview link opens; the yes-to-live minutes; a draft post
   shows on its preview and not on the live site; a Spotify and an Apple Podcasts episode play; a form added by chat
   sends, lands in the Sheet's Forms tab (after item 2) and emails the owner.
21. Turn uploads on for that site: `docs/EDITING.md`, "Set up uploads on one site", steps h to l. Then confirm a portrait
   iPhone HEIC photo shows upright, a PDF downloads with the sandbox header, a phone video is refused, and a transparent
   PNG logo stays transparent.
22. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
23. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
24. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor, uploads, collections and
    brand settings, and forms with the ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering
    and ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the
    same runs.
25. Connect a site to a Pipeline app copy (only mocked tests so far): set `INTAKE_SECRET` in the app copy and the site,
    set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`, `npm run sync:config`,
    merge, then send one test note and delete the test lead. Optional: teach the intake a form-name field (today the
    form's name is the first line of the message).
26. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
27. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id. Forms add no id.
28. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
29. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 5).
30. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template defaults.
31. Optional, later: an expired site notice comes down only at the next publish; a daily scheduled rebuild would fix it
    (an account step, not built).
32. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Catalog visitors see a piece's other photos with almost no effort: the gallery card shows the second photo when
  pointed at, and a piece's page swipes between photos and opens them larger. Photo order now matters to owners.
- Not offered: pinch zoom, video on pieces, autoplay or a carousel on cards.

## Last run: Catalog photo views (2026-11-27)

Process run, unattended, one PR (#41). Plan and rulings P1 to P10: `docs/superpowers/plans/2026-11-27-photo-views.md`
(amends catalog R8 and R12). Opus planned, reviewed and fixed; one Sonnet agent built it; Haiku wrote the docs.
- Rulings worth a look: P2 (a lazy image with no box is never fetched; pinned in Chromium), P4 (native scrolling, no
  touch handler), P7 (one photo: no larger view), P10 (phone thumbnails four across, for 44 px). No new dependency or CSP.
- `npm run check` passes; `test:a11y` 189 passed (7 new photo tests); Lighthouse CI passes (8 pages), unchanged thresholds. 500-piece fixture builds
  580 pages in 6.6 s; its gallery page is 50 KB gzipped (was 39 KB), and its second photos load nothing until used.
- Reviews fixed: arrow keys dead until a Tab, modifier arrows swallowed, clipped focus ring, stale aim after a touch,
  scrollbar shift, 37 px thumbnails at 320 px, larger-view controls off the page grid at 1440 (design critique).

| Measure | This run |
|---|---|
| Wall-clock time | about 45 minutes (21:00 to about 21:45, PR open, reviewed and fixed) |
| Commits | 10 |
| Time in checks | about 20 minutes (`check:fast` per commit, 2 full checks, 7 builds incl. the fixture, the catalog spec 4 times, `test:a11y` once, 1 Lighthouse CI run) |
| Time waiting on CI | 0 (auto-merge queued) |
