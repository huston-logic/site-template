# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-25.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #30, all merged except #3 (Dependabot, closed unmerged). #29 (pages as blocks) and #30 (thanks
  page links checked, change report traces blocks, build stamp `/site-version.json`, `/blocks` on previews only) merged
  on 2026-11-25.
- **Open:** #31, the site editor (`feat/owner-editor`), queued for auto-merge behind the required checks.
- **Site editor (in #31):** owners change their pages by chatting with their own AI app. MCP tools on the site's Worker
  (`/mcp`), propose then publish through a `change/owner-...` pull request and the required checks, "is it live" from
  `/site-version.json`, undo, requests recorded as `owner-request` issues, an owner page (`/owner`) behind Cloudflare
  Access, one GitHub App per site. Off by default (`editor.enabled: false`); built and tested against mocks only.
  How it works and setup: `docs/EDITING.md`.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that #31 merged. Its "Needs your eyes" line names one new runtime dependency for the Worker only
   (`@cloudflare/workers-oauth-provider` 1.2.4, the Pipeline app's version) and changes to AGENTS.md, README,
   package.json and PROCESS.md rule 14's wording.
2. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from the
   last run. Either commit them on their own branch and PR (as before), or do item 3, whose file already includes them.
3. Decide the content fast lane: read `docs/proposals/content-fast-lane.md`. To adopt it: first change the "Protect
   main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 17 to
   PROCESS.md (text in the proposal).
4. Turn the editor on for the first site (accounts and secrets, so yours): follow `docs/EDITING.md`, "Set up the editor on
   one site", steps a to g: create the site's GitHub App (exact permissions listed), install it on that repo only, set
   `GITHUB_APP_PRIVATE_KEY` for production only, create the `OAUTH_KV` and `EDITOR_KV` namespaces, create the Access app
   for `<domain>/owner` (one-time PIN, owner emails), fill `editor` in `site.config.ts`, `npm run sync:config`, merge.
   Preconditions: the ruleset with its required checks and "Allow auto-merge" (without them the editor publishes nothing
   and says so), the `owner-request` label, and watching the repo.
5. On that first site, confirm what mocks could not: a real AI app connects (Claude custom connector); `/site-version.json`
   shows the deployed commit (Workers Builds sets `WORKERS_CI_COMMIT_SHA`); `/blocks` is the 404 page on the live site; a
   preview link opens (alias rule `change-owner-<id>-<worker>.<subdomain>.workers.dev`); the Workers Builds check's name
   starts with `Workers Builds` (else adjust `editor.ignoredChecks`); and note the yes-to-live minutes the owner page shows.
6. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`
   (recommended: a small gateway Worker per client; not built).
7. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
8. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor with the ready-to-paste
   message in `docs/EDITING.md`: huston-logic/structural-integrity-engineering and ghuston/huston-tech-website. Port the
   earlier process items (managed hosting, the Pipeline destination) in the same runs.
9. Connect a site to a Pipeline app copy (unchanged; only mocked tests so far): set `INTAKE_SECRET` in the app copy and
   the site (`npx wrangler secret put INTAKE_SECRET`, and `npx wrangler preview base-config secret put INTAKE_SECRET`),
   set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`, `npm run sync:config`,
   merge, then send one test note and delete the test lead.
10. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
11. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id (next new site: 2001, 2002, 2003).
12. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
13. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 2).
14. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template
    defaults.
15. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
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
- Site owners can change their pages by chatting with their own AI app; the site checks each change, shows exactly what will change, and publishes only after the owner says yes.
- Only the owner emails Huston Logic lists for a site can sign in; each site can write only its own pages, in its own repo.
- Requests the site's sections cannot handle are recorded for Huston Logic automatically.
- The block showcase now appears on preview sites only, never on a live site.

## Last run: Owner sign-in and chat tools (2026-11-25)

Process run, unattended, from Grant's brief. Design: `docs/superpowers/specs/2026-11-25-owner-chat-tools-design.md`
(rulings marked "Ruling", builder-check answers included). Plan: `docs/superpowers/plans/2026-11-25-owner-chat-tools.md`.
Opus designed, coordinated and did the correctness review; Sonnet implemented (the two leftovers and the owner page in
their own git worktrees, in parallel with the editor work); Haiku read the Pipeline app's sign-in and wrote the docs.
Two PRs: #30 (leftovers, merged) and #31 (site editor, open, auto-merge queued).

- **Checks:** full `npm run check` passes (244 Worker tests, 432 script tests, content and design checks, build);
  `npm run test:a11y` passes locally (78, owner page at 390 and 1440 included); the Worker bundles (406 KB).
- **Reviews:** #30: review-code and review-security (1 medium, 4 low, all fixed). #31: review-security (nothing High or
  Critical), review-code, review-a11y, an Opus correctness review, and a design critique of the owner page; all
  findings fixed in two fix waves or recorded as rulings.
- **Judgment calls:** consent page inside the Access-protected `/owner/connect` (no Access for SaaS app); hand-written
  MCP, no SDK; drafts in KV for 3 days, history stays in git; one change in flight; the owner's yes is relayed by their
  AI app (the brief's direction; risk written down); a "clean" auto-merge answer never merges directly (fail closed);
  "Remove the second testimonial" is tested on a highlights list (no testimonial block exists).
- **Speed:** required CI takes about 4 minutes per PR (Lighthouse is the slowest job, 6 pages x 3 runs); yes-to-live is
  that plus the Workers Builds deploy, not yet measured live. The fast lane would cut Lighthouse to the changed pages.
- **New dependencies:** `@cloudflare/workers-oauth-provider` 1.2.4 (exact, 34 days old, Worker only).

| Measure | This run |
|---|---|
| Wall-clock time | about 95 minutes (about 16:20 to 17:55, both PRs open and reviewed) |
| Commits | 24 (6 in #30, 18 in #31) plus 2 merge commits |
| Time in checks | about 10 minutes (`check:fast` per commit, 3 full checks, one local a11y run) |
| Time waiting on CI | about 3 minutes (B5 waited for #30's last checks; other work filled the rest) |
