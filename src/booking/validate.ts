// The content check for src/content/booking.json, in the owner's words. Import-free apart from sibling shared modules.
import { textProblem } from "../blocks/validate.ts";
import { SLUG_RE } from "../collections/schema.ts";
import {
  AHEAD_DAYS,
  BETWEEN_DAYS_MAX,
  BOOKING_PATH,
  BUFFER_MAX,
  CALENDAR_OFF_MESSAGE,
  CHANGE_WORDING_MAX,
  GIFT_CARD_LINE_MAX,
  HOURS_KEYS,
  MAX_CLOSED,
  MAX_SERVICES,
  MAX_SESSIONS,
  MAX_START_TIMES,
  MAX_WINDOWS_PER_DAY,
  NOTICE_HOURS_MAX,
  PAID_NEEDS_PAYMENTS_MESSAGE,
  PARTY_MAX,
  PERCENT,
  POLICY_MAX,
  PRICE_MAX,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_KEYS,
  SERVICE_NAME_MAX,
  SESSION_MINUTES,
  SETTINGS_KEYS,
  STARTS_EVERY,
  WEEKDAYS,
} from "./schema.ts";
import type { BookingSettings, Service } from "./schema.ts";
import { clockMinutes, isClockTime, isLocalDate } from "./zone.ts";

const where = BOOKING_PATH;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const onGrid = (time: string) => clockMinutes(time) % 5 === 0;

function checkKeys(data: Record<string, unknown>, allowed: readonly string[], here: string, out: string[]): void {
  for (const key of Object.keys(data)) if (!allowed.includes(key)) out.push(`${where}: ${here}: "${key}" is not a booking setting here. It accepts: ${allowed.join(", ")}.`);
}

function checkText(value: unknown, max: number, what: string, out: string[]): void {
  if (typeof value !== "string") return void out.push(`${where}: ${what} must be text.`);
  if (value.trim().length === 0) return void out.push(`${where}: ${what} is empty; it needs some text.`);
  if (value.length > max) return void out.push(`${where}: ${what} is ${value.length} characters; it takes at most ${max}.`);
  const bad = textProblem(value);
  if (bad) out.push(`${where}: ${what} ${bad}.`);
}

function checkWindows(value: unknown, label: string, out: string[]): void {
  if (!isRecord(value)) return void out.push(`${where}: ${label}: "weekly" must list the opening times for each day: ${WEEKDAYS.join(", ")}.`);
  for (const key of Object.keys(value)) if (!(WEEKDAYS as readonly string[]).includes(key)) out.push(`${where}: ${label}: "${key}" is not a day. The days are ${WEEKDAYS.join(", ")}.`);
  for (const day of WEEKDAYS) {
    const here = `${label}: ${day}`;
    const windows = value[day];
    if (windows === undefined) {
      out.push(`${where}: ${here} is missing; give it a list of opening times, or [] for closed.`);
      continue;
    }
    if (!Array.isArray(windows)) {
      out.push(`${where}: ${here} must be a list of opening times like ["09:00", "17:00"], or [] for closed.`);
      continue;
    }
    if (windows.length > MAX_WINDOWS_PER_DAY) out.push(`${where}: ${here} has ${windows.length} opening times; a day takes at most ${MAX_WINDOWS_PER_DAY}.`);
    let previousClose = -1;
    windows.forEach((window, index) => {
      const at = `${here}, opening time ${index + 1}`;
      if (!Array.isArray(window) || window.length !== 2 || !isClockTime(window[0]) || !isClockTime(window[1])) {
        return void out.push(`${where}: ${at} must be an opening and a closing time like ["09:00", "17:00"] (24-hour).`);
      }
      const [open, close] = window as [string, string];
      if (!onGrid(open) || !onGrid(close)) return void out.push(`${where}: ${at} (${open} to ${close}) must use times on a 5-minute step, like 09:00 or 09:05.`);
      if (clockMinutes(open) >= clockMinutes(close)) return void out.push(`${where}: ${at} opens at ${open} but closes at ${close}; it must close after it opens.`);
      if (clockMinutes(open) < previousClose) out.push(`${where}: ${at} (${open} to ${close}) overlaps or comes before the one above it; list a day's opening times in order, without overlap.`);
      previousClose = clockMinutes(close);
    });
  }
}

