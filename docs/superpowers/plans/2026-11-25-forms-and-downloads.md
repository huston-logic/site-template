# Forms and downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Sonnet implements each task in
> waves, in git worktrees; one review at the end, per CLAUDE.md "Autonomous runs"). Steps use checkbox (`- [ ]`) syntax.

**Goal:** owners add, change, archive and restore forms (including file-download forms) by chatting; every form is
judged by one validator in the browser and the Worker, saved where the contact form saves, and emails the owner.
**Architecture:** one JSON file per form in `src/content/forms/`, import-free shared rules in `src/forms/`, a generated
committed registry the Worker bundles, one submission handler in the Worker, a `form` block, and forms as a document kind
in the site editor. **Tech:** TypeScript, Next static export, Cloudflare Workers, Node test runner, Playwright + axe.
**Spec:** `docs/superpowers/specs/2026-11-25-forms-and-downloads-design.md` (rulings R1 to R16 and the builder-check
answers are binding; read it first).

## Global Constraints

- Branch `feat/forms-and-downloads`, one PR. Commit per task after `npm run check:fast`. No new dependency. No owner-only path.
- Shared modules in `src/forms/` import only each other, `site.config.ts`, sibling shared modules and JSON (`with { type: "json" }`), with explicit `.ts` extensions; never `site.ts`, Node, Next or a library.
- The contact form: no visible change, same `/api/contact` body, rows, Pipeline message, emails, 16 KB limit and Turnstile action `contact`. `worker/contact.test.ts` and `tests/a11y/contact-form.spec.ts` pass **unmodified**.
- Text is plain (`Text`: only `**bold**`, `[[placeholder]]`); never `dangerouslySetInnerHTML`; visitor-facing words live in `src/content/forms.ts` or the form file, not JSX.
- Logs: fixed event names and status codes only. Tests: mocked `fetch`, fake GitHub, fake R2; never real mail or credentials.
- Blocks: tokens and motion only (`npm run check:design`); `npm run blocks:catalog` after a definition change.

## Review Focus

- A post with an extra key, a number for a text field, `true` for a dropdown, or an unknown option is 400 `rejected` and saves nothing (T2 test).
- An archived or unknown form id posted directly is 404 before the rate limit, Turnstile or any save (T2 test).
- The download `href` never reaches the browser: not in the props passed to the client form, not in `out/` HTML of a page showing a download form (T3 test).
- Form files with `"checked": true`, a label "Card number", help "your SSN", an option "Password" are refused with the named sentence (T1 test).
- The download email in preview goes to the site's own address; in production its link is `domain.url` + href even when the request's host differs (T2 test).

## Waves: 1: T1. 2 (parallel worktrees): T2, T3, T4, T5. 3: T6 docs. 4: integration, reviews, PR (Opus).

### Task 1: Forms core (shared rules, settings, registry, contact definition)

