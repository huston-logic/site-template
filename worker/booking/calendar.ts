import type { Interval } from "../../src/booking/schema.ts";
import { log, retryable, TIMEOUT_MS } from "../env.ts";
import { CALENDAR_SCOPE, forgetGoogleToken, googleAccessToken, parseServiceAccount } from "../google-auth.ts";
import type { Outcome } from "../payments/types.ts";

/**
 * A Google Calendar v3 client over `fetch`, signed in as the site's service account (google-auth.ts). Every call returns
 * an Outcome and logs fixed event names and numbers only: never a calendar id, event id, email, key or body.
 * https://developers.google.com/calendar/api/v3/reference
 */

const API = "https://www.googleapis.com/calendar/v3";
/** freeBusy refuses a range longer than this many days, so a longer one is asked for in pieces. */
const FREEBUSY_DAYS = 60;
const DAY_MS = 86_400_000;
const MAX_LIST_PAGES = 10;

/** `props` is the event's `extendedProperties.private`. Times are Unix milliseconds. */
export interface CalendarEvent {
  id: string;
  start: number;
  end: number;
  transparent: boolean;
  status: string;
  summary: string;
  props: Record<string, string>;
}

export interface NewEvent {
  id: string;
  start: number;
  end: number;
  timeZone: string;
  summary: string;
  description: string;
  transparent: boolean;
  props: Record<string, string>;
}

/** Only the fields given are changed; `props` are merged into the existing private properties by Google's patch rules. */
export interface EventChanges {
  summary?: string;
  description?: string;
  transparent?: boolean;
  props?: Record<string, string>;
}

export interface CalendarClient {
  /** Busy time across all the calendars, sorted and merged. Any calendar that errs or is missing from the answer fails the call. */
  freeBusy(calendarIds: string[], from: number, to: number): Promise<Outcome<Interval[]>>;
  /** The live hold events this site wrote (`hl_kind=hold`, `hl_site=<site>`). Fails if more than 10 pages come back, rather than miss one. */
  listHolds(calendarId: string, from: number, to: number, site: string): Promise<Outcome<CalendarEvent[]>>;
  /** A 409 (the id already exists) is `{ ok: false, status: 409, code: "duplicate" }` and is never retried. */
  insertEvent(calendarId: string, event: NewEvent): Promise<Outcome<CalendarEvent>>;
  /** `null` when the event is gone (404, 410) or cancelled. */
  getEvent(calendarId: string, eventId: string): Promise<Outcome<CalendarEvent | null>>;
  patchEvent(calendarId: string, eventId: string, changes: EventChanges): Promise<Outcome<CalendarEvent>>;
  /** An event that is already gone (404, 410) counts as deleted. */
  deleteEvent(calendarId: string, eventId: string): Promise<Outcome<null>>;
}

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads an event. An all-day event has `start.date`, not `start.dateTime`: with `allowAllDay` it is read as running from
 * UTC midnight of its first day to UTC midnight of its end date (a rough span, enough to know the event exists); without
 * it the event is skipped, because the bookings and holds the Worker writes always have times.
 */
function parseEvent(raw: unknown, allowAllDay: boolean): CalendarEvent | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const readTime = (value: unknown): number | null => {
    if (!isRecord(value)) return null;
    if (typeof value.dateTime === "string") {
      const ms = Date.parse(value.dateTime);
      return Number.isNaN(ms) ? null : ms;
    }
    if (allowAllDay && typeof value.date === "string") {
      const ms = Date.parse(`${value.date}T00:00:00Z`);
      return Number.isNaN(ms) ? null : ms;
    }
    return null;
  };
  const start = readTime(raw.start);
  const end = readTime(raw.end);
  if (start === null || end === null) return null;
  const props: Record<string, string> = {};
  const priv = isRecord(raw.extendedProperties) ? raw.extendedProperties.private : undefined;
  if (isRecord(priv)) for (const [key, value] of Object.entries(priv)) if (typeof value === "string") props[key] = value;
  return {
    id: raw.id,
    start,
    end,
    transparent: raw.transparency === "transparent",
    status: typeof raw.status === "string" ? raw.status : "confirmed",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    props,
  };
}

/** Google's error reason (a short fixed word such as "rateLimitExceeded"), or null if the body does not have a plain one. */
function errorReason(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error) || !Array.isArray(body.error.errors)) return null;
  const first: unknown = body.error.errors[0];
  return isRecord(first) && typeof first.reason === "string" && /^[A-Za-z]{1,40}$/.test(first.reason) ? first.reason : null;
}

const iso = (ms: number): string => new Date(ms).toISOString();
const eventPath = (calendarId: string, eventId?: string): string =>
  `/calendars/${encodeURIComponent(calendarId)}/events${eventId === undefined ? "" : `/${encodeURIComponent(eventId)}`}`;