function checkStarts(value: unknown, label: string, out: string[]): void {
  if (!isRecord(value)) return void out.push(`${where}: ${label}: "starts" must be {"every": minutes} or {"at": ["09:00", ...]}.`);
  const keys = Object.keys(value);
  if (keys.length !== 1 || (keys[0] !== "every" && keys[0] !== "at")) return void out.push(`${where}: ${label}: "starts" must be exactly one of {"every": minutes} or {"at": ["09:00", ...]}.`);
  if (keys[0] === "every") {
    const every = value["every"];
    if (!isWhole(every, STARTS_EVERY.min, STARTS_EVERY.max) || every % 5 !== 0) out.push(`${where}: ${label}: a new start every N minutes must be a whole number of minutes on a 5-minute step, from ${STARTS_EVERY.min} to ${STARTS_EVERY.max}.`);
    return;
  }
  const times = value["at"];
  if (!Array.isArray(times) || times.length < 1 || times.length > MAX_START_TIMES) return void out.push(`${where}: ${label}: "at" must list 1 to ${MAX_START_TIMES} start times like "09:00".`);
  let previous = -1;
  for (const time of times) {
    if (!isClockTime(time) || !onGrid(time)) return void out.push(`${where}: ${label}: the start time ${JSON.stringify(time)} must be a time like "09:00" on a 5-minute step.`);
    if (clockMinutes(time) <= previous) return void out.push(`${where}: ${label}: list the start times in order, each once.`);
    previous = clockMinutes(time);
  }
}

function checkClosed(value: unknown, label: string, out: string[]): void {
  if (!Array.isArray(value)) return void out.push(`${where}: ${label}: "closed" must be a list of closed dates, each {"from": "2026-12-24", "to": "2027-01-02"}, or [].`);
  if (value.length > MAX_CLOSED) out.push(`${where}: ${label}: ${value.length} closed stretches; at most ${MAX_CLOSED}.`);
  value.forEach((range, index) => {
    const at = `${label}: closed stretch ${index + 1}`;
    if (!isRecord(range)) return void out.push(`${where}: ${at} must be {"from": "2026-12-24", "to": "2027-01-02"}.`);
    checkKeys(range, ["from", "to"], at, out);
    if (!isLocalDate(range["from"]) || !isLocalDate(range["to"])) return void out.push(`${where}: ${at} needs real dates written like 2026-12-24 for "from" and "to".`);
    if (range["from"] > range["to"]) out.push(`${where}: ${at} runs from ${range["from"]} to ${range["to"]}; the first date must not be after the second.`);
  });
}

function checkHours(value: Record<string, unknown>, label: string, whole: boolean, out: string[]): void {
  checkKeys(value, HOURS_KEYS, label, out);
  if (whole) for (const key of HOURS_KEYS) if (!(key in value)) out.push(`${where}: ${label}: "${key}" is missing.`);
  if ("weekly" in value) checkWindows(value["weekly"], label, out);
  if ("starts" in value) checkStarts(value["starts"], label, out);
  if ("bufferMinutes" in value && !isWhole(value["bufferMinutes"], 0, BUFFER_MAX)) out.push(`${where}: ${label}: "bufferMinutes" must be a whole number of minutes from 0 to ${BUFFER_MAX}.`);
  if ("noticeHours" in value && !isWhole(value["noticeHours"], 0, NOTICE_HOURS_MAX)) out.push(`${where}: ${label}: "noticeHours" must be a whole number of hours from 0 to ${NOTICE_HOURS_MAX} (14 days is 336).`);
  if ("aheadDays" in value && !isWhole(value["aheadDays"], AHEAD_DAYS.min, AHEAD_DAYS.max)) out.push(`${where}: ${label}: "aheadDays" must be a whole number of days from ${AHEAD_DAYS.min} to ${AHEAD_DAYS.max}.`);
  if ("closed" in value) checkClosed(value["closed"], label, out);
}

