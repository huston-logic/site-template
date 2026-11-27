# Ad tracking: plan

Design: `docs/superpowers/specs/2026-11-27-ad-tracking-design.md` (read it first; its tables and rulings are the spec).
Branch `feat/ad-tracking`, one PR. Already on the branch: `src/tracking/config.ts` (formats, CSP origins, build
decision, fixture IDs) and the `tracking` group in `site.config.ts`. Model routing: PROCESS.md rule 8.

Tasks A, B and C run in parallel in their own git worktrees (no shared files). Each runs `npm run check:fast` in its
own worktree before each commit. The pre-commit hook runs check:fast in the main checkout, so the main checkout stays
clean while they work.

## Task A (Sonnet): settings checks, CSP generation, fixture build

Files: `scripts/sync-config.mjs`, `scripts/config-rules.mjs` (+ test), `scripts/finish-build.mjs` (+ test),
`src/tracking/config.test.ts` (new), one editor test.

1. `src/tracking/config.test.ts`: `trackingProblems` (each format, a label without the id, placeholders refused by
   format), `trackingIds`, `trackingCspOrigins` (none, each product alone, all three: exact lists), `trackingForBuild`
   (null in dev and preview, real IDs and host on production, fixture on `TRACKING_FIXTURE=1`, throws on production
   with the fixture), `isSiteHost`.
2. `check:config` (`scripts/sync-config.mjs --check` via config-rules): add `trackingProblems(c.tracking)`.
3. CSP: move the `_headers` text builder into an exported pure function (in `scripts/config-rules.mjs` or a new
   `scripts/headers-text.mjs` with tests) that takes the config and appends `trackingCspOrigins(c.tracking)` to
   script-src, img-src (after `'self' data:`), connect-src and frame-src. Add a comment line per set product. With all
   IDs null, `public/_headers` must be byte-identical to `main` (test it against the committed file).
4. `scripts/finish-build.mjs`: when `TRACKING_FIXTURE=1`, rewrite `out/_headers` with the CSP built from
   `FIXTURE_TRACKING`; otherwise do nothing new. Test both.
5. Owner-only proof: a test in `worker/editor/` that every editor operation refuses a path of `site.config.ts` (find the
   editor's writable-path check and assert on it).

## Task B (Sonnet): the Worker side

Files: `worker/attribution.ts` (+ test, new), `worker/visit.ts` (+ test, new), `worker/contact.ts`, `worker/forms.ts`,
`worker/messages.ts`, `worker/pipeline.ts`, `worker/sheets.ts`, their tests, `docs/apps-script/contact-sheet.gs`
(header comment only).

1. `worker/attribution.ts`, pure, never throws: `touchFromVisit(path, referrer, ownHost, nowSeconds)`, `mergeVisit(state,
   touch, now)` (null when nothing changes), `encodeState` / `decodeState` (base64url JSON, the 3,600-byte budget),
   `readAttribution(cookieHeader, now)` (clean field by field: allow-listed keys, types, caps, control characters,
   click-ID charset, drop touches over 90 days old or more than a day in the future), and the outputs:
   `sourceSummary(a)` (at most 60 characters), `sheetCells(a, receivedAt)` (the five cells, `Not known` and blanks
   with no attribution), `emailLine(a, receivedAt)` (one line, no newline possible), `pipelineAttribution(a,
   receivedAt)`. Exact rules: design, "Source capture" and "Delivery".
2. `worker/visit.ts`: `POST /api/visit`. Same-origin check as the forms, JSON only, body at most 2 KB, `{ path,
   referrer }` strings only. Answers 204 with `Cache-Control: no-store`, the Worker's CSP header, and `Set-Cookie` only
   when `mergeVisit` changed something. Wrong method 405, bad input 400, never logs values. Route it in
   `createWorker` in `worker/contact.ts` next to `/api/contact`.
3. Submissions: in `handleSubmission`, read the cookie once with `readAttribution` and pass it to `spec.delivery` and
   `spec.notification` (both specs). Contact `sheetRow` and `formSheetRow` append the five cells; both notification
   emails add the `Came from:` line before `Received:`; `PipelineLead` gains optional `source` and `attribution`, and
   `sendToPipeline` sends them when present. `worker/sheets.ts` range `A:K` becomes `A:T`.
4. Tests: the acceptance path in a new `worker/attribution-acceptance.test.ts`: a tagged visit with `utm_*` and a
   `gclid` (cookie set), a later untagged visit (no Set-Cookie), then the contact form and an owner-made form, for the
   Sheet (Apps Script body), the email text and the Pipeline post (`destination: "pipeline"` fixture). Plus forged and
   oversized cookies (bad base64, bad JSON, extra keys, 10 KB, formula text, newlines, future times): the submission
   still answers 200 and the values are cleaned or dropped. Update existing row and email expectations.
5. `contact-sheet.gs`: header comments list the five new columns. No code change (it already takes 20 columns).

## Task C (Sonnet): event layer, loader, capture script

Files: `src/tracking/events.ts` (+ test), `src/tracking/track.ts`, `src/tracking/capture-script.ts` (+ test),
`src/components/tracking/TrackingTags.tsx` (new, `"use client"`), `src/app/layout.tsx`,
`src/components/hl/ContactForm.tsx`, `src/components/hl/FormView.tsx`.

1. `events.ts`: `EVENT_NAMES`, the typed params per event, and `eventCalls(name, params, ids)` returning the exact
   `gtag(...)` and `fbq(...)` argument lists from the design's table (allow-listed params; bad value or currency
   dropped). Tests for every row of the table and with each product missing.
