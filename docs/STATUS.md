# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-25.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #28, all merged except #3 (Dependabot, closed unmerged). #27 and #28 (managed hosting, form
  contacts to a Pipeline app copy) merged on 2026-11-25.
- **Open:** the "Pages as blocks" PR (`feat/pages-as-blocks`), queued for auto-merge behind the required checks.
- **Pages as blocks (in that PR):** every page is a JSON file in `src/content/pages/` (a list of designed blocks), built
  by one renderer; menu, sitemap and route list come from the same files. 10 library blocks, a site's own blocks in
  `src/site-blocks/`, `npm run check:content` (also inside the build), `npm run check:design` (tokens and motion), the
  generated catalog (`docs/BLOCKS.md`, `docs/blocks.json`), the `/blocks` showcase, client-facing
  `docs/EDITING-LANES.md`, `docs/CONVERT-TO-BLOCKS.md`, and PROCESS.md rule 16 (the block gate).
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that the "Pages as blocks" PR merged. Read its "Needs your eyes" line first (AGENTS.md, README, package.json,
   `lighthouserc.cjs` and the security headers changed).
2. Add the content and design checks to CI by name (owner-only file; the build already refuses bad pages, so this only
   makes failures easier to read). On a new branch in this repo:
   `cp /private/tmp/claude-501/-Users-granthuston--claude-spares-spare-BeCWLJ/940d8130-1ab2-43cd-a8a1-8416ef4050b3/scratchpad/proposed/.github/workflows/ci.yml.proposed .github/workflows/ci.yml`,
   then commit and open a PR. If the scratchpad was cleared, the change is two steps in the `check` job, before "Build
   static export": `- name: Content check` / `run: npm run check:content` and `- name: Design check` /
   `run: npm run check:design`. Job names do not change, so the ruleset needs no change.
3. Update Playwright's Chromium on your Mac (installing a browser needs your OK, so it was not done):
   `npx playwright install chromium`. The installed build (1248) is older than the one Playwright now wants (1254), so
   `npm run test:a11y` cannot start locally. This run used Google Chrome instead; CI installs its own.
4. Decide whether the `/blocks` showcase should ship on live client sites. Today it is built everywhere: noindex, not in
   the menu or sitemap, but reachable by its address.
5. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md` (it ends with a ready-to-paste run message):
   huston-logic/structural-integrity-engineering and ghuston/huston-tech-website. Port the earlier process items
   (managed hosting, the Pipeline destination) in the same runs.
6. Connect a site to a Pipeline app copy (unchanged from last run; only mocked tests so far): set `INTAKE_SECRET` in the
   app copy and the site (`npx wrangler secret put INTAKE_SECRET`, and `npx wrangler preview base-config secret put
   INTAKE_SECRET`), set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds` in
   `site.config.ts`, `npm run sync:config`, merge, then send one test note and delete the test lead.
7. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
8. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
   Cloudflare account, give one a new pair.
9. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
   name". That is false under managed hosting.
10. Decide whether CI's `check` job should also run `npm run check:process` (same kind of owner-only CI edit as item 2).
11. Decide how strict mode is enforced. Today it applies only to branches named `change/...` (limit in
    `docs/CHANGE-SCOPE.md`). The ruleset or CODEOWNERS can close that.
12. After 5 clean runs of `change-scope`, and a deliberate-failure proof PR on a `change/` branch, decide whether to make
    it a required check (change the ruleset first, then the workflow).
13. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template
    defaults.
14. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

- Website build rules now live in docs/PROCESS.md in huston-logic/site-template; the master links to it.
- Website docs describe managed hosting and offboarding; template sites can send form contacts to a Pipeline app copy.
- Website pages are now data: each page is a list of designed sections, so most client changes are data a check can verify.
- Clients change their own words, prices, contact details, legal text, links and pages; these no longer wait for Huston Logic review.
- Pages are archived, never deleted, and can be restored.
- A new section design joins a site's library only after the block gate: example, showcase, token and motion checks, and a design review at desktop and phone width.
- Every site can show YouTube and Vimeo videos; nothing loads from those sites until a visitor presses play.
- Clients get a plain "what you can change" guide in three lanes: do it yourself, do it once it is built, Huston Logic builds it.

## Last run: Pages as blocks (2026-11-25)

Process run, unattended, from Grant's brief. Design: `docs/superpowers/specs/2026-11-25-pages-as-blocks-design.md`
(its rulings are marked "Ruling"). Plan: `docs/superpowers/plans/2026-11-25-pages-as-blocks.md`. Opus designed,
coordinated and reviewed; Sonnet implemented Tasks 1 to 7a; Haiku drafted the client docs and the scope and process docs;
the review-code, review-a11y and review-security agents each read the branch once, and the design critique used
screenshots of `/blocks` at 1440 and 390 wide. One PR (one feature area).

- **No visible change:** the five pages and the thanks page, screenshotted against a build of `main` at 390 and 1440 wide
  (reduced motion), are pixel-identical apart from 1 to 2 levels of 255 inside the soft glows. `main`'s own pictures
  differ by the same amounts between two runs of the same build, so that is gradient rendering noise.
- **Checks:** full `npm run check` passes; the a11y scan passes (50 tests, `/blocks` included; run on Google Chrome);
  Lighthouse is 100 in every category on every page (`/blocks` SEO not asserted: noindex by design).
- **Judgment calls:** pages are JSON (no code in a page file); one-level paths; no colored bands (style guide v3 uses
  glows); the entrance is a 16px rise with no fade, by `IntersectionObserver` (a first scroll-driven version broke
  AGENTS.md's no-scroll-linked rule, and its fade made Lighthouse read faint text); YouTube and Vimeo frame and autoplay
  permissions are on for every site; Lighthouse checks `/blocks` without SEO through `assertMatrix` (existing pages keep
  all four thresholds); the contact-fields module and the route list moved to tier 3; deleting a page file is tier 3;
  the "Flagged for Grant" list and the new-page code grammar were removed (nothing else used it); a video grid always has
  a heading; three-column grids need three items to use three columns; no photo section yet (`docs/EDITING-LANES.md`
  says so).
- **Review fixes:** video play control named for what a press does; video words made plain data (a client may edit
  them); a removed picture now runs the content check; the change report photographs the before side of a new page file
  (needed for conversions); `/404` and `/index` reserved; per-page entrance reset.
- **Not done, noted:** the thanks page's own links (in `contact.ts`) are not checked against archived pages; the change
  report still photographs every page for most component changes (slow, not wrong); the header and footer nav labels
  are written in JSX (older than this run); the README's "Framework step names" row is stale (older than this run).
- **New dependencies:** none.

| Measure | This run |
|---|---|
| Wall-clock time | about 80 minutes (about 12:15 to 13:35, PR open and reviewed) |
| Commits | 13 |
| Time in checks | about 20 minutes (`check:fast` per commit, 4 cold builds, 3 a11y runs, 3 Lighthouse runs, 4 screenshot reports) |
| Time waiting on CI | 0: auto-merge is queued; nothing waited on CI |