**Files:** Create `src/forms/{schema,validate,answers,sensitive,registry,contact,showcase}.ts`, `src/forms/registry.generated.ts`, `src/content/forms/contact.json`, `src/content/forms.ts`, tests `src/forms/*.test.ts` (add `"src/forms/*.test.ts"` to `test:worker`). Modify `site.config.ts` (add `forms`; `contact.sheetTabs` gains `forms: "Forms"`, `formsPreview: "Forms preview"`), `worker/config.ts` (`WorkerConfig.forms: FormSettings`, `sheetTabs` type), `worker/tsconfig.json` (include `../src/forms/*.ts`, the JSON files, `resolveJsonModule`), `src/lib/contact-validation.ts` (wrapper), `src/blocks/schema.ts` + `src/blocks/validate.ts` (field kind `{ kind: "form" }`, `Context.forms`), `src/collections/site-validate.ts` (`SiteInput.forms`), `src/lib/site-content.ts`, `scripts/check-content.mjs` (read forms, print warnings, do not fail on them), `scripts/sync-config.mjs` (write and `--check` the registry).
**Produces:**
- schema.ts: `FIELD_TYPES = ["short-text","long-text","email","phone","dropdown","checkbox","consent"] as const`, `FieldType`; `PURPOSES = ["name","organization","website","address"] as const`; `FORM_STATUSES = ["live","archived"] as const`; `FORM_DIR = "src/content/forms"`; `formFilePath(id): string`; `FIELD_ID_RE` (slug, 1 to 40); `RESERVED_FIELD_IDS = ["topic"]` (the token and honeypot keys can never be slugs); `CONTACT_FORM_ID = "contact"`; `SHOWCASE_FORM_ID = "showcase-example"`; types `FormField = { id: string; type: FieldType; label: string; required: boolean; help?: string; error?: string; max?: number; purpose?: Purpose; options?: string[]; display?: "menu" | "buttons" }`, `FormDefinition = { name: string; status: FormStatus; fields: FormField[]; button: string; thanks: string; download?: { href: string; title: string } }`, `PublicForm = Omit<FormDefinition, "download"> & { delivers: boolean }`, `FormFile = { id: string; data: unknown; error?: string }`, `FormSettings = { maxForms; maxFields; maxAnswerChars; maxBodyBytes }` (numbers), `DEFAULT_FORM_SETTINGS = { maxForms: 10, maxFields: 12, maxAnswerChars: 8000, maxBodyBytes: 32768 }`. Limits exactly as the spec's field table.
- validate.ts: `formProblems(id: string, data: unknown, ctx: FormContext, settings: FormSettings): string[]`; `validateForms(files: readonly FormFile[], ctx: FormContext, settings: FormSettings): { problems: string[]; warnings: string[] }` (adds caps across files and "registry lists exactly these files" when `ctx.registryIds` is given); `parseForm(data: unknown, settings): FormDefinition | null` (null on any problem; the Worker fails closed with it); `validateSubmission(def: FormDefinition, input: Record<string, unknown>): { ok: true; value: Record<string, string | boolean> } | { ok: false; fields: string[]; malformed: boolean }`; `publicForm(def): PublicForm`. `FormContext = { fileExists(href: string): boolean; registryIds?: readonly string[] }`.
- answers.ts: `answerLines(def, value): { label: string; text: string }[]` (given answers only, checkboxes "Yes"/"No"); `nameOf`, `emailOf`, `organizationOf(def, value): string`.
- sensitive.ts: `refusedTerm(text: string): string | null`, `healthTerm(text: string): string | null` (word lists from the spec), `DataKind` and `dataKinds(def): DataKind[]`, `newDataKinds(before: readonly FormDefinition[], after: readonly FormDefinition[]): DataKind[]` (live forms only), `dataKindLabel(kind): string`.
- registry.ts: `REGISTRY_PATH = "src/forms/registry.generated.ts"`, `registrySource(ids: readonly string[]): string` (sorted ids, one JSON import each, exports `formFiles: readonly { id: string; data: unknown }[]`).
- contact.ts: `contactDefinitionFor(topic: UrlTopic | ""): FormDefinition` (partner drops `need`), `CONTACT_BODY_BYTES = 16384`. contact.json moves labels, limits and error messages verbatim (spec "The contact form as the first form"); `needOptions` stays the code list, a test asserts contact.json's `need` options equal its labels.
- showcase.ts: `showcaseForm: FormDefinition` (a short enquiry form with every field type, live, no download).
- `src/content/forms.ts`: `formWords = { optional: "(optional)", errors: { "short-text": "Please fill this in.", "long-text": "Please fill this in.", email: "That email doesn't look quite right.", phone: "That phone number doesn't look quite right.", dropdown: "Please pick one.", checkbox: "Please tick this box.", consent: "Please tick this box to go on." }, sendErrors: { notVerified: "That didn't go through. Please try again.", rateLimited: "Too many tries in a row. Wait a minute and try again.", failed: "That didn't send. Please try again in a few minutes." }, downloadNotSent: "The email with your file didn't send. Please write to us and we'll send it.", noScript: "This form needs JavaScript to send. You can also write to", noScriptNoEmail: "This form needs JavaScript to send. You can also reach us from the contact page.", download: { subject: "Your copy of {title}", lines: ["Here is {title}, as you asked.", "Download it here:"] } }` (plain data; code fills `{title}`).
- blocks: field kind `{ kind: "form"; label: string }`, value must name a live form in `ctx.forms` that is not `contact`; registry examples are judged with `ctx.forms` holding `showcase-example`. `Context.forms: ReadonlyMap<string, FormStatus> | null`.
- site-validate.ts: `SiteInput.forms: readonly FormFile[]` (callers pass `[]` where they have none yet), `SiteExtra.formSettings?: FormSettings`, `SiteExtra.registryIds?`; `siteWarnings(input): string[]`.
- [ ] Tests first: every field-type limit and default; unknown keys (`checked`, `default`, `value`, `hidden`, `pattern`, `style`) refused with named sentences; one required email; purposes unique; caps (`maxFields`, `maxAnswerChars`, live `maxForms`, archived not counted); download href rule; Review Focus line 4; health warning; `validateSubmission` cleaning, booleans, malformed cases (Review Focus line 1); `newDataKinds`; `registrySource` output stable; contact wrapper returns today's values for the existing `validateContact` cases.
- [ ] Implement; `npm run sync:config`; `npm run check:fast`; commit `feat(forms): shared form rules, settings, registry and the contact definition`.

