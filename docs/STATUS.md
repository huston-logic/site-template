# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-27.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #38, all merged except #3 (Dependabot, closed unmerged). #37 (catalog) and #38 (font loading) merged
  on 2026-11-27.
- **Open:** #39, payments base and gift cards (`feat/gift-cards`), queued for auto-merge behind the required checks.
- **In `main`:** the site editor, uploads, collections, brand, forms and ad tracking (owners change pages, photos,
  PDFs, posts, videos, episodes, testimonials, team, business details, brand, a notice and forms by chatting; editor and
  uploads off by default, mocks only; tags off until IDs are set); catalog and quotes (#37; `/blocks` shows a 60-piece
  example); fonts loading only the faces the design uses (#38: photo-led pages 89 to 92, every page pixel-identical).
- **Payments and gift cards (in #39):** off by default (`payments: null`; a production build ships none of it). Set
  up: Stripe hosted Checkout, Worker-computed amounts, a PDF certificate by email, a ledger row, an owner email, owner
  tools by chat. Tested against a mocked Stripe only (`docs/PAYMENTS.md`).
- **Still open per `docs/TEMPLATE.md`:** README polish; which Huston content rules in AGENTS.md stay as defaults.

## Needs Grant

In order:

1. Check that #39 merged (auto-merge queued). "Needs your eyes": AGENTS.md (a Payments and gift cards paragraph, the
   Worker's import list, the Stripe secrets, `PAYMENTS_FIXTURE`), README (a "Payments and gift cards" section),
   package.json (test globs only; no dependency). Copy for you: `src/content/gift-cards.ts` (block and thank-you page),
   `src/content/gift-card-emails.ts`, `src/content/gift-certificate.ts` and the placeholders in `src/content/gift-cards.json`.
2. Before the first site sells gift cards, with a real Stripe test-mode key (accounts, so yours; `docs/PAYMENTS.md`):
   confirm the restricted key works with Checkout Sessions write, PaymentIntents write and Charges read (the Worker
   expands the charge; a missing permission fails every confirm), that the pinned `Stripe-Version` (`2025-10-29.clover`)
   is accepted, that Resend accepts the PDF attachment, and walk one test purchase with card 4242 4242 4242 4242.
3. For each site that sells gift cards on the Google Sheet: add the tabs "Gift cards" and "Gift cards preview" with the
   header row in `docs/PAYMENTS.md`, paste the new `docs/apps-script/contact-sheet.gs` and deploy a new version.
4. Pipeline app (separate repo): `/intake` has no idempotency key, so a same-second duplicate webhook could add a gift
   card lead twice; consider accepting the payment id as a key. Certificates draw the logo through the Images binding.

6. First catalog site: `docs/EDITING.md`, "Catalog" (settings, import dry run then `--write`, a page with the `catalog`
   block), then one real quote on the preview (Sheet row, both emails); delete the test row.
7. Watch item (design R7): about 1,600 pieces at 3 photos reaches Workers' default 20,000 asset files; each uploaded
   photo now takes 3 to 6 Images transformations (5,000 free a month across all sites).
8. For each site that saves to the Google Sheet: add five header cells to row 1, `Came from | Campaign | Click ID |
   First seen (UTC) | Days to note`: columns L to P on "Submissions" and "Preview", G to K on "Forms" and "Forms
   preview". First check those columns are empty and move any column the owner added there to the right. Rows already
   save with the new cells (the Apps Script takes up to 20 columns); sites on the Pipeline app need nothing. Every
   site's privacy page should mention the source cookie, tags or not (`docs/TRACKING.md`, wording).
9. Before ads run on a site (accounts, so yours): `docs/TRACKING.md`, "Set up one site", steps 1 to 11: GA4 property and
   two enhanced-measurement switches off, Google Ads Lead and Purchase conversion actions and labels, auto-tagging on,
   enhanced conversions off, link Ads to GA4, key events, the Meta Pixel with Automatic advanced matching off. Put the
   IDs in `site.config.ts`, `npm run sync:config`, PR. Then test each tag on the live site and update the privacy page
   (`docs/LAUNCH-CHECKLIST.md` D12 to D15; the privacy wording is a copy decision for you and the client).
10. On the first live site with tracking, confirm what local tests could not: GA4 DebugView and Meta Test events show the
   events, the console has no CSP error, and a Safari visitor back after 7+ days still shows the ad (ruling 2).
11. Pipeline app (separate repo): confirm `/intake` treats the new `source` and `attribution` as outside text (a visitor
   can forge the cookie), and decide whether to store `attribution`.
12. Decide whether Google Ads should build remarketing lists. Off now: page views go to GA4 only, because a page view to
   Ads sets third-party cookies on every page (best practices fell to 73). Ruling 17 in
   `docs/superpowers/specs/2026-11-27-ad-tracking-design.md`.
13. For each site that saves to the Google Sheet, before its owner adds a form: open the Sheet, add two tabs named
   "Forms" and "Forms preview", each with the header row `Received (UTC) | Form | Name | Email | Answers | Mode`; for the
   Apps Script writer, paste the new `docs/apps-script/contact-sheet.gs` into the script, set Script Properties
   `TAB_FORMS` and `TAB_FORMS_PREVIEW` only if you named the tabs differently, then Deploy, Manage deployments, edit the
   web app, New version (same URL, so no Worker secret changes). Until then a new form's answers still reach the owner
   by email, which says "Sheet: NOT saved - add this one by hand". Sites on the Pipeline app need nothing.
14. On the first real site with a download form, send one test submission and look at the email the visitor gets (only
   mocked so far), then delete the test row or lead.
15. For each client site, set the per-client values from the last run: `business.timeZone` in `site.config.ts`, the
   palette, fonts and logo in `src/content/brand.json`, the business details in `src/content/business.json`, then
   `npm run sync:config`. Remove or archive the template's example posts, videos, episodes, testimonials and team member
   the site does not use (the launch gate fails on their placeholders).
16. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 6, whose file already includes them.
17. Decide the content fast lane: `docs/proposals/content-fast-lane.md` (its rule is now numbered 18). To adopt it: first
   change the "Protect main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 18 to
   PROCESS.md (text in the proposal). Forms add to the reasons: the scope check's form rules block an editor change only
   once `change-scope` is required.
18. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Brand changes by chat also need `editor.workersSubdomain` set.
19. On that first site, confirm what mocks could not: a real AI app connects; `/site-version.json` shows the deployed
   commit and `drafts: false`; `/blocks` is the 404 page; a preview link opens; the yes-to-live minutes; a draft post
   shows on its preview and not on the live site; a Spotify and an Apple Podcasts episode play; a form added by chat
   sends, lands in the Sheet's Forms tab (after item 2) and emails the owner.
20. Turn uploads on for that site: `docs/EDITING.md`, "Set up uploads on one site", steps h to l. Then confirm a portrait
   iPhone HEIC photo shows upright, a PDF downloads with the sandbox header, a phone video is refused, and a transparent
   PNG logo stays transparent.
21. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
22. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
23. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor, uploads, collections and
    brand settings, and forms with the ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering
    and ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the
    same runs.
24. Connect a site to a Pipeline app copy (only mocked tests so far): set `INTAKE_SECRET` in the app copy and the site,
    set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`, `npm run sync:config`,
    merge, then send one test note and delete the test lead. Optional: teach the intake a form-name field (today the
    form's name is the first line of the message).
25. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
26. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id. Forms add no id.
27. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
28. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 5).
29. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template defaults.
30. Optional, later: an expired site notice comes down only at the next publish; a daily scheduled rebuild would fix it
    (an account step, not built).
31. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Sites can sell gift cards: the buyer pays on Stripe's own page and gets a printable certificate with a code by email.
- Money goes straight to the client's own Stripe account; the site never sees a card number and loads no Stripe script.
- Every sale lands in the owner's Sheet (or Pipeline app) and their inbox; the ledger is where balances are kept.
- Owners change amounts, the any-amount range, the certificate wording and selling on or off by chat.
- Payments are set up per site by Huston Logic (the client's Stripe account, keys, webhook); booking will reuse them.
- Not offered: online redeeming, balance checks, scheduled delivery, automatic refunds, tax, other payment providers.
- Pages led by a photo now load faster: fonts load only the styles the design uses.

## Last run: Font loading, and payments base with gift cards (2026-11-27)

Process run, unattended, two PRs. Design: `docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md`. Opus
designed, built PR 1 and integrated; Sonnet built PR 2's parts in parallel worktrees and one fix wave; Haiku drafted docs.

- **#38, fonts (merged):** median of 5 Lighthouse runs on the 500-piece fixture: gallery 89 to 92, piece page 89 to 92;
  142 of 142 page screenshots identical, and every accent font checked; thresholds unchanged.
- **#39, payments and gift cards:** `npm run check` passes (1,217 Worker and shared-module tests, 614 script tests);
  `test:a11y` 183 passed; `test:tracking` 10 passed, including the walk against the real Worker code (begin_checkout and
  purchase once, a reload fires nothing, the webhook three times gives one email, one row and one owner email with the
  same code, amount and source); Lighthouse 100 on every audited page. Payments off: production pages pixel-identical,
  same `_headers` and sitemap, no gift card script (shared CSS 1.1 KB larger).
- **Reviews (all fixed):** a misreported Sheet row, checkout without the webhook secret, a silent paid mismatch, sales
  bound to their site, the session id kept out of the Meta Pixel.
- **New dependencies:** none (the certificate PDF is made without a library).

| Measure | This run |
|---|---|
| Wall-clock time | about 1 hour 55 minutes (16:23 to about 18:18, both PRs open, reviewed and fixed) |
| Commits | 5 on #38; 20 plus 4 merge commits on #39 |
| Time in checks | about 45 minutes (Lighthouse 4 x 10 fixture runs and 2 suites, 9 pixel comparisons, about 25 builds, a11y twice, tracking 3 times, `check:fast` per commit) |
| Time waiting on CI | 0 (auto-merge queued on both) |
