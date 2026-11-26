# Owner sign-in and chat tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Sonnet implements each task; one
> review at the end, per CLAUDE.md "Autonomous runs"). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the site's Worker gets an MCP endpoint, owner sign-in and an owner page so an owner changes pages by chat, safely.
**Architecture:** `worker/index.ts` gates by mode; in production on the site's domain it wraps the contact Worker and the editor
in `@cloudflare/workers-oauth-provider`. The editor (`worker/editor/`) reads and writes the repo through a per-site GitHub App,
judges proposals with `validatePages`, and keeps drafts in KV. **Tech:** TypeScript, Workers, Node test runner, Playwright+axe.
**Spec:** `docs/superpowers/specs/2026-11-25-owner-chat-tools-design.md` (read it first; its rulings are binding).

## Global Constraints

- Two PRs: A `fix/leftovers` (Tasks A1 to A3, own worktree, from `main`), B `feat/owner-editor` (B1 to B10). B merges `main`
  after A merges. Commit per task after `npm run check:fast`; installs with `npx --yes npm@10.9.9 install` only.
- One new dependency: `@cloudflare/workers-oauth-provider` exact `1.2.4`, imported only by `worker/index.ts` (it imports
  `cloudflare:workers`, which Node tests cannot load). No MCP SDK, no zod.
- `worker/` imports only import-free `src/` modules with `.ts` extensions: add `src/blocks/{schema,validate,embeds,definitions}.ts`,
  library `definition.ts` files, `src/site-blocks/definitions.ts`, `src/lib/thanks-links.ts`, `src/content/contact.ts`.
- Logs: fixed event names and status codes only. No email, page text, token, key or URL with a secret in any log or error.
- Editor writes only `src/content/pages/*.json`, never deletes one, never adds a `[[placeholder]]`. Plain text everywhere;
  HTML output escapes `& < > " '`. Tests never touch the network: fake GitHub, fake KV, fake assets, mocked `fetch`.
- Limits: body 64 KB, 40 operations, 5 pages per proposal, `request_feature` 2,000 characters, KV draft TTL 259200 s,
  `dailyChangeLimit` default 10 (UTC day), `EDITOR_RATE_LIMIT` 30 per 60 s. Branches `change/owner-<8 lowercase a-z0-9>`.

## Review Focus

- A proposal built on a page set that changed before publish must be refused (pages or images tree SHA moved): B5 test.
- Text that looks like HTML or instructions inside a page must come back quoted and escaped, never as markup: B4, B7 tests.
- A second publish while an editor PR is open, and two publishes at once (newer PR closes itself): B5 tests.
- `/site-version.json` with `commit: null` or unreachable must never yield `live`: B5 test.
- A non-owner email with a valid Access JWT, and an owner removed from the list holding an old OAuth token: B2, B6 tests.

---

### Task A1: thanks-page links in the validator
**Files:** `src/blocks/validate.ts`, create `src/lib/thanks-links.ts`, `src/content/contact.ts` (import `./contact-fields.ts`),
`scripts/check-content.mjs`, the build's caller in `src/lib/pages.ts`, test `scripts/check-content.test.mjs`.
**Produces:** `thanksPageLinks(thanks: { after: { href: string }; meanwhile: { links: { href: string }[] } }): { where: string; href: string }[]`
(where = `contact.ts, thanks page "after" link` / `contact.ts, thanks page link N`);
`validatePages(files, registry, repo, extra?: { links?: { where: string; href: string }[] })`: each link through `linkProblem`
with the page index, message `${where}: "${href}" ${problem}.`
- [ ] Test `thanks links to an archived page fail`: services.json archived, expect a line starting `contact.ts, thanks page "after" link: "/services" points to /services, which is archived`. Test `thanks links to live pages pass`.
- [ ] Run `npm run test:scripts`: FAIL. Implement. Run again: PASS. `npm run check:fast`. Commit `fix(content): check the thanks page links against archived pages`.

### Task A2: change report photographs only what a change reaches
**Files:** `scripts/change-report.mjs` (`reachablePages`, `affectedPages`, `NO_VISUAL_EFFECT`), test `scripts/change-report.test.mjs`.
- `reachablePages` returns `{ all, routes, types }`: tracing stops at an importer under `src/blocks/library/<type>/` or
  `src/site-blocks/<type>/` and records `<type>`; `affectedPages` maps types to pages using them plus `/blocks`.
  `NO_VISUAL_EFFECT` adds `^worker\/` and `\.test\.(ts|mjs)$`.
- [ ] Tests: `a component used only by the FAQ block maps to pages using faq and /blocks`; `worker/ changes photograph nothing`;
  `a layout component still reaches every page` (Footer). FAIL, implement, PASS, check:fast, commit `fix(report): ...`.

