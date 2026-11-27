# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
Rules for keeping it: CLAUDE.md, "Status and source of truth". Task list for the Nov 18 autonomous run: `docs/PLAN.md`.
Last verified with `gh` on 2026-11-22.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo. Whether Cloudflare Workers Builds is connected to the template itself is not
  recorded here; client sites deploy from their own repos.
- **Merged:** PRs #1 to #21, all merged except #3 (Dependabot, closed unmerged). Includes the generic starter (#6), the
  generic contact Worker with Apps Script writer and `docs/SECRETS.md` (#10), Organization JSON-LD (#8), the redirect
  slot (#9), the pipeline docs, ruleset export and launch checklist stub (#11), the dependency bumps (#13, #15), the
  installed hook and settings changes that allow `gh pr merge --auto --squash` (#16), the CLAUDE.md cleanup (#17, #18), the STATUS.md format with the CLAUDE.md "Status and source of truth" rules (#19), the change scope check and change report, steps 1 and 2 of the client change requests plan (#20), and hidden camera and location data stripped from client images plus a blocking alt text check (#21).
- **Open:** #22, the `change-scope` and `change-report` CI jobs (proposed in #20, copied into
  `.github/workflows/ci.yml` by Grant). Until it merges, no scope, image-data or alt text check runs on pull requests.
  The jobs are not required checks. No other open PRs.
- **Still open per `docs/TEMPLATE.md`** (that file's PR table may lag the merged PRs): template README polish, and
  deciding which Huston content rules in AGENTS.md stay as template defaults.

## Changelog

- 2026-11-17: #1 generic template identity and `docs/TEMPLATE.md`; #2 remove `engine-strict` so Dependabot's npm 12 can
  update; #4 `site.config.ts` with `sync:config` and `check:config`; #5 CI runs `check:config`. #3 (Dependabot) closed.
- 2026-11-18, autonomous run, product code: #6 generic starter site; #8 Organization JSON-LD on the homepage only;
  #9 redirect slot and `check-redirects`; #10 generic Worker, Apps Script Sheet writer, `docs/SECRETS.md`.
- 2026-11-18, autonomous run, docs and tooling: #7 run rules, PLAN.md, STATUS.md; #11 ruleset export, pipeline docs,
  launch checklist stub; #12 and #14 STATUS updates; #13 `@lhci/cli` 0.16.1 and Playwright 1.65.0 (one-time 7-day
  exception, below); #15 Dependabot npm group bump.
- 2026-11-18, owner install and cleanup: #16 hook, settings, agent and workflow changes hand-copied by Grant; #17 generic
  package description and CLAUDE.md matches the installed hooks; #18 note that new repos need "Allow auto-merge".
- 2026-11-21: #19 STATUS.md rewritten into four sections, CLAUDE.md gets the "Status and source of truth" rules.
- 2026-11-22: #20 `scripts/change-scope-rules.mjs`, `check-change-scope.mjs` (`npm run check:scope`) and `change-report.mjs`
  (`npm run report:changes`) with tests (`npm run test:scripts`), `docs/CHANGE-SCOPE.md`. No new dependencies.
- 2026-11-22: #21 `npm run strip:images` (`scripts/strip-image-metadata.mjs`, `image-metadata.mjs`) removes EXIF,
  GPS, XMP, IPTC, comments and thumbnails from jpg, png and webp without re-encoding; `check:scope` fails a `change/` branch
  whose images still carry them or are not used with real alt text (`scripts/image-alt.mjs`); the change report lists each
  image with its alt text. Pure Node, no new dependencies; STATUS.md corrected for #20.
- 2026-11-22: #22 `change-scope` and `change-report` jobs added to `.github/workflows/ci.yml` (Grant hand-copied
  them; Claude cannot write workflows). Not required checks; strict only on `change/` branches.

## Needs Grant

In order:

1. Review and merge #22. It only adds the two CI jobs (`change-scope`, `change-report`) to `ci.yml`; the four
   required jobs are unchanged and the new jobs are not required checks. Watch its first run: both jobs run on this PR too.
2. Decide how strict mode is enforced. Today it applies only to branches named `change/...`, so it trusts the branch name
   (limit written up in `docs/CHANGE-SCOPE.md`). The ruleset or CODEOWNERS can close that; I did not touch the ruleset.
3. After 5 clean runs of `change-scope`, and a deliberate-failure proof PR on a `change/` branch, decide whether to make it
   a required check (change the ruleset first, then the workflow).
4. Check that the master doc "00 Huston Logic: Source of Truth" links to `docs/STATUS.md` in this repo (I cannot see the
   Google Doc).
5. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules (voice, framework,
   testimonials, pricing) stay as template defaults.
6. For each new client repo made from this template, turn on "Allow auto-merge", apply the ruleset, and set the Worker
   secrets yourself. Steps: `docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
   `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md` (still a stub headed "Filled in by Grant").

## For the master

- Template: the repo is now a GitHub template; client sites start from it. Auto-merge is on, behind the four required
  checks and CodeQL.
- Decision (Grant, Nov 18): the contact form's Sheet writer defaults to a Google Apps Script web app with a shared
  secret; the service-account writer stays as an option.
- Decision (Grant, Nov 18): the B7b automatic reply was made generic (no "demo" line, biography replaced by a
  placeholder, "Partner" label). `docs/website-plan.md` was not updated.
- Decision (Grant, Nov 18): CLAUDE.md, AGENTS.md, `package.json`, `wrangler.jsonc` and `.gitignore` no longer ask for
  approval; Claude may enable auto-merge only in autonomous runs and only with `--auto --squash` or `--auto --merge`.
- Decision (Grant, Nov 18): one-time waiver of the 7-day dependency rule for `@lhci/cli` 0.16.1 (below).

- Client change requests v1, steps 1 and 2 built and merged (scope check, change report), plus image privacy and alt text
  checks (#21, merged). Still to build: the agent, the Changes page, notifications, the rehearsal on Dylan's site
  and the after-live checks. The scope check is report-only in CI until it has earned "required" (item 3 above); its CI jobs are added by #22 (item 1).
- Decision (Claude, while Grant was away): the tier 1 list excludes `src/content/site.ts`, `providers.ts` and `auto-reply.ts`
  (wiring, not copy). Details and the other judgment calls: the PR description and `docs/CHANGE-SCOPE.md`.
- Decision (Claude, while Grant was away, #21): client photos must be clean of camera and location data and used
  with real alt text to pass on a `change/` branch. Calls made: a phone photo's rotation flag is kept (one EXIF block holding
  only that), because dropping it turns the picture sideways and fixing that needs re-encoding; an image used nowhere, or
  with empty ("decorative") or non-literal alt text, fails and stops for Grant rather than passing; alt text is checked for
  being real, not for being accurate (Grant reads it in the change report).

## Record: one-time exception to the 7-day dependency rule (owner-approved Nov 18)

`@lhci/cli` 0.16.1 (published 2026-11-11 23:40Z) was about 2 hours short of 7 days when PR #13 was made. Grant waived the
rule for that release only, once; its sibling `@lhci/utils` 0.16.1 came with it. Nothing else is waived:
`@playwright/test` and `overrides.playwright-core` 1.65.0 were 13 days old, and the lockfile was written with
`npx npm@12 install --package-lock-only --before=2026-11-11T23:41:00Z`, so no other package newer than the waived
release is in it. Without `--before`, npm picked about 20 transitive versions that were 1 to 6 days old.

## Record: judgment calls from the Nov 18 run

- T3b: `@type` is `Organization` (was `ProfessionalService`). Founder `jobTitle` is built but not emitted, because the
  site does not show `owner.role`. The optional `brand.logo` config key is not a launch blocker.
- T2: Wrangler allows 2,000 characters per redirect rule, so `public/_redirects` says 2,000. The checker's tests run with
  `node --test scripts/check-redirects.test.mjs` and are not wired into CI (workflows are owner-only).
- T4: `sheetTabs` stay "Submissions" / "Preview". `siteEmail` and `schedulerUrl` are `null` in the template, so the
  Worker answers 502 `config_incomplete` until they are set. CodeQL's `js/incomplete-url-substring-sanitization` alert in
  `worker/contact.test.ts` was fixed in the code, not dismissed.
- T1c: Playwright 1.65.0, not 1.65.1 (1.65.1 was 5 days old).
- Branches were made one at a time in the main checkout, not in worktrees. `gh pr merge --auto --squash` was blocked by
  the owner-only hook until #16, so the PRs before it were merged by hand.

## Record: Website process run (2026-11-24, moved from STATUS.md unchanged)

Process run, unattended, from Grant's approved brief. Plan: `docs/superpowers/plans/2026-11-24-website-process.md`.
Opus planned and reviewed; Sonnet wrote the scripts and the hook proposals; Haiku drafted the docs.

- #24: `npm run check:fast` (everything in `check` except the build); `npm run check` is now `check:fast` then
  `build`; `npm run check:process` with 11 tests; Lighthouse `numberOfRuns` 5 to 3 (no threshold touched); STATUS.md
  cut down, old file kept in `docs/history/`.
- #25: `docs/PROCESS.md` (Where facts live, 12 rules, what still stops for Grant, before and after timings);
  `docs/LAUNCH-CHECKLIST.md` moved from `incoming/` (formatting only) and linked from the README; CLAUDE.md "Autonomous
  runs" rewritten; one line at the top of `docs/pipeline/README.md`.
- Owner-only proposals in the scratchpad (Needs Grant, item 2). Hook selftest: 104 cases today, 132 with the
  proposals, none removed.
- Judgment calls: #25 is stacked on #24 because `check:process` needs `docs/PROCESS.md` and a short STATUS.md
  to pass, so #24 carries both. CLAUDE.md lines outside "Autonomous runs" that said "full check on every commit" or
  described the old STATUS changelog were updated to match. The README keeps its site-specific launch items under a
  pointer to the full checklist. No auto-merge was enabled: the brief did not call this an autonomous run.

| Measure | This run |
|---|---|
| Wall-clock time | 16 minutes (13:04 to 13:20, both PRs open) |
| Commits | 10 (5 in #24, 5 in #25) |
| Time in checks | about 5 minutes (the installed hook ran the full check on each commit, plus timing runs) |
| Time waiting on CI | 0: #24's CI ran while #25 was written; nothing waited on it. #24's slowest job, `lighthouse` (3 runs per page), took 3 min 35 s |

## Record: Managed hosting and form routing run (2026-11-24, moved from STATUS.md unchanged)

Process run, unattended, from Grant's approved brief (09 doc items H1 and H2). Plan:
`docs/superpowers/plans/2026-11-24-managed-hosting-and-form-routing.md`. Sonnet planned, built and reviewed; Haiku drafted
the docs; the review-code and review-security agents each read the code branch once.

- #27 (docs): PROCESS.md rules 13 (hosting), 14 (own rate-limit ids), 15 (form contacts); `docs/HOSTING.md` register;
  `docs/OFFBOARDING.md` (not yet rehearsed); managed-hosting changes to the launch checklist (section A, every proof
  kept) and the onboarding checklist; README link.
- #28 (code): `contact.destination`, `contact.pipelineUrl`, `contact.rateLimitIds`; `scripts/config-rules.mjs` (17
  tests); the Worker posts to `<pipelineUrl>/intake` with `INTAKE_SECRET` (16 new Worker tests, plus 1 added after
  review); `secrets.required` follows the destination; docs updated.
- Judgment calls: the hosting fee is not written in the repo (business facts live in the master). Rule 15 is in #27 so the
  two PRs do not both edit PROCESS.md. `contact.rateLimit.namespaceIds` was renamed `contact.rateLimitIds` and the
  template keeps 1001/1002; `check:config` rejects them only once the Worker name is real. Previews never post to the
  real app. The form's other answers are added to `message` (5,000 character cap, the email holds the whole note).
  Review fix: `redirect: "manual"` instead of `"error"`, because the Workers runtime may reject `"error"`; this has not
  been run in a real Worker. Not built: a third destination ("another tool the client names").

| Measure | This run |
|---|---|
| Wall-clock time | about 25 minutes (about 21:15 to 21:40, both PRs open and reviewed) |
| Commits | 7 (2 in #27, 5 in #28) |
| Time in checks | about 4 minutes (`check:fast` per commit, the full check on each push) |
| Time waiting on CI | 0: nothing waited on it. #27's slowest job, `lighthouse`, took 3 min 31 s |

## Record: Pages as blocks run (2026-11-25, moved from STATUS.md unchanged)

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

## Record: Owner sign-in and chat tools (2026-11-25) run, moved from STATUS.md unchanged (2026-11-25)

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

## Record: For the master lines up to the owner sign-in run (moved from STATUS.md unchanged, 2026-11-25)

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

## Record: Uploads and photos run (2026-11-25), moved from STATUS.md unchanged (2026-11-25)

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

## Record: For the master lines from the uploads and photos run (moved from STATUS.md unchanged, 2026-11-25)

- Site owners can upload photos and PDFs from their phone on their owner page, then ask their AI app to use them.
- Phone photos, iPhone ones included, are made web-ready automatically: right size, fast to load, location and camera data removed; owners never resize or convert.
- Uploads stay private until the owner says yes to a change that uses them; unused uploads are removed after 30 days.
- Every photo on a site needs a description for people who cannot see it; the owner sees it before saying yes.
- Sites gain two new section designs, a photo with text and a photo gallery, and photos on the highlights section.
- Owners can offer a PDF to download from any button or link; PDFs with scripts or attached files are refused.
- Video files are not uploaded; owners add videos as YouTube or Vimeo links.
- Uploads cost next to nothing per site: storage and photo conversion fit Cloudflare's free allowances at expected use.

## Record: For the master lines from the collections and brand settings run (moved from STATUS.md unchanged, 2026-11-25)

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

## Record: Collections and brand settings run (2026-11-25), moved from STATUS.md unchanged (2026-11-25)

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

## Record: For the master lines from the forms and downloads run (moved from STATUS.md unchanged, 2026-11-27)

- Site owners can add their own forms by chatting: quote requests, booking requests, sign-ups and "get the free guide".
- A form is built only from seven kinds of question; owners cannot add code, hidden fields or their own checks.
- A form can send the visitor a PDF by email; this collects an email address but does not lock the file.
- A form never asks for card numbers, ID numbers or passwords; health questions get a warning; consent boxes start empty.
- When a form collects a new kind of personal data, the owner is offered a matching privacy page change.
- The site's contact form stays Huston Logic's to change; owners add other forms beside it.
- Where form answers go and who is emailed stay Huston Logic settings; sites on the Sheet need one script update first.
- Phone screens no longer fail the speed check on pages led by a photo; the bar itself is unchanged.

## Record: Forms and downloads run (2026-11-25), moved from STATUS.md unchanged (2026-11-27)

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
