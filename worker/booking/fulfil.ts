import type { Interval } from "../../src/booking/schema.ts";
import { sendEmail } from "../email.ts";
import { log } from "../env.ts";
import { readMarks, writeMark, type MarkKey } from "../payments/marks.ts";
import type { PaymentProvider, PaymentSession } from "../payments/types.ts";
import type { CalendarEvent } from "./calendar.ts";
import type { BookingDeps } from "./deps.ts";
import { alertEmail, mismatchEmail, ownerEmail, visitorEmail, waitingEmail } from "./emails.ts";
import { bookingChanges, isOurBooking, liveClaims, loadBusy, writeCalendarId } from "./events.ts";
import { saveLedger } from "./ledger.ts";
import { hasTimeLeft, type Claim } from "./lock.ts";
import { parseBooking, type Booking } from "./metadata.ts";

/**
 * What a paid booking sets in motion (design R11, R12). Safe to run any number of times for one payment, from the webhook,
 * the thank-you page's repair or the cron: every step that succeeds writes a mark into the payment's metadata and a later run
 * skips it, and every email has a Resend idempotency key (`book-<payment>-<step>`).
 *
 * Order: calendar (inside the lock), ledger, then
 * - booked: the visitor's confirmation with the calendar file, then the owner's note;
 * - a clash (a hold is gone, or another event now covers the time): the surviving holds become "CHECK" bookings, the owner
 *   gets an alert with the whole booking and the visitor is told I will contact them. No confirmation, no ordinary note;
 * - the calendar could not be reached: the same alert and "I will contact you" email go at once and the run answers "not
 *   done", so Stripe retries. A later success sends the real confirmation and the owner's note says it was written late.
 * A mark that cannot be written after its step succeeded is NOT a failure (logged): a retry after Resend's 24-hour
 * idempotency window would send everything twice.
 */

export type JudgedBooking =
  | { kind: "paid"; booking: Booking }
  | { kind: "not_paid"; pending: boolean }
  | { kind: "ignore" }
  | { kind: "mismatch"; booking: Booking };

/** Decides whether a session is a paid booking of this site and mode, by its own metadata. The amount and currency must match what the Worker sent. */
export function judgeBooking(deps: Pick<BookingDeps, "payments" | "mode" | "config">, session: PaymentSession): JudgedBooking {
  if (session.metadata["site"] !== deps.config.workerName) return { kind: "ignore" };
  const booking = parseBooking(session.metadata);
  if (!booking || booking.siteMode !== deps.mode) return { kind: "ignore" };
  if (session.paymentStatus !== "paid") return { kind: "not_paid", pending: session.status === "complete" };
  if (session.amountTotal !== booking.dueNowMinor || session.currency !== booking.currency || booking.currency !== deps.payments?.currency || session.payment === null || booking.dueNowMinor <= 0) return { kind: "mismatch", booking };
  return { kind: "paid", booking };
}

export interface FulfilResult {
  /** True when every step that should have run is done (marked now or before). False asks the caller to answer 500 so Stripe retries. */
  done: boolean;
  /** What the calendar holds: "waiting" when the write has not succeeded yet. */
  calendar: "booked" | "clash" | "waiting";
  /** True when the visitor has had the email that fits (confirmation, or "I will contact you"). */
  emailed: boolean;
}

const idempotency = (paymentId: string, step: string) => `book-${paymentId}-${step}`;
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const DAY_MS = 86_400_000;

/** Whether any session now collides with another event. null when the busy time could not be read. */
async function sessionsClash(deps: BookingDeps, booking: Booking, claims: Claim[]): Promise<boolean | null> {
  const own = new Set(booking.eventIds);
  const first = Math.min(...booking.starts);
  const last = Math.max(...booking.ends);
  const busy = await loadBusy(deps, first - DAY_MS, last + DAY_MS, { fresh: true, own });
  if (busy === null) return null;
  const claimed = await liveClaims(deps, claims, own);
  if (claimed === null) return null;
  const others: Interval[] = [...busy, ...claimed];
  return booking.starts.some((start, index) => others.some((other) => overlaps({ start, end: booking.ends[index] as number }, other)));
}

