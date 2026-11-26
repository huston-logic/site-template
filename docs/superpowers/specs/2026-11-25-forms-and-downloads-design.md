# Forms and downloads: design

Run: "Forms and downloads", a process run, 2026-11-25. Grant's brief is the approval of the direction; where it left
something open, the call is recorded below as a ruling with its cost if wrong. Repo rules: AGENTS.md, CLAUDE.md,
docs/PROCESS.md.

## Intent

An owner leaving Wix must be able to add a form by chatting: a quote request, a booking request, a newsletter sign-up,
or "fill this out to get the free guide". Today the site has one contact form whose fields only Huston Logic can change.
Forms collect personal data, and their answers pass through the Worker that holds the secrets, so the system must be safe
by construction: an owner (or a misled AI) can only describe a form from a fixed set of parts, and every layer that
protects the contact form protects every form.

## Goals

- A form is a data file the owner's AI app can add, change, archive and restore through propose-then-publish.
- One validator: the browser form and the Worker judge a submission against the same form definition.
- The contact form becomes the first form in the system, with no visible change and no change in where its answers go.
- A `form` block in the library that passes the block gate (PROCESS.md rule 16) and works without JavaScript in the sense
  ruled below.
- Every form saves to the site's existing destination (Pipeline app or Sheet) and emails the owner, as the contact form
  does. The owner sets nothing up.
- File-download forms: after a valid submission the visitor is emailed a link to a PDF from the owner's uploads.
- Personal-data rules enforced by the content check and repeated in the AI app's instructions.
- Change scope check, content check and change report know about forms; destinations, recipients and secrets stay out of
  the owner's reach.

## Non-goals (this run)

Payments, calendar bookings, visitor file uploads, multi-step forms, scored surveys, connecting other tools, a coding
agent, visitor analytics. Also not built: owner edits to the contact form itself (R3), per-form destinations or
recipients, conditional fields, owner-written validation rules, hidden fields.

## Anti-goals (a failure even if it works)

- Any owner-reachable value decides where answers go, who is emailed, or what the Worker trusts.
- A form that asks for card numbers, government ID numbers or passwords can be published.
- A consent box can start ticked.
- The contact page looks or behaves differently, or its rows, Pipeline message or emails change.
- A visitor sees success when the answers reached nobody.
- A download gate is described as protection it is not.

## The form file

One JSON file per form: `src/content/forms/<id>.json`. The id is the file name (the slug rule of collections:
lowercase words and digits joined by hyphens, 1 to 60 characters). Shape:

```json
{
  "name": "Quote request",
  "status": "live",
  "fields": [
    { "id": "name", "type": "short-text", "label": "Your name", "purpose": "name", "required": true },
    { "id": "email", "type": "email", "label": "Email", "required": true },
    { "id": "phone", "type": "phone", "label": "Phone", "required": false },
    { "id": "project", "type": "dropdown", "label": "Project type", "options": ["Kitchen", "Bathroom", "Other"], "required": true },
    { "id": "message", "type": "long-text", "label": "Tell me about the project", "required": true, "max": 2000 },
    { "id": "updates", "type": "consent", "label": "You can email me now and then with news and offers.", "required": false }
  ],
  "button": "Send my request",
  "thanks": "Thanks. I'll reply within two working days.",
  "download": { "href": "/files/buyers-checklist-k3x9q2mz.pdf", "title": "The Buyer's Checklist" }
}
```

- `name` (1 to 60): what the owner calls it; shown in the notification subject, the Sheet's Form column and the Pipeline
  message. Never shown to visitors.
- `status`: `live` or `archived`. Archived forms are never built into a page, the Worker refuses them, and the file is
  never deleted (pages and items work the same way).
- `fields`: 1 to `forms.maxFields` (default 12), in display order. Field ids are unique slugs (1 to 40), and may not be
  `turnstileToken`, `topic` or the honeypot name.
- `button` (1 to 40), `thanks` (1 to 400): plain text; `Text` rules apply (only `**bold**` and `[[placeholder]]`).
- `download` (optional): `href` is a `/files/<name>.pdf` link that exists (the existing file-link rule) or an
  `upload:<id>` reference to a PDF in the inbox, which the existing resolver turns into a published `/files/` path in the
  same proposal; `title` (1 to 80) names it in the email.