export function googleCalendar(keyJson: string | undefined): CalendarClient {
  const keyOk = keyJson !== undefined && parseServiceAccount(keyJson) !== null;

  /**
   * One request with the bearer token: a retry after a rate limit, server error or network failure, and one after a 401
   * (the token is forgotten and fetched again). `accept` lists extra statuses, such as 404, that are an answer here.
   */
  async function request(method: string, path: string, body: unknown, accept: number[] = []): Promise<Outcome<{ status: number; json: unknown }>> {
    if (!keyOk) {
      log("calendar_no_key");
      return { ok: false, status: 0, code: "no_key" };
    }
    let retried = false;
    let refreshed = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const token = await googleAccessToken(keyJson, CALENDAR_SCOPE);
      if (!token) return { ok: false, status: 0, code: "token_failed" };
      try {
        const response = await fetch(`${API}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const json: unknown = await response.json().catch(() => null);
        if (response.ok || accept.includes(response.status)) return { ok: true, value: { status: response.status, json } };
        log("calendar_failed", { status: response.status, attempt });
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          forgetGoogleToken(CALENDAR_SCOPE);
          continue;
        }
        if (retryable(response.status) && !retried) {
          retried = true;
          continue;
        }
        return { ok: false, status: response.status, code: response.status === 409 ? "duplicate" : errorReason(json) };
      } catch {
        log("calendar_unreachable", { attempt });
        if (retried) return { ok: false, status: 0, code: "unreachable" };
        retried = true;
      }
    }
    return { ok: false, status: 0, code: "unreachable" };
  }

  const badResponse = { ok: false, status: 200, code: "bad_response" } as const;

  const eventBody = (event: NewEvent): Raw => ({
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: { dateTime: iso(event.start), timeZone: event.timeZone },
    end: { dateTime: iso(event.end), timeZone: event.timeZone },
    transparency: event.transparent ? "transparent" : "opaque",
    extendedProperties: { private: event.props },
  });

  return {
    async freeBusy(calendarIds, from, to) {
      const busy: Interval[] = [];
      for (let pieceStart = from; pieceStart < to; pieceStart += FREEBUSY_DAYS * DAY_MS) {
        const pieceEnd = Math.min(to, pieceStart + FREEBUSY_DAYS * DAY_MS);
        const result = await request("POST", "/freeBusy", {
          timeMin: iso(pieceStart),
          timeMax: iso(pieceEnd),
          items: calendarIds.map((id) => ({ id })),
        });
        if (!result.ok) return result;
        const calendars = isRecord(result.value.json) && isRecord(result.value.json.calendars) ? result.value.json.calendars : null;
        if (!calendars) return { ok: false, status: 200, code: "calendar_error" };
        for (const id of calendarIds) {
          const entry = calendars[id];
          if (!isRecord(entry) || entry.errors !== undefined || !Array.isArray(entry.busy)) {
            log("calendar_busy_unreadable");
            return { ok: false, status: 200, code: "calendar_error" };
          }
          for (const span of entry.busy as unknown[]) {
            const start = isRecord(span) && typeof span.start === "string" ? Date.parse(span.start) : NaN;
            const end = isRecord(span) && typeof span.end === "string" ? Date.parse(span.end) : NaN;
            if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false, status: 200, code: "calendar_error" };
            busy.push({ start, end });
          }
        }
      }
      // Sorted, and spans that overlap or touch (a booking cut at a piece boundary, two calendars busy together) become one.
      busy.sort((a, b) => a.start - b.start || a.end - b.end);
      const merged: Interval[] = [];
      for (const span of busy) {
        const last = merged[merged.length - 1];
        if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
        else merged.push({ ...span });
      }
      return { ok: true, value: merged };
    },

    async listHolds(calendarId, from, to, site) {
      const events: CalendarEvent[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const query = new URLSearchParams({ timeMin: iso(from), timeMax: iso(to), singleEvents: "true", showDeleted: "false", maxResults: "250" });
        query.append("privateExtendedProperty", "hl_kind=hold");
        query.append("privateExtendedProperty", `hl_site=${site}`);
        if (pageToken) query.set("pageToken", pageToken);
        const result = await request("GET", `${eventPath(calendarId)}?${query.toString()}`, undefined);
        if (!result.ok) return result;
        const json = result.value.json;
        if (!isRecord(json) || !Array.isArray(json.items)) return badResponse;
        for (const item of json.items as unknown[]) {
          const event = parseEvent(item, false);
          if (event && event.status !== "cancelled") events.push(event);
        }
        pageToken = typeof json.nextPageToken === "string" && json.nextPageToken ? json.nextPageToken : null;
        if (!pageToken) return { ok: true, value: events };
      }
      log("calendar_too_many_pages");
      return { ok: false, status: 200, code: "too_many_pages" };
    },

    async insertEvent(calendarId, event) {
      const result = await request("POST", eventPath(calendarId), eventBody(event));
      if (!result.ok) return result;
      const parsed = parseEvent(result.value.json, true);
      return parsed ? { ok: true, value: parsed } : badResponse;
    },

    async getEvent(calendarId, eventId) {
      const result = await request("GET", eventPath(calendarId, eventId), undefined, [404, 410]);
      if (!result.ok) return result;
      if (result.value.status === 404 || result.value.status === 410) return { ok: true, value: null };
      const parsed = parseEvent(result.value.json, true);
      if (!parsed) return badResponse;
      return { ok: true, value: parsed.status === "cancelled" ? null : parsed };
    },

    async patchEvent(calendarId, eventId, changes) {
      const body: Raw = {};
      if (changes.summary !== undefined) body.summary = changes.summary;
      if (changes.description !== undefined) body.description = changes.description;
      if (changes.transparent !== undefined) body.transparency = changes.transparent ? "transparent" : "opaque";
      if (changes.props !== undefined) body.extendedProperties = { private: changes.props };
      const result = await request("PATCH", eventPath(calendarId, eventId), body);
      if (!result.ok) return result;
      const parsed = parseEvent(result.value.json, true);
      return parsed ? { ok: true, value: parsed } : badResponse;
    },

    async deleteEvent(calendarId, eventId) {
      const result = await request("DELETE", eventPath(calendarId, eventId), undefined, [404, 410]);
      return result.ok ? { ok: true, value: null } : result;
    },
  };
}

/** A new event id: "hl" and 24 characters of base32hex (0-9, a-v), the alphabet Google allows for event ids. 32 divides 256, so masking a byte is unbiased. */
export function newEventId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let id = "hl";
  for (const byte of random(24)) id += alphabet[byte & 31];
  return id;
}
