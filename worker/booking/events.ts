import type { BookingSummary } from "../../src/booking/api.ts";
import { HOLD_GRACE_MINUTES, type Interval } from "../../src/booking/schema.ts";
import { formatLocal, zoneName } from "../../src/booking/zone.ts";
import { log } from "../env.ts";
import { formatMoney } from "../payments/money.ts";
import type { BookingDeps } from "./deps.ts";
import type { CalendarEvent, EventChanges, NewEvent } from "./calendar.ts";
import type { Claim } from "./lock.ts";
import type { Booking } from "./metadata.ts";

/** The calendar side of booking: which calendars are read and written, busy time with live holds, and the events themselves (design R2, R8, R10, R19). */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const BUSY_CACHE_MS = 30_000;

/** Where holds and bookings are written: the real calendar, or in a preview the test calendar (null without one: nothing can be written). */
export function writeCalendarId(deps: BookingDeps): string | null {
  return deps.mode === "preview" ? deps.booking.previewCalendarId : deps.booking.calendarId;
}

/** Every calendar read for busy time. A preview also reads the test calendar, so a preview's own bookings show. */
export function busyCalendarIds(deps: BookingDeps): string[] {
  const ids = [deps.booking.calendarId, ...deps.booking.busyCalendarIds];
  if (deps.mode === "preview" && deps.booking.previewCalendarId) ids.push(deps.booking.previewCalendarId);
  return [...new Set(ids)];
}

/** A hold counts as busy until its checkout closes plus the grace; one without a readable expiry counts as live (the safe direction). */
export function holdIsLive(event: CalendarEvent, now: number): boolean {
  const expires = Number(event.props["hl_expires"]);
  return !Number.isFinite(expires) || now < expires * 1000 + HOLD_GRACE_MINUTES * MINUTE_MS;
}

const cache = new Map<string, { at: number; busy: Interval[] }>();

/** For tests: forget the times route's 30-second memory. */
export function resetBusyCache(): void {
  cache.clear();
}

/**
 * Busy time between `from` and `to`: free/busy over every busy calendar plus the live holds on the write calendar (other
 * people's unpaid checkouts). `own` leaves out the holds of a booking being confirmed. The times route reuses a result for
 * 30 seconds per calendar set and range (R8); `fresh` always asks Google. null when any calendar could not be read.
 */
export async function loadBusy(deps: BookingDeps, from: number, to: number, options: { fresh: boolean; own?: ReadonlySet<string> }): Promise<Interval[] | null> {
  const calendars = busyCalendarIds(deps);
  const writeCalendar = writeCalendarId(deps);
  const key = `${calendars.join("|")}#${writeCalendar ?? ""}#${from}#${to}`;
  const now = deps.now();
  if (!options.fresh && !options.own) {
    const hit = cache.get(key);
    if (hit && now - hit.at < BUSY_CACHE_MS) return hit.busy;
  }
  const [busy, holds] = await Promise.all([deps.calendar.freeBusy(calendars, from, to), writeCalendar ? deps.calendar.listHolds(writeCalendar, from, to, deps.config.workerName) : Promise.resolve({ ok: true as const, value: [] })]);
  if (!busy.ok || !holds.ok) return null;
  const live = holds.value.filter((event) => holdIsLive(event, now) && !options.own?.has(event.id));
  const combined: Interval[] = [...busy.value, ...live.map((event) => ({ start: event.start, end: event.end }))];
  if (!options.fresh && !options.own) {
    for (const [oldKey, entry] of cache) if (now - entry.at >= BUSY_CACHE_MS) cache.delete(oldKey);
    cache.set(key, { at: now, busy: combined });
  }
  return combined;
}

/**
 * The lock's recent claims that still matter: a claim stands for an event written in the last ten minutes, so it counts only
 * while that event still exists (read by id, which is up to date at once). A checkout abandoned and released leaves a
 * claim behind; without this the same visitor could not pick the same time again for ten minutes. `own` leaves out the
 * booking being confirmed. null when an event could not be read (the caller fails closed).
 */
export async function liveClaims(deps: BookingDeps, claims: Claim[], own: ReadonlySet<string> = new Set()): Promise<Interval[] | null> {
  const calendarId = writeCalendarId(deps);
  if (!calendarId) return [];
  const others = claims.filter((claim) => !own.has(claim.ref));
  const found = await Promise.all(others.map((claim) => deps.calendar.getEvent(calendarId, claim.ref)));
  const out: Interval[] = [];
  for (let i = 0; i < others.length; i++) {
    const result = found[i];
    if (!result || !result.ok) return null;
    const claim = others[i];
    if (result.value !== null && claim) out.push({ start: claim.start, end: claim.end });
  }
  return out;
}

/** Everything that blocks this booking's times, read fresh inside the lock: busy time, other people's live holds and the lock's recent claims (a new event may not show in free/busy yet). null when a calendar could not be read. */
export async function loadBusyForBooking(deps: BookingDeps, booking: Booking, claims: Claim[]): Promise<Interval[] | null> {
  const first = Math.min(...booking.starts);
  const last = Math.max(...booking.ends);
  const [busy, claimed] = await Promise.all([loadBusy(deps, first - DAY_MS, last + DAY_MS, { fresh: true }), liveClaims(deps, claims)]);
  if (busy === null || claimed === null) return null;
  return [...busy, ...claimed];
}

export function sessionPrefix(booking: Booking, index: number): string {
  return booking.starts.length > 1 ? ` ${index + 1}/${booking.starts.length}` : "";
}