### Field types (the fixed set)

| type | value | limits | notes |
|---|---|---|---|
| `short-text` | one line | `max` 1 to 300, default 200 | optional `purpose`: `name`, `organization`, `website`, `address` (sets autocomplete; `website` uses a url input). At most one field per purpose. |
| `long-text` | lines kept | `max` 1 to 5000, default 2000 | |
| `email` | one line, checked with the contact form's pattern | 254, fixed | exactly one per form, always required (R4) |
| `phone` | digits, spaces, `+ ( ) - .`, 7 to 20 digits | 30, fixed | |
| `dropdown` | one of `options` | 2 to 20 options, each 1 to 80, unique | optional `display`: `menu` (default, a select) or `buttons` (the contact form's chip row) |
| `checkbox` | yes or no | label 1 to 300 | required means it must be ticked |
| `consent` | yes or no | label 1 to 300 | for agreeing to be contacted or to terms; never pre-ticked (no field can carry a starting value at all) |

Every field: `label` (1 to 80, except checkbox and consent), `required` (boolean, default true for text, email and
dropdown, false for checkbox, consent and phone when omitted; the AI always writes it), optional `help` (1 to 200, shown
under the control, tied with `aria-describedby`), optional `error` (1 to 120, the message for any problem with that field;
the default comes from `src/content/forms.ts` by type). Unknown keys are refused, so `default`, `checked`, `value`,
`hidden`, `pattern`, `class` and `style` can never appear. The total of all text limits in one form is at most
`forms.maxAnswerChars` (default 8000), so a full form always fits the body limit.

### Settings (site.config.ts, owner-only, tier 3)

```ts
forms: { maxForms: 10, maxFields: 12, maxAnswerChars: 8000, maxBodyBytes: 32_768 }
```

`maxForms` counts live forms; archived files do not count. The Worker reads the same values through `worker/config.ts`.
Rate limits stay the contact pair (R7).

### Shared modules (import-free, Worker-allowed)

- `src/forms/schema.ts`: types, field types, limits, defaults, reserved ids, `formFilePath`.
- `src/forms/validate.ts`: `validateForms(files, ctx, settings)` for the content check (problems and warnings,
  R11), and `validateSubmission(definition, input)` for the browser and the Worker.
- `src/forms/sensitive.ts`: the refused and warned word lists and `dataKinds(definition)`.
- `src/forms/registry.generated.ts`: generated, committed. One `import ... with { type: "json" }` per form file and an
  exported list. Written by `npm run sync:config`, checked by `npm run check:config`, and written by the editor in the
  same proposal when it adds a form (as it writes `palette.css` with a brand change). Ids are sorted, so the output is
  deterministic.
- `src/content/forms.ts`: interface words (default error messages by type, "(optional)", send errors, the no-JavaScript
  note, the download email's lines). Plain defaults, like `src/content/blog.ts`.

All are added to the Worker-allowed module list in AGENTS.md and `worker/tsconfig.json`.

## One validator

`validateSubmission(definition, input)` returns `{ ok: true, value }` with cleaned values in field order, or
`{ ok: false, fields, malformed }` like `validateContact` today: `fields` lists field ids with a person-fixable problem
(missing, bad email, bad phone, required box unticked) in field order; `malformed` is a value no person could enter
through the form (a key the definition does not name, a wrong type, an unknown option, over a limit). Cleaning reuses
`cleanLine` and `cleanText`. Checkbox and consent values are booleans; `false` and missing are the same.

`validateContact` stays as the contact form's entry point and becomes a thin wrapper: it builds the contact definition for
the request's topic (R2) and calls `validateSubmission`, returning the same shape and values as today. The existing tests
of `validateContact` and `worker/contact.test.ts` pass unchanged.

## The contact form as the first form

`src/content/forms/contact.json` holds the contact form's fields in the shared format: `need` (dropdown, display
buttons, options equal to the `needOptions` labels, R2), `name` (short-text, purpose name), `email`, `business`
(short-text, purpose organization), `message` (long-text 5000, `help` = the privacy note), `tools`, `website`
(short-text, purpose website), `source` (dropdown menu). Labels, limits and error messages are moved verbatim from
`src/content/contact.ts` and `src/content/contact-fields.ts`; those modules keep the copy that is not a field (headings,
placeholders by need, send errors, thanks page).

What stays code, bound to the id `contact` (the "contact extras", in one module):

- The partner variant and the hidden `topic` read from `?topic=`: the definition for `topic=partner` drops `need`; a
  `website` or `workflow` topic preselects that need. `topic` is the only key the Worker accepts beyond the definition,
  and only for `contact`.
- Placeholders that follow the chosen need, the panel heading (and the partner heading), no "(optional)" marks (its labels
  already say so), the Turnstile action `contact`, the endpoint `/api/contact`, and success moving to `/contact/thanks`
  with the first-name handoff.
- Delivery: the existing Sheet row (Submissions/Preview tabs), Pipeline message, notification subject and B7b automatic
  reply, unchanged (`worker/messages.ts`).

The shared form view renders the contact form with today's exact markup and classes. Proof: `npm run compare:screens`
on before and after screenshots of `/contact` at 1440 and 390 (and `/contact?topic=partner` at 390), plus the unchanged
contact tests and `tests/a11y/contact-form.spec.ts`.

## The form block

`form` in `src/blocks/library/form/`: content `{ form: "<id>", heading?: text 60, intro?: text 300 }` and variants
`stacked` (heading and intro above the form panel, one centred column) and `beside` (text left, panel right, stacked on
phones, like the contact block). Placement: `any`, `maxPerPage: 1`, rhythm `compact`, motion `entrance: "none"` with the
contact block's reason. The content check refuses a form block whose form is missing, archived or `contact` (the contact
form appears only through the `contact-form` block).

