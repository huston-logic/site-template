# Plan: Website process (2026-11-24)

Goal: make site builds fast to see and cheap to run without lowering the quality bar. Brief approved by Grant on
2026-11-24; this is a process run. Opus plans and does the one final review; Sonnet implements; Haiku reads and
writes docs. No new dependencies. No test removed, no assertion weakened, no threshold or required check changed.

## Baseline (measured 2026-11-24, this Mac, `.next` deleted first)

| Step | Time |
|---|---|
| `check:config` | 0.2 s |
| `lint` | 3.4 s |
| `typecheck` | 2.1 s |
| `test:worker` | 0.4 s |
| `test:scripts` | 5.0 s |
| `build` | 4.6 s |
| `npm run check` as one command | 12.8 s |

The template's build is small; a client site's build is the step that grows, which is why it leaves the fast check.

## Two PRs, stacked

- **PR A** `chore/fast-checks` from `main`: tasks 1, 2, 3, 6, plus the first STATUS.md update (CLAUDE.md: first PR
  and closing PR carry STATUS). A must pass its own `check:process`, so A also moves the old STATUS.md to
  `docs/history/STATUS-history.md` unchanged, rewrites STATUS.md under the caps, and seeds `docs/PROCESS.md` with
  "Where facts live" and "Timings".
- **PR B** `docs/website-process`, based on A's branch (merge A first; GitHub then retargets B to `main`): tasks 4,
  5, 7, 9. Task 8 lives in the scratchpad (owner-only paths) and is listed in B's description.
- Commit per task. Each commit goes through the installed pre-commit hook (today it runs the full check). Full
  `npm run check` once more before each PR. PRs are opened and left for Grant; no merge is attempted.

## Task 1: Baseline (done above)

Record the table in `docs/PROCESS.md` under "Timings". Re-time in task 9.

## Task 2: `npm run check:fast`

- `check:fast` = `check:config`, `check:process`, `lint`, `typecheck`, `test:worker`, `test:scripts`.
- `check` = `check:fast`, then `build`. Same steps as before plus `check:process`; nothing removed.
- AGENTS.md "Checks" list gains `check:fast` and `check:process`. README command list too if it lists scripts.
- Note: CI's `check` job runs its steps one by one, not `npm run check`, so CI does not run `check:process`.
  Adding it is a CI change: queued under Needs Grant, not made.

## Task 3: Lighthouse runs

`lighthouserc.cjs`: `numberOfRuns` 5 to 3, and the comment "median of the 5 runs" becomes 3. No assertion touched.

## Task 6: `npm run check:process` (`scripts/check-process.mjs`, tests in `scripts/check-process.test.mjs`)

Pure function `checkProcess(root, options)` returns a list of problems; the CLI prints them and exits 1 if any.
Tests build fake repos in a temp folder (no network). It fails when:

1. `docs/STATUS.md` is over 150 lines.
2. The newest plan in `docs/superpowers/plans/` (by file name, which starts with the date) is over 150 lines.
3. A file in `.claude/agents/*.md` has no `model:` in its front matter.
4. `docs/PROCESS.md` is missing, or has no `## Where facts live` section.
5. A rule in `docs/PROCESS.md` (each `### ` heading under `## Rules`) has no non-empty `**Why:**` line.
6. `## For the master` in STATUS.md has a PR number (`#12`, `PR 12`, `pull/12`) or more than 12 non-blank lines.
7. Off until the owner batch switches it on (`scripts/process-rules.json`, `"precommitHookFastOnly": false`): the
   pre-commit hook `.claude/hooks/precommit-check.mjs` must not run the full check (its `SCRIPT` must not be
   `check` or `build`).

`check:fast` is wired only after STATUS.md passes, so no commit on the branch fails its own check.

## Task 4: Launch checklist (PR B)

`incoming/launch-checklist.md` exists (git-ignored folder). Move it to `docs/LAUNCH-CHECKLIST.md`, replacing the stub.
Same items and proofs; formatting only (blank line before each table, consistent headings). The "this is the copy to
move" sentence becomes "This repo's copy is the truth." README "Launch checklist" gets a first line pointing at it;
its existing site-specific items stay.

## Task 5: `docs/PROCESS.md` (PR B)

Sections: "Where facts live" (first), "Rules", "What still stops for Grant", "Timings". Each rule has What, Why,
Decided (Grant, 2026-11-24), Enforced by. Rules: design first; one sprint, one branch, one PR; live preview while
building; fast check per commit, full check before the PR; one review at the end; one feedback round; after launch,
one PR per change and `change/` branches; model routing; context caps; "For the master" format; timing table per run;
Lighthouse 3 runs. "Enforced by" names the real check, hook or doc, or says "convention (no automatic check)".

## Task 7: CLAUDE.md and handbook (PR B)

- Rewrite "Autonomous runs", short: read `docs/PROCESS.md` first; three kinds of run (site build: one branch and one
  PR, inline with executing-plans; live-site change: one PR per change; process run: one PR per feature area);
  commit per task with `check:fast`, full `check` before the PR; one review at the end; STATUS.md once at the end
  with the timing table; model routing. "One PR per task" goes. Every stop rule and the auto-merge rule stay word
  for word.
- "Git workflow" line "Run `npm run check` before every commit" becomes `check:fast` per commit and `check` before
  the PR, so the two sections agree (flagged in the PR).
- `docs/pipeline/README.md`: one line at the top, nothing else changed.

## Task 8: Owner-only proposals (scratchpad)

- `precommit-check.mjs.proposed`: runs `check:fast`.
- `prepush-check.mjs.proposed`: new hook, runs the full `npm run check` before `git push` and `gh pr create`.
- `settings.json.proposed`: registers the new hook (timeout 600).
- `selftest.mjs.proposed` and `hooks-README.md.proposed`: cover and describe the change.
- `scout.md.proposed` (haiku; Read, Grep, Glob) and `docs-writer.md.proposed` (haiku; docs and STATUS only).
- `owner-batch.sh`: new branch from `main`, copies all of the above into place, sets
  `"precommitHookFastOnly": true`, runs the hook selftest and `npm run check`.

## Task 9: Closing (PR B)

Re-time `check:fast` and `check`; before and after in PROCESS.md "Timings". STATUS.md: current state (#22 merged, A
and B open), Needs Grant (owner batch steps; port to `huston-logic/structural-integrity-engineering` and
`ghuston/huston-tech-website`; CI step for `check:process`), For the master (the one line from the brief), this
run's timing table (wall-clock, commits, time in checks, time waiting on CI).

## Final review (Opus)

Read both diffs against this plan and the brief; run `npm run check` and the hook selftest on the proposals in a
scratch copy; confirm no threshold, assertion, test or required check changed.
