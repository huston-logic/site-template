# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-27.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #36, all merged except #3 (Dependabot, closed unmerged). #36 (ad tracking) merged on 2026-11-27.
- **Open:** #37, catalog, price ranges and quotes (`feat/catalog`), queued for auto-merge behind the required checks.
- **Site editor, uploads, collections, brand, forms and ad tracking (in `main`):** owners change pages, photos, PDFs,
  posts, videos, episodes, testimonials, team, business details, brand, a notice and forms by chatting; the editor and
  uploads are off by default, tested against mocks only (`docs/EDITING.md`). Tags stay off until IDs are set
  (`docs/TRACKING.md`).
- **Catalog and quotes (in #37):** a `catalog` collection, `catalog.json` (filters, item word) and `pricing.json`
  (option groups, per-person fee, spread, rounding, note, exact prices); the `catalog` gallery block with filters in
  the address, a page per piece, the `quote-builder` block, the `quote` form, a Worker that recomputes every estimate,
  owner tools by chat and the import script. No template page uses it; `/blocks` shows a 60-piece example.
- **Still open per `docs/TEMPLATE.md`:** README polish; which Huston content rules in AGENTS.md stay as defaults.

## Needs Grant

In order:

1. Check that #37 merged (auto-merge queued). "Needs your eyes": AGENTS.md (the Catalog paragraph in Architecture,
   the client component list, the editor's write list with `catalog.json`, `pricing.json` and `<id>-card.webp`),
   README (new "Catalog and quotes" section), package.json (scripts `import:catalog` and `fixture:catalog`, test glob
   `src/catalog/*.test.ts`; no dependency change). Copy for you: the template wording in `src/content/catalog.ts`,
   `src/content/forms/quote.json` (ships live on every site; no reply-time promise) and the note in `pricing.json`.
2. Before the first catalog site goes live, decide the photo-led Lighthouse margin. Locally, the 500-piece gallery and
   a piece page score 89 to 90 on performance (median of 3 at exactly 90 for the gallery, 89 for a piece), at the 90
   bar, because the first-screen photo shares the simulated phone network with the accent font (Newsreader italic,
   148 KB, weights 200 to 800) and the base JavaScript. A client site's CI audits its catalog page and first piece. The
   fix is brand-wide: load the accent at the one weight the design uses. Other categories are 100.
3. First catalog site: `docs/EDITING.md`, "Catalog" (settings, import dry run then `--write`, a page with the `catalog`
   block), then one real quote on the preview (Sheet row, both emails); delete the test row.
4. Watch item (design R7): about 1,600 pieces at 3 photos reaches Workers' default 20,000 asset files; each uploaded
   photo now takes 3 to 6 Images transformations (5,000 free a month across all sites).
5. For each site that saves to the Google Sheet: add five header cells to row 1, `Came from | Campaign | Click ID |
   First seen (UTC) | Days to note`: columns L to P on "Submissions" and "Preview", G to K on "Forms" and "Forms
   preview". First check those columns are empty and move any column the owner added there to the right. Rows already
   save with the new cells (the Apps Script takes up to 20 columns); sites on the Pipeline app need nothing. Every
   site's privacy page should mention the source cookie, tags or not (`docs/TRACKING.md`, wording).
6. Before ads run on a site (accounts, so yours): `docs/TRACKING.md`, "Set up one site", steps 1 to 11: GA4 property and
   two enhanced-measurement switches off, Google Ads Lead and Purchase conversion actions and labels, auto-tagging on,
   enhanced conversions off, link Ads to GA4, key events, the Meta Pixel with Automatic advanced matching off. Put the
   IDs in `site.config.ts`, `npm run sync:config`, PR. Then test each tag on the live site and update the privacy page
   (`docs/LAUNCH-CHECKLIST.md` D12 to D15; the privacy wording is a copy decision for you and the client).
7. On the first live site with tracking, confirm what local tests could not: GA4 DebugView and Meta Test events show the
   events, the console has no CSP error, and a Safari visitor back after 7+ days still shows the ad (ruling 2).
8. Pipeline app (separate repo): confirm `/intake` treats the new `source` and `attribution` as outside text (a visitor
   can forge the cookie), and decide whether to store `attribution`.
9. Decide whether Google Ads should build remarketing lists. Off now: page views go to GA4 only, because a page view to
   Ads sets third-party cookies on every page (best practices fell to 73). Ruling 17 in
   `docs/superpowers/specs/2026-11-27-ad-tracking-design.md`.
10. For each site that saves to the Google Sheet, before its owner adds a form: open the Sheet, add two tabs named
   "Forms" and "Forms preview", each with the header row `Received (UTC) | Form | Name | Email | Answers | Mode`; for the
   Apps Script writer, paste the new `docs/apps-script/contact-sheet.gs` into the script, set Script Properties
   `TAB_FORMS` and `TAB_FORMS_PREVIEW` only if you named the tabs differently, then Deploy, Manage deployments, edit the
   web app, New version (same URL, so no Worker secret changes). Until then a new form's answers still reach the owner
   by email, which says "Sheet: NOT saved - add this one by hand". Sites on the Pipeline app need nothing.
11. On the first real site with a download form, send one test submission and look at the email the visitor gets (only
   mocked so far), then delete the test row or lead.
12. For each client site, set the per-client values from the last run: `business.timeZone` in `site.config.ts`, the
   palette, fonts and logo in `src/content/brand.json`, the business details in `src/content/business.json`, then
   `npm run sync:config`. Remove or archive the template's example posts, videos, episodes, testimonials and team member
   the site does not use (the launch gate fails on their placeholders).
13. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 6, whose file already includes them.
14. Decide the content fast lane: `docs/proposals/content-fast-lane.md` (its rule is now numbered 18). To adopt it: first
   change the "Protect main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 18 to
   PROCESS.md (text in the proposal). Forms add to the reasons: the scope check's form rules block an editor change only
   once `change-scope` is required.
15. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Brand changes by chat also need `editor.workersSubdomain` set.
16. On that first site, confirm what mocks could not: a real AI app connects; `/site-version.json` shows the deployed
   commit and `drafts: false`; `/blocks` is the 404 page; a preview link opens; the yes-to-live minutes; a draft post
   shows on its preview and not on the live site; a Spotify and an Apple Podcasts episode play; a form added by chat
   sends, lands in the Sheet's Forms tab (after item 2) and emails the owner.
17. Turn uploads on for that site: `docs/EDITING.md`, "Set up uploads on one site", steps h to l. Then confirm a portrait
   iPhone HEIC photo shows upright, a PDF downloads with the sandbox header, a phone video is refused, and a transparent
   PNG logo stays transparent.
18. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
19. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
20. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor, uploads, collections and
    brand settings, and forms with the ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering
    and ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the
    same runs.
21. Connect a site to a Pipeline app copy (only mocked tests so far): set `INTAKE_SECRET` in the app copy and the site,
    set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`, `npm run sync:config`,
    merge, then send one test note and delete the test lead. Optional: teach the intake a form-name field (today the
    form's name is the first line of the message).
22. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
23. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id. Forms add no id.
24. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
25. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 5).
26. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template defaults.
27. Optional, later: an expired site notice comes down only at the next publish; a daily scheduled rebuild would fix it
    (an account step, not built).
28. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Sites can now sell from a portfolio: a filterable gallery, a page per piece and an instant price estimate.
- Every price shown is an estimate (a range or "About"), never a firm price, and comes only from the owner's table.
- A visitor can request a quote; it reaches the owner the usual way and emails the visitor their estimate.
- Owners add pieces, change filters and change prices by chat; a price change shows which pieces it moves.
- A first load of many pieces is Huston Logic's job: an import from a spreadsheet and a folder of photos.
- Catalog photos stay in each site's repo; past about 1,500 pieces a site would need photo storage (a later build).

## Last run: Catalog, price ranges and quotes (2026-11-27)

Process run, unattended. Design (23 rulings, measured numbers): `docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md`;
plan beside it in `plans/`. Opus designed, integrated and verified; Sonnet built the core, then four parts in parallel
worktrees, then two fix waves; Haiku drafted the docs; the three reviewers ran once. One PR: #37.

- **Checks:** full `npm run check` passes (1,027 Worker and shared-module tests, 580 script tests, content and design
  checks, build); `npm run test:a11y` 139 passed; `npm run test:tracking` 8 passed, including the acceptance walk (ad
  landing, two filters, a piece, options, a quote through the real Worker code: Sheet row, owner email and visitor
  email carry the page's estimate and the source); local Lighthouse 100 on every audited page (`/blocks` SEO 69 as a
  noindex page, as on `main`); the 500-piece fixture builds (578 pages in under 2 s of page generation).
- **Owner sayings** pass as editor tests (add a piece with a photo, raise 18k gold 5 percent, add a Style filter, hide
  a price, archive). A forged range is refused (400); a stale selection answers 409.
- **Reviews and critique, all fixed:** utm and click IDs stripped from the address on landing; every exact price sent
  to the browser and listed in `/catalog.json` for drafts; the catalog read before the cheap layers; focus, stepper,
  live-region and no-JS photo issues; a duplicate Estimate label, an empty people box and a letterboxed photo frame.
- **Judgment calls (all in the design):** exact prices in `pricing.json`; server-rendered cards with a small filter
  island; pieces at `<catalog page>/<slug>`; the Worker reads `/catalog.json` through ASSETS; photos in the repo.
- **New dependencies:** none.

| Measure | This run |
|---|---|
| Wall-clock time | about 1 hour 20 minutes (13:55 to about 15:15, PR open, reviewed and fixed) |
| Commits | 30 plus 5 merge commits |
| Time in checks | about 35 minutes (`check:fast` per commit and in 7 worktrees, 5 full checks, 6 builds, 3 a11y runs, 4 tracking runs, 1 Lighthouse CI run and 12 single Lighthouse runs, 3 fixture builds) |
| Time waiting on CI | 0 (auto-merge queued) |
