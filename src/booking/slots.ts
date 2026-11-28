// Which times can be booked (design R4, R6 to R8). Every rule is local to the business's zone; a session is real elapsed time.
import { effectiveHours, isClosed } from "./hours.ts";
import type { BookingSettings, Hours, Interval, LocalDate, Service } from "./schema.ts";
import { addDays, clockFromMinutes, clockMinutes, daysBetween, localParts, weekdayOf, zonedToUtc } from "./zone.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The instant a window closes. A close time inside a spring-forward gap means the first real time after it. */
function closeInstant(date: LocalDate, close: string, tz: string): number | null {
  for (let minutes = clockMinutes(close); minutes < 24 * 60; minutes += 5) {
    const instant = zonedToUtc(date, clockFromMinutes(minutes), tz);
    if (instant !== null) return instant;
  }
  return null;
}

/** Every start inside the day's windows whose session ends by the window's close, ascending. */
export function startsOn(date: LocalDate, hours: Hours, minutes: number, tz: string): number[] {
  if (isClosed(date, hours)) return [];
  const found = new Set<number>();
  for (const [open, close] of hours.weekly[weekdayOf(date)] ?? []) {
    const closeMs = closeInstant(date, close, tz);
    if (closeMs === null) continue;
    const from = clockMinutes(open);
    const to = clockMinutes(close);
    const candidates: number[] = [];
    if ("every" in hours.starts) {
      for (let at = from; at < to; at += hours.starts.every) candidates.push(at);
    } else {
      for (const time of hours.starts.at) {
        const at = clockMinutes(time);
        if (at >= from && at < to) candidates.push(at);
      }
    }
    for (const at of candidates) {
      const start = zonedToUtc(date, clockFromMinutes(at), tz);
      if (start !== null && start + minutes * MINUTE_MS <= closeMs) found.add(start);
    }
  }
  return [...found].sort((a, b) => a - b);
}

export function sessionIntervals(service: Service, starts: number[]): Interval[] {
  return starts.map((start, index) => ({ start, end: start + (service.sessions[index]?.minutes ?? 0) * MINUTE_MS }));
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** The session with the buffer on both sides clashes with a busy interval. */
function touchesBusy(start: number, minutes: number, bufferMinutes: number, busy: Interval[]): boolean {
  const padded = { start: start - bufferMinutes * MINUTE_MS, end: start + (minutes + bufferMinutes) * MINUTE_MS };
  return busy.some((other) => overlaps(padded, other));
}

/** The session (buffered) overlaps an earlier chosen session, or starts before the one chosen just ahead of it. */
function breaksOrder(start: number, minutes: number, bufferMinutes: number, earlier: Interval[]): boolean {
  const last = earlier[earlier.length - 1];
  if (last && start < last.end) return true;
  return touchesBusy(start, minutes, bufferMinutes, earlier);
}

export interface OpenDaysInput {
  settings: BookingSettings;
  service: Service;
  /** Which session of the service is being chosen, from 0. */
  index: number;
  /** The starts already chosen for sessions 0 to index - 1. */
  chosen: number[];
  busy: Interval[];
  now: number;
  from: LocalDate;
  days: number;
  tz: string;
}

/** One entry per date that may be offered for this session (its starts may be empty); dates outside the allowed window are left out. */
export function openDays(input: OpenDaysInput): { date: LocalDate; starts: number[] }[] {
  const { settings, service, index, chosen, busy, now, from, days, tz } = input;
  const session = service.sessions[index];
  if (!session || days < 1) return [];
  const hours = effectiveHours(settings.hours, service);
  const today = localParts(now, tz).date;
  let first: LocalDate;
  let last: LocalDate;
  if (index === 0) {
    first = from > today ? from : today;
    const horizon = addDays(today, hours.aheadDays);
    const end = addDays(first, days - 1);
    last = end < horizon ? end : horizon;
  } else {
    const previous = chosen[index - 1];
    const between = service.between;
    if (previous === undefined || !between) return [];
    const previousDate = localParts(previous, tz).date;
    const earliest = addDays(previousDate, between.minDays);
    const latest = addDays(previousDate, between.maxDays);
    const end = addDays(from, days - 1);
    first = from > earliest ? from : earliest;
    last = end < latest ? end : latest;
  }
  const earlier = sessionIntervals(service, chosen.slice(0, index));
  const result: { date: LocalDate; starts: number[] }[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const starts = startsOn(date, hours, session.minutes, tz).filter((start) => {
      if (index === 0 && start < now + hours.noticeHours * HOUR_MS) return false;
      if (breaksOrder(start, session.minutes, hours.bufferMinutes, earlier)) return false;
      return !touchesBusy(start, session.minutes, hours.bufferMinutes, busy);
    });
    result.push({ date, starts });
  }
  return result;
}

export type SelectionProblem = "service" | "party" | "count" | "notice" | "ahead" | "hours" | "closed" | "rule" | "busy";

/** Judges a whole choice, session by session, and names the first thing wrong. The Worker runs this again at checkout. */
export function checkSelection(
  settings: BookingSettings,
  service: Service,
  party: number,
  starts: number[],
  busy: Interval[],
  now: number,
  tz: string,
): { ok: true } | { ok: false; reason: SelectionProblem; index: number } {
  const fail = (reason: SelectionProblem, index = 0) => ({ ok: false as const, reason, index });
  if (service.status !== "live") return fail("service");
  if (!Number.isInteger(party) || party < service.party.min || party > service.party.max) return fail("party");
  if (starts.length !== service.sessions.length || !starts.every((start) => Number.isSafeInteger(start))) return fail("count");
  const hours = effectiveHours(settings.hours, service);
  const today = localParts(now, tz).date;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index] as number;
    const minutes = service.sessions[index]?.minutes ?? 0;
    const date = localParts(start, tz).date;
    if (index === 0) {
      if (start < now + hours.noticeHours * HOUR_MS) return fail("notice", index);
      if (date > addDays(today, hours.aheadDays)) return fail("ahead", index);
    }
    if (isClosed(date, hours)) return fail("closed", index);
    if (!startsOn(date, hours, minutes, tz).includes(start)) return fail("hours", index);
    if (index > 0) {
      const between = service.between;
      const gap = daysBetween(localParts(starts[index - 1] as number, tz).date, date);
      if (!between || gap < between.minDays || gap > between.maxDays) return fail("rule", index);
      if (breaksOrder(start, minutes, hours.bufferMinutes, sessionIntervals(service, starts.slice(0, index)))) return fail("rule", index);
    }
    if (touchesBusy(start, minutes, hours.bufferMinutes, busy)) return fail("busy", index);
  }
  return { ok: true };
}
