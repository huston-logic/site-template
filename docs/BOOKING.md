# Booking

This explains how booking works and how Huston Logic sets it up for one site. Booking uses the same payment setup as gift cards, so read [PAYMENTS.md](PAYMENTS.md) first. The design and the reasons for each choice are in `docs/superpowers/specs/2026-11-27-booking-design.md`.

Terms used below:

- **Google Calendar** is the owner's calendar. It is the one record of what is booked.
- **Service account** is a robot Google account the site signs in as. It has an email address and a key file. The owner shares their calendar with that email.
- **Free/busy** is Google's view of when a calendar is busy. It shows no details of the events.
- **Hold** is a calendar event that keeps a time while the visitor pays.
- **Durable Object** is a Cloudflare feature the site uses as a lock, so two visitors cannot take the same time. It stores nothing.
- **Cron** is a timer that runs a task on a schedule. Here, every 15 minutes.
- **Stripe test mode** and the **webhook** are explained in [PAYMENTS.md](PAYMENTS.md).

## 1. What booking does

- The visitor picks a service, the party size, and a time for each session.
- The visitor pays a deposit, the full price, or nothing online, as the service says.
- The owner's Google Calendar is the one record. The site reads it for busy times and writes each booking to it.
- There is no database. Bookings live in the calendar, payments in Stripe, and the lock holds nothing.
- Changes and refunds are the owner's job: they move or delete the event in Google Calendar, and refund in Stripe.

## 2. Off by default

Booking is off while `booking` in `site.config.ts` is `null`. While it is off:

- every `/api/booking/*` route answers 404;
- `wrangler.jsonc` has no lock, no timer and no extra secret;
- the `/booking/thanks` page is not built;
- a live page with a `booking` block fails the content check;
- a production build has no booking script.

Setting `booking` to `{ calendarId, busyCalendarIds, previewCalendarId }` adds:

- the lock (the Durable Object `BookingLock`, one per site);
- a cron every 15 minutes, which finishes or clears anything the webhook missed;
- the secret `GOOGLE_SERVICE_ACCOUNT_KEY`, which booking needs whatever the Sheet writer is;
- the thank-you page `/booking/thanks` and the booking script.

## 3. Setup for one site (Grant, in this order)

1. **The Google project and the service account.** In the Google Cloud Console, use the site's project or make one. Create a service account, then create a JSON key for it and download the key file. Set the key as a Worker secret, from the repo folder:

   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY < path/to/key.json
   ```

   For previews, run the preview form instead, with the same file: `npx wrangler preview base-config secret put GOOGLE_SERVICE_ACCOUNT_KEY < path/to/key.json`. Set both before you push the branch, because a preview copies the base secrets when it is created. Then delete the downloaded key file. Never commit it. See [SECRETS.md](SECRETS.md).

2. **Enable the calendar API.** In the same Google project, open the Library, find "Google Calendar API", and press Enable.

3. **Share the owner's booking calendar.** The owner opens Google Calendar, opens the booking calendar's settings and sharing, and shares it with the service account's email (the `client_email` value in the key file) with "Make changes to events". Each extra calendar that should block times is shared the same way but with "See only free/busy (hide details)".

4. **Find the calendar IDs.** In the calendar's settings, scroll to "Integrate calendar" and copy "Calendar ID". Keep the booking calendar's ID and each extra calendar's ID.

5. **Make a test calendar for previews.** Make a second calendar with a name such as "Bookings test". Share it with the service account with "Make changes to events" and copy its ID. Previews write only to this calendar, so no test booking touches the owner's real times.

6. **Set the calendars in `site.config.ts`.** Set `booking` to `{ calendarId, busyCalendarIds, previewCalendarId }`, using the IDs from steps 4 and 5 (`busyCalendarIds` is a list, empty if there are none). Check that `business.timeZone` is the business's own IANA zone, such as "America/Chicago", because every rule is local to it. Then run:

   ```bash
   npm run sync:config
   npx wrangler types worker/worker-configuration.d.ts
   ```

   Commit the result and open the pull request, as with payments. The same rule applies to `wrangler.jsonc` changes.

7. **Stripe, only if the site takes payment.** Payments must already be set up (PAYMENTS.md, steps 1 to 5). In the Stripe webhook endpoint for `https://<site domain>/api/payments/stripe`, add the event `checkout.session.expired` next to the two gift card events. Do the same on the test-mode endpoint for previews. A free-only site skips this step.

