// The change list's section for the booking settings, in the owner's words. Built from the real before and after values
// (never from the operations): services are matched by id, so adding, changing or archiving one reads as that.
import { WEEKDAYS } from "../../src/booking/schema.ts";
import { quote } from "./change-list.ts";
import { isObject } from "./json.ts";
import { deepEqual } from "./operations.ts";

export const BOOKING_ON_LINE = "Visitors can book on the live site when this is published.";
export const BOOKING_OFF_LINE = "Booking stops on the live site when this is published. Bookings already made stay on your calendar.";

const DAY_NAMES: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const record = (value: unknown): Record<string, unknown> => (isObject(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const windowsText = (value: unknown): string => {
  const windows = list(value).map((window) => (Array.isArray(window) ? `${String(window[0])} to ${String(window[1])}` : String(window)));
  return windows.length === 0 ? "closed" : windows.join(" and ");
};

const startsText = (value: unknown): string => {
  const starts = record(value);
  if (typeof starts.every === "number") return `every ${starts.every} minutes from opening`;
  if (Array.isArray(starts.at)) return `at ${starts.at.map(String).join(", ")}`;
  return quote(value);
};

const noticeText = (hours: unknown): string => {
  const n = Number(hours);
  return Number.isInteger(n) && n >= 48 && n % 24 === 0 ? `${plural(n, "hour", "hours")} (${n / 24} days)` : plural(n, "hour", "hours");
};

const closedText = (range: unknown): string => {
  const { from, to } = record(range);
  return from === to ? String(from) : `${String(from)} to ${String(to)}`;
};

/** Lines for what changed between two sets of hours (a site's, or a service's own). A key missing from `now` is not part of the change. */
function hoursLines(old: Record<string, unknown>, now: Record<string, unknown>, indent: string, own: boolean, fresh = false): string[] {
  const out: string[] = [];
  const oldWeekly = record(old.weekly);
  const weekly = record(now.weekly);
  /** "Label: was → now"; a new service's own hours have no "was". */
  const line = (label: string, was: string | null, is: string): string => `${indent}${label}: ${fresh ? "" : `${was ?? "the site's"} → `}${is}`;
  if ("weekly" in now) {
    for (const day of WEEKDAYS) {
      if (!deepEqual(oldWeekly[day], weekly[day])) out.push(line(DAY_NAMES[day], "weekly" in old ? windowsText(oldWeekly[day]) : "the site's hours", windowsText(weekly[day])));
    }
  }
  if ("starts" in now && !deepEqual(old.starts, now.starts)) out.push(line("Start times", "starts" in old ? startsText(old.starts) : null, startsText(now.starts)));
  if ("bufferMinutes" in now && old.bufferMinutes !== now.bufferMinutes) out.push(line("Gap kept around a booking", "bufferMinutes" in old ? `${String(old.bufferMinutes)} minutes` : null, `${String(now.bufferMinutes)} minutes`));
  if ("noticeHours" in now && old.noticeHours !== now.noticeHours) out.push(line("Notice needed before the first session", "noticeHours" in old ? noticeText(old.noticeHours) : null, noticeText(now.noticeHours)));
  if ("aheadDays" in now && old.aheadDays !== now.aheadDays) out.push(line("How far ahead people can book", "aheadDays" in old ? `${String(old.aheadDays)} days` : null, `${String(now.aheadDays)} days`));
  if ("closed" in now) {
    const was = list(old.closed);
    const is = list(now.closed);
    for (const range of is) if (!was.some((candidate) => deepEqual(candidate, range))) out.push(`${indent}${own ? "Also closed" : "Closed"}: ${closedText(range)}`);
    for (const range of was) if (!is.some((candidate) => deepEqual(candidate, range))) out.push(`${indent}Open again: ${closedText(range)}`);
  }
  return out;
}

const sessionsText = (value: unknown): string => {
  const sessions = list(value).map((session) => Number(record(session).minutes));
  if (sessions.length === 1) return `one session of ${sessions[0]} minutes`;
  return `${plural(sessions.length, "session", "sessions")} of ${sessions.join(", ")} minutes`;
};

const betweenText = (value: unknown): string => {
  if (!isObject(value)) return "(none)";
  return `each session ${String(value.minDays)} to ${String(value.maxDays)} days after the one before`;
};

const partyText = (value: unknown): string => {
  const { min, max } = record(value);
  return min === max ? plural(Number(min), "person", "people") : `${String(min)} to ${String(max)} people`;
};

const priceText = (value: unknown, symbol: string): string => {
  if (!isObject(value)) return "no price shown";
  return `${symbol}${String(value.amount)}${value.per === "person" ? " per person" : " per booking"}`;
};

const paymentText = (value: unknown, symbol: string): string => {
  const payment = record(value);
  if (payment.kind === "full") return "pays in full online";
  if (payment.kind === "deposit") return typeof payment.percent === "number" ? `pays a ${payment.percent} percent deposit online, the rest later` : `pays a ${symbol}${String(payment.amount)} deposit online, the rest later`;
  return "nothing paid online (any price is paid on the day)";
};

function describeService(service: Record<string, unknown>, symbol: string): string[] {
  const lines = [
    `Status: ${service.status === "archived" ? "archived" : "live"}`,
    `Sessions: ${sessionsText(service.sessions)}`,
    ...(list(service.sessions).length > 1 ? [`Between sessions: ${betweenText(service.between)}`] : []),
    `Party: ${partyText(service.party)}`,
    `Price: ${priceText(service.price, symbol)}`,
    `Payment: ${paymentText(service.payment, symbol)}`,
    `Description: ${quote(service.description)}`,
  ];
  if (isObject(service.hours)) lines.push("Its own hours:", ...hoursLines({}, service.hours, "  ", true, true));
  return lines;
}

function serviceLines(old: Record<string, unknown> | undefined, now: Record<string, unknown> | undefined, id: string, symbol: string): string[] {
  if (now === undefined) return old === undefined ? [] : [`  Service ${quote(old.name)} (${id}) was removed from the file; services are archived, never deleted.`];
  if (old === undefined) return [`  New service ${quote(now.name)} (${id}):`, ...describeService(now, symbol).map((line) => `    ${line}`)];
  const lines: string[] = [];
  if (old.name !== now.name) lines.push(`Name: ${quote(old.name)} → ${quote(now.name)}`);
  if (old.description !== now.description) lines.push(`Description: ${quote(old.description)} → ${quote(now.description)}`);
  if (old.status !== now.status) {
    lines.push(
      now.status === "archived"
        ? "Status: archive. It leaves the site and nobody can book it. Nothing is deleted; it can be brought back. Bookings already made stay on your calendar."
        : "Status: restore. It comes back on the live site and visitors can book it.",
    );
  }
  if (!deepEqual(old.sessions, now.sessions)) lines.push(`Sessions: ${sessionsText(old.sessions)} → ${sessionsText(now.sessions)}`);
  if (!deepEqual(old.between, now.between)) lines.push(`Between sessions: ${betweenText(old.between)} → ${betweenText(now.between)}`);
  if (!deepEqual(old.party, now.party)) lines.push(`Party: ${partyText(old.party)} → ${partyText(now.party)}`);
  if (!deepEqual(old.price, now.price)) lines.push(`Price: ${priceText(old.price, symbol)} → ${priceText(now.price, symbol)}`);
  if (!deepEqual(old.payment, now.payment)) lines.push(`Payment: ${paymentText(old.payment, symbol)} → ${paymentText(now.payment, symbol)}`);
  if (!deepEqual(old.hours, now.hours)) {
    lines.push("Its own hours:", ...(isObject(now.hours) ? hoursLines(record(old.hours), now.hours, "  ", true) : ["  now follow the site's hours"]));
  }
  return lines.length === 0 ? [] : [`  Service ${quote(now.name)} (${id}):`, ...lines.map((line) => `    ${line}`)];
}

/** "Booking settings:" and what changed in them. */
export function bookingSection(old: Record<string, unknown>, now: Record<string, unknown>, symbol: string = "$"): string {
  const lines = ["Booking settings:"];
  if (old.taking !== now.taking) lines.push(`  Taking bookings: ${old.taking === true ? "yes" : "no"} → ${now.taking === true ? "yes" : "no"}`);
  for (const [key, label] of [["policy", "Policy"], ["changeWording", "How to change or cancel"], ["giftCardLine", "Gift card line"]] as const) {
    if (old[key] !== now[key]) lines.push(`  ${label}: ${quote(old[key])} → ${quote(now[key])}`);
  }
  const hours = hoursLines(record(old.hours), record(now.hours), "    ", false);
  if (hours.length > 0) lines.push("  Opening hours:", ...hours);
  const was = new Map(list(old.services).filter(isObject).map((service) => [String(service.id), service]));
  const is = new Map(list(now.services).filter(isObject).map((service) => [String(service.id), service]));
  for (const id of new Set([...was.keys(), ...is.keys()])) lines.push(...serviceLines(was.get(id), is.get(id), id, symbol));
  if (old.taking !== true && now.taking === true) lines.push(`  ${BOOKING_ON_LINE}`);
  if (old.taking === true && now.taking !== true) lines.push(`  ${BOOKING_OFF_LINE}`);
  return lines.join("\n");
}
