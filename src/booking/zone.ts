// Time-zone arithmetic for booking, on Intl alone (no library). Every rule is local to the business's IANA zone; a session's
// length is real elapsed time. Import-free apart from the schema's types and weekday list.
import { WEEKDAYS } from "./schema.ts";
import type { ClockTime, LocalDate, Weekday } from "./schema.ts";

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string") return false;
  const match = DATE_RE.exec(s);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function isClockTime(s: unknown): s is ClockTime {
  return typeof s === "string" && TIME_RE.test(s);
}

/** Minutes since midnight of an "HH:MM" time. */
export function clockMinutes(time: ClockTime): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function clockFromMinutes(minutes: number): ClockTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function dateToUtcDay(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return new Date(dateToUtcDay(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** b minus a, in calendar days. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((dateToUtcDay(b) - dateToUtcDay(a)) / DAY_MS);
}

export function weekdayOf(date: LocalDate): Weekday {
  const sundayFirst = new Date(dateToUtcDay(date)).getUTCDay();
  return WEEKDAYS[(sundayFirst + 6) % 7] as Weekday;
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallParts(ms: number, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let formatter = wallFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    wallFormatters.set(tz, formatter);
  }
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof typeof out] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetAt(ms: number, tz: string): number {
  const w = wallParts(ms, tz);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a local wall-clock time happens, in Unix ms. null when the time does not exist (the spring-forward gap); the
 * first instant when it happens twice (fall back).
 */
export function zonedToUtc(date: LocalDate, time: ClockTime, tz: string): number | null {
  if (!isLocalDate(date) || !isClockTime(time)) return null;
  const wall = dateToUtcDay(date) + clockMinutes(time) * 60_000;
  // The offset a day either side of the wall time brackets any single transition, so one of the two candidates is right.
  const candidates = new Set([wall - offsetAt(wall - DAY_MS, tz), wall - offsetAt(wall + DAY_MS, tz)]);
  const valid = [...candidates].filter((instant) => offsetAt(instant, tz) === wall - instant);
  return valid.length === 0 ? null : Math.min(...valid);
}

export function localParts(ms: number, tz: string): { date: LocalDate; time: ClockTime; weekday: Weekday } {
  const w = wallParts(ms, tz);
  const date = `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  return { date, time: `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`, weekday: weekdayOf(date) };
}

/** Local midnight, or the first instant of the day where a zone skips midnight. */
export function startOfLocalDay(date: LocalDate, tz: string): number {
  for (let minutes = 0; minutes < 24 * 60; minutes += 5) {
    const instant = zonedToUtc(date, clockFromMinutes(minutes), tz);
    if (instant !== null) return instant;
  }
  return dateToUtcDay(date);
}

/** "Central Standard Time" at that instant. */
export function zoneName(tz: string, ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date(ms));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? tz;
}

function longParts(ms: number, tz: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(ms));
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** "9:00 AM", written with plain spaces whatever the runtime's ICU version. */
export function formatTime(ms: number, tz: string): string {
  const p = longParts(ms, tz);
  return `${p["hour"]}:${p["minute"]} ${(p["dayPeriod"] ?? "").toUpperCase()}`;
}

/** "Tuesday, December 1, 2026, 9:00 AM". */
export function formatLocal(ms: number, tz: string): string {
  const p = longParts(ms, tz);
  return `${p["weekday"]}, ${p["month"]} ${p["day"]}, ${p["year"]}, ${formatTime(ms, tz)}`;
}

/** "Tuesday, December 1, 2026, 9:00 AM (Central Standard Time)": a session's time with its own zone name, because the name changes on the day the clocks do. */
export function formatLocalZoned(ms: number, tz: string): string {
  return `${formatLocal(ms, tz)} (${zoneName(tz, ms)})`;
}
