# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-25.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #31, all merged except #3 (Dependabot, closed unmerged). #31 (the site editor) merged on
  2026-11-25.
- **Open:** #32, uploads and photos (`feat/uploads-and-photos`), queued for auto-merge behind the required checks.
- **Site editor (in `main`):** owners change their pages by chatting with their own AI app; off by default
  (`editor.enabled: false`), built and tested against mocks only. `docs/EDITING.md`.
- **Uploads and photos (in #32):** an "Your uploads" section on `/owner` (several photos from a phone, thumbnails,
  rename, remove; works without JavaScript); phone photos (HEIC included) become web-ready WebP through the Cloudflare
  Images binding; a private R2 inbox per site, 30-day expiry; AI tools `list_uploads`, `view_upload`, `remove_upload`
  and `upload:<id>` in proposals; new `photo-text` and `gallery` blocks and photos on `highlights`; PDF downloads with
  scope-check rules. Off by default (`editor.uploads.enabled: false`); mocks only. Setup: `docs/EDITING.md`, "Set up
  uploads on one site".
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that #32 merged. "Needs your eyes": AGENTS.md (upload paths, uploads security bullet, `src/lib/pdf-scan.ts`
   allowed in the Worker), package.json (one test glob; no dependency change), site.config.ts (`editor.uploads`, off),
   public/_headers (generated `/files/*` block).
2. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 3, whose file already includes them.
3. Decide the content fast lane: read `docs/proposals/content-fast-lane.md`. To adopt it: first change the "Protect
   main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 17 to
   PROCESS.md (text in the proposal). Uploads make this more pressing: the scope check's PDF and photo rules block an
   editor change only once `change-scope` is required.
4. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Preconditions: the ruleset with its required checks, "Allow auto-merge", the `owner-request`
   label, and watching the repo.
5. On that first site, confirm what mocks could not: a real AI app connects (Claude custom connector);
   `/site-version.json` shows the deployed commit; `/blocks` is the 404 page on the live site; a preview link opens; the
   Workers Builds check's name starts with `Workers Builds`; and note the yes-to-live minutes the owner page shows.
6. Turn uploads on for that site (account steps, so yours): `docs/EDITING.md`, "Set up uploads on one site", steps h to
   l: `npx wrangler r2 bucket create <workerName>-uploads` (private, no public access);
   `npx wrangler r2 bucket lifecycle add <workerName>-uploads expire-inbox --expire-days 31`; check Cloudflare Images is
   on the account (Free plan is enough); set `editor.uploads.bucket` and `editor.uploads.enabled: true`,
   `npm run sync:config`, PR, merge.
7. On that site, confirm what mocks could not (step l): an iPhone HEIC photo taken in portrait shows upright on
   `/owner` and in a published gallery (Cloudflare Images is relied on to apply the rotation; if it is sideways, a fix
   is a `rotate` from the photo's orientation); a PDF downloads from `/files/...` and its response carries both the site
   CSP and `Content-Security-Policy: sandbox`; a phone video is refused with the YouTube/Vimeo message.
8. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
9. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
10. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor and uploads with the
    ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering and
    ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the same runs.
11. Connect a site to a Pipeline app copy (unchanged; only mocked tests so far): set `INTAKE_SECRET` in the app copy and
    the site, set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`,
    `npm run sync:config`, merge, then send one test note and delete the test lead.
12. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
13. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id (next new site: 2001, 2002, 2003).
14. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
15. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 2).
16. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template
    defaults.
17. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Site owners can upload photos and PDFs from their phone on their owner page, then ask their AI app to use them.
- Phone photos, iPhone ones included, are made web-ready automatically: right size, fast to load, location and camera data removed; owners never resize or convert.
- Uploads stay private until the owner says yes to a change that uses them; unused uploads are removed after 30 days.
- Every photo on a site needs a description for people who cannot see it; the owner sees it before saying yes.
- Sites gain two new section designs, a photo with text and a photo gallery, and photos on the highlights section.
- Owners can offer a PDF to download from any button or link; PDFs with scripts or attached files are refused.
- Video files are not uploaded; owners add videos as YouTube or Vimeo links.
- Uploads cost next to nothing per site: storage and photo conversion fit Cloudflare's free allowances at expected use.

## Last run: Uploads and photos (2026-11-25)

Process run, unattended, from Grant's brief. Design: `docs/superpowers/specs/2026-11-25-uploads-and-photos-design.md`
(rulings marked "Ruling", costs, builder-check answers). Plan: `docs/superpowers/plans/2026-11-25-uploads-and-photos.md`.
Opus designed, coordinated, did the correctness review and the design critique; Sonnet implemented seven tasks (three
in parallel git worktrees, then two fix waves in parallel); a Sonnet builder check read the design; Haiku wrote the docs.
One PR: #32 (open, auto-merge queued).

- **Checks:** full `npm run check` passes (349 Worker tests, 478 script tests, content and design checks, build);
  `npm run test:a11y` passes locally (102 passed, 4 skipped; owner page upload states at 390 and 1440); the Worker
  bundles with esbuild (476 KB; the guard hook blocks `wrangler deploy --dry-run`, so esbuild was used instead).
- **Reviews:** review-security (nothing High or Critical; 1 Medium: a PDF name ended by a NUL byte slipped past the
  Worker's scan; fixed with one shared scanner and a parity test), review-code (PDF parity; module state in the change
  list; soft limits), review-a11y (2 High: focus lost during uploads, failures not announced; 5 Medium), and the design
  critique (upload cards too heavy on phones: redesigned). All fixed.
- **Judgment calls:** Cloudflare Images binding for conversion (no dependency, no paid service); one private R2 bucket
  per site; WebP at 1600 px and at most 450 KB, one size (no `srcset` yet); photos named by id in the repo, PDFs by a
  readable slug plus id; previews may show an upload before the yes (the preview link is unlisted); the hero stays
  photo-free (the approved first screen has none); example photos are abstract still lifes drawn locally (no stock
  downloads); daily cap and inbox total are soft limits under concurrent uploads; PDF document properties are kept.
- **New dependencies:** none.

| Measure | This run |
|---|---|
| Wall-clock time | about 55 minutes (about 17:40 to 18:35, PR open and reviewed) |
| Commits | 13 plus 3 merge commits |
| Time in checks | about 12 minutes (`check:fast` per commit and in each worktree, 2 full checks, 2 local a11y runs) |
| Time waiting on CI | 0: auto-merge is queued; nothing waited on CI |
