import type { BookingSummary } from "../../src/booking/api.ts";
import { HOLD_GRACE_MINUTES, type Interval } from "../../src/booking/schema.ts";
import { addDays, daysBetween, formatLocalZoned, localParts, startOfLocalDay, zoneName } from "../../src/booking/zone.ts";
import { log } from "../env.ts";
import { formatMoney } from "../payments/money.ts";
import type { BookingDeps } from "./deps.ts";
import type { CalendarEvent, EventChanges, NewEvent } from "./calendar.ts";
import type { Outcome } from "../payments/types.ts";
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

/** A hold counts as busy until its checkout closes plus the grace; one whose expiry cannot be read is stale and ignored (design R10). */
export function holdIsLive(event: CalendarEvent, now: number): boolean {
  const raw = event.props["hl_expires"];
  const expires = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(expires) && now < expires * 1000 + HOLD_GRACE_MINUTES * MINUTE_MS;
}

/** The seam between a calendar set's read and what is kept: busy spans and the site's holds for one 14-day bucket. */
interface BucketData {
  busy: Interval[];
  holds: CalendarEvent[];
}

const BUCKET_DAYS = 14;
const BUCKET_ORIGIN = "1970-01-05";
const MAX_CACHED_BUCKETS = 64;
const memory = new Map<string, { at: number; data: BucketData }>();

/** For tests: forget the times route's 30-second memory. */
export function resetBusyCache(): void {
  memory.clear();
}

const edgeCache = (): Cache | null => (typeof caches === "undefined" ? null : caches.default);

/** A short stable tag for a calendar set, so the cache key never holds a calendar id. */
function setHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** The fixed 14-day piece of time a moment falls in: whole days since 1970-01-05 in the business's zone, floor-divided by 14. */
export function bucketOf(ms: number, tz: string): number {
  return Math.floor(daysBetween(BUCKET_ORIGIN, localParts(ms, tz).date) / BUCKET_DAYS);
}

function bucketRange(bucket: number, tz: string): { from: number; to: number } {
  return { from: startOfLocalDay(addDays(BUCKET_ORIGIN, bucket * BUCKET_DAYS), tz), to: startOfLocalDay(addDays(BUCKET_ORIGIN, (bucket + 1) * BUCKET_DAYS), tz) };
}

/** Free/busy over every busy calendar plus the site's holds on the write calendar, for one range. null when any calendar could not be read. */
async function readRange(deps: BookingDeps, from: number, to: number): Promise<BucketData | null> {
  const calendars = busyCalendarIds(deps);
  const writeCalendar = writeCalendarId(deps);
  const [busy, holds] = await Promise.all([deps.calendar.freeBusy(calendars, from, to), writeCalendar ? deps.calendar.listHolds(writeCalendar, from, to, deps.config.workerName) : Promise.resolve({ ok: true as const, value: [] as CalendarEvent[] })]);
  if (!busy.ok || !holds.ok) return null;
  return { busy: busy.value, holds: holds.value };
}

function remember(key: string, at: number, data: BucketData): void {
  memory.delete(key);
  memory.set(key, { at, data });
  while (memory.size > MAX_CACHED_BUCKETS) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

async function readBucket(deps: BookingDeps, bucket: number): Promise<BucketData | null> {
  const calendars = busyCalendarIds(deps);
  const tag = setHash(`${calendars.join("|")}#${writeCalendarId(deps) ?? ""}`);
  const key = `https://booking-cache.invalid/${deps.config.workerName}/${deps.mode}/${tag}/${bucket}`;
  const now = deps.now();
  const hit = memory.get(key);
  if (hit && now - hit.at < BUSY_CACHE_MS) return hit.data;
  const edge = edgeCache();
  if (edge) {
    try {
      const found = await edge.match(key);
      if (found) {
        const data = (await found.json()) as BucketData;
        remember(key, now, data);
        return data;
      }
    } catch {
      // The edge cache is only an optimisation; a read that fails is a miss.
    }
  }
  const range = bucketRange(bucket, deps.config.timeZone);
  const data = await readRange(deps, range.from, range.to);
  if (data === null) return null;
  remember(key, now, data);
  if (edge) {
    try {
      await edge.put(key, new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `max-age=${BUSY_CACHE_MS / 1000}` } }));
    } catch {
      // Not stored: the next read asks Google again.
    }
  }
  return data;
}

