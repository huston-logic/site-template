# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-25.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #34, all merged except #3 (Dependabot, closed unmerged). #33 (collections and brand settings)
  and #34 (the Lighthouse test server compresses like Cloudflare, PROCESS.md rule 17) merged on 2026-11-25.
- **Open:** #35, forms and downloads (`feat/forms-and-downloads`), queued for auto-merge behind the required checks.
- **Site editor, uploads, collections and brand (in `main`):** owners change pages, add photos and PDFs, keep a blog,
  list videos, episodes, testimonials and team, and change business details, brand and a notice by chatting; the editor
  and uploads are off by default (`editor.enabled`, `editor.uploads.enabled`), built and tested against mocks only.
  `docs/EDITING.md`.
- **Forms and downloads (in #35):** a form is one JSON file in `src/content/forms/` built from seven field types;
  one validator for the browser and the Worker; a `form` section with two designs; every form saves where the contact
  form saves and emails the owner; file-download forms email the visitor a link to a PDF; personal-data rules in the
  content check and the AI instructions; 2 new AI tools and 2 new operations. The contact form is the first form, with
  no visible change (pixel-identical at 390 and 1440). Mocks only.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that #35 merged. "Needs your eyes": AGENTS.md (forms in Architecture, the Worker-allowed modules, the
   files the editor writes, `FormView` as a client component), README (Contact form: the two forms tabs), package.json
   (test glob `src/forms/*.test.ts` only; no dependency change), site.config.ts (new `forms` caps, `contact.sheetTabs`
   gains `forms` and `formsPreview`), `docs/apps-script/contact-sheet.gs` (accepts the two forms tabs).
2. For each site that saves to the Google Sheet, before its owner adds a form: open the Sheet, add two tabs named
   "Forms" and "Forms preview", each with the header row `Received (UTC) | Form | Name | Email | Answers | Mode`; for the
   Apps Script writer, paste the new `docs/apps-script/contact-sheet.gs` into the script, set Script Properties
   `TAB_FORMS` and `TAB_FORMS_PREVIEW` only if you named the tabs differently, then Deploy, Manage deployments, edit the
   web app, New version (same URL, so no Worker secret changes). Until then a new form's answers still reach the owner
   by email, which says "Sheet: NOT saved - add this one by hand". Sites on the Pipeline app need nothing.
3. On the first real site with a download form, send one test submission and look at the email the visitor gets (only
   mocked so far), then delete the test row or lead.
4. For each client site, set the per-client values from the last run: `business.timeZone` in `site.config.ts`, the
   palette, fonts and logo in `src/content/brand.json`, the business details in `src/content/business.json`, then
   `npm run sync:config`. Remove or archive the template's example posts, videos, episodes, testimonials and team member
   the site does not use (the launch gate fails on their placeholders).
5. Your working copy of `.github/workflows/ci.yml` still holds the uncommitted content and design check steps from an
   earlier run. Either commit them on their own branch and PR, or do item 6, whose file already includes them.
6. Decide the content fast lane: `docs/proposals/content-fast-lane.md` (its rule is now numbered 18). To adopt it: first
   change the "Protect main" ruleset to add `change-scope` as a required check, then on a new branch run
   `cp docs/proposals/content-fast-lane-files/ci.yml.proposed .github/workflows/ci.yml`,
   `cp docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed lighthouserc.cjs` and
   `cp docs/proposals/content-fast-lane-files/site.a11y.spec.ts.proposed tests/a11y/site.a11y.spec.ts`, then PR. Per
   CLAUDE.md a new required check needs 5 clean runs and a deliberate-failure proof PR first. Then add rule 18 to
   PROCESS.md (text in the proposal). Forms add to the reasons: the scope check's form rules block an editor change only
   once `change-scope` is required.
7. Turn the editor on for the first site (accounts and secrets, so yours): `docs/EDITING.md`, "Set up the editor on one
   site", steps a to g. Brand changes by chat also need `editor.workersSubdomain` set.
8. On that first site, confirm what mocks could not: a real AI app connects; `/site-version.json` shows the deployed
   commit and `drafts: false`; `/blocks` is the 404 page; a preview link opens; the yes-to-live minutes; a draft post
   shows on its preview and not on the live site; a Spotify and an Apple Podcasts episode play; a form added by chat
   sends, lands in the Sheet's Forms tab (after item 2) and emails the owner.
9. Turn uploads on for that site: `docs/EDITING.md`, "Set up uploads on one site", steps h to l. Then confirm a portrait
   iPhone HEIC photo shows upright, a PDF downloads with the sandbox header, a phone video is refused, and a transparent
   PNG logo stays transparent.
10. Decide the one-connector option for clients with a site and the Pipeline app: `docs/proposals/one-connector.md`.
11. Update Playwright's Chromium on your Mac (installing a browser needs your OK): `npx playwright install chromium`.
12. Convert the client sites to blocks with `docs/CONVERT-TO-BLOCKS.md`, then add the editor, uploads, collections and
    brand settings, and forms with the ready-to-paste messages in `docs/EDITING.md`: huston-logic/structural-integrity-engineering
    and ghuston/huston-tech-website. Port the earlier process items (managed hosting, the Pipeline destination) in the
    same runs.
