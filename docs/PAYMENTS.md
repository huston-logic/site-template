# Payments and gift cards

This explains how a site takes payment, sells gift cards and takes paid bookings, and how Huston Logic sets it up for one site.
The first product is gift cards. Booking is the second, and it uses the same base (see "Booking" below). Other products will
use the same base later.

Terms used below:

- **Stripe** is the payment company. Its hosted Checkout page is the page where the buyer pays.
- **Restricted key** is a Stripe key that can do only the things you tick when you make it.
- **Webhook** is a message Stripe sends to the site's address when something happens, such as a payment.
- **Test mode** is Stripe's practice mode. Test cards take no real money. Test keys start with `rk_test_`, live keys with `rk_live_`.

## What it does and does not do

- The buyer pays on Stripe's own page. The site never sees a card number, and it loads no Stripe script.
- The money goes to the client's own Stripe account. Huston Logic does not hold it.
- After payment the buyer gets a printable gift certificate (a PDF with a code) by email. The owner gets an email, and
  one row in the ledger: the client's Google Sheet, or their Pipeline app.
- The ledger is the record. The site does not check balances and does not redeem cards. Redeeming is done by the business.
- Refunds are done in Stripe, by hand. See "Refunds" below.
- Not included: online redemption, scheduled delivery, automatic refunds, tax, subscriptions and other payment providers.

Payments are off by default. While `payments` in `site.config.ts` is `null`, nothing about payments is in the build:
no payment route answers, no Stripe secret is listed, the thank-you page is not built, and a live page with a gift card
block fails the content check.

## How a sale flows