2. `track.ts`: `track(name, params?)` calls `window.hlTrack` when present, else pushes to `window.hlq` (at most 50).
3. `TrackingTags.tsx` (props: `TrackingBuild`): one effect does nothing when `navigator.globalPrivacyControl === true`
   or (`host` set and `!isSiteHost(location.hostname, host)`); otherwise defines `dataLayer`/`gtag` and an `fbq` queue
   stub (our own code, not Meta's minified snippet), `gtag('js')`, `gtag('config', id, { send_page_view: false })` for
   GA4 and Ads, `fbq('init', id)`, sets `window.hlTrack`, drains `window.hlq`, adds one document click listener for
   `a[href^="tel:"]` and `a[href^="mailto:"]`, and after `load` plus an idle callback adds
   `https://www.googletagmanager.com/gtag/js?id=<GA4 or Ads id>` and `https://connect.facebook.net/en_US/fbevents.js`
   (async). A second effect on `usePathname()` sends `page_view`. Renders nothing.
4. `capture-script.ts`: `CAPTURE_SCRIPT`, a plain string of ES2017 the root layout puts in a `<script>` in `<head>`:
   posts `{ path, referrer }` to `/api/visit` (`keepalive`, errors swallowed) only when the query has a `utm_*` or click
   ID key or the referrer is another host. Test it by running the string with a fake `location`, `document` and `fetch`.
5. `layout.tsx`: the capture script in `<head>`; `trackingForBuild(base config, process.env)` and render
   `<TrackingTags>` only when it is not null.
6. `ContactForm.tsx` and `FormView.tsx`: `track("form_start", { form_id })` once on first focus, `track("lead",
   { form_id })` on the Worker's success, before moving on. The contact form's id is `contact`.

## Task D (Haiku, after A to C): docs

`docs/TRACKING.md` (new), a Lane 3 line in `docs/EDITING-LANES.md`, lines in `docs/LAUNCH-CHECKLIST.md` (including
"tracking on means the privacy page says so", with suggested privacy wording in TRACKING.md only), AGENTS.md (the
tracking modules, the Worker's `/api/visit`, `TrackingTags` in the client list, the third-party script exception,
`TRACKING_FIXTURE` in the build variables, `worker/attribution.ts`), README (CSP origins per product).

## Integration (Opus)

1. Merge A, B and C into `feat/ad-tracking`; `npm run check`.
2. No IDs: `public/_headers` equals `main`; `npm run report:changes` and `npm run compare:screens` pixel-identical;
   request count per page unchanged (Playwright, third-party requests recorded).
3. Fixture build (`TRACKING_FIXTURE=1 npm run build`): a local Playwright run with third-party hosts stubbed proves the
   tags load, each event fires under its mapped name, CSP has no violation, GPC loads nothing, and a page written by the
   editor's operations (temporary, not committed) fires page_view and its form fires lead.
4. Lighthouse with fixture tags on (report the scores).
5. Reviews: review-code, review-security, review-a11y, then the design critique; fix; STATUS.md; PR.
