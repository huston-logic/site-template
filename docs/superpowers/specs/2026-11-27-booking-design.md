# Booking: design

Date: 2026-11-27. Status: approved direction (Grant's brief for this run); the rulings below are Claude's, each with its
cost if wrong. Plan beside it in `docs/superpowers/plans/2026-11-27-booking.md`. Booking is the second product on the
payments base (`docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md`).

## Goal

A visitor books a time and, where the owner asks for it, pays, with no phone call. The owner's own Google Calendar is the
one record of what is booked: the site reads it for busy times and writes bookings to it. It fits a business that books
single appointments and one whose service takes several sessions on different days. No database.

Not in this run: classes with seats, visitor rescheduling or cancelling, automatic refunds, reminders, staff or several
resources, redeeming gift cards online, a settings screen on the owner page, calendars other than Google.

## Shape

```
browser (booking block)                 Worker                                          Google / Stripe
  GET /api/booking/times?...        ->  rules - busy (free/busy, all calendars) - live holds
  POST /api/booking/checkout        ->  lock; re-check every session; paid: Stripe session, then one hold per
                                        session on the calendar; free: the bookings at once, emails, ledger
  <- { url } (begin_checkout)  or  { ok, reference } (lead) -> /booking/thanks
                                        POST /api/payments/stripe  <- completed | expired (signed)
                                        completed: lock; holds -> bookings; visitor email + .ics; ledger; owner email
                                        expired: holds removed;  cron every 15 minutes: the same, for anything missed
  /booking/thanks?session_id=       ->  GET /api/booking/confirm (repairs a missing webhook, like gift cards)
```

Code layout: `src/booking/` holds the import-free rules (settings, time zones, open times, prices) shared by the content
check, the editor, the block and the Worker. `worker/booking/` is the product (calendar client, lock, routes, confirmation,
emails, calendar file, ledger, cleanup). `worker/google-auth.ts` is the service-account sign-in, now shared by the Sheet
writer and the calendar.

## Rulings

**R1. Off means nothing ships.** `booking` in `site.config.ts` is `null` (template default) or
`{ calendarId, busyCalendarIds }` (owner-only). With `null`: every `/api/booking/*` route is a 404; `wrangler.jsonc` has no
lock binding, no cron and no extra secret; `/booking/thanks` is removed by `finish-build.mjs`; a live page holding a
`booking` block fails the content check; and a production build has no booking script (the block's flow is a slot that
`next.config.ts` points at the real component only when booking is on or the build is not production, the gift card
pattern). Catalog piece pages show "Book a time" only while booking is on. Cost if wrong: as gift cards R1 (Tailwind
still scans the block's source, so the shared stylesheet grows).

**R2. The calendar connection.** The owner shares their calendar with the site's Google service account ("Make changes
to events") and any extra calendars ("See only free/busy"). The Worker signs in with the existing service-account code
(moved to `worker/google-auth.ts`, the Sheet writer unchanged) and the scopes `calendar.events` and `calendar.freebusy`.
`GOOGLE_SERVICE_ACCOUNT_KEY` is required while `booking` is set, whatever the Sheet writer. Cost if wrong: if Google wants
another scope for free/busy on a shared calendar, the first real site's test booking fails at "times"; the fix is one
string (`calendar` instead), listed in Needs Grant.

**R3. Services and rules: one settings file, `src/content/booking.json`.** `{ taking, policy, changeWording, giftCardLine,
hours, services }` (types and limits in `src/booking/schema.ts`). The owner changes it by chat (`propose_change` with
`{ settings: "booking" }`). A service: id, name, description, status (`live` or `archived`; never deleted), 1 to 6
sessions of 15 to 720 minutes, `between` (fewest and most local days between neighbours; 0 allows the same day),
party 1 to 50, price per person or per booking (or none), payment `full`, `deposit` (whole amount or 1 to 99 percent)
or `free`, and optional own hours. `taking: true` is refused while `booking` is null; a service that takes money is
refused while `payments` is null (the messages are in `schema.ts`). Cost if wrong: none for safety; a missing knob is a
schema change.

**R4. One rule between sessions.** The same `between` holds for every pair of neighbouring sessions; the brief names one
rule. Notice and "how far ahead" apply to the first session; later sessions may run past the horizon by up to the rule's
most days. Cost if wrong: a service needing different gaps per pair would need `between` as a list, a small change.

**R5. "Free" means nothing taken online.** `payment: free` with a price shows the whole price as due later (paid on the
day) and skips Stripe; with `price: null` the service costs nothing. A deposit never exceeds the price; a percent deposit
rounds to the cent. Cost if wrong: Grant meant "free" only as "costs nothing"; then a priced free service is refused, one
check.

**R6. Hours.** Site-wide weekly windows, start times (every N minutes from each window's opening, or a fixed list),
buffer, notice in hours ("14 days' notice" is 336), how far ahead in days, closed date ranges. A service's own `hours`
replace those keys, except `closed`, which adds. A session must fit inside one window. The buffer of the service being
booked is kept before and after every busy time. Cost if wrong: owners who want the buffer only after a booking get a
slightly emptier day.

**R7. Time zones.** Every rule is local to `business.timeZone`; the Worker converts with `Intl` (no library). A start
time that does not exist (the spring-forward gap) is not offered; one that happens twice (fall back) is offered once, at
the first. A session's length is real elapsed time. Times are shown in the business's zone, named on the page, because
the visitor comes to the business. Cost if wrong: an online-only business may want the visitor's own zone; a display
change in the block.

**R8. Open times.** Rules minus busy (Google free/busy over the booking calendar and every extra calendar) minus live holds
minus the lock's recent claims. One booking per time across all services. Free/busy is read in 60-day pieces; if any
calendar answers with an error the route fails closed ("times could not be loaded"), never offering a time it could not
check. `GET /api/booking/times` answers at most 14 days per call and keeps free/busy for 30 seconds per Worker isolate; it
is not rate limited (a visitor browsing weeks would hit the forms' 5-a-minute limit). Checkout always reads fresh.
Cost if wrong: a busy-calendar change can take up to 30 seconds to show on the page; checkout still refuses it.

**R9. Exactly one winner: a lock with no storage.** A Durable Object (`BookingLock`, one per site) is a mutex with a
60-second lease and an in-memory list of the last 10 minutes of claimed times. Checkout, free bookings and confirmation run
their check-and-write inside it, and the claims cover Google's short delay before a new event shows in free/busy. It
stores nothing (no SQL, no KV); the calendar stays the one record. A caller that has used 20 seconds of its lease gives up
before writing. Without the binding the routes fail closed (502). Cost if wrong: if Grant meant no new Cloudflare
binding at all, the fallback is a calendar-only claim (fixed event ids per start time), which only catches two visitors on
the same start time; about half a day.

**R10. Holds.** Paid checkout, inside the lock: re-check every session, create the Stripe session first (30 minutes,
cards only, so a payment can only complete before it closes; the metadata names the hold event ids), then write one
hold per session (event ids chosen by the Worker, `transparency: transparent`, so free/busy ignores them and live holds
are read separately by their private properties). If a hold cannot be written, the written ones are removed and the
session is expired before the visitor sees it. A hold counts as busy until its checkout closes plus 60 minutes, then it
is stale and ignored; it is only ever deleted after Stripe says its session expired, so a completed payment always finds
its hold. Removal: the `checkout.session.expired` webhook; the block's "back" from Stripe (it sends the session id it was
given; an open session is expired and its holds removed); and a cron every 15 minutes that also repairs a paid session
the webhook missed. Cost if wrong: if Stripe ever completes a card payment after `expires_at`, the hold is still there for
60 minutes and confirmation's clash check catches anything later.

**R11. Confirmation, exactly once, with the base's marks.** Order: calendar (inside the lock, re-checked: holds become
opaque bookings with the service, name, party, phone, paid, due, notes and catalog item), visitor email (every session,
the change wording, a `.ics` file), ledger row, owner email. Marks on the PaymentIntent: `hl_calendar` (`booked` or
`clash`), `hl_buyer`, `hl_wait`, `hl_ledger`, `hl_owner`, `hl_alert`; Resend idempotency keys `book-<payment>-<step>`.
Cost if wrong: as gift cards R6.

**R12. Failure after payment.** A hold that is gone, or a time another event now covers: `hl_calendar=clash`, the
holds still there become bookings titled "CHECK" (so the time stays blocked), the owner gets an alert with the full
booking, the visitor is told the owner will contact them. A calendar call that fails: the owner alert and the visitor's
"you will be contacted" email go at once, the webhook answers 500 so Stripe retries; a later success sends the real
confirmation and a normal owner email noting the late write. Never a silent double booking; never a paid booking with no
record (the alert holds the whole booking). Cost if wrong: in that rare case the visitor gets two emails.

**R13. Free bookings.** Same checks, same lock, behind the Turnstile check (action `booking`); the events are written as
bookings at once, then owner email, visitor email and ledger, with keys from a booking reference. Success needs the
calendar write plus the owner email or the ledger. Cost if wrong: if the request dies after the calendar write, the time
is booked and the owner may have only the calendar entry.

**R14. The details form.** `src/content/forms/booking.json`, bound in code to the id `booking` like the quote form:
shown only by the booking block, refused by the `form` block and by `/api/forms/booking`. It must keep a name field and
an email field; the first phone field is the phone; every other answer is the notes. Its text limits add up to at most
2,000 characters (they ride in the payment's metadata). Cost if wrong: a longer form needs chunked metadata, small.

**R15. Ledger.** Tabs "Bookings" and "Bookings preview" (`contact.sheetTabs.bookings`, `bookingsPreview`). Columns:
Booked (UTC), Service, Sessions (each session's local time, one cell), Party size, Name, Email, Phone, Paid, Due later,
Stripe reference (the PaymentIntent, or the booking reference for a free one), Catalog item, the five source cells,
Status, Notes. Both writers; a reference already in the tab is not added twice. Pipeline sites post the booking as forms
do. Cost if wrong: owners who want a column per session add them by hand.

**R16. The block.** `booking`: service cards, party size, then each session's day strip and times (later sessions only
on days the rule allows), the details form, a summary with the price, what is due now and later, the policy and (gift
cards on sale) the gift card line, then "Pay ... now" or "Confirm booking". One per page; `?service=` preselects and
`?item=` carries a catalog piece (shown in emails and the ledger; the price stays the service's). Without JavaScript the
block lists the services with a way to get in touch. Block gate, rule 16. Copy is template wording in
`src/content/booking.ts` (listed for Grant).

**R17. Tracking.** `begin_checkout` (what is due now) before leaving for Stripe and `purchase` once on the thank-you page
for paid bookings; `lead` with form id `booking` for free ones. Nothing personal in any event.

**R18. Changes after booking are the owner's.** Moving or deleting the calendar event moves or frees the time (free/busy
reads it); refunds happen in Stripe. Emails carry `changeWording`. Cost if wrong: none.

**R19. Previews never touch the real calendar's times.** `booking.previewCalendarId` is a test calendar shared with the
service account. A branch preview reads busy time from the real calendars and the test one, and writes holds and bookings
only to the test one (emails to the site's address, the "Bookings preview" tab, Stripe test mode, as gift cards). With
it null a preview shows times but refuses to book (502, `preview_calendar_missing`). Development (`wrangler dev`) calls
no outside service: times come from the rules alone and a booking is a logged dry run. `BOOKING_FIXTURE=1` gives a local
test build a fake calendar setting so the thank-you page and the flow build; a Workers Builds build with it set fails.
Cost if wrong: none for the live calendar; Grant sets up one test calendar per site to walk a preview.