8. **Google Sheet sites only.** Add two tabs, `Bookings` and `Bookings preview`. Put this header row in row 1 of each tab, in this order:

   ```
   Booked (UTC) | Service | Sessions | Party size | Name | Email | Phone | Paid | Due later | Stripe reference | Catalog item | Came from | Campaign | Click ID | First seen (UTC) | Days to note | Status | Notes
   ```

   Then paste the new contents of `docs/apps-script/contact-sheet.gs` into the Apps Script editor in place of the old code, save, and deploy a new version of the same web app, so the address does not change. If a tab has a different name, set the Script Property `TAB_BOOKINGS` (the live tab) or `TAB_BOOKINGS_PREVIEW` (the preview tab) to that name, as [SECRETS.md](SECRETS.md) describes. Set them only when the tabs are named differently. Pipeline sites need nothing here: bookings post to the app the way forms do.

9. **The owner's settings.** The owner changes `src/content/booking.json` by chat (services, hours, deposits, policy). See docs/EDITING.md, "Booking". The chat change to turn taking on (`taking: true`) is refused until the calendar is connected (step 6). A service that takes money is refused until payments are set up.

## 4. A test booking on a preview

Use test mode only. The preview must be built from a branch with `booking` set, the test calendar ID set, and the test Stripe secrets in place (steps 1, 5 and 7).

1. Free service. Open the preview's booking page. Choose a free service, pick a time, and fill in the name and email. Press "Confirm booking".
   - Check: a booking event appears on the TEST calendar, not the owner's calendar.
   - Check: the email arrives at the site's own address, with the usual preview subject.
   - Check: the `Bookings preview` tab has one new row. (Skip if the site uses the Pipeline app.)
2. Paid service. Choose a service that takes payment and press "Pay ... now". On Stripe's page, use the test card `4242 4242 4242 4242`, any future expiry date, and any three-digit code.
   - Check: `/booking/thanks` says the booking is confirmed.
   - Check: the hold events on the TEST calendar become bookings.
   - Check: the visitor email arrives with a `.ics` file (a calendar file), and the owner email arrives.
   - Check: the `Bookings preview` row shows the amount paid, the amount due later and the Stripe reference.
3. Cancel. Start another paid booking. On Stripe's page, use the back link instead of paying. The hold should disappear from the TEST calendar. If it stays, check that the test-mode webhook points at the preview's address (PAYMENTS.md, "Testing the webhook on a preview"). The cron runs only on production, so a preview's hold leftover waits for Stripe's expired event.
4. Clean up. Delete the test events on the TEST calendar and the test rows on the `Bookings preview` tab. The owner's calendar and the `Bookings` tab should show no test activity.

## 5. How it behaves

- **Holds.** When a visitor starts paying, the site writes one hold per session. The Stripe page stays open for 30 minutes. A hold keeps its time while the page is open and for 60 minutes after. Then it is ignored. Only Stripe's "session expired" message deletes a hold, so a payment that finishes late still finds its time.
- **One winner.** Checking and writing run one at a time behind the lock, so exactly one visitor gets a time.
- **Times.** Every time is shown in the business's time zone, and the page names that zone.
- **Free bookings.** They use the same checks and the lock. They sit behind the Turnstile check (the form's spam check). The event is written at once, then the emails.
- **Something fails after payment.** The owner always hears about it:
  - If the time was taken in the meantime, the holds become bookings titled "CHECK", so the time stays blocked. The owner gets an alert with the full booking. The visitor is told the owner will contact them. Call the visitor, then fix the calendar.
  - If the calendar write fails, the owner gets an alert at once and the visitor is told they will be contacted. Stripe retries. If a retry works, the normal confirmation goes out with a note that the write was late.
  - The site never double-books silently, and never keeps a paid booking with no record.
- **Changes.** Moving or deleting an event in Google Calendar moves or frees the time. The site reads the calendar again on its next check.

## 6. Known limits to confirm on the first real site

- The Google scopes `calendar.events` and `calendar.freebusy` must work with a shared calendar. If Google asks for another scope for free/busy, the first test fails at "times". The fix is one string (`calendar`), listed under Needs Grant in docs/STATUS.md.
- A Durable Object class cannot be removed later without a delete migration, so turning booking off does not remove the lock.
- Free/busy changes can take up to 30 seconds to show on the page. Checkout always reads fresh.
- The cron runs only on the production Worker, not on previews.
- Google limits how far one free/busy request can reach, so the site asks in 60-day pieces. Confirm this on the first real site.
- Visitors cannot reschedule or cancel their own booking. The owner does it in Google Calendar and Stripe.
- There are no reminders.
- One booking at a time across all services. There is no staff or room choice.
