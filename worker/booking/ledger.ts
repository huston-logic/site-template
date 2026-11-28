import { formatLocal } from "../../src/booking/zone.ts";
import type { Delivery } from "../forms.ts";
import { formatMoney } from "../payments/money.ts";
import type { BookingDeps } from "./deps.ts";
import type { Booking } from "./metadata.ts";

/**
 * The ledger row of a booking (design R15): the owner's "Bookings" tab, or a Pipeline lead, chosen by `saveSubmission` from
 * `contact.destination`. The Stripe reference (column J, index 9) is unique in the tab: the Apps Script skips a reference
 * it already holds and the service-account writer reads the column first. A free booking has no payment, so the booking
 * reference sits there.
 */

export const LEDGER_HEADERS = [
  "Booked (UTC)",
  "Service",
  "Sessions",
  "Party size",
  "Name",
  "Email",
  "Phone",
  "Paid",
  "Due later",
  "Stripe reference",
  "Catalog item",
  "Came from",
  "Campaign",
  "Click ID",
  "First seen (UTC)",
  "Days to note",
  "Status",
  "Notes",
] as const;

const REFERENCE_COLUMN = 9;
const PIPELINE_MESSAGE_MAX = 5000;

export type LedgerStatus = "Booked" | "Needs attention";

export function ledgerRow(deps: BookingDeps, booking: Booking, reference: string, bookedAtIso: string, status: LedgerStatus): string[] {
  const tz = deps.config.timeZone;
  return [
    bookedAtIso,
    booking.serviceName,
    booking.starts.map((start) => formatLocal(start, tz)).join("\n"),
    String(booking.party),
    booking.name,
    booking.email,
    booking.phone,
    formatMoney(booking.dueNowMinor, booking.currency),
    formatMoney(booking.dueLaterMinor, booking.currency),
    reference,
    booking.item?.name ?? "",
    ...booking.cells,
    status,
    booking.answers.map((answer) => `${answer.label}: ${answer.text}`).join("\n"),
  ];
}

/** The row cell by cell, for the owner's email when it could not be saved. Empty cells are left out. */
export function ledgerCells(row: string[]): { label: string; value: string }[] {
  return row.flatMap((value, index) => (value === "" ? [] : [{ label: LEDGER_HEADERS[index] ?? `Column ${index + 1}`, value }]));
}

function delivery(deps: BookingDeps, booking: Booking, reference: string, bookedAtIso: string, status: LedgerStatus): Delivery {
  const tz = deps.config.timeZone;
  const message = [
    "Booking",
    `Reference: ${booking.reference}`,
    `Service: ${booking.serviceName}`,
    ...booking.starts.map((start, index) => `Session ${index + 1} of ${booking.starts.length}: ${formatLocal(start, tz)}`),
    `Party: ${booking.party}`,
    ...(booking.phone ? [`Phone: ${booking.phone}`] : []),
    `Paid: ${formatMoney(booking.dueNowMinor, booking.currency)}`,
    `Due later: ${formatMoney(booking.dueLaterMinor, booking.currency)}`,
    ...(booking.item ? [`Catalog item: ${booking.item.name}`] : []),
    ...booking.answers.map((answer) => `${answer.label}: ${answer.text}`),
    `Status: ${status}`,
    ...(reference !== booking.reference ? [`Stripe payment: ${reference}`] : []),
  ].join("\n");
  const { sheetTabs } = deps.config;
  return {
    tabs: { production: sheetTabs.bookings, preview: sheetTabs.bookingsPreview },
    row: ledgerRow(deps, booking, reference, bookedAtIso, status),
    lead: { name: booking.name || booking.email, email: booking.email, message: message.slice(0, PIPELINE_MESSAGE_MAX), ...booking.lead },
    uniqueCell: REFERENCE_COLUMN,
  };
}

/** "saved", "skipped" (a preview never posts to the real app) or "by-hand" (the owner adds the row; the mark stops a retry adding it twice). */
export async function saveLedger(deps: BookingDeps, booking: Booking, reference: string, bookedAtIso: string, status: LedgerStatus): Promise<"saved" | "by-hand" | "skipped"> {
  const saved = await deps.save(deps.mode, delivery(deps, booking, reference, bookedAtIso, status));
  return saved === "saved" ? "saved" : saved === "skipped" ? "skipped" : "by-hand";
}