function checkService(service: unknown, index: number, seen: Set<string>, out: string[]): void {
  const fallback = `service ${index + 1}`;
  if (!isRecord(service)) return void out.push(`${where}: ${fallback} must have ${SERVICE_KEYS.filter((key) => key !== "hours").join(", ")} (and, if it has its own hours, "hours").`);
  const id = service["id"];
  const label = typeof id === "string" && id !== "" ? `service "${id}"` : fallback;
  checkKeys(service, SERVICE_KEYS, label, out);
  for (const key of SERVICE_KEYS) if (key !== "hours" && !(key in service)) out.push(`${where}: ${label}: "${key}" is missing.`);

  if ("id" in service) {
    if (typeof id !== "string" || !SLUG_RE.test(id)) out.push(`${where}: ${label}: the id must be lowercase letters, numbers and single dashes (like "consultation").`);
    else if (seen.has(id)) out.push(`${where}: ${label}: the id "${id}" is used twice; every service has its own.`);
    else seen.add(id);
  }
  if ("name" in service) checkText(service["name"], SERVICE_NAME_MAX, `${label}: the name`, out);
  if ("description" in service) checkText(service["description"], SERVICE_DESCRIPTION_MAX, `${label}: the description`, out);
  if ("status" in service && service["status"] !== "live" && service["status"] !== "archived") out.push(`${where}: ${label}: "status" must be "live" or "archived".`);

  let sessionCount = 0;
  if ("sessions" in service) {
    const sessions = service["sessions"];
    if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > MAX_SESSIONS) out.push(`${where}: ${label}: "sessions" must list 1 to ${MAX_SESSIONS} sessions, each {"minutes": 60}.`);
    else {
      sessionCount = sessions.length;
      sessions.forEach((session, at) => {
        const here = `${label}: session ${at + 1}`;
        if (!isRecord(session)) return void out.push(`${where}: ${here} must be {"minutes": 60}.`);
        checkKeys(session, ["minutes"], here, out);
        const minutes = session["minutes"];
        if (!isWhole(minutes, SESSION_MINUTES.min, SESSION_MINUTES.max) || minutes % 5 !== 0) out.push(`${where}: ${here}: the length must be a whole number of minutes on a 5-minute step, from ${SESSION_MINUTES.min} to ${SESSION_MINUTES.max}.`);
      });
    }
  }

  if ("between" in service) {
    const between = service["between"];
    if (sessionCount === 1 && between !== null) out.push(`${where}: ${label}: a service with one session has no "between"; set it to null.`);
    else if (sessionCount >= 2 && !isRecord(between)) out.push(`${where}: ${label}: a service with ${sessionCount} sessions needs "between": {"minDays": 2, "maxDays": 10}, the fewest and most days from one session to the next.`);
    else if (isRecord(between)) {
      checkKeys(between, ["minDays", "maxDays"], `${label}: between`, out);
      const { minDays, maxDays } = between;
      const okMin = isWhole(minDays, 0, BETWEEN_DAYS_MAX);
      const okMax = isWhole(maxDays, 0, BETWEEN_DAYS_MAX);
      if (!okMin || !okMax) out.push(`${where}: ${label}: the days between sessions ("minDays" and "maxDays") must be whole numbers from 0 to ${BETWEEN_DAYS_MAX}.`);
      else if (minDays > maxDays) out.push(`${where}: ${label}: the fewest days between sessions (${minDays}) is more than the most (${maxDays}).`);
    } else if (between !== null) out.push(`${where}: ${label}: "between" must be null or {"minDays": 2, "maxDays": 10}.`);
  }

  let partyMax: number | null = null;
  let partyMin: number | null = null;
  if ("party" in service) {
    const party = service["party"];
    if (!isRecord(party)) out.push(`${where}: ${label}: "party" must be {"min": 1, "max": 6}.`);
    else {
      checkKeys(party, ["min", "max"], `${label}: party`, out);
      const { min, max } = party;
      if (!isWhole(min, 1, PARTY_MAX) || !isWhole(max, 1, PARTY_MAX)) out.push(`${where}: ${label}: the party size ("min" and "max") must be whole numbers from 1 to ${PARTY_MAX}.`);
      else if (min > max) out.push(`${where}: ${label}: the smallest party (${min}) is more than the largest (${max}).`);
      else {
        partyMax = max;
        partyMin = min;
      }
    }
  }

  let price: { amount: number; per: string } | null = null;
  if ("price" in service) {
    const value = service["price"];
    if (value !== null) {
      if (!isRecord(value)) out.push(`${where}: ${label}: "price" must be null (no price) or {"amount": 150, "per": "person"}.`);
      else {
        checkKeys(value, ["amount", "per"], `${label}: price`, out);
        const okAmount = isWhole(value["amount"], 1, PRICE_MAX);
        if (!okAmount) out.push(`${where}: ${label}: the price must be a whole number from 1 to ${PRICE_MAX.toLocaleString("en-US")}.`);
        if (value["per"] !== "person" && value["per"] !== "booking") out.push(`${where}: ${label}: the price is "per" "person" or "booking".`);
        else if (okAmount) price = { amount: value["amount"] as number, per: value["per"] };
      }
    }
  }

  if ("payment" in service) {
    const payment = service["payment"];
    const hasPrice = service["price"] !== null && service["price"] !== undefined;
    if (!isRecord(payment)) out.push(`${where}: ${label}: "payment" must be {"kind": "free"}, {"kind": "full"} or {"kind": "deposit", "amount": 100} (or "percent": 25).`);
    else {
      const kind = payment["kind"];
      if (kind === "free") checkKeys(payment, ["kind"], `${label}: payment`, out);
      else if (kind === "full") {
        checkKeys(payment, ["kind"], `${label}: payment`, out);
        if (!hasPrice) out.push(`${where}: ${label}: taking full payment needs a price; give the service one, or make it free.`);
      } else if (kind === "deposit") {
        checkKeys(payment, ["kind", "amount", "percent"], `${label}: payment`, out);
        const hasAmount = "amount" in payment;
        const hasPercent = "percent" in payment;
        if (hasAmount === hasPercent) out.push(`${where}: ${label}: a deposit is either a whole "amount" or a "percent" of the price, not both and not neither.`);
        if (!hasPrice) out.push(`${where}: ${label}: a deposit needs a price; give the service one, or make it free.`);
        if (hasPercent && !isWhole(payment["percent"], PERCENT.min, PERCENT.max)) out.push(`${where}: ${label}: the deposit percent must be a whole number from ${PERCENT.min} to ${PERCENT.max}.`);
        else if (hasPercent && price && service["status"] === "live") {
          const smallest = price.amount * (price.per === "person" ? (partyMin ?? 1) : 1) * (payment["percent"] as number) / 100;
          if (smallest < 1) out.push(`${where}: ${label}: the deposit for the smallest party would be under 1.00 in the site's currency, which card payments do not allow. Raise the percent or the price.`);
        }
        if (hasAmount) {
          const amount = payment["amount"];
          if (!isWhole(amount, 1, PRICE_MAX)) out.push(`${where}: ${label}: the deposit must be a whole number, at least 1.`);
          else if (price) {
            const top = price.per === "person" && partyMax !== null ? price.amount * partyMax : price.amount;
            if (amount >= top) out.push(`${where}: ${label}: the deposit (${amount}) must be less than the price (${top}); a deposit is capped at the price, so take full payment instead.`);
          }
        }
      } else out.push(`${where}: ${label}: payment "kind" must be "free", "full" or "deposit".`);
    }
  }

  if ("hours" in service) {
    const hours = service["hours"];
    if (!isRecord(hours)) out.push(`${where}: ${label}: "hours" must hold the settings this service changes (${HOURS_KEYS.join(", ")}).`);
    else checkHours(hours, `${label}: its own hours`, false, out);
  }
}