1. The visitor picks an amount on the gift card block, fills in the buyer's name and email, and presses the button.
2. The Worker (the site's server code, on Cloudflare) checks the amount against the owner's settings and creates a
   Stripe Checkout page for it. The browser never sends a price the Worker trusts.
3. The visitor pays on Stripe's page.
4. Stripe tells the Worker, by webhook. The Worker asks Stripe again whether the payment is real and paid, then sends the
   certificate, writes the ledger row and emails the owner.
5. The visitor lands on the thank-you page, which confirms the payment with Stripe.

Each step writes a mark on Stripe's payment record when it succeeds. A repeated webhook skips the steps already marked,
so a sale is never sent or recorded twice.

## Set up one site (Huston Logic, in this order)

**1. The client's Stripe account.** The client opens a Stripe account in their own name, and their bank details go there.
Huston Logic does not own the account and does not hold its money.

**2. A restricted key.** In the Stripe Dashboard, make a restricted key. Give it exactly these permissions: Checkout Sessions write, PaymentIntents write and Charges read
(the Worker reads the payment's latest charge to date the sale). Nothing else. Use a test-mode key for previews (`rk_test_...`) and a live-mode key
for production (`rk_live_...`). The Worker refuses a key whose mode does not match the site: a test key on production, or a
live key on a preview, makes the checkout fail with `payments_misconfigured` and creates nothing.

**3. The webhook endpoint.** In the Stripe Dashboard, add a webhook endpoint with the address
`https://<site domain>/api/payments/stripe`. Choose these two events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Stripe then shows the endpoint's signing secret (it starts with `whsec_`). Copy it into the next step. Do the same in
test mode for previews. Test mode has its own endpoint and its own signing secret.

**4. The two Worker secrets.** Names and places only (the values are never written down in the repo or in chat):

- `STRIPE_SECRET_KEY`: the restricted key from step 2.
- `STRIPE_WEBHOOK_SECRET`: the signing secret from step 3.

Production: `npx wrangler secret put STRIPE_SECRET_KEY` and `npx wrangler secret put STRIPE_WEBHOOK_SECRET`, with the live values.
Previews: `npx wrangler preview base-config secret put STRIPE_SECRET_KEY` and the same for `STRIPE_WEBHOOK_SECRET`, with the
test values. A preview copies the base secrets when it is created, so set them before pushing the branch.
Full table: [SECRETS.md](SECRETS.md).

**5. Turn payments on in `site.config.ts`.** Set:

```ts
payments: { provider: "stripe", currency: "usd" },
```

Currency is one of `usd`, `cad`, `gbp`, `eur`, `aud` or `nzd` (two-decimal currencies only). Then run:

```bash
npm run sync:config
```

This adds the two Stripe secret names to `wrangler.jsonc` and, because payments need it for the certificate's logo, the
Images binding. Then run `npx wrangler types worker/worker-configuration.d.ts`, as the README asks after any change to
`wrangler.jsonc`. Commit the result in the branch's pull request.

**6. The ledger.** Pick the ledger the client uses:

- *Google Sheet (default).* In the Sheet, add two tabs named exactly `Gift cards` and `Gift cards preview`. Put this
  header row in row 1 of each tab, in this order:

  `Sold (UTC) | Code | Amount | Buyer | Buyer email | Recipient | Message | Stripe payment | Came from | Campaign | Click ID | First seen (UTC) | Days to note | Used | Balance | Notes`

  Then update the Apps Script. Open `docs/apps-script/contact-sheet.gs` in the repo, copy its new contents into the
  script editor in place of the old code, and save. The two new Script Properties are `TAB_GIFT_CARDS` and
  `TAB_GIFT_CARDS_PREVIEW`. Set them only if the tabs are named differently from the defaults above. Then deploy a new
  version of the same web app, so the address the Worker uses does not change. The script skips a sale whose code is
  already in its tab, so a repeated notice never lists a sale twice.
- *Pipeline app.* If the client uses their Pipeline app copy (`contact.destination` set to `"pipeline"`), each sale becomes
  a lead there, with the code, amount, recipient and Stripe payment reference in the message. Previews never post to the app.

**7. A page with the gift card block.** Add a page with the `gift-card` block (see [EDITING.md](EDITING.md), "Gift
cards"). The block sits on a live page only once payments are on. The thank-you page at `/gift-cards/thanks` is part of the
build while payments are on.

**8. Turn selling on, by chat.** Ask the owner's chat tools to start selling gift cards. The change is refused until
payments are set up on the site, and the refusal says so. Selling starts when the owner publishes the change.

**Certificate fonts (Huston Logic only).** The certificate uses the site's own fonts as small subsets in
`src/brand/certificate-fonts/`. Run `node scripts/fetch-certificate-fonts.mjs` only when the curated fonts change
(`CURATED_FONTS` in `src/brand/fonts.ts`). A normal build never fetches fonts.

## Booking

Booking is the second product on this base. It uses the same Stripe keys, the same webhook endpoint and the same marks on the
payment record. It adds one event to the webhook: `checkout.session.expired`, so Stripe tells the site when a checkout closes
unpaid and its hold can be removed. Booking takes card payments only, and a payment can only complete while its checkout is
open. The emails, the ledger and the calendar are described in [BOOKING.md](BOOKING.md).

## Test walk on a preview

Use test mode only. The preview builds from its own branch, so the branch must have `payments` set and selling on.

1. Make sure the preview has the test key and the test signing secret (step 4), and the Sheet has its preview tab.
2. Open the preview's page with the gift card block. Pick an amount and fill in the buyer's name and email. Add a
   recipient's name and an email if you want the recipient copy.
3. On Stripe's hosted page, pay with Stripe's test card `4242 4242 4242 4242`. Use any future expiry date and any
   three-digit code.
4. Check each of these:
   - The thank-you page says the payment is confirmed, and says where the certificate went.
   - The certificate email arrives with a PDF. On a preview it goes to the site's own address, with the usual
     `[Preview -> would go to ...]` subject.
   - The `Gift cards preview` tab has one new row, with the code, amount and Stripe payment reference.
   - The owner email arrives, with the same code, amount and source.
5. Delete the test row from the preview tab. Previews skip the Pipeline app, so nothing is written there.

Open the PDF in a viewer and check it prints on one Letter page.

## Testing the webhook on a preview

The walk above uses the webhook only if Stripe can reach the preview. To check it directly:

- In the Stripe Dashboard (test mode), point the test webhook endpoint at the preview's `/api/payments/stripe` address,
  and send a test event for one of the two events listed in step 3.
- Or use the Stripe CLI, a command-line tool from Stripe that can forward test events to an address. Follow Stripe's own
  instructions for its command.

A correct webhook makes the same steps as the walk, and a second delivery of the same event adds nothing.

## Go-live list

Do these in order, on the live site, before you hand it over:

- [ ] The client's Stripe account is in their name, with bank details added.
- [ ] A live restricted key (`rk_live_...`) with the two permissions is set as `STRIPE_SECRET_KEY` for production.
- [ ] A live webhook endpoint for `https://<site domain>/api/payments/stripe` with the two events is set, and its
      signing secret is set as `STRIPE_WEBHOOK_SECRET` for production.
- [ ] `payments` is set in `site.config.ts` on the main branch, and the sync and wrangler steps are committed.
- [ ] The ledger is ready: the two Sheet tabs with their header rows and the updated Apps Script, or the Pipeline app.
- [ ] One real, low-value purchase (a small amount, from a real card you own), checked the same way as the test walk.
      Then refund it in Stripe (see "Refunds") and note the refund in the ledger.
- [ ] In the Stripe Dashboard, the email alerts for failing webhook endpoints are on, so Stripe emails the account
      owner if the site stops receiving events.
- [ ] The privacy page says that Stripe is the payment processor and that it takes the card details.
- [ ] The launch checklist's gift card lines are ticked, with the date ([LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md)).

## When something fails after payment

A buyer who has paid always gets the certificate, or the owner is told.

- **The buyer's email fails** (after one retry). The owner gets an alert at once. It has the certificate attached and says
  what to do: forward it to the buyer if it has not arrived within the hour. Stripe then retries the webhook for up to 3
  days. When the email finally goes out, the owner gets a note that it was delivered late.
- **The ledger row fails.** The owner's email says the row was NOT saved and gives the row cell by cell. Add it to the
  tab by hand. The site will not add it a second time.
- **A paid session does not match its sale** (the amount, the currency or the payment itself). No certificate is issued and no
  code is given out. You get one email, "Action needed: gift card payment did not match", with the Stripe payment id and
  amount; refund it in Stripe if needed.
- **Two sites on one Stripe account.** Each sale carries its site's Worker name (`domain.workerName`); a site ignores any
  payment that names another site.
- **The owner's email fails.** Stripe retries the webhook. Steps already done are skipped.
- **The webhook never arrives** (for example, the endpoint is wrong). When the buyer returns to the thank-you page and the
  payment is more than 90 seconds old, the page sends the certificate and the owner's email says so in a neutral note (a slow
  payment method that has only just cleared looks the same); if that note appears often, check the webhook as below. The page asks again at 30 and 100 seconds while the certificate has not gone out.

If a payment is not in the ledger or the owner's inbox, check Stripe's webhook log for the endpoint first. Then check the
site's Worker logs (Cloudflare Workers Logs) for the fixed event names: `webhook_refused`, `payments_misconfigured`,
`stripe_failed` and `payment_mismatch`. The logs hold no card data and no personal data.

## Refunds

Refunds are made by hand, in the Stripe Dashboard: find the payment and refund it there. The site does not refund
automatically.

After a refund, write it in the ledger: put a note in the Notes cell and set Balance to 0.

## Known limits

- The site does not check balances and does not redeem gift cards. The ledger's Used and Balance cells are for the owner.
- On a Pipeline site, a repeated notice for the same sale in the same second can add the lead twice. The app's intake has
  no idempotency key yet (a request that is safe to repeat), so this is a thing to watch.
- Gift card expiry: the settings allow none, or 60 to 240 months (see [EDITING.md](EDITING.md), "Gift cards").
- The site does not calculate tax.

## Adding another payment provider

Products never call Stripe directly. They use a small provider interface (`worker/payments/types.ts`). The one place a
provider is chosen is `worker/payments/provider.ts`, marked "OTHER PROVIDER GOES HERE". A new provider needs:

- its name added to the payments setting in `src/payments/config.ts`, and to `scripts/config-rules.mjs` (its secret names);
- its client next to `worker/payments/stripe.ts`;
- a branch in `paymentProvider` and in `verifyPaymentWebhook`;
- tests like `worker/payments/stripe.test.ts`.

Currencies must have two decimal places. A currency with none needs a change in `worker/payments/money.ts`.