/**
 * Inside the lock: turns the holds into bookings, or into "CHECK" bookings when a hold is gone or the time is no longer free.
 * "failed" means a calendar call failed or the lock could not be had: nothing is marked and a later run tries again.
 */
async function settleCalendar(deps: BookingDeps, booking: Booking): Promise<"booked" | "clash" | "failed"> {
  const calendarId = writeCalendarId(deps);
  if (!calendarId || !deps.lock) {
    log("calendar_unavailable", { reason: !calendarId ? "no_calendar" : "no_lock" });
    return "failed";
  }
  const lease = await deps.lock.acquire();
  if (!lease) return "failed";
  let claims: Claim[] = [];
  try {
    const events: (CalendarEvent | null)[] = [];
    for (const id of booking.eventIds) {
      const found = await deps.calendar.getEvent(calendarId, id);
      if (!found.ok) return "failed";
      events.push(found.value);
    }
    // A run that patched and then lost its mark finds its own bookings: they were checked before they were written, so no check now.
    const alreadyBooked = events.some((event) => event !== null && isOurBooking(event, booking));
    let clash = events.some((event) => event === null);
    if (!clash && !alreadyBooked) {
      const found = await sessionsClash(deps, booking, lease.claims);
      if (found === null) return "failed";
      clash = found;
    }
    if (!hasTimeLeft(lease, deps.now())) return "failed";
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (!event || isOurBooking(event, booking)) continue;
      const patched = await deps.calendar.patchEvent(calendarId, booking.eventIds[index] as string, bookingChanges(booking, index, clash));
      if (!patched.ok) return "failed";
    }
    claims = booking.starts.map((start, index) => ({ start, end: booking.ends[index] as number, ref: booking.eventIds[index] as string }));
    return clash ? "clash" : "booked";
  } finally {
    await deps.lock.release(lease.token, claims);
  }
}

export async function fulfil(deps: BookingDeps, provider: PaymentProvider, session: PaymentSession, booking: Booking, options: { webhookMissing: boolean }): Promise<FulfilResult> {
  const payment = session.payment;
  const siteEmail = deps.config.siteEmail;
  if (!payment || !siteEmail || !deps.env.RESEND_API_KEY) {
    log("fulfil_config_incomplete");
    return { done: false, calendar: "waiting", emailed: false };
  }
  const { env } = deps;
  const marks = readMarks(session);
  const bookedAtIso = new Date((payment.paidAt ?? session.created) * 1000).toISOString();
  let stepFailed = false;
  let marksFailed = false;

  const mark = async (key: MarkKey, value: string): Promise<void> => {
    if (await writeMark(provider, payment.id, key, value)) marks[key] = value;
    else {
      marksFailed = true;
      log("mark_failed", { step: key });
    }
  };

  // 1. The calendar.
  const earlierAlert = marks.hl_alert !== undefined || marks.hl_wait !== undefined;
  let calendar: "booked" | "clash" | null = marks.hl_calendar === "booked" || marks.hl_calendar === "clash" ? marks.hl_calendar : null;
  if (calendar === null) {
    const settled = await settleCalendar(deps, booking);
    if (settled !== "failed") {
      calendar = settled;
      await mark("hl_calendar", settled);
    }
  }

  // 2. The ledger row, once the calendar's answer is final, so its status never has to change.
  let ledger = marks.hl_ledger;
  if (calendar !== null && ledger === undefined) {
    ledger = await saveLedger(deps, booking, payment.id, bookedAtIso, calendar === "booked" ? "Booked" : "Needs attention");
    await mark("hl_ledger", ledger);
  }

  // 3. Not booked: the owner's alert (the whole booking) and the visitor's "I will contact you", each once.
  if (calendar !== "booked") {
    const why = calendar === "clash" ? "clash" : "failed";
    if (marks.hl_alert === undefined) {
      if (await sendEmail(env.RESEND_API_KEY, alertEmail(deps, siteEmail, booking, payment.id, bookedAtIso, why, ledger), idempotency(payment.id, "alert"), "booking_alert")) await mark("hl_alert", "sent");
      else stepFailed = true;
    }
    if (marks.hl_wait === undefined) {
      if (await sendEmail(env.RESEND_API_KEY, waitingEmail(deps, siteEmail, booking), idempotency(payment.id, "wait"), "booking_wait")) await mark("hl_wait", "sent");
      else stepFailed = true;
    }
    // For a clash the alert is the owner's note, so the ordinary one is marked done without being sent.
    if (calendar === "clash" && marks.hl_alert !== undefined && marks.hl_owner === undefined) await mark("hl_owner", "alert");
    if (marksFailed && !stepFailed) log("payment_marks_failed");
    return { done: calendar === "clash" && !stepFailed, calendar: calendar ?? "waiting", emailed: marks.hl_wait !== undefined };
  }

  // 4. Booked: the visitor's confirmation with the calendar file.
  let visitorSent = marks.hl_buyer !== undefined;
  if (!visitorSent) {
    if (await sendEmail(env.RESEND_API_KEY, visitorEmail(deps, siteEmail, booking), idempotency(payment.id, "buyer"), "booking_visitor")) {
      visitorSent = true;
      await mark("hl_buyer", "sent");
    } else stepFailed = true;
  }

  // 5. The owner's note, once.
  if (marks.hl_owner === undefined) {
    const email = ownerEmail(deps, siteEmail, booking, payment.id, bookedAtIso, { visitor: visitorSent ? "sent" : "not-sent", ledger, late: earlierAlert, repairedByThanksPage: options.webhookMissing });
    if (await sendEmail(env.RESEND_API_KEY, email, idempotency(payment.id, "owner"), "booking_owner")) await mark("hl_owner", "sent");
    else stepFailed = true;
  }

  if (marksFailed && !stepFailed) log("payment_marks_failed");
  return { done: !stepFailed, calendar: "booked", emailed: visitorSent };
}