/** Why `booking.json` is not acceptable. `calendarOn` is whether site.config.ts has `booking` set; `paymentsOn` whether it has `payments`. */
export function validateBooking(data: unknown, options: { calendarOn: boolean; paymentsOn: boolean }): string[] {
  if (!isRecord(data)) return [`${where}: the file must be an object with ${SETTINGS_KEYS.map((key) => `"${key}"`).join(", ")}.`];
  const out: string[] = [];
  checkKeys(data, SETTINGS_KEYS, "the file", out);
  for (const key of SETTINGS_KEYS) if (!(key in data)) out.push(`${where}: "${key}" is missing.`);

  if ("taking" in data && typeof data["taking"] !== "boolean") out.push(`${where}: "taking" must be true or false.`);
  if ("policy" in data) checkText(data["policy"], POLICY_MAX, "the policy", out);
  if ("changeWording" in data) checkText(data["changeWording"], CHANGE_WORDING_MAX, "the change wording", out);
  if ("giftCardLine" in data) checkText(data["giftCardLine"], GIFT_CARD_LINE_MAX, "the gift card line", out);
  if ("hours" in data) {
    if (!isRecord(data["hours"])) out.push(`${where}: "hours" must hold ${HOURS_KEYS.join(", ")}.`);
    else checkHours(data["hours"], "the opening hours", true, out);
  }

  const services = data["services"];
  if ("services" in data) {
    if (!Array.isArray(services)) out.push(`${where}: "services" must be a list of services.`);
    else {
      if (services.length > MAX_SERVICES) out.push(`${where}: there are ${services.length} services; a site lists at most ${MAX_SERVICES}. Archive the ones no longer offered.`);
      const seen = new Set<string>();
      services.forEach((service, index) => checkService(service, index, seen, out));
    }
  }

  if (data["taking"] === true && !options.calendarOn) out.push(CALENDAR_OFF_MESSAGE);
  if (Array.isArray(services)) {
    const live = services.filter((service) => isRecord(service) && service["status"] === "live");
    if (data["taking"] === true && live.length === 0) out.push(`${where}: booking is on but no service is live; make at least one service "live", or turn booking off.`);
    const paid = live.some((service) => isRecord(service) && isRecord(service["payment"]) && (service["payment"]["kind"] === "full" || service["payment"]["kind"] === "deposit"));
    if (paid && !options.paymentsOn) out.push(PAID_NEEDS_PAYMENTS_MESSAGE);
  }
  return out;
}

export function liveServices(settings: BookingSettings): Service[] {
  return settings.services.filter((service) => service.status === "live");
}

export function findService(settings: BookingSettings, id: string): Service | null {
  return liveServices(settings).find((service) => service.id === id) ?? null;
}
