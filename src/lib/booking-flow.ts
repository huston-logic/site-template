// The pure helpers the booking flow draws from: how a service reads on its card, money with cents, the rule between sessions
// in words, the week strip's days and what the flow keeps across a trip to Stripe. No React and no Next, so node:test loads it.
import type { BookedSession, BookingSummary, ConfirmAnswer } from "../booking/api.ts";
import { bookingPrice } from "../booking/price.ts";
import type { LocalDate, Service } from "../booking/schema.ts";
import { addDays } from "../booking/zone.ts";
import { bookingWords as words } from "../content/booking.ts";

/** "$150", or "$112.50" when there are cents. */
export function moneyText(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(minor / 100);
}

/** "3 hours", "90 minutes", "1 hour 30 minutes". */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return words.length.minutes(rest);
  return rest === 0 ? words.length.hours(hours) : words.length.hoursAndMinutes(hours, rest);
}

/** "Two sessions of 3 hours, 2 to 10 days apart", or just "1 hour". Sessions of different lengths are listed. */
export function lengthText(service: Service): string {
  const { sessions, between } = service;
  const first = sessions[0];
  if (first === undefined) return "";
  if (sessions.length === 1 || between === null) return durationText(first.minutes);
  const gap = words.length.days(between.minDays, between.maxDays);
  if (sessions.every((session) => session.minutes === first.minutes)) return words.length.several(sessions.length, durationText(first.minutes), gap);
  return `${sessions.length} sessions (${sessions.map((session) => durationText(session.minutes)).join(", ")}), ${gap} apart`;
}

/** The two parts of a card's price line: the price, and what is taken online. Either may be empty. */
export function priceParts(service: Service, currency: string): { price: string; terms: string } {
  const { price, payment } = service;
  if (price === null) return { price: words.free, terms: "" };
  const amount = moneyText(price.amount * 100, currency);
  const base = price.per === "person" ? words.price.perPerson(amount) : words.price.perBooking(amount);
  if (payment.kind === "free") return { price: `${base}${words.price.paidOnTheDay}`, terms: "" };
  if (payment.kind === "full") return { price: base, terms: "" };
  const deposit = "percent" in payment ? words.price.percent(payment.percent) : moneyText(payment.amount * 100, currency);
  return { price: base, terms: words.price.deposit(deposit) };
}

/** Where a later session may fall, in words. */
export function ruleText(service: Service): string {
  const between = service.between;
  if (between === null) return "";
  if (between.minDays === between.maxDays) return words.rule.exact(between.minDays);
  if (between.minDays === 0) return words.rule.sameDayOrLater(between.maxDays);
  return words.rule.range(between.minDays, between.maxDays);
}

/** Amounts for the summary, in minor units, for a service and party. Null for a service with no price. */
export function amountsFor(service: Service, party: number) {
  return bookingPrice(service, party);
}

/** The seven days a week strip shows, from its first. */
export function weekDays(first: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** "Tuesday, December 1", from a local date. */
export function dayName(date: LocalDate): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

/** The parts a day tile draws: "Tue", "1", "Dec". */
export function dayTile(date: LocalDate): { weekday: string; day: string; month: string } {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(at);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/** What the flow keeps in sessionStorage while the visitor is on Stripe's page. Never a token or a price. */
export type Resume = {
  service: string;
  party: number;
  starts: number[];
  answers: Record<string, string | boolean>;
  sessionId: string | null;
  /** Proves to the release route that this browser started the checkout. */
  releaseToken: string | null;
  item: string | null;
};

export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export function saveResume(storage: StorageLike | null, key: string, resume: Resume): void {
  try {
    storage?.setItem(key, JSON.stringify(resume));
  } catch {
    // Without storage the choices are simply not kept.
  }
}

export function loadResume(storage: StorageLike | null, key: string): Resume | null {
  try {
    const raw = storage?.getItem(key);
    if (typeof raw !== "string") return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const record = data as Record<string, unknown>;
    const starts = record["starts"];
    const answers = record["answers"];
    if (typeof record["service"] !== "string" || typeof record["party"] !== "number" || !Array.isArray(starts) || !starts.every((start) => typeof start === "number")) return null;
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return null;
    const kept: Record<string, string | boolean> = {};
    for (const [name, value] of Object.entries(answers)) if (typeof value === "string" || typeof value === "boolean") kept[name] = value;
    return {
      service: record["service"],
      party: record["party"],
      starts: starts as number[],
      answers: kept,
      sessionId: typeof record["sessionId"] === "string" ? record["sessionId"] : null,
      releaseToken: typeof record["releaseToken"] === "string" ? record["releaseToken"] : null,
      item: typeof record["item"] === "string" ? record["item"] : null,
    };
  } catch {
    return null;
  }
}

export function clearResume(storage: StorageLike | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

// ---- the thank-you page ----

export const BOOKING_SESSION_KEY = "hl-booking-session";

export function rememberBookingSession(storage: StorageLike | null, id: string): void {
  try {
    storage?.setItem(BOOKING_SESSION_KEY, id);
  } catch {
    // The page then asks once, from the address it was given.
  }
}

export function recalledBookingSession(storage: StorageLike | null): string | null {
  try {
    const id = storage?.getItem(BOOKING_SESSION_KEY);
    return typeof id === "string" && /^[A-Za-z0-9_]{1,200}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const shortText = (value: unknown, max = 300): string | null => (typeof value === "string" && value.length <= max ? value : null);

/** A booking summary as the page may show it, or null when it is not one. Every text is capped. */
export function readSummary(body: unknown): BookingSummary | null {
  if (!isRecord(body) || !Array.isArray(body["sessions"]) || body["sessions"].length > 12) return null;
  const reference = shortText(body["reference"], 100);
  const service = shortText(body["service"]);
  const zoneName = shortText(body["zoneName"]);
  const paidText = shortText(body["paidText"], 40);
  const dueLaterText = shortText(body["dueLaterText"], 80);
  const party = body["party"];
  if (reference === null || service === null || zoneName === null || paidText === null || dueLaterText === null || typeof party !== "number") return null;
  const sessions: BookedSession[] = [];
  for (const entry of body["sessions"]) {
    if (!isRecord(entry)) return null;
    const label = shortText(entry["label"]);
    if (label === null || typeof entry["start"] !== "number" || typeof entry["end"] !== "number") return null;
    sessions.push({ start: entry["start"], end: entry["end"], label });
  }
  const item = body["item"];
  return { reference, service, party, sessions, zoneName, paidText, dueLaterText, item: typeof item === "string" ? item.slice(0, 300) : null };
}

/** The confirm route's answer as the page may use it, or null when it is not one. A "paid" answer must carry its summary and figures. */
export function readConfirm(body: unknown): ConfirmAnswer | null {
  if (!isRecord(body)) return null;
  const status = body["status"];
  if (status === "pending" || status === "unpaid" || status === "error") return { status };
  if (status !== "paid") return null;
  const booked = body["booked"];
  const summary = readSummary(body["summary"]);
  const { value, currency, transactionId } = body;
  if ((booked !== "booked" && booked !== "clash" && booked !== "waiting") || summary === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency) || typeof transactionId !== "string" || transactionId === "" || transactionId.length > 200) return null;
  return { status: "paid", booked, summary, value, currency: currency.toUpperCase(), transactionId, emailed: body["emailed"] === true };
}
