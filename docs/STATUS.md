# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-24.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #26, all merged except #3 (Dependabot, closed unmerged). #24 to #26 were the "Website process"
  run: `check:fast`, `check:process`, the process rules, and the fast pre-commit and pre-push hooks and agents (now
  installed).
- **Open:** #27 (`docs/managed-hosting`: managed hosting rules, offboarding runbook, rate-limit id register, checklists)
  and #28 (`feat/pipeline-form-routing`: form contacts to a Pipeline app copy). Both are queued for auto-merge behind
  the required checks. Docs in #27 and #28 point at each other's files, so they read best once both are merged.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Check that #27 and #28 merged. If either shows a conflict, ask Claude to merge `main` into its branch (a normal merge
   commit, no force push).
2. Connect a site to a Pipeline app copy. The first real request has not been tried, only mocked tests:
   1. Make a long random value. Do not paste it in chat or a file.
   2. In the Pipeline app copy's folder: `npx wrangler secret put INTAKE_SECRET`, and paste the value at the hidden prompt.
   3. In the site's repo, set `contact.destination` to `"pipeline"`, `contact.pipelineUrl` to the copy's https origin
      (no path) and `contact.rateLimitIds` to a free pair from `docs/HOSTING.md`, then `npm run sync:config`. Open a PR and
      merge it.
   4. In the site's repo folder: `npx wrangler secret put INTAKE_SECRET` (same value), and
      `npx wrangler preview base-config secret put INTAKE_SECRET` for previews. Then `RESEND_API_KEY` and
      `TURNSTILE_SECRET_KEY` as before.
   5. Send one test note on the live site. Expect a new lead in the app and "Pipeline app: saved" in the notification
      email. Delete the test lead.
3. Rehearse `docs/OFFBOARDING.md` once on a test site, then change its status line from "Not yet rehearsed".
4. Grant's site and Dylan's site both use rate-limit ids 1001/1002 (`docs/HOSTING.md`). Once two sites share a Cloudflare
   account, give one a new pair, or they share counters.
5. Copy decision (yours): older client sites may still say "Websites are hosted on Cloudflare, in an account in your
   name". That is false under managed hosting. This template's copy does not contain it.
6. When a client names a tool other than the Pipeline app or the Sheet: a third destination goes in `saveSubmission` in
   `worker/contact.ts` (`docs/PROCESS.md`, rule 15). Not built.
7. Decide whether CI's `check` job should run `npm run check:process` (one step in `.github/workflows/ci.yml`; owner-only
   and a CI change, so not made). Today it runs locally only; its tests run in CI's `change-scope` job.
8. Port this process, including managed hosting and the Pipeline destination, to
   huston-logic/structural-integrity-engineering and ghuston/huston-tech-website.
9. Check that the master doc links to `docs/STATUS.md` and `docs/PROCESS.md` in this repo.
10. Decide how strict mode is enforced. Today it applies only to branches named `change/...`, so it trusts the branch
    name (limit written up in `docs/CHANGE-SCOPE.md`). The ruleset or CODEOWNERS can close that.
11. After 5 clean runs of `change-scope`, and a deliberate-failure proof PR on a `change/` branch, decide whether to make
    it a required check (change the ruleset first, then the workflow).
12. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules (voice, framework,
    testimonials, pricing) stay as template defaults.
13. For each new client repo made from this template, turn on "Allow auto-merge", apply the ruleset, and set the Worker
    secrets yourself. Steps: `docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
    `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`.

## For the master

- Website build rules now live in docs/PROCESS.md in huston-logic/site-template; the master links to it.
- Website docs describe managed hosting and offboarding; template sites can send form contacts to a Pipeline app copy.

## Last run: Managed hosting and form routing (2026-11-24)

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