The panel uses the contact form's primitives (labels, controls, the error line, the chip row, the ink button), lifted into
shared components so both forms render from one set. Behaviour:

- Labels on every control; optional fields marked "(optional)"; `help` tied with `aria-describedby`.
- On submit, problems show under each field (`aria-live="polite"` lines, `aria-invalid`), focus moves to the first
  problem field; send errors in a `role="status"` line, as today.
- Success: the panel's content is replaced by the thank-you message (and, for a download form whose email did not send,
  one fixed line saying so), the panel keeps its height (`min-height` from the measured form), and focus moves to the
  message (`tabIndex={-1}`). No page change.
- Turnstile loads only on focus, as today (`useTurnstile`), action `form`.
- The client component receives only what it renders: the download `href` is never sent to the browser (R9).
- Tokens and motion only (`check:design`); no layout shift from the error lines or the Turnstile slot beyond what the
  contact form has today.

### Without JavaScript (R6)

Every label, control and the button are in the static HTML. Nothing is sent without JavaScript (no `action`,
`method="post"`, as today), because the human check needs it. A `<noscript>` line under the button says the form needs
JavaScript to send and gives the site's email address (`contact.siteEmail`, which is public) or, while that is unset, a
link to the contact page.

## The Worker

- `POST /api/forms/<id>` for every form; `/api/contact` stays the contact form's address and runs the same handler with
  the contact extras. Same layers as today, in the same order: mode, same-origin, JSON content type, body limit
  (`forms.maxBodyBytes`), JSON object with only allowed keys (the definition's ids, the honeypot, the token, and `topic`
  for contact), rate limit, honeypot (an honest error), `validateSubmission`, Turnstile (hostname; action `contact` for
  contact, `form` for the rest), the `config_incomplete` refusal, then save, notify, and the reply email.
- Definitions come only from `registry.generated.ts`, bundled at deploy, so the Worker always judges against the form the
  same commit built. An unknown or archived id is a 404 before anything is read; a bundled definition that fails the
  shared check is refused with a fixed log event (fail closed).
- `saveSubmission` stays the one place a submission is saved, now taking a "row" built per form:
  - **Sheet:** contact keeps its row and tabs. Other forms go to two new tabs, `contact.sheetTabs.forms` ("Forms") and
    `contact.sheetTabs.formsPreview` ("Forms preview"), with one fixed header for every form: `Received (UTC) | Form |
    Name | Email | Answers | Mode`. Answers is one cell, one `Label: value` line per field given, checkboxes as Yes/No,
    capped at 6000 characters with a fixed "(cut; the notification email has every answer)" ending. The formula guard
    applies to every cell. Preview never writes the production tabs.
  - **Pipeline:** `{ name, email, message, business? }` as today: `name` is the `purpose: name` field or, without one, the
    email address; `message` starts `Form: <form name>`, then the answers, capped at 5000; `business` is the
    `purpose: organization` field. A preview never posts.
