# Managed hosting and form routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Document managed hosting (Huston Logic hosts every client site) and offboarding, and let a site send form contacts to a Pipeline app copy.

**Architecture:** PR A is docs only. PR B adds `contact.destination` ("sheet" default, or "pipeline") to `site.config.ts`; the Worker POSTs to `<pipelineUrl>/intake` when it is "pipeline". `scripts/config-rules.mjs` holds the config checks and the secret names, and `sync-config.mjs` uses it.

**Tech Stack:** Next.js static export, Cloudflare Worker (TypeScript, no libraries), Node test runner.

**Spec:** the approved brief for the "Managed hosting and form routing" run (09 doc items H1, H2); intake contract: `huston-logic/pipeline` README, "Connect a website form".

## Global Constraints

- Branches `docs/managed-hosting` (A) and `feat/pipeline-form-routing` (B), both from `main`; never commit to `main`; no force push.
- `npm run check:fast` before each commit, `npm run check` before each PR. Never remove a test, weaken an assertion, lower a threshold or change required checks.
- No secrets in code. The Worker never logs the Pipeline URL, `INTAKE_SECRET` or visitor data (fixed event names and status codes only).
- Business prices stay out of the repo (PROCESS.md "Where facts live"), so docs say "the hosting fee", not the amount.
- Owner-only paths (`.github/workflows`, `.claude/**`) are not touched. STATUS.md is edited once, in PR A, at the end.
- Every PR description starts with "Needs your eyes" and ends with the attribution line.

## Review Focus

- Pipeline answers 401/4xx: visitor still sees success only if the notification email went; email says "NOT saved".
- Pipeline unreachable or 5xx: one retry, then failed; the secret is never sent after a redirect (`redirect: "error"`).
- Preview mode with "pipeline": no POST to the client's real app; email says skipped.
- `pipelineUrl` missing, `http://`, or with a path: no request is made and `check:config` fails.
- Visitor message near 5,000 characters, plus the extra lines folded into it, stays within the app's limit.

---

### Task 1 (PR A): Rules, register, runbook, checklists

**Files:**
- Modify: `docs/PROCESS.md` (rules 13 to 15 before "What still stops for Grant"), `docs/LAUNCH-CHECKLIST.md`, `docs/pipeline/client-onboarding-checklist.md`, `README.md` (one link line)
- Create: `docs/OFFBOARDING.md`, `docs/HOSTING.md`, this plan

**Interfaces:**
- Produces: PROCESS.md rule 13 "Managed hosting", 14 "Every site has its own rate-limit ids", 15 "Form contacts go to the client's own tool"; `docs/HOSTING.md` register (template 1001/1002, Grant's site 1001/1002, Dylan's site 1001/1002, Pipeline app picks its own, new sites from 2001).

- [ ] **Step 1:** Branch `docs/managed-hosting`; commit this plan.
- [ ] **Step 2:** Haiku `docs-writer` agents draft in parallel: (a) LAUNCH-CHECKLIST section A for managed hosting and B to F edits only where they assume the client's Cloudflare, every proof column kept; (b) the onboarding checklist wherever it creates accounts in the client's name; (c) `docs/OFFBOARDING.md` marked "Not yet rehearsed".
- [ ] **Step 3:** Write PROCESS.md rules 13 to 15 (What / Why / Decided / Enforced by) and `docs/HOSTING.md`; link OFFBOARDING from PROCESS.md and the README.
- [ ] **Step 4:** Read every drafted diff against the brief; fix. Run `npm run check:fast`; expect `check:process` passes.
- [ ] **Step 5:** Commit; `npm run check`; push; open PR A.

### Task 2 (PR B): Config, secrets and rate-limit ids

**Files:**
- Create: `scripts/config-rules.mjs`, `scripts/config-rules.test.mjs`
- Modify: `site.config.ts`, `scripts/sync-config.mjs`, `scripts/check-placeholders.mjs`, `wrangler.jsonc` (regenerated)

**Interfaces:**
- Produces: `configProblems(c): string[]` (empty when valid) and `secretsFor(contact): string[]`. `site.config.ts` `contact` gains `destination: "sheet" | "pipeline"` (default `"sheet"`), `pipelineUrl: string | null`, `rateLimitIds: { production: string; preview: string }` (template `"1001"`, `"1002"`), replacing `rateLimit.namespaceIds`.