/**
 * A free booking, after its events are written (checkout.ts): the ledger row, the owner's note and the visitor's
 * confirmation, with keys from the booking reference. True when the owner has it somewhere (the note or the ledger, R13);
 * the visitor's email failing is logged and does not fail the booking.
 */
export async function finishFree(deps: BookingDeps, siteEmail: string, booking: Booking): Promise<boolean> {
  const { env } = deps;
  const bookedAtIso = new Date(deps.now()).toISOString();
  const ledger = await saveLedger(deps, booking, booking.reference, bookedAtIso, "Booked");
  const visitorSent = await sendEmail(env.RESEND_API_KEY, visitorEmail(deps, siteEmail, booking), idempotency(booking.reference, "buyer"), "booking_visitor");
  if (!visitorSent) log("booking_visitor_email_failed");
  const ownerSent = await sendEmail(
    env.RESEND_API_KEY,
    ownerEmail(deps, siteEmail, booking, booking.reference, bookedAtIso, { visitor: visitorSent ? "sent" : "not-sent", ledger, late: false, repairedByThanksPage: false }),
    idempotency(booking.reference, "owner"),
    "booking_owner",
  );
  return ownerSent || ledger === "saved";
}

/**
 * A paid session of this site that does not match its booking: money was taken and no time is confirmed, so the owner is told
 * once (the mark `hl_mismatch`, and the same Resend idempotency key). True when the owner has been told, now or before.
 */
export async function alertMismatch(deps: BookingDeps, provider: PaymentProvider, session: PaymentSession, booking: Booking): Promise<boolean> {
  const siteEmail = deps.config.siteEmail;
  if (!siteEmail || !deps.env.RESEND_API_KEY) {
    log("fulfil_config_incomplete");
    return false;
  }
  const payment = session.payment;
  if (payment && readMarks(session).hl_mismatch !== undefined) return true;
  const sent = await sendEmail(deps.env.RESEND_API_KEY, mismatchEmail(deps, siteEmail, booking, session), idempotency(payment?.id ?? session.id, "mismatch"), "booking_mismatch");
  if (sent && payment && !(await writeMark(provider, payment.id, "hl_mismatch", "sent"))) log("mark_failed", { step: "hl_mismatch" });
  return sent;
}