### Task A3: build stamp and preview-only showcase
**Files:** create `scripts/finish-build.mjs` + `scripts/finish-build.test.mjs`; `package.json` (`build` and `build:launch` end
with `&& node scripts/finish-build.mjs`); `site.config.ts` `domain.productionBranch: "main"`.
**Produces:** `finishBuild({ outDir: string, env: Record<string,string|undefined>, productionBranch: string }): { commit: string | null; showcaseRemoved: boolean }`.
Writes `<outDir>/site-version.json` = `{"commit": WORKERS_CI_COMMIT_SHA ?? GITHUB_SHA ?? null, "builtAt": ISO}`. When
`env.WORKERS_CI_BRANCH === productionBranch` removes `blocks.html`, `blocks.txt` and the `blocks/` folder from `outDir`.
- [ ] Tests (temp dirs): stamp from each variable and null; showcase removed only on the production branch; CI (`GITHUB_SHA`) keeps it.
- [ ] FAIL, implement, PASS, `npm run check`, commit `feat(build): site-version stamp; /blocks only outside production builds`.
- [ ] Haiku: AGENTS.md (scripts list, `/blocks` preview-only), `docs/CHANGE-SCOPE.md` report tracing, README build section. Commit.

### Task B1: editor settings, generated config, dependency
**Files:** `site.config.ts` (`editor` block), `worker/config.ts` (`EditorConfig`), `worker/env.ts` (`EditorEnv`),
`scripts/config-rules.mjs`, `scripts/sync-config.mjs` (+ tests), `wrangler.jsonc` (generated), `package.json`, lockfile.
- `editor`: `enabled: false`, `ownerEmails: [] as string[]`, `access: { teamDomain: null, aud: null }`, `github: { owner: null,
  repo: null, appId: null, installationId: null, botLogin: null }`, `workersSubdomain: null`, `dailyChangeLimit: 10`,
  `rateLimitId: "1003"`, `kv: { oauth: null, editor: null }`, `ignoredChecks: ["change-report", "change-scope", "Workers Builds"]`.
- `wrangler.jsonc`: `main: "./worker/index.ts"`, `assets.binding: "ASSETS"` always. Only when enabled: the spec's extra
  `run_worker_first` paths, `kv_namespaces` OAUTH_KV and EDITOR_KV, ratelimit `EDITOR_RATE_LIMIT` (30/60), secret
  `GITHUB_APP_PRIVATE_KEY`. `previews` gets none of them.
- `check:config` when enabled: every editor value set, at least one owner email, `rateLimitId` a number not equal to the
  contact ids and not `1003` on a real site.
- [ ] Tests in `scripts/config-rules.test.mjs`: disabled config generates no editor bindings; enabled generates each; each missing value fails with a plain message.
- [ ] Install the dependency; `npx wrangler types worker/worker-configuration.d.ts`; FAIL/PASS; check:fast; commit.

### Task B2: Access sign-in check (port from huston-pipeline `src/auth/jwt.ts`, `access-jwt.ts`, `owners.ts`)
**Files:** create `worker/editor/access.ts`, `worker/editor/access.test.ts`.
**Produces:** `verifyAccessJwt(token: string, opts: { teamDomain: string; aud: string; now?: number; fetch?: typeof fetch }): Promise<{ ok: true; email: string } | { ok: false; reason: "invalid" | "unavailable" }>`;
`ownerFromRequest(request: Request, config: EditorConfig, fetchFn?): Promise<{ email: string } | Response>` (header
`Cf-Access-Jwt-Assertion`, else cookie `CF_Authorization`; 401/403/503/500 as the spec).
- [ ] Tests (keys from Web Crypto, JWKS via mocked fetch): valid owner; wrong aud; wrong iss; HS256 and `none` refused; expired;
  non-owner 403; owner list compare is case-insensitive; JWKS down 503. FAIL, port, PASS, check:fast, commit.