- [ ] **Step 1:** Write failing tests in `scripts/config-rules.test.mjs`: `secretsFor` returns `RESEND_API_KEY, TURNSTILE_SECRET_KEY, INTAKE_SECRET` for pipeline and the writer's pair for sheet; `configProblems` flags an unknown destination, `pipeline` with null / `http://` / path `pipelineUrl`, non-numeric or missing ids, equal production and preview ids, and 1001/1002 once `domain.workerName` is not a `[[placeholder]]`; passes for 2001/2002.
- [ ] **Step 2:** Run `npm run test:scripts`; expect the new file to fail (module missing).
- [ ] **Step 3:** Implement `scripts/config-rules.mjs`; make `sync-config.mjs` print the problems and exit 1 (both modes) and generate `secrets.required` and the ids from it. Update `check-placeholders.mjs` to list `contact.rateLimitIds.*`, and `contact.pipelineUrl` when the destination is "pipeline".
- [ ] **Step 4:** `npm run sync:config`, then `npm run test:scripts` and `npm run check:config`; expect pass.
- [ ] **Step 5:** Commit.

### Task 3 (PR B): Worker destination

**Files:**
- Create: `worker/pipeline.ts`
- Modify: `worker/config.ts`, `worker/env.ts`, `worker/contact.ts`, `worker/messages.ts`, `worker/contact.test.ts` (add only: a `pipeline` route in `route()`, new leak strings in `afterEach`, a new `describe`)

**Interfaces:**
- Consumes: `retryable`, `log`, `TIMEOUT_MS` from `worker/env.ts`.
- Produces: `sendToPipeline(baseUrl: string | null | undefined, secret: string | undefined, lead: { name; email; message; business? }): Promise<boolean>`; `type SaveStatus = "saved" | "failed" | "skipped"`; `ContactEnv.INTAKE_SECRET?: string`; `WorkerSiteConfig.contact.destination?` and `pipelineUrl?`; `notificationEmail(..., status: SaveStatus, destination)`; `pipelineMessage(submission): string` in `messages.ts` (visitor text, then Need, Uses today, Current website, Heard about lines, capped at 5,000 characters).

- [ ] **Step 1:** Add failing tests in a new `describe("pipeline destination")`: success POST to `https://pipeline.example.test/intake` with `x-intake-secret`, JSON name, email, message, business and no Sheet call; 200 and 201 both saved; 401 not retried, email says "Pipeline app: NOT saved", visitor 200; 503 then 200 saved, 503 twice failed; failed save plus failed email gives 502; missing secret, `http://` URL: no request, email says NOT saved; preview mode: no request, "skipped"; `redirect: "error"` set; message cap; default config never calls the intake; no log line holds the secret or host.
- [ ] **Step 2:** `npm run test:worker`; expect the new tests to fail.
- [ ] **Step 3:** Implement `sendToPipeline` (https origin only, `new URL("/intake", base)`, header `x-intake-secret`, one retry on 429, 5xx or network error, 2xx means saved). In `contact.ts` replace `saveRow` with `saveSubmission(config, env, mode, ...)`, the one switch on `config.destination`, with the marked comment `THIRD DESTINATION GOES HERE`. Keep the `!saved && !notified` 502 rule. Keep "Sheet: saved" and "Sheet: NOT saved - add this one by hand" for sheet.
- [ ] **Step 4:** `npm run test:worker` and `npm run typecheck`; expect all pass, no existing test edited.
- [ ] **Step 5:** Commit.

### Task 4 (PR B): Docs for the code

**Files:** `docs/pipeline/contact-form.md`, `README.md` ("Contact form"), `docs/SECRETS.md`, `AGENTS.md`, `docs/TEMPLATE.md`.

- [ ] **Step 1:** Haiku `docs-writer` updates the five files from the final code: destination setting, `INTAKE_SECRET` command, request and answer format, preview behaviour, rate-limit ids, third-destination place. Review the diff.
- [ ] **Step 2:** `npm run check`; push; open PR B.

### Task 5: Close the run

- [ ] **Step 1:** On the PR A branch update `docs/STATUS.md` once: timing table, "For the master" line, "Needs Grant" steps for `INTAKE_SECRET`, Open PRs. Commit and push.
- [ ] **Step 2:** `superpowers:requesting-code-review` on both branches; fix findings; `superpowers:verification-before-completion`.
- [ ] **Step 3:** `gh pr merge <n> --auto --squash` for both PRs; report.
