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
- **Open:** the "Website process" run's first PR (`chore/fast-checks`): `npm run check:process`, Lighthouse 3 runs,
  this STATUS.md format. `npm run check:fast` and the rest follow in the same run.
- **Still open per `docs/TEMPLATE.md`:** template README polish, and deciding which Huston content rules in AGENTS.md
  stay as template defaults.

## Needs Grant

In order:

1. Review and merge the "Website process" PRs (first `chore/fast-checks`, then the docs PR based on it).
2. Decide how strict mode is enforced. Today it applies only to branches named `change/...`, so it trusts the branch
   name (limit written up in `docs/CHANGE-SCOPE.md`). The ruleset or CODEOWNERS can close that.
3. After 5 clean runs of `change-scope`, and a deliberate-failure proof PR on a `change/` branch, decide whether to make
   it a required check (change the ruleset first, then the workflow).
4. Check that the master doc "00 Huston Logic: Source of Truth" links to `docs/STATUS.md` in this repo.
5. Decide the AGENTS.md question from `docs/TEMPLATE.md` section E: which Huston content rules (voice, framework,
   testimonials, pricing) stay as template defaults.
6. For each new client repo made from this template, turn on "Allow auto-merge", apply the ruleset, and set the Worker
   secrets yourself. Steps: `docs/pipeline/client-onboarding-checklist.md`, `docs/SECRETS.md`,
   `docs/ruleset-protect-main.json`, `docs/LAUNCH-CHECKLIST.md`.

## For the master

- Decision (Grant, 2026-11-24): Lighthouse runs 3 times per page instead of 5; every threshold is unchanged.

## Last run: Website process (2026-11-24, in progress)

Process run: make site builds fast to see and cheap to run. Plan:
`docs/superpowers/plans/2026-11-24-website-process.md`. Timing table added when the run ends.