function combine(data: BucketData[], now: number, own?: ReadonlySet<string>): Interval[] {
  const live = data.flatMap((piece) => piece.holds.filter((event) => holdIsLive(event, now) && !own?.has(event.id)));
  const spans: Interval[] = [...data.flatMap((piece) => piece.busy), ...live.map((event) => ({ start: event.start, end: event.end }))];
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Busy time for the times route (design R8): read in fixed 14-day buckets, each kept 30 seconds (the Cloudflare edge cache,
 * with this isolate's memory in front), so any number of visitors paging through weeks makes a few Google calls. Holds are
 * read per bucket too. null when any calendar could not be read.
 */
export async function loadBusyBucketed(deps: BookingDeps, from: number, to: number): Promise<Interval[] | null> {
  const tz = deps.config.timeZone;
  const first = bucketOf(from, tz);
  const last = bucketOf(Math.max(from, to - 1), tz);
  const buckets: number[] = [];
  for (let bucket = first; bucket <= last; bucket++) buckets.push(bucket);
  const read = await Promise.all(buckets.map((bucket) => readBucket(deps, bucket)));
  const data: BucketData[] = [];
  for (const piece of read) {
    if (piece === null) return null;
    data.push(piece);
  }
  return combine(data, deps.now());
}

/**
 * Busy time between `from` and `to`, always read fresh from Google: free/busy over every busy calendar plus the live holds on
 * the write calendar (other people's unpaid checkouts). `own` leaves out the holds of a booking being confirmed. Checkout and
 * confirmation use this inside the lock. null when any calendar could not be read.
 */
export async function loadBusy(deps: BookingDeps, from: number, to: number, options: { own?: ReadonlySet<string> } = {}): Promise<Interval[] | null> {
  const data = await readRange(deps, from, to);
  return data === null ? null : combine([data], deps.now(), options.own);
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
  const [busy, claimed] = await Promise.all([loadBusy(deps, first - DAY_MS, last + DAY_MS), liveClaims(deps, claims)]);
  if (busy === null || claimed === null) return null;
  return [...busy, ...claimed];
}

export function sessionPrefix(booking: Booking, index: number): string {
  return booking.starts.length > 1 ? ` ${index + 1}/${booking.starts.length}` : "";
}

const moneyOrNone = (booking: Booking, minor: number): string => (minor > 0 ? formatMoney(minor, booking.currency) : "nothing");

/** Google shows an event's description as HTML, so anything a visitor typed is written with its markup characters escaped. */
export const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The calendar entry's description: everything the owner needs to know about the booking, and how to change it. */
export function bookingDescription(booking: Booking, index: number, timeZone: string): string {
  return [
    `Service: ${booking.serviceName}`,
    `Session ${index + 1} of ${booking.starts.length}: ${formatLocalZoned(booking.starts[index] as number, timeZone)}`,
    `Party: ${booking.party}`,
    `Name: ${escapeHtml(booking.name)}`,
    `Email: ${escapeHtml(booking.email)}`,
    ...(booking.phone ? [`Phone: ${escapeHtml(booking.phone)}`] : []),
    `Paid online: ${moneyOrNone(booking, booking.dueNowMinor)}`,
    `Due later: ${moneyOrNone(booking, booking.dueLaterMinor)}`,
    ...(booking.item ? [`Catalog item: ${escapeHtml(booking.item.name)}`] : []),
    ...booking.answers.map((answer) => `${escapeHtml(answer.label)}: ${escapeHtml(answer.text)}`),
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
    description: bookingDescription(booking, index, deps.config.timeZone),
    transparent: false,
    props: { ...baseProps({ deps, booking, sessionId: null, index }), hl_kind: "booking" },
  };
}

/** What turns a hold into the booking (opaque, with the details). `check` titles it for the owner to look at (a clash). */
export function bookingChanges(booking: Booking, index: number, check: boolean, timeZone: string): EventChanges {
  return {
    summary: check ? `CHECK: ${booking.serviceName}: ${booking.name}${sessionPrefix(booking, index)}` : bookingSummaryLine(booking, index),
    description: bookingDescription(booking, index, timeZone),
    transparent: false,
    // The marker goes in the same patch as the title, so a clash can never be forgotten by a run that stops halfway.
    props: { hl_kind: "booking", ...(check ? { hl_check: "1" } : {}) },
  };
}

/**
 * Writes an event. A 409 (the id exists) after a first attempt that landed but answered with an error is not a failure: the
 * event is read back and counts as written when it belongs to this booking (`hl_ref`) and carries every property just sent.
 */
export async function insertOrAdopt(deps: BookingDeps, calendarId: string, event: NewEvent): Promise<Outcome<CalendarEvent>> {
  const result = await deps.calendar.insertEvent(calendarId, event);
  if (result.ok || result.status !== 409) return result;
  const found = await deps.calendar.getEvent(calendarId, event.id);
  const existing = found.ok ? found.value : null;
  if (existing && existing.props["hl_ref"] === event.props["hl_ref"] && Object.entries(event.props).every(([key, value]) => existing.props[key] === value)) {
    log("event_insert_adopted");
    return { ok: true, value: existing };
  }
  return result;
}

/** Removes every event of a booking that was being written (an id that never landed counts as removed). True when all are gone. */
export async function removeEvents(deps: BookingDeps, calendarId: string, eventIds: string[]): Promise<boolean> {
  let all = true;
  for (const id of eventIds) {
    const removed = await deps.calendar.deleteEvent(calendarId, id);
    if (!removed.ok) all = false;
  }
  if (!all) log("booking_rollback_failed");
  return all;
}

/** True for an event of this booking that is already an opaque booking (a run that patched and then lost its mark). A hold, or an event still transparent, is not. */
export function isOurBooking(event: CalendarEvent, booking: Booking): boolean {
  return event.props["hl_kind"] === "booking" && event.props["hl_ref"] === booking.reference && !event.transparent;
}

/** True when an earlier run found a clash for this booking and wrote the marker (`hl_check`) with the CHECK title. */
export function isMarkedCheck(event: CalendarEvent, booking: Booking): boolean {
  return event.props["hl_check"] === "1" && event.props["hl_ref"] === booking.reference;
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
    sessions: booking.starts.map((start, index) => ({ start, end: booking.ends[index] as number, label: formatLocalZoned(start, tz) })),
    zoneName: zoneName(tz, booking.starts[0] as number),
    paidText: booking.dueNowMinor > 0 ? formatMoney(booking.dueNowMinor, booking.currency) : "",
    dueLaterText: booking.dueLaterMinor > 0 ? `${formatMoney(booking.dueLaterMinor, booking.currency)} due later` : "",
    item: booking.item?.name ?? null,
  };
}