13. Connect a site to a Pipeline app copy (only mocked tests so far): set `INTAKE_SECRET` in the app copy and the site,
    set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` and `contact.rateLimitIds`, `npm run sync:config`,
    merge, then send one test note and delete the test lead. Optional: teach the intake a form-name field (today the
    form's name is the first line of the message).
14. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
15. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a
    Cloudflare account, give one a new pair. A site with the editor takes a third id. Forms add no id.
16. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
    name". That is false under managed hosting.
17. Decide whether CI's `check` job should also run `npm run check:process` (owner-only CI edit, like item 5).
18. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules stay as template defaults.
19. Optional, later: an expired site notice comes down only at the next publish; a daily scheduled rebuild would fix it
    (an account step, not built).
20. For each new client repo made from this template: turn on "Allow auto-merge", apply the ruleset, set the Worker
    secrets yourself (`docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`).

## For the master

Earlier lines were copied to the master and moved to `docs/history/STATUS-history.md`.

- Site owners can add their own forms by chatting: quote requests, booking requests, sign-ups and "get the free guide".
- A form is built only from seven kinds of question; owners cannot add code, hidden fields or their own checks.
- A form can send the visitor a PDF by email; this collects an email address but does not lock the file.
- A form never asks for card numbers, ID numbers or passwords; health questions get a warning; consent boxes start empty.
- When a form collects a new kind of personal data, the owner is offered a matching privacy page change.
- The site's contact form stays Huston Logic's to change; owners add other forms beside it.
- Where form answers go and who is emailed stay Huston Logic settings; sites on the Sheet need one script update first.
- Phone screens no longer fail the speed check on pages led by a photo; the bar itself is unchanged.

## Last run: Forms and downloads (2026-11-25)

Process run, unattended, from Grant's brief. Design: `docs/superpowers/specs/2026-11-25-forms-and-downloads-design.md`
(16 rulings with costs, builder-check answers). Plan: `docs/superpowers/plans/2026-11-25-forms-and-downloads.md`. Opus
designed, coordinated, did the design critique and the final rulings; Sonnet implemented five tasks (four in parallel
git worktrees) and one fix wave; a Sonnet builder check read the design; Haiku wrote the docs. Two PRs: #34 (the approved
Lighthouse compression, PROCESS.md rule 17, merged) and #35.

- **Checks:** full `npm run check` passes (725 Worker and shared-module tests, 531 script tests, content and design
  checks, build); `npm run test:a11y` passes locally (118 passed, 4 skipped); `npm run test:lighthouse` passes locally (every page 100 for performance, accessibility, best practices and SEO; the showcase 100 with SEO 69 as a noindex page). The contact page is
  pixel-identical to `main` at 390 and 1440 (`npm run report:changes`, `npm run compare:screens`); the partner and
  topic variants were checked by hand. The Worker bundles with the form files (esbuild). All six owner sayings, plus the
  refused card-number field, are tests in `worker/editor/forms-acceptance.test.ts`.
- **Reviews:** review-code (client JS carried the authoring checks, a field id that reads inherited properties, the
  showcase id could shadow a file, the change report missed the contact form, key order, duplicated registry parsing,
  dead test stubs), review-security (no high or medium; an answers cell that could reach 6001 characters, a contact
  defence-in-depth gap), review-a11y (the button-style question lacked `aria-invalid`, a weak test), and the design
  critique ("(optional)" after checkbox sentences; a showcase checkbox that promised an email). All fixed except two
  parked: a field error can be read twice (the contact form's unchanged pattern), and without JavaScript the send button
  still shows beside the note.
- **Judgment calls:** one file per form plus a generated registry the Worker bundles; the contact form's topic, partner
  variant and delivery stay code; owners cannot change the contact form in this run; every form has one required email
  field; "works without JavaScript" means it renders and says how else to reach the owner, since nothing can pass the
  human check without it; per-form rate limits on the existing ids; only download forms email the visitor; two new Sheet
  tabs with one fixed header; new forms get 32 KB, the contact form keeps 16 KB; TIN, PIN and passport narrowed so "tin
  roof", "bowling pins" and "terms and conditions" pass; `src/content/contact.ts` is now wiring (tier 3).
- **New dependencies:** none.

| Measure | This run |
|---|---|
| Wall-clock time | about 1 hour 15 minutes (21:30 to about 22:45, PR open and reviewed) |
| Commits | 19 (2 in #34, 17 in #35) plus 5 merge commits |
| Time in checks | about 25 minutes (`check:fast` per commit and in each worktree, 3 full checks, 2 change reports, 1 local a11y run, 1 local Lighthouse run) |
| Time waiting on CI | about 9 minutes for #34 (queued before the main work, merged while it ran); 0 for #35 (auto-merge queued) |