- **Notification:** plain text, to `contact.siteEmail`, Reply-To the visitor. Subject `New <form name> from <name or
  email>` (with the preview prefix), then every field label and value, Received, the save line and the mode, as today.
- **Download email** (forms with `download` only): plain text, from `contact.replyFromName`, to the visitor in production
  and to the site's own address in preview (subject says who it would have gone to, like the automatic reply). Its words
  are fixed (`src/content/forms.ts`) plus the owner's `download.title`, the business name and the link
  `<domain.url><href>`, built from config, never from the request. No visitor input appears in it. Sent only after the
  answers reached the owner (the same rule as the automatic reply). Other forms send no automatic reply (R8).
- Response: `{ ok: true, delivered?: boolean }` (`delivered` false when a download email failed), and the existing error
  shapes.

## Spam and abuse

Every form gets: Turnstile, the per-IP rate limit keyed per form (`<id>:<ip>` on the existing binding; the contact form
keeps its current key), the body limit, the field and answer caps, the forms-per-site cap, the honeypot, and the
same-origin check. Each cap is a `forms.*` setting with the default above.

## Personal data rules

In `src/forms/sensitive.ts`, judged on labels, help, options and the form name (word-boundary, case-insensitive), and
used by the content check, the editor (it calls the same site check) and the instructions:

