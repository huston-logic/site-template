# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-27.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #35, all merged except #3 (Dependabot, closed unmerged). #35 (forms and downloads) merged on
  2026-11-26.
- **Open:** PR_NUMBER, ad tracking and lead source (`feat/ad-tracking`), queued for auto-merge behind the required checks.
- **Site editor, uploads, collections, brand and forms (in `main`):** owners change pages, add photos and PDFs, keep a
  blog, list videos, episodes, testimonials and team, change business details, brand and a notice, and add forms by
  chatting; the editor and uploads are off by default, built and tested against mocks only. `docs/EDITING.md`.
- **Ad tracking and lead source (in PR_NUMBER):** GA4, Google Ads and Meta Pixel tags behind owner-only IDs (all null),
  production only, never under GPC; one event list; a Worker-set `hl_src` cookie keeps the first and last tagged touch
  for 90 days, and every submission carries it to the Sheet, the email and the Pipeline post. `docs/TRACKING.md`.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that PR_NUMBER merged (auto-merge queued). "Needs your eyes": AGENTS.md (the tracking layer in Architecture,
   the Lead source paragraph, `TrackingTags` as a client component, gtag.js and the Meta Pixel as script exceptions,
   the GA4 wildcard CSP exception, `TRACKING_FIXTURE`, `npm run test:tracking`), README (ad tracking CSP origins),
   package.json (new `test:tracking` script, test glob `src/tracking/*.test.ts`; no dependency change), site.config.ts
   (new `tracking` group, all null), next.config.ts (the tag-slot alias), `docs/apps-script/contact-sheet.gs` (header
   comments only; no redeploy).
2. For each site that saves to the Google Sheet: add five header cells to row 1, `Came from | Campaign | Click ID |
   First seen (UTC) | Days to note`: columns L to P on "Submissions" and "Preview", G to K on "Forms" and "Forms
   preview". Nothing else: rows already save with the new cells (the Apps Script takes up to 20 columns), and sites on
   the Pipeline app need nothing.
3. Before ads run on a site (accounts, so yours): `docs/TRACKING.md`, "Set up one site", steps 1 to 11: GA4 property and
   two enhanced-measurement switches off, Google Ads Lead and Purchase conversion actions and labels, auto-tagging on,
   enhanced conversions off, link Ads to GA4, key events, the Meta Pixel with Automatic advanced matching off. Put the
   IDs in `site.config.ts`, `npm run sync:config`, PR. Then test each tag on the live site and update the privacy page
   (`docs/LAUNCH-CHECKLIST.md` D12 to D15; the privacy wording is a copy decision for you and the client).
4. On the first live site with tracking, confirm what local tests could not: GA4 DebugView and Meta Test events show the
   events, the console has no CSP error, and a Safari visitor back after 7+ days still shows the ad (ruling 2).
5. Pipeline app (separate repo): confirm `/intake` treats the new `source` and `attribution` as outside text (a visitor
   can forge the cookie), and decide whether to store `attribution`.
6. Decide whether Google Ads should build remarketing lists. Off now: page views go to GA4 only, because a page view to
   Ads sets third-party cookies on every page (best practices fell to 73). Ruling 17 in
   `docs/superpowers/specs/2026-11-27-ad-tracking-design.md`.
7. For each site that saves to the Google Sheet, before its owner adds a form: open the Sheet, add two tabs named
   "Forms" and "Forms preview", each with the header row `Received (UTC) | Form | Name | Email | Answers | Mode`; for the
   Apps Script writer, paste the new `docs/apps-script/contact-sheet.gs` into the script, set Script Properties
   `TAB_FORMS` and `TAB_FORMS_PREVIEW` only if you named the tabs differently, then Deploy, Manage deployments, edit the
   web app, New version (same URL, so no Worker secret changes). Until then a new form's answers still reach the owner
   by email, which says "Sheet: NOT saved - add this one by hand". Sites on the Pipeline app need nothing.
8. On the first real site with a download form, send one test submission and look at the email the visitor gets (only
   mocked so far), then delete the test row or lead.
9. For each client site, set the per-client values from the last run: `business.timeZone` in `site.config.ts`, the
   palette, fonts and logo in `src/content/brand.json`, the business details in `src/content/business.json`, then
   `npm run sync:config`. Remove or archive the template's example posts, videos, episodes, testimonials and team member
   the site does not use (the launch gate fails on their placeholders).
10. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 6, whose file already includes them.
11. Decide the content fast lane: `docs/proposals/content-fast-lane.md` (its rule is now numbered 18). To adopt it: first
   change the "Protect main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 18 to
   PROCESS.md (text in the proposal). Forms add to the reasons: the scope check's form rules block an editor change only
   once `change-scope` is required.
12. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Brand changes by chat also need `editor.workersSubdomain` set.
13. On that first site, confirm what mocks could not: a real AI app connects; `/site-version.json` shows the deployed
   commit and `drafts: false`; `/blocks` is the 404 page; a preview link opens; the yes-to-live minutes; a draft post
   shows on its preview and not on the live site; a Spotify and an Apple Podcasts episode play; a form added by chat
   sends, lands in the Sheet's Forms tab (after item 2) and emails the owner.
14. Turn uploads on for that site: `docs/EDITING.md`, "Set up uploads on one site", steps h to l. Then confirm a portrait
   iPhone HEIC photo shows upright, a PDF downloads with the sandbox header, a phone video is refused, and a transparent
   PNG logo stays transparent.
15. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
16. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
17. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor, uploads, collections and
    brand settings, and forms with the ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering
    and ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the
    same runs.
18. Connect a site to a Pipeline app copy (only mocked tests so far): set `INTAKE_SECRET` in the app copy and the site,
    set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`, `npm run sync:config`,
    merge, then send one test note and delete the test lead. Optional: teach the intake a form-name field (today the
    form's name is the first line of the message).
19. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
20. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id. Forms add no id.
21. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
22. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 5).
23. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template defaults.
24. Optional, later: an expired site notice comes down only at the next publish; a daily scheduled rebuild would fix it
    (an account step, not built).
25. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Sites can carry Google Analytics, Google Ads and Meta Pixel tags; Huston Logic sets the IDs, owners cannot by chat.
- The tags load only on the live site, and never for a visitor whose browser sends Global Privacy Control; no banner.
- Every lead in the Sheet, the owner's email and the Pipeline app now shows which ad or site it came from.
- A visitor who clicks an ad and comes back within 90 days is still credited to that ad.
- Google Ads gets conversions only, with no remarketing lists, so no third-party cookies land on every page.
- No personal data goes to Google or Meta; their automatic matching settings must stay off in each ad account.
- A site with tracking on must say so on its privacy page; suggested wording is in the tracking guide.
- In the weekly ad report the Sheet is the lead count; spend comes from the ad accounts and the funnel from GA4.

## Last run: Ad tracking and lead source (2026-11-27)

Process run, unattended. Design (18 rulings with costs): `docs/superpowers/specs/2026-11-27-ad-tracking-design.md`; plan:
`docs/superpowers/plans/2026-11-27-ad-tracking.md`. Opus designed, integrated, tested and fixed; three Sonnet
implementers in parallel worktrees; Haiku drafted the docs; the three reviewers ran once. One PR: PR_NUMBER.

- **Checks:** full `npm run check` passes (832 Worker and shared-module tests, 543 script tests, content and design
  checks, build). With no IDs, `public/_headers` is byte-identical to `main`, all 9 pages are pixel-identical at
  desktop and phone (`npm run report:changes`, `npm run compare:screens`), no page asks a new host or `/api/visit`;
  each page makes one more same-origin request (a JS chunk Turbopack split in two after it grew about 460 bytes;
  ruling 4). With the fixture IDs: `npm run test:tracking` (new, 6 browser tests, outside hosts stubbed) passes,
  including a page and form made by the editor's own operations, and GPC loading nothing; Lighthouse with the tags on
  scores 100/100/100/100 on every page (the showcase SEO 69 as a noindex page, as on `main`).
- **Found by the fixture Lighthouse run and fixed:** a missing Ads script host in the CSP, and page views sent to Google
  Ads setting third-party cookies (best practices 73 on every page).
- **Reviews:** review-code (a throwing ad script could stop a form's success step; a stale page title; a bare visit could
  create an empty first touch; a utm tag without utm_source read "Direct"), review-security (no high; medium: the Meta
  Pixel's automatic configuration and advanced matching could read forms; low: the fixture on a preview build, the
  page address sent to GA4 kept every parameter, the GA4 wildcard origins undocumented), review-a11y (none; the same
  success-step point). All fixed. Design critique: nothing visible changed (pixel-identical), so none was needed.
- **Judgment calls (all in the design):** the cookie comes from `POST /api/visit`, not a Worker before every page; capture
  only tagged or referred visits; a build-time alias keeps tag code out of builds without IDs; the capture script stays
  under 400 characters (Next's 2 KB prefetch-inlining limit); GA4 gets `generate_lead`; page views to GA4 only.
- **New dependencies:** none.

| Measure | This run |
|---|---|
| Wall-clock time | about 50 minutes (12:22 to about 13:10, PR open and reviewed) |
| Commits | COMMIT_COUNT |
| Time in checks | about 25 minutes (`check:fast` per commit in four places, 2 full checks, 8 builds, 2 local Lighthouse runs, 4 browser test runs, 1 change report) |
| Time waiting on CI | 0 (auto-merge queued; the next run does not depend on it) |
