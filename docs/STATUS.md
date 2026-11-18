# Autonomous run status

Plan: `docs/PLAN.md`. Rules: CLAUDE.md, "Autonomous runs". Started 2026-11-18. Updated after every task.

## Tasks

| # | Task | PR | State |
| --- | --- | --- | --- |
| 0 | Autonomous runs rules, PLAN.md, STATUS.md | [#7](https://github.com/huston-logic/site-template/pull/7) | merged |
| 1 | T3b Organization JSON-LD (homepage only) | [#8](https://github.com/huston-logic/site-template/pull/8) | merged |
| 2 | Redirect slot and check-redirects | [#9](https://github.com/huston-logic/site-template/pull/9) | merged |
| 3 | T4 generic Worker, Apps Script writer, SECRETS.md | [#10](https://github.com/huston-logic/site-template/pull/10) | merged (CodeQL alert fixed in the code) |
| 4 | T5 ruleset export, pipeline docs, launch checklist stub | [#11](https://github.com/huston-logic/site-template/pull/11) | merged |
| - | STATUS update | [#12](https://github.com/huston-logic/site-template/pull/12) | merged |
| 5 | T1c Dependabot fix: `@lhci/cli` 0.16.1, Playwright 1.65.0 | [#13](https://github.com/huston-logic/site-template/pull/13) | open. **Contains the one-time 7-day exception below.** After it merges, close Dependabot PR #3 with a comment linking #13. |
| 6 | Mark repo as template | none (API call) | done (`is_template` is true) |
| - | Hand-copy batch installed by the owner | [#16](https://github.com/huston-logic/site-template/pull/16) | merged |
| - | Cleanup: generic package description, CLAUDE.md matches hooks | [#17](https://github.com/huston-logic/site-template/pull/17) | open |

## One-time exception to the 7-day dependency rule (owner-approved Nov 18)

`@lhci/cli` 0.16.1 (published 2026-11-11 23:40Z) was about 2 hours short of 7 days when PR #13 was made. Grant waived the
rule for that release only, once. Its sibling `@lhci/utils` 0.16.1 (same release) comes with it. Nothing else is
waived: `@playwright/test` and `overrides.playwright-core` 1.65.0 are 13 days old, and the lockfile was written with
`npx npm@12 install --package-lock-only --before=2026-11-11T23:41:00Z`, so no other package newer than the waived
release is in it (every other changed version is at least 7 days old). Without `--before`, npm picked about 20
transitive versions that were 1 to 6 days old (for example `@sentry/*` 11.14.0 and `puppeteer-core` 25.18.1).

## Judgment calls

- Branches are made one at a time in the main checkout, not in worktrees: tasks run in sequence and each starts from a
  fresh `main`.
- PR 0 (docs only) was written directly, not through an implementer subagent. The other tasks used an implementer and a
  separate reviewer subagent each.
- `gh pr merge --auto --squash` is blocked by the owner-only hook `.claude/hooks/guard-bash.mjs` (it also blocks merging
  through `gh api`). I did not work around it. Every PR was left open and announced as "ready for auto-merge" once its
  review passed ("review passed" is the author's record, not something GitHub shows); the owner merged them by hand.
  The owner approved (Nov 18) a hook change that allows exactly `gh pr merge <number> --auto --squash` and `--auto
  --merge`; it was installed in #16.
- Each task branched from `main` and no PR depended on another. After a PR merged, the other open branches were updated
  from `origin/main` (merge commits, no force pushes).
- T3b: `@type` is `Organization` (was `ProfessionalService`). Founder `jobTitle` is built but not emitted, because the
  site does not show `owner.role` anywhere. The new optional `brand.logo` config key is not a launch blocker.
- T2: Wrangler allows 2,000 characters per redirect rule, not the 1,000 in the brief, so `public/_redirects` says 2,000.
  The redirect checker's tests run with `node --test scripts/check-redirects.test.mjs` and are not wired into CI
  (workflows are owner-only and `package.json` was being changed by another PR).
- T4: `sheetTabs` stay "Submissions" / "Preview" (generic names, not client-specific). `siteEmail` and `schedulerUrl`
  are `null` in the template, so the Worker answers 502 `config_incomplete` until they are set. The B7b automatic reply
  was genericized (dropped "(Consider this the demo!)", biography paragraph replaced by a `[[placeholder]]`, "Zoho
  partner" label is now "Partner"); this is a change to approved copy; the owner confirmed it on Nov 18 (the template is generic).
  `docs/website-plan.md` was not updated.
- T4: CodeQL flagged `js/incomplete-url-substring-sanitization` in `worker/contact.test.ts`. Fixed in the code (the test
  now compares whole lines); no dismissal and no suppression.
- T5: the proposals for `.claude/agents/*.md` and the workflow comments were hand-copied by the owner (#16).
- T1c: Playwright 1.65.0, not 1.65.1 (1.65.1 was 5 days old). Dependabot's Tailwind 4.3.5 bump is not part of #13;
  Dependabot will propose it again.

## Stop queue

- Auto-merge: unblocked (hook change installed in PR #16); use `gh pr merge <number> --auto --squash`.
- Close Dependabot PR #3 with a comment linking #13, after #13 merges (owner confirmed Nov 18).
- `npm run test:a11y` was not run locally for the T1c bump (it needs Chromium, a separate approval); CI runs it.

## Proposals for the owner (hand-copy)

All four were installed by the owner in #16 (kept here as a record). In order:

1. `.claude/hooks/guard-bash.mjs` and `.claude/hooks/selftest.mjs`: allow exactly `gh pr merge <n> --auto --squash` and
   `--auto --merge` (`--admin` and any merge without `--auto` stay blocked), and Bash writes to the five files no longer ask.
2. `.claude/hooks/protect-config.mjs` and `.claude/hooks/README.md`: Edit/Write of `package.json`, `CLAUDE.md`,
   `AGENTS.md`, `wrangler.jsonc` and `.gitignore` no longer ask.
3. `.claude/settings.json`: the five "ask" rules removed, every deny rule and hook kept.
4. `.claude/agents/review-{a11y,code,security}.md` ("this site" wording) and the comment-only fixes in
   `.github/workflows/{ci,codeql,dependency-review}.yml` (PR #11 has merged, so these can be applied now).

Tested in a scratch copy of the hooks folder: `node .claude/hooks/selftest.mjs` ends with `All 104 passed`.

## Flagged dependencies

PR #13 bumps `@lhci/cli` 0.16.0 to 0.16.1 (the one-time exception above), `@playwright/test` and
`overrides.playwright-core` 1.64.1 to 1.65.0. Exact-pinned. Lockfile churn is limited to `@lhci/cli`'s and Playwright's
dependency trees, all other versions at least 7 days old.
