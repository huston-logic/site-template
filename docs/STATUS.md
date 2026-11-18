# Autonomous run status

Plan: `docs/PLAN.md`. Rules: CLAUDE.md, "Autonomous runs". Started 2026-11-18. Updated after every task.

## Tasks

| # | Task | PR | State |
| --- | --- | --- | --- |
| 0 | Autonomous runs rules, PLAN.md, STATUS.md | [#7](https://github.com/huston-logic/site-template/pull/7) | merged |
| 1 | T3b Organization JSON-LD (homepage only) | [#8](https://github.com/huston-logic/site-template/pull/8) | merged |
| 2 | Redirect slot and check-redirects | [#9](https://github.com/huston-logic/site-template/pull/9) | open, review passed, ready for auto-merge |
| 3 | T4 generic Worker, Apps Script writer, SECRETS.md | [#10](https://github.com/huston-logic/site-template/pull/10) | open, review passed; CodeQL alert fixed, waiting on CI |
| 4 | T5 ruleset export, pipeline docs, launch checklist stub | [#11](https://github.com/huston-logic/site-template/pull/11) | open, review passed, ready for auto-merge |
| 5 | T1c Dependabot lhci/playwright bump | none yet | queued: `@lhci/cli` 0.16.1 is not 7 days old until 2026-11-18 23:40Z |
| 6 | Mark repo as template | none (API call) | done (`is_template` is true) |

## Judgment calls

- Branches are made one at a time in the main checkout, not in worktrees: tasks run in sequence and each starts from a
  fresh `main`.
- PR 0 (docs only) was written directly, not through an implementer subagent. The other tasks used an implementer and a
  separate reviewer subagent each.
- `gh pr merge --auto --squash` is blocked by the owner-only hook `.claude/hooks/guard-bash.mjs` (it also blocks merging
  through `gh api`). I did not work around it. Every PR is left open as "ready for auto-merge" once its review passes.
  The owner approved (Nov 18) a hook change that allows exactly `gh pr merge <number> --auto --squash` and `--auto
  --merge`; it is in the hand-copy batch.
- Because PRs stay open, each task branches from `main` and no PR depends on another. After a PR merged, the other open
  branches were updated from `origin/main` (merge commits, no force pushes).
- STATUS.md is updated in PR #7 and in this closing PR, not in every task PR, so the open PRs do not conflict.
- T3b: `@type` is `Organization` (was `ProfessionalService`). Founder `jobTitle` is built but not emitted, because the
  site does not show `owner.role` anywhere. The new optional `brand.logo` config key is not a launch blocker.
- T2: Wrangler allows 2,000 characters per redirect rule, not the 1,000 in the brief, so `public/_redirects` says 2,000.
  The redirect checker's tests run with `node --test scripts/check-redirects.test.mjs` and are not wired into CI
  (workflows are owner-only and `package.json` was being changed by another PR).
- T4: `sheetTabs` stay "Submissions" / "Preview" (generic names, not client-specific). `siteEmail` and `schedulerUrl`
  are `null` in the template, so the Worker answers 502 `config_incomplete` until they are set. The B7b automatic reply
  was genericized (dropped "(Consider this the demo!)", biography paragraph replaced by a `[[placeholder]]`, "Zoho
  partner" label is now "Partner"); this is a change to approved copy and is flagged in the PR for confirmation.
  `docs/website-plan.md` was not updated.
- T4: CodeQL flagged `js/incomplete-url-substring-sanitization` in `worker/contact.test.ts`. Fixed in the code (the test
  now compares whole lines); no dismissal and no suppression.
- T5: the proposals for `.claude/agents/*.md` and the workflow comments are in the hand-copy batch, not in a PR.
- T1c: the lockfile proof is done (see below) but the PR waits for the 7-day rule.

## Stop queue

- Auto-merge: needs the hook change in the hand-copy batch, or the owner merging by hand. (#7 and #8 were merged by hand.)
- T1c (Dependabot fix): `@lhci/cli` 0.16.1 was published 2026-11-11 23:40Z, so it is 7 days old at 2026-11-18 23:40Z.
  Proof already run in a scratch copy: with `@lhci/cli` 0.16.1, `@playwright/test` 1.65.0 and
  `overrides.playwright-core` 1.65.0, a lockfile written by `npx npm@12 install --package-lock-only` passes
  `npx npm@10.9.9 ci --dry-run`. Steps to finish: branch from `main`, apply those three version changes, write the
  lockfile with npm 12, run `npm ci --dry-run` with npm 10.9.9, `npm run check`, open the PR, then close Dependabot PR #3
  with a comment linking it. Dependabot's #3 also bumps `tailwindcss` and `@tailwindcss/turbopack` to 4.3.5; this fix
  does not, so Dependabot will propose that again.
- `docs/TEMPLATE.md` has stale rows after T4 and T5 (PR 5 row, the `docs/pipeline/*` row, table B rows for the Worker
  name, Google Cloud project and ruleset ids). Left out on purpose to avoid conflicts with PR #10; update after it merges.
- `package.json` description still says "Huston Tech" (needs approval to change).
- CLAUDE.md "Protected folders" still says CLAUDE.md, AGENTS.md, package.json, wrangler.jsonc and .gitignore "ask for
  approval on each change". That becomes wrong once the hook and settings changes below are installed.

## Proposals for the owner (hand-copy)

Everything is in `handcopy-batch.sh` in the run's scratchpad; the commands are in the run summary. In order:

1. `.claude/hooks/guard-bash.mjs` and `.claude/hooks/selftest.mjs`: allow exactly `gh pr merge <n> --auto --squash` and
   `--auto --merge` (`--admin` and any merge without `--auto` stay blocked), and Bash writes to the five files no longer ask.
2. `.claude/hooks/protect-config.mjs` and `.claude/hooks/README.md`: Edit/Write of `package.json`, `CLAUDE.md`,
   `AGENTS.md`, `wrangler.jsonc` and `.gitignore` no longer ask.
3. `.claude/settings.json`: the five "ask" rules removed, every deny rule and hook kept.
4. After PR #11 merges: `.claude/agents/review-{a11y,code,security}.md` ("this site" wording) and the comment-only
   fixes in `.github/workflows/{ci,codeql,dependency-review}.yml`.

Tested in a scratch copy of the hooks folder: `node .claude/hooks/selftest.mjs` ends with `All 104 passed`.

## Flagged dependencies

None added. T1c (queued) would bump `@lhci/cli` 0.16.0 to 0.16.1 and `@playwright/test` plus `overrides.playwright-core`
1.64.1 to 1.65.0, exact-pinned, all older than 7 days at 23:40Z.