- **Refused:** card numbers (card number, credit card, debit card, CVV, CVC, security code, expiry/expiration date),
  bank details (account number, routing number, sort code, IBAN), government ID numbers (social security, SSN, national
  insurance, passport, driver's licence/license number, tax ID, TIN, national ID, ID number), passwords and PINs. The
  sentence says why: a website form is not a safe place for them; the answers sit in email and a spreadsheet in plain
  text. Use the payment provider for payments.
- **Warned, not refused:** health words (health, medical, diagnosis, condition, medication, prescription, symptoms,
  allergy, disability, mental health, therapy, pregnancy, injury). The warning says the site is not set up for health
  details and suggests asking for them on a call instead. AGENTS.md's "never ask visitors to submit sensitive data" rule
  is kept: the AI is told not to propose such a field unless the owner insists after the warning.
- **Consent never pre-ticked:** no field may carry a starting value (unknown keys are refused, with a named message for
  `checked`, `default` and `value`).
- **New kinds of personal data:** `dataKinds(definition)` maps fields to kinds (names, email addresses, phone numbers,
  postal addresses, business names, website addresses, written messages, answers to questions, consent to be contacted).
  When a proposal makes a live form collect a kind no live form collected before, the change list ends with a note that
  the privacy page should say so, and the instructions tell the AI to offer a privacy page edit in the same proposal
  (an ordinary page operation on `privacy.json`, worded with the owner).

## Owner tools (site editor)

Forms join the editor as a document kind beside collection items:

- **Read:** `list_forms` (each form's name, id, status, fields summary, the pages that show it, and whether it delivers a
  file) and `get_form` (one form as data, with field numbers for pointers).
- **Write, through `propose_change` operations:** `add_form` (id, form; also writes the regenerated registry),
  `set_form_status` (`live` or `archived`; archiving also removes its form block from any page in the same proposal and
  says so), and the existing `set`, `insert_item` and `remove_item` with a new target `{ form: "<id>" }` (pointers under
  `/name`, `/fields`, `/button`, `/thanks`, `/download`; never `/status`). Placing a form is the existing `insert_block`
  with `type: "form"`. The `contact` form is refused for every write (R3).
- **Change list:** a new form shows its name, button, thank-you, file (title and path), and the full field list, one line
  per field: number, label, type, required or optional, options. A changed form shows the full field list after the
  change, with the changed lines marked. Then any warnings and the privacy note.
- **Instructions:** a forms section repeating the personal-data rules, the refusal sentence for card, ID and password
  fields, "show the owner the full field list and wait for yes", that the contact form is Huston Logic's, how weak a
  download gate is, and that destinations and recipients are not chat changes.
- Freshness, the commit allow-list (`isCommittablePath`: form files and the registry), the daily cap and one change in
  flight apply as for items.

## Checks and the change report

- **Content check** (`validateSite` gains `forms`): every rule above, the registry matching the folder, form blocks
  pointing at live non-contact forms, a download `href` that exists, the caps, warnings printed but not failing.
- **Change scope check:** form files are tier 1 when they pass the content check at the head commit; the registry is tier
  1 only when byte-equal to what the form files generate; `contact.json` is tier 3 ("the contact form's wiring");
  deleting a form file is tier 3 (archive instead). `site.config.ts` (the `forms` caps, tabs, destination, recipients)
  stays tier 3.
- **Change report:** a changed form file traces to the pages whose `form` blocks show it, so those pages get before and
  after screenshots.

## Docs

`docs/EDITING.md` (what works now, the six owner sayings, how strong the download gate is and is not, the ready-to-paste
message for an existing client site), `docs/EDITING-LANES.md` (forms and file-download forms move from lane 2 to lane 1),
`docs/BLOCKS.md` and `docs/blocks.json` regenerated, `docs/SECRETS.md` (no new secret; the Apps Script's two new tab
properties), `docs/CHANGE-SCOPE.md` (forms), `docs/HOSTING.md` (no new rate-limit id: per-form keys share the contact
pair), AGENTS.md (forms in Architecture and the Worker-allowed modules), README (Contact form section: new tabs).

## Stops for Grant (Needs Grant)

1. Each site on the Sheet: update the Apps Script from `docs/apps-script/contact-sheet.gs` (it accepts the two forms tabs),
   add tabs "Forms" and "Forms preview" with the header row, set `TAB_FORMS` and `TAB_FORMS_PREVIEW` only if the names
   differ, and deploy a new version of the same web app. Until then a new form's answers still reach the owner by email,
   which says "Sheet: NOT saved - add this one by hand".
2. Pipeline sites: nothing is required (the form name travels in the message). Optional: teach the intake a form-name
   field.
3. Look at the first real download email on a live site (it sends to visitors; mocks only so far).

## Approaches considered

1. **One file per form, a generated registry the Worker imports (chosen).** Matches pages and items (one file each,
   archive by status), and the Worker judges against definitions bundled from the same commit. Costs a generated file
   the editor must also write, which the repo already does for brand files.
2. **All forms in one `forms.json`.** No generated file, one import. Rejected: one file per form is what the brief says,
   archive and restore would edit a shared file, and every change list would diff the whole set.
3. **The Worker fetches definitions from the static assets at run time.** No generated file. Rejected: the definitions
   would be public files, exposing a download's link without a submission, and it adds an assets round trip per post.

## Rulings (each with its cost if wrong)

- **R1. One file per form plus a generated registry.** If wrong: moving to one file is a refactor of the reader and the
  registry; the shapes stay.
- **R2. The contact form's special behaviour stays code, bound to the id `contact`; its need options are labels in the
  file, matched by a test against `needOptions`.** If wrong: making topics or variants data needs conditional fields,
  which the brief rules out for now.
- **R3. Owners cannot change the contact form by chat in this run.** Its fields feed fixed Sheet columns and the Pipeline
  message. If wrong: owners ask "add a phone field to my contact form" and are told Huston Logic does it; unlocking needs
  the contact row to carry extra answers.
- **R4. Every form has exactly one email field, required.** The download needs it, the Pipeline app needs it, and the owner
  needs a way to answer. If wrong: a phone-only "call me back" form is refused; relaxing it needs a Pipeline change.
- **R5. Dropdown values are their labels, and `display: buttons` is a presentation of the dropdown, not an eighth type.**
  Keeps the brief's seven types. If wrong: renaming an option changes what later rows say; old rows keep the old label.
- **R6. "Works without JavaScript" means the form renders fully and says honestly how to reach the owner; nothing is sent
  without the human check.** If wrong: a real no-JavaScript post would have to skip Turnstile, which the brief also rules
  out; that trade is Grant's.
- **R7. No new rate-limit ids: per-form counters are keys on the existing binding, at the site's 5 per minute.** If wrong:
  a form needing a different limit needs its own binding and id pair (HOSTING.md register).
- **R8. Only download forms email the visitor; no other form sends an automatic reply.** Fewer emails to typed-in
  addresses. If wrong: an owner wanting a confirmation email gets the on-page thank-you only; adding one is a fixed
  template like the download email.
- **R9. The download link is a plain public `/files/` URL, mailed after the submission and never sent to the browser
  beforehand.** It is a gate that collects an email address, not a lock: anyone with the link can download, forever, and
  can share it. If wrong (the owner needs real protection): signed, expiring links served by the Worker from R2, a larger
  build.
- **R10. Generic forms show the thank-you in place; only the contact form keeps its thanks page.** If wrong: per-form
  thanks pages are new routes.
- **R11. Health words warn, they do not refuse.** The brief says warn. If wrong: an order form asking "any allergies?" would
  be blocked by a stricter rule.
- **R12. Two new Sheet tabs with one fixed header for all forms, answers in one cell.** No per-form columns that would
  break when a field changes, and only two tab names for the Apps Script to allow. If wrong: owners wanting a column per
  question would need per-form tabs, each a script property.
- **R13. Body limit `forms.maxBodyBytes` (32 KB) for new forms; the contact form keeps its 16 KB (a contact extra).** "No
  change" to the contact form wins, and its test of a 17,000-character message expecting 413 stays. If wrong: a contact
  note of 16 KB in non-Latin letters stays refused, as today.
- **R15. No on/off switch for forms while the Apps Script is not yet updated.** The brief says build what the repo holds
  and list the rest for Grant. Until the script is updated, a new form's Sheet save fails, the owner's email says "Sheet:
  NOT saved - add this one by hand" with every answer, and the visitor sees success because the note reached the owner
  (PROCESS.md rule 15). If wrong: an owner who never reads the email line misses rows in the Sheet until Grant updates
  the script.
- **R16. Rate limits are per form: one visitor gets 5 posts a minute on each form.** The brief asks for per-form limits;
  with at most 10 live forms that is at most 50 a minute from one address, each still behind Turnstile. If wrong: a
  site-wide key is a one-line change.
- **R14. Error messages, "(optional)" and the download email lines are template defaults in `src/content/forms.ts`, not
  placeholders.** Same as the blog's interface words. If wrong: a client wanting other wording edits that module (tier 1).

## Builder check answers

A Sonnet builder read this design. Its questions and the answers (none needed Grant):

1. **Body limit vs unchanged contact tests:** R13. The handler takes a per-form limit; contact's is 16 KB.
2. **New forms before the Apps Script is updated:** R15. No gate flag.
3. **The service-account writer:** both writers serve the forms tabs. `appendRow` already takes any tab name; the
   service-account path is tested with the new tabs too. Its tabs are created by Grant (Needs Grant 1 covers both).
4. **Who generates the registry:** one import-free generator, `registrySource(ids: string[]): string` in
   `src/forms/registry.ts`, used by `scripts/sync-config.mjs` (write and `--check`), by the editor's `add_form`, and by
   the change scope check's byte-equal test (scripts already import shared `.ts` modules). The site and the Worker deploy
   from the same commit (Workers Builds builds both), so they never disagree.
5. **Per-form rate limits multiply the allowance:** R16, intended.
6. **Where `maxForms` is enforced:** in `validateForms`, so the content check, the build and the editor (which calls the
   site check) all refuse it. It counts live form files in the folder; the registry must list exactly the folder's files.
7. **Archiving:** `set_form_status` archived removes every `form` block that shows that form, on any page, in the same
   proposal, and the change list names each page. The archived file keeps its `download`, so restoring brings it back.
8. **Showcase example:** a showcase-only definition in code (`src/forms/showcase.ts`, id `showcase-example`), never a
   file, never in the registry, so the Worker has no endpoint for it and it does not count toward `maxForms`. The block's
   registry example points at it; the content check of registry examples knows it. Submitting it on `/blocks` shows the
   ordinary "failed" message.

## Left to the builder

Component and file names inside the listed folders, the exact regexes, the order of checks inside `validateSubmission`,
how the shared form primitives are split, and test file layout.
