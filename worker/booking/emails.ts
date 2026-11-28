import { bookingEmails, type Facts } from "../../src/content/booking-emails.ts";
import { formatLocal, zoneName } from "../../src/booking/zone.ts";
import { autoReplyFirstName } from "../../src/lib/first-name.ts";
import type { OutgoingEmail } from "../email.ts";
import { toBase64 } from "../gift-cards/emails.ts";
import { formatMoney } from "../payments/money.ts";
import type { PaymentSession } from "../payments/types.ts";
import type { BookingDeps } from "./deps.ts";
import { bookingIcs } from "./ics.ts";
import { ledgerCells, ledgerRow, type LedgerStatus } from "./ledger.ts";
import type { Booking } from "./metadata.ts";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "../../src/payments/config.ts";

/**
 * The booking emails as Resend takes them. All plain text; the visitor's confirmation carries the calendar file. In a
 * preview every email goes to the site's own address and the subject says who it would have gone to. The wording is in
 * src/content/booking-emails.ts. Idempotency keys (`book-<payment>-<step>`) are chosen by fulfil.ts.
 */

const REPLY_HEADERS = { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" };

/** Where a message goes: the person in production, the site's own address otherwise (with the usual subject marker). */
function routed(deps: BookingDeps, siteEmail: string, person: string, subject: string): { to: string; subject: string } {
  return deps.mode === "production" ? { to: person, subject } : { to: siteEmail, subject: `[Preview → would go to ${person}] ${subject}` };
}

const fromPerson = (deps: BookingDeps, siteEmail: string) => `${deps.config.replyFromName} <${siteEmail}>`;
const fromSite = (deps: BookingDeps, siteEmail: string) => `${deps.config.fromName} <${siteEmail}>`;
const ownerSubject = (deps: BookingDeps, subject: string) => `${deps.mode === "production" ? "" : "[Preview] "}${subject}`;

export function facts(deps: BookingDeps, booking: Booking): Facts {
  const tz = deps.config.timeZone;
  const many = booking.starts.length > 1;
  return {
    business: deps.config.businessName,
    service: booking.serviceName,
    reference: booking.reference,
    party: booking.party,
    sessions: booking.starts.map((start, index) => `${many ? `Session ${index + 1} of ${booking.starts.length}: ` : "When: "}${formatLocal(start, tz)}`),
    zoneName: zoneName(tz, booking.starts[0] as number),
    paid: booking.dueNowMinor > 0 ? formatMoney(booking.dueNowMinor, booking.currency) : "",
    dueLater: booking.dueLaterMinor > 0 ? formatMoney(booking.dueLaterMinor, booking.currency) : "",
    item: booking.item?.name ?? null,
  };
}

const notes = (booking: Booking): string[] => booking.answers.map((answer) => `${answer.label}: ${answer.text}`);
const person = (booking: Booking) => ({ name: booking.name, email: booking.email, phone: booking.phone });

/** The calendar file for the visitor: one event per session. */
export function calendarFile(deps: BookingDeps, booking: Booking): { filename: string; content: string } {
  const text = bookingIcs({
    site: deps.config.workerName,
    host: deps.config.editor.host,
    reference: booking.reference,
    now: deps.now(),
    sessions: booking.starts.map((start, index) => ({
      start,
      end: booking.ends[index] as number,
      summary: `${booking.serviceName} with ${deps.config.businessName}${booking.starts.length > 1 ? ` (${index + 1} of ${booking.starts.length})` : ""}`,
      description: `Reference ${booking.reference}`,
    })),
  });
  return { filename: "booking.ics", content: toBase64(new TextEncoder().encode(text)) };
}

export function visitorEmail(deps: BookingDeps, siteEmail: string, booking: Booking): OutgoingEmail {
  const { subject, text } = bookingEmails.visitor({ ...facts(deps, booking), firstName: autoReplyFirstName(booking.name), changeWording: deps.settings.changeWording, policy: deps.settings.policy });
  return { from: fromPerson(deps, siteEmail), replyTo: siteEmail, headers: REPLY_HEADERS, ...routed(deps, siteEmail, booking.email, subject), text, attachments: [calendarFile(deps, booking)] };
}

export function waitingEmail(deps: BookingDeps, siteEmail: string, booking: Booking): OutgoingEmail {
  const { subject, text } = bookingEmails.waiting({ ...facts(deps, booking), firstName: autoReplyFirstName(booking.name), changeWording: deps.settings.changeWording });
  return { from: fromPerson(deps, siteEmail), replyTo: siteEmail, headers: REPLY_HEADERS, ...routed(deps, siteEmail, booking.email, subject), text };
}

function ledgerBlock(deps: BookingDeps, booking: Booking, reference: string, state: string | undefined, bookedAtIso: string, status: LedgerStatus): string[] {
  const where = deps.config.destination === "pipeline" ? "Pipeline app" : "Sheet";
  const known = state === "saved" || state === "skipped" ? state : "by-hand";
  return bookingEmails.ledgerLines(where, known, known === "by-hand" ? ledgerCells(ledgerRow(deps, booking, reference, bookedAtIso, status)) : []);
}

export function ownerEmail(
  deps: BookingDeps,
  siteEmail: string,
  booking: Booking,
  reference: string,
  bookedAtIso: string,
  state: { visitor: "sent" | "not-sent"; ledger: string | undefined; late: boolean; repairedByThanksPage: boolean },
): OutgoingEmail {
  const { subject, text } = bookingEmails.owner({
    ...facts(deps, booking),
    ...person(booking),
    notes: notes(booking),
    cameFrom: booking.cameFrom,
    payment: reference,
    visitorState: state.visitor,
    ledger: ledgerBlock(deps, booking, reference, state.ledger, bookedAtIso, "Booked"),
    late: state.late,
    repairedByThanksPage: state.repairedByThanksPage,
    mode: deps.mode === "production" ? null : deps.mode,
  });
  return { from: fromSite(deps, siteEmail), to: siteEmail, replyTo: booking.email, subject: ownerSubject(deps, subject), text };
}

export function alertEmail(deps: BookingDeps, siteEmail: string, booking: Booking, reference: string, bookedAtIso: string, why: "clash" | "failed", ledger: string | undefined): OutgoingEmail {
  const { subject, text } = bookingEmails.alert({
    ...facts(deps, booking),
    ...person(booking),
    notes: notes(booking),
    payment: reference,
    why,
    ledger: ledger === undefined ? [] : ledgerBlock(deps, booking, reference, ledger, bookedAtIso, "Needs attention"),
  });
  return { from: fromSite(deps, siteEmail), to: siteEmail, replyTo: booking.email, subject: ownerSubject(deps, subject), text };
}

/** What Stripe took, written plainly even when its currency is not one the site supports. */
function takenText(session: PaymentSession): string {
  if (session.amountTotal === null) return "an unknown amount";
  const currency = session.currency ?? "";
  return (PAYMENT_CURRENCIES as readonly string[]).includes(currency) ? formatMoney(session.amountTotal, currency as PaymentCurrency) : `${(session.amountTotal / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

export function mismatchEmail(deps: BookingDeps, siteEmail: string, booking: Booking, session: PaymentSession): OutgoingEmail {
  const { subject, text } = bookingEmails.mismatch({ amount: takenText(session), payment: session.payment?.id ?? session.id, expected: formatMoney(booking.dueNowMinor, booking.currency) });
  return { from: fromSite(deps, siteEmail), to: siteEmail, replyTo: siteEmail, subject: ownerSubject(deps, subject), text };
}
