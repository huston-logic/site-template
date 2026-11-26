# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-25.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #32, all merged except #3 (Dependabot, closed unmerged). #32 (uploads and photos) merged on
  2026-11-25.
- **Open:** #33, collections and brand settings (`feat/collections-and-brand`), queued for auto-merge behind the
  required checks.
- **Site editor and uploads (in `main`):** owners change pages and add photos and PDFs by chatting; both off by default
  (`editor.enabled`, `editor.uploads.enabled`), built and tested against mocks only. `docs/EDITING.md`.
- **Collections and brand settings (in #33):** a blog (post pages, drafts, a paginated list, an RSS feed), videos,
  podcast episodes (Spotify and Apple Podcasts players that load nothing until play), testimonials and team, each item
  one JSON file; seven new sections (latest posts, post index, videos, episodes, testimonials, team, business details);
  owner-editable business details, brand colors (contrast-checked), curated fonts, a logo from an upload, and a
  site-wide notice; 4 new AI tools and 4 new operations. All works by chat once the editor is on. Mocks only.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that #33 merged. "Needs your eyes": AGENTS.md (Worker-allowed modules, files the editor writes, palette and
   fonts now generated from `src/content/brand.json`, LinkedIn now a social link), package.json (test globs only; no
   dependency change), README (CSP origins for Spotify and Apple Podcasts), site.config.ts (`theme`, `brand.logo`,
   `owner.phone` and `contact.linkedInUrl` removed; `business.timeZone`, `contact.emailColors` and `editor.pageColors`
   added), lighthouserc.cjs (reads `auditRoutes`; no threshold changed), public/_headers (two player origins).
2. Decide [docs/proposals/lighthouse-compression.md](proposals/lighthouse-compression.md): the Lighthouse test server
   sends files uncompressed (Cloudflare compresses them), so a page led by a photo on a phone (a blog post with a lead
   photo, or a photo section right under a short hero) scores 77 to 79 and fails the required `lighthouse` check,
   although the live site is fast. With gzip in `scripts/preview.mjs` it scored 90 and every other page 100. It changes
   CI behavior, so it is yours; no threshold changes. Until then an owner's post with a lead photo can stay stuck.