### Task 2: The Worker's submission path

**Files:** Create `worker/forms.ts`, `worker/forms.test.ts`. Modify `worker/contact.ts` (route `/api/forms/<id>`; one handler with a per-form spec: allowed keys, body limit, Turnstile action, rate key, delivery), `worker/messages.ts` (`formNotificationEmail`, `formSheetRow`, `formPipelineLead`, `downloadEmail`), `worker/index.ts` if routing needs it, `docs/apps-script/contact-sheet.gs` (accept `TAB_FORMS` default "Forms" and `TAB_FORMS_PREVIEW` default "Forms preview"; header comment).
**Consumes:** T1 (`formFiles`, `parseForm`, `validateSubmission`, `answerLines`, `nameOf`, `emailOf`, `organizationOf`, `formWords`, `WorkerConfig.forms`, `sheetTabs.forms|formsPreview`).
- [ ] Tests first (`createWorker(fixture)` with fixture forms): a valid quote post writes `[received, "Quote request", name, email, answers, mode]` to tab "Forms" (apps-script and service-account writers), preview to "Forms preview"; Pipeline gets `{ name, email, message: "Form: Quote request\n\n..." }` capped 5000, `name` falls back to the email; notification subject `New Quote request from Ada`; answers cell over 6000 is cut with the fixed ending; Review Focus lines 1, 2 and 5; rate limit key `quote:<ip>` and contact's key unchanged; honeypot, wrong origin, 32 KB limit (413); a required consent unticked is `invalid`; a download form sends one plain-text email with no visitor input, only after a save or notification succeeded, and `delivered: false` when it fails; a non-download form sends no visitor email; `config_incomplete` still refuses.
- [ ] Implement; `npm run check:fast` (contact tests unmodified and passing); commit `feat(forms): the Worker accepts every form`.

### Task 3: The form block, shared form UI and the contact form on it

