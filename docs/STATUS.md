# Status: site-template

Business priorities live in the Google Doc "00 Huston Logic: Source of Truth"; this file is the repo's status.
How sites are built: `docs/PROCESS.md`. Rules for keeping this file: CLAUDE.md, "Status and source of truth", and the
caps in `docs/PROCESS.md` (max 150 lines; current state, Needs Grant, For the master and the last run only). Older
history, unchanged: `docs/history/STATUS-history.md`. Last verified with `gh` on 2026-11-24.

## Current state

- **Repo:** `huston-logic/site-template`, a GitHub template (`is_template` is true). Default branch `main`, ruleset
  "Protect main" active, "Allow auto-merge" on.
- **Live:** not checked from the repo; client sites deploy from their own repos.
- **Merged:** PRs #1 to #22, all merged except #3 (Dependabot, closed unmerged). #22 added the `change-scope` and
  `change-report` CI jobs (not required checks).
- **Open:** #24 (`chore/fast-checks`: `check:fast`, `check:process`, Lighthouse 3 runs, short STATUS.md; all CI checks
  passed) and #25, based on it (`docs/website-process`: PROCESS.md rules, launch checklist, CLAUDE.md "Autonomous
  runs"). Merge #24 first.
- **Not installed yet:** the fast pre-commit hook, the pre-push hook and the `scout` and `docs-writer` agents. They are
  owner-only files, waiting in the scratchpad for the owner batch (Needs Grant, item 2). Until then the installed
  pre-commit hook still runs the full `npm run check` on every commit.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Review and merge #24, then #25. If GitHub does not switch #25's base to `main` by itself after #24 merges, ask
   Claude to merge `main` into `docs/website-process` (a normal merge commit, no force push).
2. After #24 is merged, run the owner batch from the repo root:
   `bash /private/tmp/claude-501/-Users-granthuston--claude-spares-spare-kIcMai/f8dec3d8-dac2-44e1-9af0-9d44b52c77f9/scratchpad/owner-proposals/owner-batch.sh`.
   It makes the branch `chore/owner-fast-hooks`, copies in the fast pre-commit hook, the new pre-push hook (full check
   before `git push` and `gh pr create`), `settings.json`, the selftest, the hooks README and the `scout` and
   `docs-writer` agents, switches on `precommitHookFastOnly`, then runs the hook selftest (must end `All 132 passed`),
   `npm run check:process` and `npm run check`. Then ask Claude to commit and open the PR. The scratchpad can be cleared
   by a reboot; if the folder is gone, ask Claude to write the proposals again.
3. Decide whether CI's `check` job should run `npm run check:process` (one step in `.github/workflows/ci.yml`; owner-only
   and a CI change, so not made). Today it runs locally only; its tests run in CI's `change-scope` job.
4. Port this process to huston-logic/structural-integrity-engineering and ghuston/huston-tech-website.
5. Check that the master doc links to `docs/STATUS.md` and `docs/PROCESS.md` in this repo.
6. Decide how strict mode is enforced. Today it applies only to branches named `change/...`, so it trusts the branch
   name (limit written up in `docs/CHANGE-SCOPE.md`). The ruleset or CODEOWNERS can close that.
7. After 5 clean runs of `change-scope`, and a deliberate-failure proof PR on a `change/` branch, decide whether to make
   it a required check (change the ruleset first, then the workflow).
8. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules (voice, framework,
   testimonials, pricing) stay as template defaults.
9. For each new client repo made from this template, turn on "Allow auto-merge", apply the ruleset, and set the Worker
   secrets yourself. Steps: `docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
   `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`.

## For the master

- Website build rules now live in docs/PROCESS.md in huston-logic/site-template; the master links to it.

## Last run: Website process (2026-11-24)

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