const moneyOrNone = (booking: Booking, minor: number): string => (minor > 0 ? formatMoney(minor, booking.currency) : "nothing");

/** The calendar entry's description: everything the owner needs to know about the booking, and how to change it. */
export function bookingDescription(booking: Booking, index: number): string {
  return [
    `Service: ${booking.serviceName}`,
    `Session ${index + 1} of ${booking.starts.length}`,
    `Party: ${booking.party}`,
    `Name: ${booking.name}`,
    `Email: ${booking.email}`,
    ...(booking.phone ? [`Phone: ${booking.phone}`] : []),
    `Paid online: ${moneyOrNone(booking, booking.dueNowMinor)}`,
    `Due later: ${moneyOrNone(booking, booking.dueLaterMinor)}`,
    ...(booking.item ? [`Catalog item: ${booking.item.name}`] : []),
    ...booking.answers.map((answer) => `${answer.label}: ${answer.text}`),
    `Reference: ${booking.reference}`,
    "",
    "Booked through the website. Move or delete this event to change the booking; refunds are made in Stripe.",
  ].join("\n");
}

export function bookingSummaryLine(booking: Booking, index: number): string {
  return `${booking.serviceName}: ${booking.name} (party of ${booking.party})${sessionPrefix(booking, index)}`;
}

interface PropsInput {
  deps: BookingDeps;
  booking: Booking;
  sessionId: string | null;
  index: number;
}

/** The private properties every event of this site carries; free/busy ignores them, the Worker reads them back. */
function baseProps({ deps, booking, sessionId, index }: PropsInput): Record<string, string> {
  return { hl_site: deps.config.workerName, hl_mode: deps.mode, hl_ref: booking.reference, hl_index: String(index), ...(sessionId ? { hl_session: sessionId } : {}) };
}

/** A hold: transparent, so free/busy ignores it and the Worker reads live holds by their properties. */
export function holdEvent(deps: BookingDeps, booking: Booking, sessionId: string, expiresAtSeconds: number, index: number): NewEvent {
  const until = new Intl.DateTimeFormat("en-US", { timeZone: deps.config.timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(expiresAtSeconds * 1000);
  return {
    id: booking.eventIds[index] as string,
    start: booking.starts[index] as number,
    end: booking.ends[index] as number,
    timeZone: deps.config.timeZone,
    summary: `Hold: ${booking.serviceName} (unpaid, until ${until})`,
    description: `${booking.serviceName}${sessionPrefix(booking, index)}. Held while the visitor pays. Removed if they do not.`,
    transparent: true,
    props: { ...baseProps({ deps, booking, sessionId, index }), hl_kind: "hold", hl_expires: String(expiresAtSeconds) },
  };
}

/** A booking written at once (a free service): opaque, so it blocks the time. */
export function bookingEvent(deps: BookingDeps, booking: Booking, index: number): NewEvent {
  return {
    id: booking.eventIds[index] as string,
    start: booking.starts[index] as number,
    end: booking.ends[index] as number,
    timeZone: deps.config.timeZone,
    summary: bookingSummaryLine(booking, index),
    description: bookingDescription(booking, index),
    transparent: false,
    props: { ...baseProps({ deps, booking, sessionId: null, index }), hl_kind: "booking" },
  };
}

/** What turns a hold into the booking (opaque, with the details). `check` titles it for the owner to look at (a clash). */
export function bookingChanges(booking: Booking, index: number, check: boolean): EventChanges {
  return {
    summary: check ? `CHECK: ${booking.serviceName}: ${booking.name}${sessionPrefix(booking, index)}` : bookingSummaryLine(booking, index),
    description: bookingDescription(booking, index),
    transparent: false,
    props: { hl_kind: "booking" },
  };
}

/** True for an event this booking has already turned into a booking (a run that patched and then lost its mark). */
export function isOurBooking(event: CalendarEvent, booking: Booking): boolean {
  return event.props["hl_kind"] === "booking" && event.props["hl_ref"] === booking.reference;
}

/**
 * Removes the holds of one checkout: only events that still say they are a hold and name this payment session, so a
 * booking or anyone else's event is never touched. True when every one is gone or was never there.
 */
export async function deleteHolds(deps: BookingDeps, sessionId: string, eventIds: string[]): Promise<boolean> {
  const calendarId = writeCalendarId(deps);
  if (!calendarId) return true;
  let all = true;
  for (const id of eventIds) {
    const found = await deps.calendar.getEvent(calendarId, id);
    if (!found.ok) {
      all = false;
      continue;
    }
    if (found.value === null) continue;
    if (found.value.props["hl_kind"] !== "hold" || found.value.props["hl_session"] !== sessionId) continue;
    const removed = await deps.calendar.deleteEvent(calendarId, id);
    if (!removed.ok) all = false;
  }
  if (!all) log("hold_delete_failed");
  return all;
}

/** What the thank-you page and the visitor's email show. */
export function summaryOf(deps: BookingDeps, booking: Booking): BookingSummary {
  const tz = deps.config.timeZone;
  return {
    reference: booking.reference,
    service: booking.serviceName,
    party: booking.party,
    sessions: booking.starts.map((start, index) => ({ start, end: booking.ends[index] as number, label: formatLocal(start, tz) })),
    zoneName: zoneName(tz, booking.starts[0] as number),
    paidText: booking.dueNowMinor > 0 ? formatMoney(booking.dueNowMinor, booking.currency) : "",
    dueLaterText: booking.dueLaterMinor > 0 ? `${formatMoney(booking.dueLaterMinor, booking.currency)} due later` : "",
    item: booking.item?.name ?? null,
  };
}
