# Payments base and gift cards: design

Date: 2026-11-27. Status: approved direction (Grant's brief for this run); the rulings below are Claude's, each with its
cost if wrong. Plan beside it in `docs/superpowers/plans/2026-11-27-payments-and-gift-cards.md`.

## Goal

A site can sell gift cards. The buyer pays on Stripe's own hosted Checkout page, gets a printable certificate with a code
by email, and the owner gets a row in their ledger (their Sheet, or their Pipeline app) and an email. Money goes straight
to the client's own Stripe account; the site never sees a card number and loads no Stripe script. The booking run that
follows takes payment through the same base.

Not in this run: booking, redeeming online, balance checks, scheduled delivery, automatic refunds, tax, subscriptions,
other providers.

## Shape

```
browser (gift-card block)            Worker                                   Stripe
  POST /api/gift-cards/checkout  ->  checks, amount from the owner's file  ->  POST /v1/checkout/sessions
  <- { url }  (begin_checkout, then leave for Stripe)                         hosted page, buyer pays
                                     POST /api/payments/stripe  <-  webhook (signed)
                                     GET session (authoritative), then the steps, each marked on the PaymentIntent
  /gift-cards/thanks?session_id= ->  GET /api/gift-cards/confirm  ->  GET session; { paid, value, currency, id }
  (purchase once)
```

Code layout: `worker/payments/` is the reusable base (config, provider seam, Stripe client, webhook verification,
step marks, money formatting). `worker/gift-cards/` is the first product on it (checkout, fulfilment, certificate,
emails, ledger row). `src/gift-cards/` holds the import-free settings rules shared by the content check, the editor,
the block and the Worker. Booking will be a second product folder that calls the same base.

## Rulings

**R1. Off means nothing ships.** `payments` in `site.config.ts` is `null` (template default) or
`{ provider: "stripe", currency: "usd" }`. Owner-only file. With `null`: the Worker answers 404 on every payments
route; `wrangler.jsonc` lists no Stripe secret; the thank-you page `/gift-cards/thanks` is not in the build (removed by
`scripts/finish-build.mjs`); no CSP origin is added (Checkout is a top-level navigation, which the CSP does not
govern); `npm run check:content` fails a live page holding a `gift-card` block; and a production build has no gift card
script. That last one needed a module swap: every catch-all page loads every block's client code (the quote builder's
already did on `main`), so the form alone added about 15 KB to every page. The block renders a form slot that
`next.config.ts` points at the real form only when payments are on or the build is not production (previews, CI and
the showcase keep it), the pattern the tracking tags use. Measured on production builds (Workers Builds on `main`) of
this branch and `main`: every page pixel-identical at 1440 and 390, `_headers` and the sitemap byte-identical, no gift
card script; the shared stylesheet is 1.1 KB larger (Tailwind scans the block's source) and two shared scripts
reshuffle by 88 bytes net (the bot check learned the `gift_card` action). Cost if wrong (Grant meant every byte of
`out/`): exclude the block's files from Tailwind's scan while payments are off, about an hour.

**R2. One place chooses the provider.** `worker/payments/provider.ts` exports `paymentProvider(config, env)`, which
returns the Stripe client for `"stripe"` and is marked `OTHER PROVIDER GOES HERE`. Products talk to a small
`PaymentProvider` interface (create a hosted checkout, verify a webhook, read a payment, write marks), never to Stripe
directly. Currencies: two-decimal ones only (usd, cad, gbp, eur, aud, nzd). Cost if wrong: a zero-decimal currency
needs the minor-unit factor per currency, a small change in `worker/payments/money.ts`.

**R3. Two secrets.** `STRIPE_SECRET_KEY` (a restricted key, `rk_live_...` in production, `rk_test_...` in previews)
and `STRIPE_WEBHOOK_SECRET` (`whsec_...`). Required only while `payments` is set (`secretsFor` in
`scripts/config-rules.mjs`). The restricted key needs exactly: Checkout Sessions write, PaymentIntents write and Charges read (the session read expands `payment_intent.latest_charge`). The
Worker refuses to start a checkout when the key's mode does not match the site's mode (a test key on production or a
live key on a preview): 502 `payments_misconfigured`, nothing created. Cost if wrong: a key Grant made with other
permissions fails with Stripe's 403, which the Worker logs as a fixed event and turns into a plain error.

**R4. The Worker computes every amount.** The browser sends `{ kind: "preset", amount }` or `{ kind: "custom", amount }`
in whole currency units. The Worker checks it against `src/content/gift-cards.json` (bundled into the Worker, like the
form files): a preset must be listed; a custom amount needs the custom range on and a whole number inside it; selling
must be on. Anything else is 400 with nothing created. The session's single line item carries the Worker's
`unit_amount` (minor units); the amount also rides in the session metadata so the webhook can compare. Cost if wrong:
none for money (Stripe charges only what the Worker sent).

**R5. The code is made at checkout and lives in Stripe.** At checkout the Worker draws a 12-character code from 30
characters that cannot be confused aloud (`23456789ABCDEFGHJKMNPQRSTVWXYZ`: no 0, O, 1, I, L or U), shown as
`XXXX-XXXX-XXXX` (about 59 bits, `crypto.getRandomValues` with rejection sampling). It goes in the session metadata,
so one payment always has one code whatever happens later; an unpaid session's code is never issued. Codes are never
sent to analytics or put in a URL. Cost if wrong: none known; collisions are about 1 in 10^17 per pair.

**R6. Exactly once without a database: marks on the PaymentIntent.** Every delivery of a webhook re-reads the session
from Stripe (with its PaymentIntent) and acts only when `payment_status` is `paid` and the amount and currency match
the metadata. Each step writes a mark into the PaymentIntent's metadata when it succeeds: `hl_buyer`, `hl_recipient`,
`hl_ledger` (`saved`, `by-hand` or `skipped`), `hl_owner`, `hl_alert`. A delivery skips every marked step, so a
repeated, replayed or out-of-order event redoes nothing. For two deliveries in the same second (the only gap marks
leave): every email carries a Resend idempotency key `gift-<payment>-<step>` (Resend drops a repeat for 24 hours,
as the forms already rely on), the Apps Script skips a row whose code is already in the tab (under its existing lock),
and the service-account writer reads the code column before appending. Events handled:
`checkout.session.completed` and `checkout.session.async_payment_succeeded`; every other event answers 200 and does
nothing. Cost if wrong: in a same-second duplicate on a Pipeline site, the owner could see the lead twice (Pipeline's
intake has no idempotency key today; Needs Grant item).

**R7. Failure after payment.** Order: buyer email (certificate attached), recipient copy, ledger row, owner email.
- Buyer email fails (after its one retry): the owner gets an alert at once, with the certificate attached and what to
  do ("forward this to the buyer if it has not arrived within the hour"); the webhook answers 500 so Stripe retries
  for up to 3 days; a later success marks `hl_buyer` and the owner email says it was delivered late.
- Ledger fails: the owner email says "Sheet: NOT saved - add this row by hand" and gives the row cell by cell; the mark
  `hl_ledger=by-hand` stops any retry adding it twice.
- Owner email fails: 500, so Stripe retries; the marked steps are skipped.
A buyer who paid always gets the certificate or the owner is told. Cost if wrong: if Resend is down for more than 3
days, Stripe gives up; Stripe then emails the account owner that the endpoint is failing (go-live list).

**R8. The thank-you page confirms, and repairs a missing webhook.** `/gift-cards/thanks?session_id=...` calls
`GET /api/gift-cards/confirm` (same-origin, rate-limited), which reads the session from Stripe and answers
`{ status, value, currency, transactionId, delivered }`. `transactionId` is the PaymentIntent id (never the code). The
page shows the paid state only on `status: "paid"`, fires `purchase` once (a `localStorage` record per transaction,
so a reload or a second tab does not fire again), and says where the certificate went. If the payment is paid but not
yet delivered and was taken more than 90 seconds ago, confirm runs the same fulfilment (the marks make it safe) and
the owner email says the webhook did not arrive, with the fix. The page asks again at 30 and 100 seconds while
`delivered` is false. Cost if wrong: if no one opens the thank-you page and the webhook is missing, nothing is sent;
the go-live list's test purchase catches a missing webhook.

**R9. Cancel keeps the choices.** Before leaving for Stripe the block saves its fields to `sessionStorage`; the cancel
address is the block's page with `?checkout=cancelled`; the block restores the fields and says nothing was charged.
Answers never go in a URL.

**R10. The certificate is a PDF attachment, made in the Worker without a library.** One Letter page (612 by 792
points), drawn by `worker/gift-cards/certificate.ts` on a small PDF writer (`worker/payments/pdf.ts`: text, lines,
rectangles, one image, TrueType fonts embedded as Type0/Identity-H with a ToUnicode map, Flate through
`CompressionStream`). Fonts: the site's display font (400 and 600) and accent (italic 400), as static TrueType
subsets (Latin-1, Latin Extended-A and typographic punctuation) fetched once by `scripts/fetch-font-files.mjs` into
`src/brand/certificate-fonts/` and copied by `finish-build.mjs` into `out/_certificate/` only while payments are on.
A character the fonts lack is shown without its accent, or as "?". Logo: the uploaded WebP is turned into PNG by the
Images binding (added to `wrangler.jsonc` while payments are on) and embedded with its transparency; without a logo,
or if that fails, the business name is set in the display font. Colors: `contact.emailColors` (the same wiring as the
automatic reply). No dependency was needed. Cost if wrong: a hand-written PDF that one reader shows badly; the test
walk opens it in macOS Preview and Chrome, and a later run could swap the writer without touching the layout.

**R11. Ledger.** Sheet tabs "Gift cards" and "Gift cards preview" (`contact.sheetTabs.giftCards` and
`giftCardsPreview`). Columns: Sold (UTC), Code, Amount, Buyer, Buyer email, Recipient, Message, Stripe payment, the
five source cells, Used, Balance, Notes (the last three left empty for the owner). Both writers. Pipeline sites post
`{ name, email, message, source, attribution }` to `/intake` as forms do, the message holding the code, amount,
recipient and payment reference; previews skip it, as forms do.

**R12. Emails.** All plain text, like the notification email (no visitor text in HTML anywhere). Buyer: the
certificate attached. Recipient: only when the buyer gave an email, only after payment, the same PDF. Owner: every
sale, with the ledger result and the source line. Previews send every email to the site's own address with the usual
`[Preview -> would go to ...]` subject, and write the preview tab.

**R13. Settings, one file the owner changes by chat.** `src/content/gift-cards.json`:
`{ selling, amounts: [{ amount, label? }], custom: null | { min, max }, redeemWording, termsLine, validForMonths }`.
Limits: 1 to 8 amounts, 5 to 10,000 whole units, unique; labels up to 40 characters; custom `min < max` inside 5 to
10,000; wording up to 300 and terms up to 200 characters; `validForMonths` null (no expiry, the default) or 60 to 240
(US federal law forbids gift card expiry under 5 years). Turning selling on while `payments` is null is refused:
"Gift card sales cannot be turned on yet: payments are not set up on this site. Huston Logic sets them up
(docs/PAYMENTS.md)." Changes go through `propose_change` with `{ settings: "gift-cards" }`, like the other settings
files.

**R14. The block.** `gift-card`: amount (radio cards for presets, "Other amount" when the range is on), buyer name and
email, recipient name, message (300 characters) and recipient email (optional), the forms' Turnstile check (action
`gift_card`), one button. One per page. Selling off shows a plain closed note. Its copy is template wording in
`src/content/gift-cards.ts` (listed in the PR as copy for Grant).

**R15. Test builds.** `PAYMENTS_FIXTURE=1` gives a local test build payments `{ stripe, usd }` (a production build with
it fails), like `TRACKING_FIXTURE`. The showcase shows the block with example settings. `test:tracking` drives the real
Worker code against a fake Stripe in the harness (sessions, a hosted-page stand-in that pays and sends a signed webhook,
PaymentIntent metadata).

## Done when (from the brief)

Payments null: build, CSP and pages unchanged. The mocked walk: amount chosen, session carries the Worker's amount, a
signed webhook, exactly one certificate email, one ledger row, one owner email with the same code, amount and source.
The same webhook three times, and events out of order: one of each. Refused with nothing sent: wrong signature, stale
timestamp (over 300 seconds), forged amount, amount outside the custom range, selling off. Sheet failing after
payment: buyer still gets the certificate, owner email says the row was not saved and gives it. Owner sayings pass as
acceptance tests. `test:tracking`: begin_checkout and purchase once; a reload does not fire purchase again. The
certificate passes the design critique and prints on one Letter page. Every required check passes at unchanged
thresholds.
