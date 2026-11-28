# Plan: payments base and gift cards

Design: `docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md` (rulings R1 to R15). One branch
`feat/gift-cards`, one PR. Opus plans, integrates and reviews; Sonnet implements A, then B, C and D in parallel
worktrees; Haiku writes E. Every task: tests first, `npm run check:fast` before each commit.

## A. Foundation (Sonnet, main checkout, first)

1. `site.config.ts`: `payments: null as null | { provider: "stripe"; currency: PaymentCurrency }` with a comment (R1, R2);
   `contact.sheetTabs.giftCards: "Gift cards"`, `giftCardsPreview: "Gift cards preview"`.
2. `src/payments/config.ts` (import-free): `PAYMENT_CURRENCIES = ["usd","cad","gbp","eur","aud","nzd"]`,
   `type PaymentsConfig`, `paymentsForBuild(config, env)`: `PAYMENTS_FIXTURE=1` gives `{ provider: "stripe",
   currency: "usd" }` on a non-production build and throws on a production one (copy `trackingForBuild`'s pattern).
3. `src/gift-cards/` (import-free, explicit `.ts`): `schema.ts` (types, limits of R13), `validate.ts`
   (`validateGiftCards(data, { paymentsOn }) => string[]`, owner's words), `amount.ts`
   (`checkAmount(settings, { kind, amount }) => { ok: true, minor } | { ok: false, reason }`), `code.ts`
   (`newGiftCode(random?: (n) => Uint8Array) => string`, R5, and `isGiftCode`), `example.ts` (showcase settings, selling on,
   presets 25/50/100 with one label, custom 25 to 500). Tests beside each (`*.test.ts`, add the glob to `test:worker`).
4. `src/content/gift-cards.json` (selling false, presets 25/50/100, custom null, `[[placeholder]]` wording and terms,
   validForMonths null) and `src/content/gift-cards.ts` (block and thank-you copy, template wording).
5. Settings wiring: `"gift-cards"` in `src/settings/names.ts`, `validateSite` branch, `tool-schemas.ts` lists,
   `change-list-documents.ts` section, content check (a live page with a `gift-card` block while payments is null fails).
6. `scripts/config-rules.mjs`: `secretsFor` adds `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` when payments is set; the
   Images binding `IMAGES` when payments is set (as uploads does); `siteProblems` checks provider and currency.
   `npm run sync:config` regenerates `wrangler.jsonc` (unchanged while null). `worker/config.ts` carries `payments` and
   the two new tabs; `worker/env.ts` adds the two secrets.
7. `scripts/finish-build.mjs`: payments null removes `out/gift-cards/` (the thank-you page); payments set copies the
   chosen certificate fonts into `out/_certificate/` (after C lands; leave a marked stub now). Tests beside.

## B. Worker payments base and fulfilment (Sonnet, worktree, after A)

Files: `worker/payments/{stripe.ts,provider.ts,webhook.ts,marks.ts,money.ts}`, `worker/gift-cards/{checkout.ts,
confirm.ts,fulfil.ts,emails.ts,ledger.ts}`, routes in `worker/contact.ts` `createWorker`, `worker/apps-script.ts` and
`worker/sheets.ts` (append once by code), `docs/apps-script/contact-sheet.gs` (two tabs, skip a code already present).
- Stripe: form-encoded `fetch` to `https://api.stripe.com/v1/...` with `Authorization: Bearer`, `Stripe-Version` pinned,
  timeout and one retry on 5xx (idempotency key on POSTs). `createCheckoutSession`, `getSession(id)` with
  `expand[]=payment_intent.latest_charge`, `markPayment(piId, marks)`.
- `verifyStripeSignature(rawBody, header, secret, nowSeconds, toleranceSeconds = 300)`: HMAC-SHA256 of `${t}.${body}`,
  any `v1` matches (constant time), refuse |now - t| > tolerance.
- Routes: `POST /api/gift-cards/checkout` (same-origin, JSON, 8 KB, rate limit, honeypot, Turnstile action `gift_card`,
  `checkAmount`, selling on, key mode matches site mode) -> `{ url }`. `GET /api/gift-cards/confirm?session_id=`
  (same-origin, rate limit) -> R8. `POST /api/payments/stripe` (raw body up to 256 KB, signature first) -> R6, R7.
  All 404 while payments is null.
- Fulfilment takes its certificate maker as a dependency:
  `type MakeCertificate = (input: CertificateInput, env: ContactEnv, requestUrl: string) => Promise<Uint8Array>`
  (`CertificateInput` from C's `worker/gift-cards/certificate-types.ts`, which B creates first exactly as below).
  Tests use a fake maker returning `%PDF-1.7 fake`.
- Tests (`worker/gift-cards.test.ts`, fake Stripe in fetch): every "Done when" Worker item, preview routing, key mode.

## C. Certificate PDF (Sonnet, worktree, parallel with A)

Files: `worker/payments/pdf.ts` (writer), `worker/payments/ttf.ts` (cmap 4/12, hmtx, metrics), `worker/payments/png.ts`
(inflate, unfilter, split alpha), `worker/gift-cards/certificate.ts` (layout), `worker/gift-cards/certificate-types.ts`,
`scripts/fetch-font-files.mjs` (adds certificate TTF subsets: every display font at 400 and 600, every accent at italic
400, into `src/brand/certificate-fonts/`, listed in `src/brand/certificate-fonts.ts`), tests, and a script
`scripts/certificate-sample.mjs` that writes a sample PDF for the critique.
```ts
export type CertificateInput = {
  businessName: string; siteHost: string; amountText: string; code: string;
  to: string | null; from: string; message: string | null;
  redeemWording: string; termsLine: string; issuedOn: string; validUntil: string | null;
  colors: { green: string; ink: string; ink2: string; rust: string; line: string };
};
export type CertificateAssets = { display: Uint8Array; displayBold: Uint8Array; accent: Uint8Array; logo: { png: Uint8Array } | null };
export function certificatePdf(input: CertificateInput, assets: CertificateAssets): Promise<Uint8Array>;
```
One Letter page, every text fits its box (shrink then wrap; message wraps to at most 6 lines). Tests: one page, MediaBox
612 792, fonts embedded, ToUnicode present, long names and a 300-character message fit, a missing glyph falls back.

## D. Block, thank-you page, editor (Sonnet, worktree, after A)

- `src/blocks/library/gift-card/` (definition with fields heading and intro, variants, one per page, example) and
  `src/components/hl/GiftCardForm.tsx` (client): R9, R14, Turnstile via `useTurnstile`, `track("begin_checkout")`
  before `location.assign(url)`. Registered in `definitions.ts` and `components.tsx`; `npm run blocks:catalog`.
- `src/app/(site)/gift-cards/thanks/page.tsx` (noindex) and `GiftCardThanks.tsx` (client): R8, `track("purchase")` once.
- Editor: owner sayings as acceptance tests in `worker/editor/gift-cards-acceptance.test.ts` ("add a $500 gift card",
  "let people pick any amount from $50 to $1,000", "change the redeem wording", "stop selling gift cards", and
  turning selling on refused while payments is null).

## F. Integration (Opus, main checkout)

Merge B, C, D. Wire `certificatePdf` into fulfilment (fonts from `env.ASSETS` `/_certificate/*.ttf`, logo through
`env.IMAGES`). `finish-build` copies fonts. `tests/tracking/gift-card-flow.spec.ts` and a harness with a fake Stripe
(walk, purchase once, reload). a11y spec for the block and the thank-you page. Payments-null build compared with `main`.

## E. Docs (Haiku docs-writer, after F)

`docs/PAYMENTS.md` (setup, key permissions, webhook address and events, test-mode walk with card 4242 4242 4242 4242,
go-live list, refunds in Stripe then noted in the ledger), `docs/SECRETS.md` rows, `docs/EDITING-LANES.md` (gift cards
by chat), `docs/LAUNCH-CHECKLIST.md` lines, `docs/EDITING.md` "Gift cards", AGENTS.md (Worker imports, routes,
secrets), README.

## G. Review and finish

check, a11y, tracking, Lighthouse; review-code, review-a11y, review-security once; design critique of the block (1440
and 390) and the certificate; STATUS.md; PR.