### Task B3: GitHub client
**Files:** create `worker/editor/github.ts`, `worker/editor/github.test.ts`, `worker/editor/fake-github.ts` (in-memory, test support).
**Produces:** `createGitHub(opts: { appId; installationId; owner; repo; privateKeyPem; userAgent; fetch?; now? }): GitHub` with the
methods `headOfMain`, `tree`, `fileAt`, `createCommit({ baseCommit, files: { path; content }[], message })`, `setBranch(name, sha)`,
`deleteBranch`, `openPull({ head, title, body })`, `enableAutoMerge(nodeId)`, `mergePull`, `closePull`, `listPulls(state)`,
`pullFiles`, `checkRuns(sha)`, `compare(base, head)`, `commitParent(sha)`, `openIssue({ title, body, labels })`; and `class FakeGitHub implements GitHub`.
- App JWT RS256 (PKCS#1 keys wrapped to PKCS#8), `iat` now-60, `exp` +540; token request names the one repo and
  `{ contents: "write", pull_requests: "write", issues: "write", checks: "read", metadata: "read" }`; cached until 5 min before expiry.
- [ ] Tests with mocked fetch: token request body and headers; token reused; auto-merge GraphQL mutation shape; a 404 maps to
  `GitHubError` with no secret in the message. FAIL, implement, PASS, check:fast, commit.

### Task B4: operations and the change list (pure)
**Files:** create `worker/editor/operations.ts`, `worker/editor/change-list.ts`, tests beside them.
**Produces:** `applyOperations(pages: ReadonlyMap<string, unknown>, ops: unknown): { ok: true; after: Map<string, unknown>; touched: string[]; ids: BlockIds } | { ok: false; problems: string[] }`;
`buildChangeList(before, after, ids, registry): string`; `addedPlaceholders(before, after): string[]`. Operations as in the spec.
- [ ] Tests: Friday hours `set` gives `was: "Friday: 9 to 5"` / `now: "Friday: 9 to 3"`; new Videos page lists its blocks and
  menu; move says `from block 4 to block 3`; remove quotes the removed text; archive/restore lines; unknown op, bad pointer,
  41 operations and 6 pages refused; a new `[[x]]` refused; text `<script>` stays quoted text.
- [ ] FAIL, implement, PASS, check:fast, commit.

### Task B5: editor service
**Files:** create `worker/editor/service.ts`, `worker/editor/service.test.ts`.
**Produces:** `createEditor(deps: { config: EditorConfig; github: GitHub; kv: KVNamespace; assets: Fetcher; registry; thanksLinks; now: () => Date })`
with `overview`, `page`, `catalog`, `guide`, `propose`, `preview`, `publish`, `status`, `recent`, `undo`, `discard`,
`requestFeature`, `waiting`; each returns `ToolResult = { text: string; data: unknown; isError?: boolean }`.
- [ ] Tests on `FakeGitHub`: propose writes nothing to the repo; publish opens PR + auto-merge with the change list in the body;
  stale trees refused; open editor PR refused; race closes the newer PR; cap counts today's PRs; status states (checking,
  stuck, going live, live, stopped; `commit: null` never live); live time stored once; undo restores, refuses after a later
  change, archives a page the change created, withdraws an open PR; request_feature issue with `@` defused.
- [ ] FAIL, implement, PASS, check:fast, commit.

### Task B6: MCP endpoint and the AI's instructions
**Files:** create `worker/editor/mcp.ts`, `worker/editor/tools.ts`, `worker/editor/instructions.ts`, `worker/editor/mcp.test.ts`,
`worker/editor/acceptance.test.ts`, `docs/VOICE-GUIDE.md` (placeholders).
**Produces:** `handleMcp(request: Request, ctx: { editor; email: string; config: EditorConfig; rateLimit?: RateLimit }): Promise<Response>`.
- [ ] Tests: initialize (version negotiation, `instructions` contain every rule in the spec's list); tools/list (11 tools, JSON
  Schemas); unknown tool and bad arguments give `isError`; batch 400; body over 64 KB 413; foreign Origin 403; rate limit 429;
  owner no longer listed 403. `acceptance.test.ts`: the spec's six sentences end to end. FAIL, implement, PASS, check:fast, commit.

### Task B7: owner page and consent
**Files:** create `worker/editor/owner-page.ts`, `worker/editor/owner-routes.ts`, tests, `tests/a11y/owner-page.spec.ts`.
**Produces:** `renderOwnerHome(data)`, `renderConfirm(data)`, `renderConsent(data)`, `renderMessage(title, body)` (strings);
`handleOwner(request, ctx: { editor; config; oauth: OAuthHelpersLike; fetch? }): Promise<Response>`.
- [ ] Tests: every route requires the owner; POST without same Origin 403; Undo and Publish go through a confirm page; consent
  shows client name and redirect host; CSP header exact; owner text escaped. Playwright+axe on every state at 390 and 1440.
- [ ] FAIL, implement, PASS, check:fast, commit.

### Task B8: entry and gate
**Files:** create `worker/index.ts`, `worker/editor/gate.ts` + test. `editorActive(config, env, url): boolean` = enabled,
production mode, host equals `domain.url`'s host. Off: `/api/*` to `createWorker(workerConfig)`, else 404. On: `OAuthProvider`
with `apiRoute "/mcp"`, `authorizeEndpoint "/owner/connect"`, `tokenEndpoint "/oauth/token"`, `clientRegistrationEndpoint
"/oauth/register"`, `resourceMetadata` as huston-pipeline. Commit after check:fast.

### Task B9: scope check strict for the editor's bot
**Files:** `scripts/check-change-scope.mjs`, its test. `--ci` is strict when `GITHUB_EVENT_PATH`'s `pull_request.user.login`
equals `editor.github.botLogin` (non-null). Test both. Commit.

### Task B10: docs and proposals (Haiku, from the spec)
`docs/EDITING.md` (how it works, setup steps for one site, the ready-to-paste message), `docs/EDITING-LANES.md` (works today),
`docs/SECRETS.md`, `docs/HOSTING.md` (Editor column), `docs/CONVERT-TO-BLOCKS.md`, `docs/proposals/content-fast-lane.md`,
`docs/proposals/one-connector.md`, AGENTS.md, README. Opus writes the `.proposed` files to the scratchpad. Commit.

### Close
Reviews (review-code, review-a11y, review-security once on the branch), design critique of the owner page at 1440 and 390, fixes,
`npm run check`, PR B, auto-merge, STATUS.md with the timing table.