3. For each client site, set the new per-client values: `business.timeZone` in `site.config.ts` (an IANA zone, for the
   notice's end date), the palette, fonts and logo in `src/content/brand.json`, the business details in
   `src/content/business.json`, then `npm run sync:config`. Remove or archive the template's example posts, videos,
   episodes, testimonials and team member the site does not use (the launch gate fails on their placeholders).
4. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 5, whose file already includes them.
5. Decide the content fast lane: `docs/proposals/content-fast-lane.md` (its `lighthouserc.cjs.proposed` now reads
   `auditRoutes`, like the real file). To adopt it: first change the "Protect main" ruleset to add `change-scope` as a
   required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 17 to
   PROCESS.md (text in the proposal). Collections make this more pressing: the scope check's item, settings and brand
   rules block an editor change only once `change-scope` is required.
6. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Brand changes by chat also need `editor.workersSubdomain` set, because a brand change must be
   previewed before it can publish.
7. On that first site, confirm what mocks could not: a real AI app connects; `/site-version.json` shows the deployed
   commit and `drafts: false`; `/blocks` is the 404 page; a preview link opens; the yes-to-live minutes; a draft post
   shows on its preview and not on the live site; a Spotify and an Apple Podcasts episode play after one or two presses.
8. Turn uploads on for that site: `docs/EDITING.md`, "Set up uploads on one site", steps h to l. Then confirm on the
   real site: a portrait iPhone HEIC photo shows upright; a PDF downloads with the sandbox header; a phone video is
   refused; and new for logos, a transparent PNG logo stays transparent after conversion (if it gains a background, the
   fix is in the Worker's conversion options, a Huston Logic change).
9. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
10. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
11. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor, uploads, and collections
    and brand settings with the ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering
    and ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the
    same runs.
12. Connect a site to a Pipeline app copy (unchanged; only mocked tests so far): set `INTAKE_SECRET` in the app copy and
    the site, set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`,
    `npm run sync:config`, merge, then send one test note and delete the test lead.
13. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
14. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id (next new site: 2001, 2002, 2003).
15. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
16. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 4).
17. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template
    defaults.
18. Optional, later: an expired site notice comes down only at the next publish. A daily scheduled rebuild (a Workers
    Builds deploy hook called by a cron) would take it down on time; it needs an account step, so it was not built.
19. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Site owners can keep a blog by chatting: write a post in their voice, save it as a draft, preview it, then publish it.
- Owners can list their videos and podcast episodes (YouTube, Vimeo, Spotify, Apple Podcasts) and show testimonials and their team.
- A testimonial needs a quote and a named person the owner gives; the AI is told never to invent quotes, people or numbers.
- Owners can change their phone, email, address, opening hours and social links themselves; the whole site follows.
- Owners can change their brand color and accent, choose fonts from a short designed list, and swap in a new logo.
- A brand color that would make any text hard to read is refused, with the nearest color that works.
- A brand change is always previewed before the owner says yes, because it changes every page.
- Owners can put up a one-line notice on every page with an end date, and take it down by chatting.
- Spacing, shapes, motion, background colors, SVG logos and new fonts stay Huston Logic changes.
- Where form notes are sent, the booking link and the email settings stay with Huston Logic.

## Last run: Collections and brand settings (2026-11-25)

Process run, unattended, from Grant's brief. Design: `docs/superpowers/specs/2026-11-25-collections-and-brand-design.md`
(30 rulings with costs, builder-check answers). Plan: `docs/superpowers/plans/2026-11-25-collections-and-brand.md`. Opus
designed, coordinated, did the design critique and the final rulings; Sonnet implemented nine tasks (in parallel git
worktrees, four at once) and two fix waves; a Sonnet builder check read the design; Haiku wrote the docs. One PR: #33.

- **Checks:** full `npm run check` passes (554 Worker and shared-module tests, 512 script tests, content and design
  checks, build); `npm run test:a11y` passes locally (110 passed, 4 skipped); `npm run test:lighthouse` passes locally (every page 100 for performance, accessibility, best practices and SEO; the showcase 98, its SEO 69 as a noindex page).
  All seven acceptance sayings are tests in `worker/editor/collections-acceptance.test.ts`. A trial brand change to a
  darker green was built and looked at; a pale mint was refused with the nearest passing color.
- **Reviews:** review-code (3 Medium: notice end date wording, brand changes on a site without previews, a drafts flag
  in the build stamp), review-security (4 Low: header comment, a commit-path allow-list, iframe sandbox parked, a
  comment), review-a11y (5 Medium copy-in-JSX, a link name that did not start with its visible words), the axe scan (2
  more), a local Lighthouse run (a post led by a photo scored 78; traced to the uncompressed test server and queued for Grant), and the design critique (post page without a hero, testimonial hierarchy, team grid, empty card panels on
  phones, thin showcase examples; glows and shadows that ignored the brand colors). All fixed except the parked sandbox.
- **Judgment calls:** one PR (the parts share the editor and the checks); brand values moved from `site.config.ts` to
  `src/content/brand.json`, with `palette.css` and `fonts.ts` generated from it; the owner changes two color roles,
  the rest derive; drafts build everywhere except a Workers Builds production build; one catch-all blog route (a static
  export cannot have an empty dynamic route); 10 posts per page; the auto-reply email and owner page keep their own
  colors; the OG image keeps Outfit; the notice is judged at build time in `business.timeZone`; the template's example post leads with text, not a photo, until the Lighthouse server question (Needs Grant 2) is decided.
- **New dependencies:** none.

| Measure | This run |
|---|---|
| Wall-clock time | about 1 hour 30 minutes (19:11 to about 20:40, PR open and reviewed) |
| Commits | 18 plus 10 merge commits |
| Time in checks | about 20 minutes (`check:fast` per commit and in each worktree, 3 full checks, 2 local a11y runs, 1 local Lighthouse run) |
| Time waiting on CI | 0: auto-merge is queued; nothing waited on CI |