**Files:** Create `src/components/hl/form/` (field primitives lifted from `ContactForm.tsx`: label, controls, `ErrorLine`, chip row, submit button, noscript note), `src/components/hl/FormView.tsx` (`"use client"`), `src/blocks/library/form/{definition.ts,FormBlock.tsx}`, `src/lib/forms.ts` (`loadForms(): { id: string; definition: FormDefinition }[]`, `formById(id)`, reads the registry), `tests/a11y/form-block.spec.ts`. Modify `src/components/hl/ContactForm.tsx` (renders contact.json's fields through the primitives; extras kept), `src/content/contact.ts` (field copy moved out), `src/blocks/definitions.ts`, `src/content/showcase.ts`, `docs/BLOCKS.md` + `docs/blocks.json` (`npm run blocks:catalog`).
**Consumes:** T1 (`publicForm`, `validateSubmission`, `showcaseForm`, `formWords`, field kind `form`).
- Block: content `{ form: { kind: "form" }, heading?: text 60, intro?: text 300 }`, variants `stacked` and `beside`, placement `{ position: "any", maxPerPage: 1, rhythm: "compact" }`, motion `entrance: "none"` with the contact block's reason, example `{ form: "showcase-example", ... }`. FormView posts JSON to `/api/forms/<id>`, Turnstile action `form`, success replaces the panel content with `thanks` keeping its height, focus to the message; behaviour list in the spec.
- [ ] Tests first: a11y spec on `/blocks` (submit empty: each error line announced, `aria-invalid`, focus on the first problem field; noscript note in the HTML); a unit test that the props FormBlock passes to FormView hold no `download` (Review Focus line 3).
- [ ] Implement; `npm run check:fast`; `npm run build`, then confirm `grep -r "/files/" out/blocks.html` finds no download href; commit `feat(forms): the form block and shared form UI; the contact form uses it`.

### Task 4: Forms in the site editor

**Files:** Modify `worker/editor/{operations,tool-schemas,tools,read-tools,site-reader,documents,change-list-documents,service,instructions}.ts`. Create `worker/editor/forms-acceptance.test.ts`.
**Consumes:** T1 (`formProblems`, `validateForms` through `validateSite`, `siteWarnings`, `newDataKinds`, `registrySource`, `REGISTRY_PATH`, `CONTACT_FORM_ID`).
- Operations `add_form { form: id, definition }` (writes the form file with `status` first and the regenerated registry; refuses an existing id), `set_form_status { form, status: "live" | "archived" }` (archiving removes every `form` block showing it, on any page, and the change list names each page), `Target` gains `{ form: id }` for `set`, `insert_item`, `remove_item` (pointers under `/name`, `/fields`, `/button`, `/thanks`, `/download`; never `/status`). Every write to `contact` refused: "The contact form is set up by Huston Logic; ask them to change it." Documents prefix `form:`; `download.href` may be `upload:<id>` (a PDF). Tools `list_forms`, `get_form`. Change list per the spec (full numbered field list, changed lines marked, warnings, privacy note). Instructions: a forms section with the spec's rules and the refusal sentence.
- [ ] Tests first, one per owner saying (spec "Goals"; brief's six sayings): quote form on Services with five fields; phone optional; consent checkbox for updates (unticked, privacy note offered); download form on home from an inbox PDF upload (PDF committed to `public/files/`); thank-you changed; newsletter archived (file kept, block removed); "credit card number" field refused with the sentence. Plus: `contact` writes refused; the 11th live form refused; registry committed with `add_form` only.
- [ ] Implement; `npm run check:fast`; commit `feat(editor): forms by chat`.

### Task 5: Change scope check and change report

**Files:** Modify `scripts/change-scope-rules.mjs`, `scripts/check-change-scope.mjs`, `scripts/change-report.mjs`, their tests.
**Consumes:** T1 (`FORM_DIR`, `REGISTRY_PATH`, `registrySource`, `validateSite` with forms).
- Rules: `formFile` regex, tier 1 when the site check passes at the head; the registry tier 1 only when byte-equal to `registrySource` of the head's form files; `src/content/forms/contact.json` tier 3 "the contact form's wiring"; a deleted form file tier 3 (archive instead); `src/forms/` tier 3 label "form rules (code)".
- [ ] Tests first for each rule; change report: a changed `src/content/forms/quote.json` traces to the pages whose `form` blocks name `quote`.
- [ ] Implement; `npm run check:fast`; commit `feat(scope): forms in the change scope check and change report`.

### Task 6: Docs (Haiku, docs-writer)

Update per the spec's "Docs" section: `docs/EDITING.md` (what works, the six sayings, the download gate's strength in plain words per R9, the ready-to-paste message for an existing client site), `docs/EDITING-LANES.md` (forms and file-download forms to lane 1), `docs/CHANGE-SCOPE.md`, `docs/SECRETS.md` (Apps Script tab properties, no new secret), `docs/HOSTING.md` (no new ids, R7), AGENTS.md (forms in Architecture, Worker-allowed modules, the form block as a client component), README (Contact form: the forms tabs). Commit `docs: forms and downloads`.

### Integration (Opus)

Merge worktrees in wave order; `rm -rf .next`; `npm run check`; `npm run report:changes` then `npm run compare:screens` on `/contact` (identical at 390 and 1440; also `/contact?topic=partner` by hand); `npm run test:a11y`; `npm run test:lighthouse`; review-code, review-a11y, review-security, design critique of `/blocks` form block at 1440 and 390; fix; STATUS.md; PR; auto-merge.
