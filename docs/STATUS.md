# Autonomous run status

Plan: `docs/PLAN.md`. Rules: CLAUDE.md, "Autonomous runs". Started 2026-11-18. Updated after every task.

## Tasks

| # | Task | PR | State |
| --- | --- | --- | --- |
| 0 | Autonomous runs rules, PLAN.md, STATUS.md | this PR | in review |
| 1 | T3b Organization JSON-LD | | pending |
| 2 | Redirect slot and check-redirects | | pending |
| 3 | T4 generic Worker, Apps Script writer, SECRETS.md | | pending |
| 4 | T5 ruleset export, pipeline docs, launch checklist stub | | pending |
| 5 | T1c Dependabot lhci/playwright bump | | pending |
| 6 | Mark repo as template | none (API call) | pending |

## Judgment calls

- Branches are made one at a time in the main checkout, not in worktrees: tasks run in sequence and each starts from a
  fresh `main`.
- PR 0 (docs only) was written directly, not through an implementer subagent.
- `gh pr merge --auto --squash` is blocked by the owner-only hook `.claude/hooks/guard-bash.mjs` (line 235; it also
  blocks merging through `gh api`). I did not work around it. Every PR is opened and left for the owner to merge.
- Because PRs stay open, each task branches from `main` and no PR depends on another. To avoid merge conflicts,
  STATUS.md is updated in this PR and in one closing PR, not in every task PR.

## Stop queue

- Auto-merge: needs the hook change in the proposals below, or the owner merging by hand.

## Proposals for the owner (hand-copy)

Nothing yet.

## Flagged dependencies

None yet.
