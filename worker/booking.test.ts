// Tests for the booking routes and fulfilment (docs/superpowers/specs/2026-11-27-booking-design.md, "Done when"). The calendar is
// a fake client with an in-memory store (it honours transparency, the private-property filter and an optional delay before a
// new event shows in free/busy); `fetch` is mocked for a fake Stripe (sessions, expiry and payment marks in memory), a Resend
// that drops a repeated idempotency key, an Apps Script that skips a booking reference it already holds, a Pipeline app and
// a Turnstile. Nothing leaves the process and every value is obviously fake.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { CheckoutAnswer, ConfirmAnswer, TimesAnswer } from "../src/booking/api.ts";
import type { BookingSettings, Hours, Interval, Service } from "../src/booking/schema.ts";
import { validateBooking } from "../src/booking/validate.ts";
import { localParts, zonedToUtc } from "../src/booking/zone.ts";
import type { GiftCardSettings } from "../src/gift-cards/schema.ts";
import { buildWorkerConfig, type WorkerSiteConfig } from "./config.ts";
import type { CalendarClient, CalendarEvent, EventChanges, NewEvent } from "./booking/calendar.ts";
import { resetBusyCache } from "./booking/events.ts";
import { LockCore, memoryLock, type Claim, type SlotLock } from "./booking/lock.ts";
import { createWorker } from "./contact.ts";
import type { ContactEnv } from "./env.ts";
import type { Outcome } from "./payments/types.ts";
import { signStripePayload } from "./payments/webhook.ts";

const ORIGIN = "https://example.test";
const WEBHOOK_URL = "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec";
const PIPELINE_URL = "https://pipeline.example.test";
const WHSEC = "whsec_fake_endpoint_secret";
const LIVE_KEY = "rk_live_fake_key_for_tests";
const TEST_KEY = "rk_test_fake_key_for_tests";
const REAL_CAL = "owner-cal@example.test";
const BUSY_CAL = "busy-cal@example.test";
const TEST_CAL = "test-cal@example.test";
const NAME = "Ada Lovelace";
const EMAIL = "ada@example.org";
const PHONE = "(555) 010-0100";
const NOTE = "Allergic to cats";
// Friday 2026-11-27, noon in Chicago.
const START = Date.UTC(2026, 10, 27, 18, 0, 0);
const TAGGED_PATH = "/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x";
const TZ = "America/Chicago";
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const BASE: WorkerSiteConfig = {
  business: { name: "Example Co", tagline: "Plain words for plain work", timeZone: TZ },
  owner: { name: "Pat Example", role: "Founder" },
  domain: { url: ORIGIN, workerName: "example-site", previewHostSuffix: ".workers.dev" },
  payments: { provider: "stripe", currency: "usd" },
  booking: { calendarId: REAL_CAL, busyCalendarIds: [BUSY_CAL], previewCalendarId: TEST_CAL },
  contact: {
    siteEmail: "hello@example.test",
    fromName: "Example Co",
    replyFromName: "Pat Example",
    schedulerUrl: "https://example.test/book",
    sheetWriter: "apps-script",
    sheetTabs: { production: "Submissions", preview: "Preview" },
    emailColors: { green: "#112233", ink: "#223344", ink2: "#334455", rust: "#445566", line: "#556677" },
  },
};

const HOURS: Hours = {
  weekly: { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]], sat: [], sun: [] },
  starts: { every: 60 },
  bufferMinutes: 15,
  noticeHours: 24,
  aheadDays: 60,
  closed: [{ from: "2026-12-24", to: "2026-12-26" }],
};

const WORKSHOP: Service = {
  id: "workshop",
  name: "Workshop",
  description: "A two-session workshop.",
  status: "live",
  sessions: [{ minutes: 120 }, { minutes: 120 }],
  between: { minDays: 2, maxDays: 10 },
  party: { min: 1, max: 10 },
  price: { amount: 150, per: "person" },
  payment: { kind: "deposit", percent: 25 },
};
const CONSULT: Service = { id: "consult", name: "Consultation", description: "One hour.", status: "live", sessions: [{ minutes: 60 }], between: null, party: { min: 1, max: 1 }, price: null, payment: { kind: "free" } };
const SINGLE: Service = { id: "single", name: "Session", description: "One paid hour.", status: "live", sessions: [{ minutes: 60 }], between: null, party: { min: 1, max: 4 }, price: { amount: 80, per: "booking" }, payment: { kind: "full" } };
const GHOST: Service = { ...CONSULT, id: "ghost", name: "Old thing", status: "archived" };

const SETTINGS: BookingSettings = {
  taking: true,
  policy: "Cancel 48 hours ahead for a refund.",
  changeWording: "To change your booking, reply to this email.",
  giftCardLine: "Gift cards are welcome.",
  hours: HOURS,
  services: [WORKSHOP, CONSULT, SINGLE, GHOST],
};

const GIFT: GiftCardSettings = { selling: false, amounts: [{ amount: 50 }], custom: null, redeemWording: "x", termsLine: "y", validForMonths: null };

// ---- the fake calendar ----

interface Stored extends CalendarEvent {
  calendar: string;
  description: string;
  createdAt: number;
}

class FakeCalendar implements CalendarClient {
  events = new Map<string, Stored>();
  log: string[] = [];
  /** How long a new event takes to show in free/busy (the real thing lags by seconds). */
  lagMs = 0;
  outage = false;
  failInsertFrom: number | null = null;
  private inserts = 0;
  private readonly clock: () => number;
  constructor(clock: () => number) {
    this.clock = clock;
  }

  private key = (calendar: string, id: string) => `${calendar}/${id}`;
  private down = <T>(): Outcome<T> | null => (this.outage ? { ok: false, status: 503, code: null } : null);
  of(calendar: string): Stored[] {
    return [...this.events.values()].filter((event) => event.calendar === calendar);
  }
  count(op: string): number {
    return this.log.filter((entry) => entry === op).length;
  }

  async freeBusy(ids: string[], from: number, to: number): Promise<Outcome<Interval[]>> {
    this.log.push("freebusy");
    const failed = this.down<Interval[]>();
    if (failed) return failed;
    const spans = [...this.events.values()]
      .filter((event) => ids.includes(event.calendar) && !event.transparent && event.status !== "cancelled" && event.createdAt + this.lagMs <= this.clock() && event.start < to && event.end > from)
      .map((event) => ({ start: event.start, end: event.end }))
      .sort((a, b) => a.start - b.start);
    return { ok: true, value: spans };
  }

  async listHolds(calendarId: string, from: number, to: number, site: string): Promise<Outcome<CalendarEvent[]>> {
    this.log.push("list");
    const failed = this.down<CalendarEvent[]>();
    if (failed) return failed;
    return { ok: true, value: this.of(calendarId).filter((event) => event.props["hl_kind"] === "hold" && event.props["hl_site"] === site && event.start < to && event.end > from) };
  }

  async insertEvent(calendarId: string, event: NewEvent): Promise<Outcome<CalendarEvent>> {
    this.log.push("insert");
    const failed = this.down<CalendarEvent>();
    if (failed) return failed;
    this.inserts += 1;
    if (this.failInsertFrom !== null && this.inserts >= this.failInsertFrom) return { ok: false, status: 500, code: null };
    if (this.events.has(this.key(calendarId, event.id))) return { ok: false, status: 409, code: "duplicate" };
    const stored: Stored = { id: event.id, start: event.start, end: event.end, transparent: event.transparent, status: "confirmed", summary: event.summary, props: { ...event.props }, calendar: calendarId, description: event.description, createdAt: this.clock() };
    this.events.set(this.key(calendarId, event.id), stored);
    return { ok: true, value: stored };
  }

  async getEvent(calendarId: string, eventId: string): Promise<Outcome<CalendarEvent | null>> {
    this.log.push("get");
    const failed = this.down<CalendarEvent | null>();
    if (failed) return failed;
    return { ok: true, value: this.events.get(this.key(calendarId, eventId)) ?? null };
  }

  async patchEvent(calendarId: string, eventId: string, changes: EventChanges): Promise<Outcome<CalendarEvent>> {
    this.log.push("patch");
    const failed = this.down<CalendarEvent>();
    if (failed) return failed;
    const found = this.events.get(this.key(calendarId, eventId));
    if (!found) return { ok: false, status: 404, code: null };
    if (changes.summary !== undefined) found.summary = changes.summary;
    if (changes.description !== undefined) found.description = changes.description;
    if (changes.transparent !== undefined) found.transparent = changes.transparent;
    if (changes.props) found.props = { ...found.props, ...changes.props };
    return { ok: true, value: found };
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<Outcome<null>> {
    this.log.push("delete");
    const failed = this.down<null>();
    if (failed) return failed;
    this.events.delete(this.key(calendarId, eventId));
    return { ok: true, value: null };
  }
}

// ---- the fake world ----

type Session = {
  id: string;
  pi: string;
  idempotencyKey: string;
  unit_amount: number;
  currency: string;
  amount_total: number;
  status: "open" | "complete" | "expired";
  payment_status: "unpaid" | "paid";
  created: number;
  chargeAt: number | null;
  expiresAt: number | null;
  paymentMethods: string[];
  metadata: Record<string, string>;
  piMetadata: Record<string, string>;
};
type Email = { key: string; to: string; subject: string; text: string; attachments?: { filename: string; content: string }[] };
type Row = { tab: string; row: string[] };

let sessions: Session[] = [];
let emails: Email[] = [];
let rows: Row[] = [];
let intakes: Record<string, unknown>[] = [];
let stripeCalls: string[] = [];
let logs: string[] = [];
let clock = START;
let calendar = new FakeCalendar(() => clock);
let turnstileOk = true;
let resendFails: (key: string) => boolean = () => false;
let sheetOk = true;
let seen = 0;
const realFetch = globalThis.fetch;
const realLog = console.log;
const realNow = Date.now;

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stripeSessionJson(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    status: s.status,
    payment_status: s.payment_status,
    amount_total: s.amount_total,
    currency: s.currency,
    created: s.created,
    expires_at: s.expiresAt,
    metadata: s.metadata,
    url: `https://checkout.stripe.com/c/pay/${s.id}`,
    payment_intent: { id: s.pi, metadata: { ...s.piMetadata }, latest_charge: s.chargeAt === null ? null : { created: s.chargeAt } },
  };
}

function fromForm(form: URLSearchParams, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form) if (key.startsWith(prefix) && key.endsWith("]") && value !== "") out[key.slice(prefix.length, -1)] = value;
  return out;
}

async function stripe(url: string, init: RequestInit): Promise<Response> {
  const path = new URL(url).pathname.replace("/v1", "");
  stripeCalls.push(`${init.method ?? "GET"} ${path}`);
  const headers = init.headers as Record<string, string>;
  assert.match(headers["authorization"] ?? "", /^Bearer rk_(live|test)_/);
  if (init.method === "POST" && path === "/checkout/sessions") {
    const form = new URLSearchParams(String(init.body));
    const key = headers["idempotency-key"] ?? "";
    const again = sessions.find((s) => s.idempotencyKey === key);
    if (again) return jsonResponse(stripeSessionJson(again));
    const metadata = fromForm(form, "metadata[");
    const piMetadata = fromForm(form, "payment_intent_data[metadata][");
    assert.ok(Object.keys(metadata).length <= 50, "more than 50 metadata keys");
    for (const value of [...Object.values(metadata), ...Object.values(piMetadata)]) assert.ok(value.length <= 500, "a metadata value is over 500 characters");
    const amount = Number(form.get("line_items[0][price_data][unit_amount]"));
    seen += 1;
    const expires = form.get("expires_at");
    const session: Session = {
      id: `cs_test_session${seen}`,
      pi: `pi_payment${seen}`,
      idempotencyKey: key,
      unit_amount: amount,
      currency: form.get("line_items[0][price_data][currency]") ?? "",
      amount_total: amount,
      status: "open",
      payment_status: "unpaid",
      created: Math.floor(clock / 1000),
      chargeAt: null,
      expiresAt: expires === null ? null : Number(expires),
      paymentMethods: [...form].filter(([name]) => name.startsWith("payment_method_types[")).map(([, value]) => value),
      metadata,
      piMetadata,
    };
    assert.ok((form.get("success_url") ?? "").endsWith("/booking/thanks?session_id={CHECKOUT_SESSION_ID}"));
    sessions.push(session);
    return jsonResponse(stripeSessionJson(session));
  }
  const expireMatch = /^\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)\/expire$/.exec(path);
  if (init.method === "POST" && expireMatch) {
    const found = sessions.find((s) => s.id === expireMatch[1]);
    if (!found) return jsonResponse({ error: { code: "resource_missing" } }, 404);
    if (found.status !== "open") return jsonResponse({ error: { code: "resource_invalid" } }, 400);
    found.status = "expired";
    return jsonResponse(stripeSessionJson(found));
  }
  const sessionMatch = /^\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(path);
  if (init.method === undefined || init.method === "GET") {
    const found = sessions.find((s) => s.id === sessionMatch?.[1]);
    return found ? jsonResponse(stripeSessionJson(found)) : jsonResponse({ error: { code: "resource_missing" } }, 404);
  }
  const intentMatch = /^\/payment_intents\/(pi_[A-Za-z0-9_]+)$/.exec(path);
  const owner = sessions.find((s) => s.pi === intentMatch?.[1]);
  if (init.method === "POST" && owner) {
    Object.assign(owner.piMetadata, fromForm(new URLSearchParams(String(init.body)), "metadata["));
    return jsonResponse({ id: owner.pi });
  }
  throw new Error(`Unexpected Stripe call: ${init.method} ${path}`);
}

function resend(init: RequestInit): Response {
  const headers = init.headers as Record<string, string>;
  const key = headers["idempotency-key"] ?? "";
  if (resendFails(key)) return jsonResponse({ message: "down" }, 500);
  const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string; html?: string; attachments?: Email["attachments"] };
  assert.equal(body.html, undefined, "booking emails are plain text");
  if (!emails.some((email) => email.key === key)) emails.push({ key, to: body.to[0] ?? "", subject: body.subject, text: body.text, attachments: body.attachments });
  return jsonResponse({ id: `email-${emails.length}` });
}

function appsScript(init: RequestInit): Response {
  if (!sheetOk) return jsonResponse({ ok: false });
  const { tab, row } = JSON.parse(String(init.body)) as { tab: string; row: string[] };
  // What docs/apps-script/contact-sheet.gs will do for a bookings tab: a reference already in column J is saved, not added again.
  if (tab.startsWith("Bookings") && rows.some((entry) => entry.tab === tab && entry.row[9] === row[9])) return jsonResponse({ ok: true });
  rows.push({ tab, row });
  return jsonResponse({ ok: true });
}

beforeEach(() => {
  sessions = [];
  emails = [];
  rows = [];
  intakes = [];
  stripeCalls = [];
  logs = [];
  clock = START;
  calendar = new FakeCalendar(() => clock);
  turnstileOk = true;
  resendFails = () => false;
  sheetOk = true;
  seen = 0;
  resetBusyCache();
  Date.now = () => clock;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.stripe.com/")) return stripe(url, init);
    if (url === "https://api.resend.com/emails") return resend(init);
    if (url.startsWith("https://script.google.com/")) return appsScript(init);
    if (url.startsWith(`${PIPELINE_URL}/`)) {
      intakes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({ ok: true }, 201);
    }
    if (url.includes("turnstile/v0/siteverify")) return jsonResponse({ success: turnstileOk, hostname: "example.test", action: "booking" });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  Date.now = realNow;
  const ids = [...calendar.events.values()].map((event) => event.id);
  for (const line of logs) {
    for (const secret of [NAME, EMAIL, PHONE, NOTE, "203.0.113.9", "re_test", WHSEC, LIVE_KEY, TEST_KEY, "webhook-test-secret", "EXAMPLE_DEPLOYMENT_ID", "turnstile-test-secret", REAL_CAL, BUSY_CAL, TEST_CAL, ...ids]) {
      assert.ok(!line.includes(secret), `log line leaked "${secret}": ${line}`);
    }
  }
});

function worker(site: WorkerSiteConfig = BASE, settings: BookingSettings = SETTINGS, extra: Record<string, unknown> = {}) {
  return createWorker(buildWorkerConfig(site), [], false, { booking: settings, calendar, lock: memoryLock(new LockCore(() => clock)), giftCards: GIFT, now: () => clock, ...extra });
}

function env(overrides: Partial<ContactEnv> = {}): ContactEnv {
  return {
    SITE_ENV: "production",
    RESEND_API_KEY: "re_test",
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    SHEET_WEBHOOK_URL: WEBHOOK_URL,
    SHEET_WEBHOOK_SECRET: "webhook-test-secret",
    INTAKE_SECRET: "intake-test-secret",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_WEBHOOK_SECRET: WHSEC,
    CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

const local = (date: string, time: string): number => {
  const ms = zonedToUtc(date, time, TZ);
  assert.ok(ms !== null, `${date} ${time} does not exist`);
  return ms;
};

const baseBody = (starts: number[], overrides: Record<string, unknown> = {}) => ({
  service: "workshop",
  party: 3,
  starts,
  answers: { name: NAME, email: EMAIL, phone: PHONE, notes: NOTE },
  returnPath: "/book",
  turnstileToken: "token-abc",
  company_fax: "",
  ...overrides,
});

function checkoutRequest(body: unknown, { origin = ORIGIN, cookie, base = ORIGIN }: { origin?: string; cookie?: string; base?: string } = {}): Request {
  return new Request(`${base}/api/booking/checkout`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function checkout(w: ReturnType<typeof worker>, body: unknown, environment: ContactEnv = env(), cookie?: string): Promise<{ status: number; body: CheckoutAnswer }> {
  const response = await w.fetch(checkoutRequest(body, { cookie }), environment);
  return { status: response.status, body: (await response.json()) as CheckoutAnswer };
}

async function times(w: ReturnType<typeof worker>, query: Record<string, string | number>, environment: ContactEnv = env()): Promise<{ status: number; body: TimesAnswer }> {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const response = await w.fetch(new Request(`${ORIGIN}/api/booking/times?${params.toString()}`), environment);
  return { status: response.status, body: (await response.json()) as TimesAnswer };
}

async function webhookRequest(type: string, sessionId: string): Promise<Request> {
  const raw = JSON.stringify({ id: `evt_${type}_${sessionId}`, type, data: { object: { id: sessionId } } });
  const signature = await signStripePayload(raw, WHSEC, Math.floor(clock / 1000));
  return new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: raw });
}

async function deliver(w: ReturnType<typeof worker>, session: Session, type = "checkout.session.completed", environment: ContactEnv = env()): Promise<Response> {
  return w.fetch(await webhookRequest(type, session.id), environment);
}

function pay(session: Session, at = clock): void {
  session.status = "complete";
  session.payment_status = "paid";
  session.chargeAt = Math.floor(at / 1000);
}

async function sourceCookie(w: ReturnType<typeof worker>): Promise<string> {
  const response = await w.fetch(
    new Request(`${ORIGIN}/api/visit`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ path: TAGGED_PATH, referrer: "https://www.google.com/" }) }),
    env(),
  );
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const kindOf = (email: Email): string => email.key.split("-").at(-1) ?? "";
const emailsOf = (kind: string): Email[] => emails.filter((email) => kindOf(email) === kind);
const decode = (content: string): string => Buffer.from(content, "base64").toString("utf8");
const bookingsIn = (calendarId: string) => calendar.of(calendarId).filter((event) => event.props["hl_kind"] === "booking");
const holdsIn = (calendarId: string) => calendar.of(calendarId).filter((event) => event.props["hl_kind"] === "hold");

/** A two-session workshop in the first week of December: Tuesday 9:00 and Friday 9:00 (both Chicago). */
const FIRST = (): number => local("2026-12-01", "09:00");
const SECOND = (): number => local("2026-12-04", "09:00");

describe("the fixtures", () => {
  test("the settings pass the owner's content check", () => {
    assert.deepEqual(validateBooking(SETTINGS, { calendarOn: true, paymentsOn: true }), []);
  });
});

describe("times", () => {
  test("the first session lists open days; a later session only the days the rule allows, never a held or busy time", async () => {
    const w = worker();
    const first = await times(w, { service: "workshop", party: 3, index: 0, from: "2026-11-28", days: 14, chosen: "" });
    assert.equal(first.status, 200);
    assert.ok(first.body.ok);
    assert.equal(first.body.zone, TZ);
    assert.equal(first.body.zoneName, "Central Standard Time");
    // Noon Friday plus 24 hours of notice: Saturday and Sunday are closed, so Monday is the first day with times.
    assert.equal(first.body.days.find((day) => day.date === "2026-11-28")?.times.length, 0);
    const monday = first.body.days.find((day) => day.date === "2026-11-30");
    assert.equal(monday?.times[0]?.label, "9:00 AM");
    assert.equal(monday?.times[0]?.start, local("2026-11-30", "09:00"));
    assert.deepEqual(first.body.window, { first: "2026-11-27", last: "2027-01-26" });

    const second = await times(w, { service: "workshop", party: 3, index: 1, from: "2026-12-02", days: 14, chosen: FIRST() });
    assert.ok(second.body.ok);
    assert.equal(second.body.days[0]?.date, "2026-12-03", "two days after the first at the earliest");
    assert.equal(second.body.days.at(-1)?.date, "2026-12-11", "ten days after the first at the latest");
    assert.deepEqual(second.body.window, { first: "2026-12-03", last: "2026-12-11" });
    assert.equal(second.body.days.find((day) => day.date === "2026-12-05")?.times.length, 0, "a Saturday has no times");
    assert.ok((second.body.days.find((day) => day.date === "2026-12-04")?.times.length ?? 0) > 0);
  });

  test("a busy time on any of the calendars, and another visitor's live hold, are not offered", async () => {
    const w = worker();
    calendar.events.set(`${BUSY_CAL}/ownerevent1`, { id: "ownerevent1", calendar: BUSY_CAL, start: local("2026-12-01", "09:00"), end: local("2026-12-01", "11:00"), transparent: false, status: "confirmed", summary: "Dentist", props: {}, description: "", createdAt: 0 });
    const free = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" });
    assert.ok(free.body.ok);
    const labels = free.body.days[0]?.times.map((time) => time.label) ?? [];
    assert.ok(!labels.includes("9:00 AM") && !labels.includes("10:00 AM"), `busy (with the buffer) hides 9 and 10: ${labels.join(",")}`);
    assert.ok(labels.includes("12:00 PM"));

    // A hold of someone else's unpaid checkout hides its time too (it is transparent, so free/busy would not).
    const booked = await checkout(w, baseBody([local("2026-12-02", "13:00")], { service: "consult", party: 1 }));
    assert.equal(booked.status, 200);
    resetBusyCache();
    const after = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-02", days: 1, chosen: "" });
    assert.ok(after.body.ok);
    assert.ok(!after.body.days[0]?.times.some((time) => time.label === "1:00 PM"));
  });

  test("anything a person could not send is refused; taking off is closed; a calendar failure fails closed", async () => {
    const w = worker();
    const good = { service: "workshop", party: 3, index: 0, from: "2026-12-01", days: 3, chosen: "" };
    assert.equal((await times(w, { ...good, service: "nope" })).status, 404);
    for (const bad of [{ party: 11 }, { party: 0 }, { party: "x" }, { index: 2 }, { index: -1 }, { days: 15 }, { days: 0 }, { from: "2026-13-01" }, { from: "tomorrow" }, { chosen: "123" }, { index: 1, chosen: "abc" }, { index: 1, chosen: "1.5" }, { index: 1, chosen: `${FIRST()},${SECOND()}` }]) {
      assert.equal((await times(w, { ...good, ...bad })).status, 400, JSON.stringify(bad));
    }
    // A chosen first session that is itself not a time this service offers (3 AM) is refused.
    assert.equal((await times(w, { ...good, index: 1, chosen: local("2026-12-01", "03:00") })).status, 400);
    assert.equal((await times(w, { ...good, service: "ghost" })).status, 404, "an archived service is not found");

    const closed = worker(BASE, { ...SETTINGS, taking: false });
    const refused = await times(closed, good);
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body, { ok: false, error: "closed" });

    calendar.outage = true;
    const down = await times(w, good);
    assert.equal(down.status, 502);
    assert.deepEqual(down.body, { ok: false, error: "unavailable" });
  });

  test("free/busy is kept for 30 seconds per calendar set and range", async () => {
    const w = worker();
    const query = { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 2, chosen: "" };
    await times(w, query);
    await times(w, query);
    assert.equal(calendar.count("freebusy"), 1);
    clock += 31_000;
    await times(w, query);
    assert.equal(calendar.count("freebusy"), 2);
  });

  test("development calls no outside service: times come from the rules alone", async () => {
    const w = worker();
    const result = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" }, env({ SITE_ENV: "development" }));
    assert.equal(result.status, 500, "development counts only on a local host");
    const response = await w.fetch(new Request("http://localhost:8787/api/booking/times?service=consult&party=1&index=0&from=2026-12-01&days=1&chosen="), env({ SITE_ENV: "development" }));
    assert.equal(response.status, 200);
    assert.equal(calendar.log.length, 0, "no calendar call");
  });
});

describe("the walk: times, checkout, payment, one signed webhook", () => {
  test("a two-session workshop for three: the Worker's deposit, holds, then one booking per session, one email each, one row, the source", async () => {
    const w = worker();
    const cookie = await sourceCookie(w);
    const response = await checkout(w, baseBody([FIRST(), SECOND()]), env(), cookie);
    assert.equal(response.status, 200);
    assert.ok(response.body.ok && response.body.kind === "checkout");
    const token = response.body.ok && response.body.kind === "checkout" ? response.body.releaseToken : "";
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.deepEqual(response.body, { ok: true, kind: "checkout", url: "https://checkout.stripe.com/c/pay/cs_test_session1", sessionId: "cs_test_session1", dueNow: 112.5, currency: "USD", releaseToken: token });

    const [session] = sessions;
    assert.ok(session);
    assert.equal(session.metadata["rt"], token, "the token is in the session's metadata");
    assert.equal(session.unit_amount, 11_250, "25 percent of $150 for three people, the Worker's figure");
    assert.equal(session.currency, "usd");
    assert.deepEqual(session.paymentMethods, ["card"]);
    assert.equal(session.expiresAt, Math.floor(clock / 1000) + 31 * 60);
    assert.equal(session.metadata["kind"], "booking");
    assert.equal(session.metadata["site"], "example-site");
    assert.equal(session.metadata["site_mode"], "production");
    assert.equal(session.metadata["total_minor"], "45000");
    assert.equal(session.metadata["later_minor"], "33750");
    assert.deepEqual(session.piMetadata, session.metadata);
    assert.equal(emails.length, 0, "nothing is sent before payment");
    assert.equal(rows.length, 0);

    const holds = holdsIn(REAL_CAL);
    assert.equal(holds.length, 2);
    assert.ok(holds.every((hold) => hold.transparent && hold.props["hl_session"] === session.id && hold.props["hl_site"] === "example-site" && hold.props["hl_mode"] === "production"));
    assert.deepEqual(holds.map((hold) => hold.start).sort(), [FIRST(), SECOND()]);
    assert.equal(holds[0]?.end, (holds[0]?.start ?? 0) + 120 * MINUTE);
    assert.ok(holds[0]?.summary.startsWith("Hold: Workshop (unpaid, until "));
    assert.equal(bookingsIn(REAL_CAL).length, 0);

    // While the visitor pays, the time is gone from the page.
    resetBusyCache();
    const during = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" });
    assert.ok(during.body.ok && !during.body.days[0]?.times.some((time) => time.label === "9:00 AM"));

    pay(session);
    assert.equal((await deliver(w, session)).status, 200);

    assert.equal(holdsIn(REAL_CAL).length, 0, "every hold became a booking");
    const bookings = bookingsIn(REAL_CAL).sort((a, b) => a.start - b.start);
    assert.equal(bookings.length, 2);
    assert.ok(bookings.every((event) => !event.transparent));
    assert.deepEqual(bookings.map((event) => event.start), [FIRST(), SECOND()]);
    assert.equal(bookings[0]?.summary, "Workshop: Ada Lovelace (party of 3) 1/2");
    assert.equal(bookings[1]?.summary, "Workshop: Ada Lovelace (party of 3) 2/2");
    assert.ok(bookings[0]?.props["hl_ref"]?.startsWith("BK-"));

    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(emailsOf("alert").length, 0);
    assert.equal(emailsOf("wait").length, 0);
    const [buyer] = emailsOf("buyer");
    assert.equal(buyer?.to, EMAIL);
    assert.equal(buyer?.subject, "Your booking with Example Co");
    for (const piece of ["Hi Ada,", "Session 1 of 2: Tuesday, December 1, 2026, 9:00 AM", "Session 2 of 2: Friday, December 4, 2026, 9:00 AM", "Central Standard Time", "Paid now: $112.50", "Still to pay: $337.50", "Party size: 3", "To change your booking, reply to this email.", "Cancel 48 hours ahead for a refund."]) {
      assert.ok(buyer?.text.includes(piece), `missing: ${piece}`);
    }
    assert.equal(buyer?.attachments?.length, 1);
    assert.equal(buyer?.attachments?.[0]?.filename, "booking.ics");
    const ics = decode(buyer?.attachments?.[0]?.content ?? "");
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//example-site//Booking//EN"));
    assert.equal(ics.split("BEGIN:VEVENT").length - 1, 2);
    assert.ok(ics.includes("DTSTART:20261201T150000Z") && ics.includes("DTEND:20261201T170000Z"), "9:00 CST is 15:00 UTC");
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
    assert.ok(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75));

    const [owner] = emailsOf("owner");
    assert.equal(owner?.to, "hello@example.test");
    assert.equal(owner?.subject, `New booking: Workshop for ${NAME}`);
    assert.ok(owner?.text.includes("Came from: google / cpc, campaign spring-sale, first visit 2026-11-27"));
    assert.ok(owner?.text.includes(`Payment: ${session.pi}`));
    assert.ok(owner?.text.includes(`Phone: ${PHONE}`));
    assert.ok(owner?.text.includes(NOTE));
    assert.ok(owner?.text.includes("Sheet: saved"));
    assert.ok(!owner?.text.includes("written to the calendar late"));

    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row?.tab, "Bookings");
    assert.equal(row?.row.length, 18);
    assert.deepEqual(row?.row.slice(0, 11), [
      "2026-11-27T18:00:00.000Z",
      "Workshop",
      "Tuesday, December 1, 2026, 9:00 AM (Central Standard Time)\nFriday, December 4, 2026, 9:00 AM (Central Standard Time)",
      "3",
      NAME,
      EMAIL,
      PHONE,
      "$112.50",
      "$337.50",
      session.pi,
      "",
    ]);
    assert.deepEqual(row?.row.slice(11, 13), ["google / cpc", "spring-sale"], "the lead source is the visit's, kept from checkout time");
    assert.equal(row?.row[16], "Booked");
    assert.ok(row?.row[17]?.includes(NOTE));

    assert.deepEqual(
      Object.keys(session.piMetadata).filter((key) => key.startsWith("hl_")).sort(),
      ["hl_buyer", "hl_calendar", "hl_ledger", "hl_owner"],
    );
    assert.equal(session.piMetadata["hl_calendar"], "booked");
    assert.equal(session.piMetadata["hl_ledger"], "saved");
  });

  test("the same webhook three times, and async_payment_succeeded after, still gives one of each", async () => {
    const w = worker();
    const { body } = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.ok(body.ok);
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    for (let i = 0; i < 3; i++) assert.equal((await deliver(w, session)).status, 200);
    assert.equal((await deliver(w, session, "checkout.session.async_payment_succeeded")).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(emails.length, 2);
    assert.equal(rows.length, 1);
    assert.equal(calendar.count("patch"), 2, "the calendar was written once");
  });

  test("two deliveries at the same moment, before any mark, still give one of each", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    const [a, b] = await Promise.all([deliver(w, session), deliver(w, session)]);
    assert.equal(a?.status, 200);
    assert.equal(b?.status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
    assert.equal(bookingsIn(REAL_CAL).length, 2);
    assert.equal(emailsOf("alert").length, 0, "the second run found its own bookings and did not call it a clash");
  });

  test("a payment that does not match what the Worker asked for gets no booking and one alert", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    session.amount_total = 100;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(bookingsIn(REAL_CAL).length, 0);
    assert.equal(emailsOf("buyer").length, 0);
    assert.equal(emailsOf("mismatch").length, 1);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("mismatch").length, 1, "told once");
  });
});

describe("expiry and release", () => {
  test("an expired checkout removes its holds and the same time is offered again", async () => {
    const w = worker();
    const { body } = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.ok(body.ok);
    const [session] = sessions;
    assert.ok(session);
    assert.equal(holdsIn(REAL_CAL).length, 2);
    session.status = "expired";
    assert.equal((await deliver(w, session, "checkout.session.expired")).status, 200);
    assert.equal(holdsIn(REAL_CAL).length, 0);
    resetBusyCache();
    const again = await times(w, { service: "workshop", party: 3, index: 0, from: "2026-12-01", days: 1, chosen: "" });
    assert.ok(again.body.ok && again.body.days[0]?.times.some((time) => time.start === FIRST()));
    // And the visitor can book it again at once, even though the lock still remembers the first try.
    clock += 2 * MINUTE;
    const retry = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(emails.length, 0, "an expired checkout sends nothing");
  });

  test("an expired event for a session that is not expired is not trusted", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    assert.equal((await deliver(w, session, "checkout.session.expired")).status, 200);
    assert.equal(holdsIn(REAL_CAL).length, 2, "Stripe says it is still open, so the holds stay");
  });

  test("release: an open page is closed and its holds removed; a paid one keeps its time; a bad id is refused", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    const tokenOf = (id: string): string => sessions.find((entry) => entry.id === id)?.metadata["rt"] ?? "";
    const release = (id: unknown, origin = ORIGIN, token: unknown = typeof id === "string" ? tokenOf(id) : "") => w.fetch(new Request(`${ORIGIN}/api/booking/release`, { method: "POST", headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ sessionId: id, releaseToken: token }) }), env());
    assert.equal((await release("nope")).status, 400);
    assert.equal((await release(session.id, "https://evil.test")).status, 403);
    const done = await release(session.id);
    assert.equal(done.status, 200);
    assert.deepEqual(await done.json(), { ok: true });
    assert.equal(session.status, "expired");
    assert.equal(holdsIn(REAL_CAL).length, 0);
    assert.deepEqual(await (await release("cs_test_unknown", ORIGIN, "0123456789abcdef0123456789abcdef")).json(), { ok: true });

    // A page that was paid between the click and the release is not expired and keeps its holds.
    await checkout(w, baseBody([local("2026-12-08", "09:00"), local("2026-12-10", "09:00")]));
    const second = sessions[1];
    assert.ok(second);
    pay(second);
    assert.equal((await release(second.id)).status, 200);
    assert.equal(second.status, "complete");
    assert.equal(holdsIn(REAL_CAL).length, 2);
  });
});

describe("one winner", () => {
  test("two checkouts for the same time at once: one URL, one taken, even when free/busy lags", async () => {
    calendar.lagMs = 5_000;
    const w = worker();
    const body = baseBody([FIRST(), SECOND()]);
    const [a, b] = await Promise.all([checkout(w, body), checkout(w, { ...body, answers: { name: "Grace Hopper", email: "grace@example.org", phone: PHONE } })]);
    const results = [a, b];
    assert.equal(results.filter((r) => r.status === 200 && r.body.ok && r.body.kind === "checkout").length, 1);
    const loser = results.find((r) => r.status === 409);
    assert.deepEqual(loser?.body, { ok: false, error: "taken", index: 0 });
    assert.equal(sessions.length, 1, "the loser never reached Stripe");
    assert.equal(holdsIn(REAL_CAL).length, 2);
  });

  test("two free bookings at once while free/busy lags: the lock's claims keep the second out", async () => {
    calendar.lagMs = 10_000;
    const w = worker();
    const start = local("2026-12-02", "10:00");
    const body = baseBody([start], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } });
    const [a, b] = await Promise.all([checkout(w, body), checkout(w, body)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(bookingsIn(REAL_CAL).length, 1);
    // Later, still inside the lag, a third try is refused; a time two hours on is free.
    clock += 3_000;
    assert.equal((await checkout(w, body)).status, 409);
    assert.equal((await checkout(w, baseBody([local("2026-12-02", "13:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }))).status, 200);
  });

  test("a different service on a time another service holds is refused too (one booking per time across services)", async () => {
    const w = worker();
    const start = local("2026-12-02", "10:00");
    const own = { answers: { name: NAME, email: EMAIL, phone: PHONE } };
    assert.equal((await checkout(w, baseBody([start], { service: "consult", party: 1, ...own }))).status, 200);
    const other = await checkout(w, baseBody([start], { service: "single", party: 2, ...own }));
    assert.equal(other.status, 409);
  });
});

describe("refused with nothing written", () => {
  const written = () => ({ stripe: stripeCalls.length, inserts: calendar.count("insert"), emails: emails.length, rows: rows.length });
  const nothing = { stripe: 0, inserts: 0, emails: 0, rows: 0 };

  test("a busy time, inside the notice, outside hours, a closed date, a broken rule, a party too large, a wrong count", async () => {
    const w = worker();
    calendar.events.set(`${REAL_CAL}/ownerevent1`, { id: "ownerevent1", calendar: REAL_CAL, start: local("2026-12-01", "09:00"), end: local("2026-12-01", "11:00"), transparent: false, status: "confirmed", summary: "Owner's own thing", props: {}, description: "", createdAt: 0 });
    const cases: [string, Record<string, unknown>, number, unknown][] = [
      ["busy", baseBody([FIRST(), SECOND()]), 409, { ok: false, error: "taken", index: 0 }],
      ["inside notice", baseBody([local("2026-11-28", "09:00"), local("2026-12-01", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["outside hours", baseBody([local("2026-12-02", "07:00"), local("2026-12-04", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["closed date", baseBody([local("2026-12-22", "09:00"), local("2026-12-24", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["second session too soon", baseBody([local("2026-12-02", "09:00"), local("2026-12-03", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["second session too late", baseBody([local("2026-12-02", "09:00"), local("2026-12-14", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["a weekend", baseBody([local("2026-12-02", "09:00"), local("2026-12-05", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["party too large", baseBody([local("2026-12-02", "09:00"), local("2026-12-04", "09:00")], { party: 11 }), 400, { ok: false, error: "rejected" }],
      ["one session of two", baseBody([local("2026-12-02", "09:00")]), 400, { ok: false, error: "rejected" }],
      ["an archived service", baseBody([local("2026-12-02", "09:00")], { service: "ghost", party: 1 }), 400, { ok: false, error: "rejected" }],
      ["an unknown service", baseBody([local("2026-12-02", "09:00")], { service: "nope", party: 1 }), 400, { ok: false, error: "rejected" }],
    ];
    for (const [name, body, status, answer] of cases) {
      const result = await checkout(w, body);
      assert.equal(result.status, status, name);
      assert.deepEqual(result.body, answer, name);
      assert.deepEqual(written(), nothing, name);
    }
  });

  test("a forged price or amount is refused, and the amount Stripe sees is always the Worker's", async () => {
    const w = worker();
    for (const forged of [{ price: 1 }, { amount: 100 }, { dueNow: 0 }, { total: 1, currency: "usd" }]) {
      const result = await checkout(w, { ...baseBody([FIRST(), SECOND()]), ...forged });
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, { ok: false, error: "rejected" });
      assert.deepEqual(written(), nothing);
    }
    // A forged price hidden in the answers is an unknown field and refused too.
    assert.equal((await checkout(w, baseBody([FIRST(), SECOND()], { answers: { name: NAME, email: EMAIL, phone: PHONE, price: "1" } }))).status, 400);
    assert.deepEqual(written(), nothing);
    // The honest request: the amount is the rule's, whatever the size of the party.
    assert.equal((await checkout(w, baseBody([FIRST(), SECOND()], { party: 10 }))).status, 200);
    assert.equal(sessions[0]?.unit_amount, 37_500, "25 percent of ten people at $150");
  });

  test("the layers before: another origin, a wrong content type, an unfilled honeypot trap, a failed Turnstile, a missing field", async () => {
    const w = worker();
    const body = baseBody([FIRST(), SECOND()]);
    assert.equal((await w.fetch(checkoutRequest(body, { origin: "https://evil.test" }), env())).status, 403);
    assert.equal((await w.fetch(new Request(`${ORIGIN}/api/booking/checkout`, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) }), env())).status, 415);
    assert.equal((await checkout(w, { ...body, company_fax: "1" })).status, 400);
    const missing = await checkout(w, { ...body, answers: { name: NAME, email: "not an email", phone: PHONE } });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { ok: false, error: "invalid", fields: ["email"] });
    assert.equal((await checkout(w, { ...body, answers: { name: NAME, email: EMAIL, phone: PHONE, extra: "x" } })).status, 400);
    turnstileOk = false;
    assert.equal((await checkout(w, body)).status, 403);
    assert.deepEqual(written(), nothing);
    // The rate limiter answers 429 before anything else is read.
    const limited = await w.fetch(checkoutRequest(body), env({ CONTACT_RATE_LIMIT: { limit: async () => ({ success: false }) } }));
    assert.equal(limited.status, 429);
  });

  test("no lock binding fails closed; a lock that cannot be had is unavailable; nothing is written either way", async () => {
    const none = createWorker(buildWorkerConfig(BASE), [], false, { booking: SETTINGS, calendar, giftCards: GIFT, now: () => clock });
    const failed = await checkout(none, baseBody([FIRST(), SECOND()]));
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.body, { ok: false, error: "failed" });
    assert.deepEqual(written(), nothing);
    const busy = { acquire: async () => null, release: async () => undefined };
    const stuck = worker(BASE, SETTINGS, { lock: busy });
    const refused = await checkout(stuck, baseBody([FIRST(), SECOND()]));
    assert.equal(refused.status, 502);
    assert.deepEqual(refused.body, { ok: false, error: "unavailable" });
    assert.deepEqual(written(), nothing);
  });

  test("a calendar outage at checkout fails closed; a hold that cannot be written undoes the rest and closes the page", async () => {
    const w = worker();
    calendar.outage = true;
    assert.equal((await checkout(w, baseBody([FIRST(), SECOND()]))).status, 502);
    assert.equal(stripeCalls.length, 0);
    calendar.outage = false;
    calendar.failInsertFrom = 2;
    const result = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { ok: false, error: "unavailable" });
    assert.equal(calendar.of(REAL_CAL).length, 0, "the first hold was taken back");
    assert.equal(sessions[0]?.status, "expired", "the page was closed before the visitor could see it");
  });
});

describe("daylight saving", () => {
  const cases: [string, string, string, string][] = [
    ["the Friday before the spring change", "2026-03-06", "2026-02-20", "9:00 AM"],
    ["the Monday after the spring change", "2026-03-09", "2026-02-20", "9:00 AM"],
    ["the Friday before the fall change", "2026-10-30", "2026-09-15", "9:00 AM"],
    ["the Monday after the fall change", "2026-11-02", "2026-09-15", "9:00 AM"],
  ];
  for (const [name, date, today, label] of cases) {
    test(`a booking on ${name} lands at 9:00 local in the calendar and the email`, async () => {
      clock = local(today, "12:00");
      const w = worker();
      const start = local(date, "09:00");
      const result = await checkout(w, baseBody([start], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const [event] = bookingsIn(REAL_CAL);
      assert.equal(event?.start, start);
      assert.equal(localParts(event?.start ?? 0, TZ).time, "09:00");
      const [buyer] = emailsOf("buyer");
      assert.ok(buyer?.text.includes(label), buyer?.text);
      const summary = result.body.ok && result.body.kind === "booked" ? result.body.summary : null;
      const offsetHours = date < "2026-03-08" || date >= "2026-11-01" ? 6 : 5;
      assert.ok(summary?.sessions[0]?.label.includes(`9:00 AM (Central ${offsetHours === 6 ? "Standard" : "Daylight"} Time)`), summary?.sessions[0]?.label);
      const ics = decode(buyer?.attachments?.[0]?.content ?? "");
      assert.ok(ics.includes(`DTSTART:${date.replaceAll("-", "")}T${String(9 + offsetHours).padStart(2, "0")}0000Z`), `${date} is UTC-${offsetHours}`);
      assert.match(summary?.zoneName ?? "", offsetHours === 6 ? /Central Standard Time/ : /Central Daylight Time/);
    });
  }
});

describe("free services and a site without payments", () => {
  test("a free service books with no Stripe call: calendar booking, visitor and owner emails, ledger", async () => {
    const w = worker();
    const start = local("2026-12-02", "10:00");
    const result = await checkout(w, baseBody([start], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.equal(result.status, 200);
    assert.ok(result.body.ok && result.body.kind === "booked");
    if (!result.body.ok || result.body.kind !== "booked") return;
    assert.match(result.body.summary.reference, /^BK-[2-9A-Z]{8}$/);
    assert.equal(result.body.summary.service, "Consultation");
    assert.equal(result.body.summary.paidText, "");
    assert.equal(result.body.summary.dueLaterText, "");
    assert.equal(result.body.summary.sessions[0]?.label, "Wednesday, December 2, 2026, 10:00 AM (Central Standard Time)");
    assert.deepEqual(stripeCalls, []);
    assert.equal(bookingsIn(REAL_CAL).length, 1);
    assert.equal(holdsIn(REAL_CAL).length, 0);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.row[9], result.body.summary.reference, "the booking reference stands in for a Stripe reference");
    assert.equal(rows[0]?.row[16], "Booked");
    assert.ok(emailsOf("owner")[0]?.text.includes(`Payment: ${result.body.summary.reference}`));
  });

  test("a free service with a price shows the whole price as due later and still skips Stripe", async () => {
    const priced: Service = { ...CONSULT, id: "priced", name: "Pay on the day", price: { amount: 40, per: "booking" } };
    const w = worker(BASE, { ...SETTINGS, services: [priced] });
    const result = await checkout(w, baseBody([local("2026-12-02", "10:00")], { service: "priced", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.ok(result.body.ok && result.body.kind === "booked");
    if (result.body.ok && result.body.kind === "booked") assert.equal(result.body.summary.dueLaterText, "$40.00 due later");
    assert.deepEqual(stripeCalls, []);
    assert.equal(rows[0]?.row[7], "$0.00");
    assert.equal(rows[0]?.row[8], "$40.00");
  });

  test("with payments null a paid service is refused (400) and a free one still books", async () => {
    const noPayments = { ...BASE, payments: null };
    const w = worker(noPayments);
    const refused = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, { ok: false, error: "rejected" });
    assert.equal(calendar.count("insert"), 0);
    const free = await checkout(w, baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.equal(free.status, 200);
    assert.equal(bookingsIn(REAL_CAL).length, 1);
    // The payments routes are a 404 here, so nothing pays and nothing hooks the webhook.
    const hook = await w.fetch(new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", body: "{}" }), env());
    assert.equal(hook.status, 404);
  });

  test("a Pipeline site gets a lead; the free booking needs the calendar and the owner's note or the ledger", async () => {
    const pipeline = { ...BASE, contact: { ...BASE.contact, destination: "pipeline" as const, pipelineUrl: PIPELINE_URL } };
    const w = worker(pipeline);
    const body = baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } });
    assert.equal((await checkout(w, body)).status, 200);
    assert.equal(intakes.length, 1);
    assert.equal(intakes[0]?.["name"], NAME);
    assert.equal(intakes[0]?.["email"], EMAIL);
    assert.ok(String(intakes[0]?.["message"]).includes("Service: Consultation"));

    // Neither the owner's email nor the ledger reached the owner: 502, and the time stays booked on the calendar.
    sheetOk = false;
    resendFails = (key) => key.endsWith("-owner");
    const lost = worker();
    const result = await checkout(lost, baseBody([local("2026-12-03", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { ok: false, error: "failed" });
    assert.equal(bookingsIn(REAL_CAL).length, 2);
  });
});

describe("failure after payment", () => {
  test("a hold removed before the webhook: a clash, the surviving hold becomes a CHECK booking, an alert with the whole booking, no confirmation", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    const [gone] = holdsIn(REAL_CAL).sort((a, b) => a.start - b.start);
    assert.ok(gone);
    calendar.events.delete(`${REAL_CAL}/${gone.id}`);
    pay(session);
    assert.equal((await deliver(w, session)).status, 200);

    assert.equal(session.piMetadata["hl_calendar"], "clash");
    assert.equal(emailsOf("buyer").length, 0, "no confirmation for a time that is not held");
    const [alert] = emailsOf("alert");
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(alert?.to, "hello@example.test");
    assert.ok(alert?.subject.startsWith("ACTION NEEDED"));
    for (const piece of [NAME, EMAIL, PHONE, NOTE, "Workshop", "Friday, December 4, 2026, 9:00 AM", "Paid now: $112.50", "Still to pay: $337.50", session.pi]) assert.ok(alert?.text.includes(piece), `missing: ${piece}`);
    const [wait] = emailsOf("wait");
    assert.equal(emailsOf("wait").length, 1);
    assert.equal(wait?.to, EMAIL);
    assert.ok(wait?.text.includes("I will contact you myself"));
    assert.ok(!wait?.text.toLowerCase().includes("is confirmed"));
    assert.equal(emailsOf("owner").length, 0, "the alert is the owner's note");
    const [survivor] = bookingsIn(REAL_CAL);
    assert.equal(survivor?.summary, "CHECK: Workshop: Ada Lovelace 2/2");
    assert.equal(survivor?.transparent, false, "the time stays blocked");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.row[16], "Needs attention");
    assert.equal(session.piMetadata["hl_owner"], "alert");

    await deliver(w, session);
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(emailsOf("wait").length, 1);
    assert.equal(rows.length, 1);
  });

  test("another event now covers the time: the same clash", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    calendar.events.set(`${BUSY_CAL}/ownerevent1`, { id: "ownerevent1", calendar: BUSY_CAL, start: SECOND() + 30 * MINUTE, end: SECOND() + 90 * MINUTE, transparent: false, status: "confirmed", summary: "Owner's own thing", props: {}, description: "", createdAt: 0 });
    pay(session);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(session.piMetadata["hl_calendar"], "clash");
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(emailsOf("buyer").length, 0);
    assert.equal(bookingsIn(REAL_CAL).length, 2, "both holds became CHECK bookings so the times stay blocked");
  });

  test("a calendar outage on the first delivery: alert, wait email and 500; a later delivery books it and confirms, once", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    calendar.outage = true;
    assert.equal((await deliver(w, session)).status, 500);
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(emailsOf("wait").length, 1);
    assert.equal(emailsOf("buyer").length, 0);
    assert.equal(rows.length, 0, "the row waits for the calendar's answer");
    assert.equal(session.piMetadata["hl_calendar"], undefined);
    assert.ok(emailsOf("alert")[0]?.text.includes("I could not write their time to your calendar"));

    assert.equal((await deliver(w, session)).status, 500, "still down: no second alert, no second wait email");
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(emailsOf("wait").length, 1);

    calendar.outage = false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.ok(emailsOf("owner")[0]?.text.includes("written to the calendar late"));
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(emailsOf("wait").length, 1);
    assert.equal(bookingsIn(REAL_CAL).length, 2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.row[16], "Booked");
    await deliver(w, session);
    assert.equal(emails.length, 4);
  });

  test("a patch that fails halfway is finished by the next delivery without calling its own booking a clash", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    const realPatch = calendar.patchEvent.bind(calendar);
    let patches = 0;
    calendar.patchEvent = async (...args) => {
      patches += 1;
      return patches === 2 ? { ok: false, status: 500, code: null } : realPatch(...args);
    };
    assert.equal((await deliver(w, session)).status, 500);
    calendar.patchEvent = realPatch;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(session.piMetadata["hl_calendar"], "booked");
    assert.equal(bookingsIn(REAL_CAL).every((event) => event.summary.startsWith("Workshop:")), true);
    assert.equal(emailsOf("buyer").length, 1);
  });

  test("the visitor's email failing is retried by Stripe; the owner is told once", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    resendFails = (key) => key.endsWith("-buyer");
    assert.equal((await deliver(w, session)).status, 500);
    assert.equal(emailsOf("owner").length, 1);
    assert.ok(emailsOf("owner")[0]?.text.includes("NOT sent yet"));
    resendFails = () => false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
  });
});

describe("the thank-you page", () => {
  const confirm = (w: ReturnType<typeof worker>, id: string) => w.fetch(new Request(`${ORIGIN}/api/booking/confirm?session_id=${id}`, { headers: { "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9" } }), env());

  test("answers the summary; a paid booking the webhook missed is finished here after 90 seconds, once", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    assert.deepEqual(await (await confirm(w, session.id)).json(), { status: "unpaid" });
    pay(session);
    const early = (await (await confirm(w, session.id)).json()) as ConfirmAnswer;
    assert.ok(early.status === "paid" && early.booked === "waiting" && !early.emailed);
    assert.equal(emails.length, 0, "too soon to repair");

    clock += 100_000;
    const late = (await (await confirm(w, session.id)).json()) as ConfirmAnswer;
    assert.ok(late.status === "paid");
    if (late.status !== "paid") return;
    assert.equal(late.booked, "booked");
    assert.equal(late.emailed, true);
    assert.equal(late.value, 112.5);
    assert.equal(late.currency, "USD");
    assert.equal(late.transactionId, session.pi);
    assert.equal(late.summary.sessions.length, 2);
    assert.equal(late.summary.paidText, "$112.50");
    assert.equal(late.summary.dueLaterText, "$337.50 due later");
    assert.equal(emailsOf("buyer").length, 1);
    assert.ok(emailsOf("owner")[0]?.text.includes("thank-you page finished this booking"));
    await confirm(w, session.id);
    await deliver(w, session);
    assert.equal(emails.length, 2);
  });

  test("a bad id, another site's session and a cross-site call are refused", async () => {
    const w = worker();
    assert.equal((await confirm(w, "nope")).status, 404);
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    session.metadata["site"] = "another-site";
    assert.equal((await confirm(w, session.id)).status, 404);
    const cross = await w.fetch(new Request(`${ORIGIN}/api/booking/confirm?session_id=${session.id}`, { headers: { "sec-fetch-site": "cross-site" } }), env());
    assert.equal(cross.status, 403);
  });
});

describe("previews and development", () => {
  const previewEnv = () => env({ SITE_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY });

  test("a preview writes holds and bookings to the test calendar only, emails only the site's address, and the preview tab", async () => {
    const w = worker();
    calendar.events.set(`${REAL_CAL}/ownerevent1`, { id: "ownerevent1", calendar: REAL_CAL, start: local("2026-12-03", "09:00"), end: local("2026-12-03", "10:00"), transparent: false, status: "confirmed", summary: "Real owner event", props: {}, description: "", createdAt: 0 });
    const real = calendar.of(REAL_CAL).length;
    // Busy time from the real calendar still hides times in a preview.
    const shown = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-03", days: 1, chosen: "" }, previewEnv());
    assert.ok(shown.body.ok && !shown.body.days[0]?.times.some((time) => time.label === "9:00 AM"));

    const paid = await w.fetch(checkoutRequest(baseBody([FIRST(), SECOND()])), previewEnv());
    assert.equal(paid.status, 200);
    assert.equal(holdsIn(TEST_CAL).length, 2);
    assert.equal(calendar.of(REAL_CAL).length, real, "the real calendar is untouched");
    assert.equal(sessions[0]?.metadata["site_mode"], "preview");
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", session.id), previewEnv())).status, 200);
    assert.equal(bookingsIn(TEST_CAL).length, 2);
    assert.equal(calendar.of(REAL_CAL).length, real);
    assert.ok(emails.length >= 2 && emails.every((email) => email.to === "hello@example.test"), emails.map((email) => email.to).join());
    assert.ok(emailsOf("buyer")[0]?.subject.startsWith(`[Preview → would go to ${EMAIL}] `));
    assert.ok(emailsOf("owner")[0]?.subject.startsWith("[Preview] "));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tab, "Bookings preview");
    // The test calendar's bookings hide the same time in the next preview request.
    resetBusyCache();
    const after = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" }, previewEnv());
    assert.ok(after.body.ok && !after.body.days[0]?.times.some((time) => time.label === "9:00 AM"));
  });

  test("a preview with no test calendar shows times but refuses to book", async () => {
    const noTest = { ...BASE, booking: { calendarId: REAL_CAL, busyCalendarIds: [BUSY_CAL], previewCalendarId: null } };
    const w = worker(noTest);
    const shown = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" }, previewEnv());
    assert.equal(shown.status, 200);
    const refused = await w.fetch(checkoutRequest(baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } })), previewEnv());
    assert.equal(refused.status, 502);
    assert.deepEqual(await refused.json(), { ok: false, error: "preview_calendar_missing" });
    assert.equal(calendar.count("insert"), 0);
    assert.equal(stripeCalls.length, 0);
  });

  test("development: a dry run that calls nothing outside (Turnstile's test keys aside)", async () => {
    const w = worker();
    const dev = env({ SITE_ENV: "development" });
    const request = (body: unknown) => new Request("http://localhost:8787/api/booking/checkout", { method: "POST", headers: { origin: "http://localhost:8787", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
    const free = await w.fetch(request(baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } })), dev);
    const freeBody = (await free.json()) as CheckoutAnswer;
    assert.ok(freeBody.ok && freeBody.kind === "booked" && freeBody.summary.reference === "dev");
    const paid = await w.fetch(request(baseBody([FIRST(), SECOND()])), dev);
    const paidBody = (await paid.json()) as CheckoutAnswer;
    assert.ok(paidBody.ok && paidBody.kind === "checkout" && /^[0-9a-f]{32}$/.test(paidBody.releaseToken));
    assert.deepEqual({ ...paidBody, releaseToken: "x" }, { ok: true, kind: "checkout", url: "http://localhost:8787/book?checkout=cancelled", sessionId: "dev", dueNow: 112.5, currency: "USD", releaseToken: "x" });
    assert.equal(calendar.log.length, 0);
    assert.deepEqual(stripeCalls, []);
    assert.equal(emails.length, 0);
  });
});

describe("booking off", () => {
  test("with booking null every booking route is 404, the webhook ignores a booking session, and the form route is 404", async () => {
    const off = { ...BASE, booking: null };
    const w = worker(off);
    for (const [method, path] of [["GET", "/api/booking/times?service=consult"], ["POST", "/api/booking/checkout"], ["POST", "/api/booking/release"], ["GET", "/api/booking/confirm?session_id=cs_test_1"]] as const) {
      const response = await w.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }), env());
      assert.equal(response.status, 404, path);
    }
    // A paid booking session that reaches this site's webhook is never a silent 200: no booking and no row, but the owner is told once.
    const started = worker();
    await checkout(started, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    const response = await deliver(w, session);
    assert.equal(response.status, 200);
    assert.equal(emails.length, 1);
    assert.equal(kindOf(emails[0] as Email), "unhandled");
    assert.equal(rows.length, 0);
    assert.equal(bookingsIn(REAL_CAL).length, 0);
    assert.equal(holdsIn(REAL_CAL).length, 2, "a site with booking off never touches the calendar");
    const expired = await deliver(w, session, "checkout.session.expired");
    assert.equal(expired.status, 200);
  });

  test("the booking form id is never a generic form", async () => {
    const w = worker();
    const response = await w.fetch(new Request(`${ORIGIN}/api/forms/booking`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: "{}" }), env());
    assert.equal(response.status, 404);
  });
});

describe("the cron", () => {
  const scheduled = (w: ReturnType<typeof worker>, environment: ContactEnv = env()) => w.scheduled?.({ scheduledTime: clock, cron: "*/15 * * * *", noRetry() {} } as ScheduledController, environment);

  test("deletes the holds of a closed checkout and repairs a paid one the webhook missed", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    await checkout(w, baseBody([local("2026-12-08", "09:00"), local("2026-12-10", "09:00")]));
    const [abandoned, paid] = sessions;
    assert.ok(abandoned && paid);
    assert.equal(holdsIn(REAL_CAL).length, 4);

    // Before the checkouts close nothing happens.
    await scheduled(w);
    assert.equal(holdsIn(REAL_CAL).length, 4);

    clock += 40 * MINUTE;
    abandoned.status = "expired";
    pay(paid, clock - 30 * MINUTE);
    await scheduled(w);
    assert.equal(holdsIn(REAL_CAL).filter((hold) => hold.props["hl_session"] === abandoned.id).length, 0);
    assert.equal(bookingsIn(REAL_CAL).length, 2, "the paid one was booked");
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
    await scheduled(w);
    assert.equal(emails.length, 2, "a second run changes nothing");
  });

  test("a closed checkout Stripe does not know is cleaned up, an open one is left; a preview or a site without booking or payments does nothing", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    clock += 40 * MINUTE;
    await scheduled(w);
    assert.equal(holdsIn(REAL_CAL).length, 2, "Stripe still calls it open, so it is left alone");
    sessions.length = 0;
    await scheduled(w, env({ SITE_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY }));
    assert.equal(holdsIn(REAL_CAL).length, 2, "a preview has no cron");
    await scheduled(worker({ ...BASE, payments: null }));
    assert.equal(holdsIn(REAL_CAL).length, 2);
    await scheduled(worker({ ...BASE, booking: null }));
    assert.equal(holdsIn(REAL_CAL).length, 2);
    await scheduled(w);
    assert.equal(holdsIn(REAL_CAL).length, 0, "Stripe has no such session");
    calendar.outage = true;
    await scheduled(w);
  });
});

describe("a gift card sale is untouched by the booking hook", () => {
  test("a webhook for a session that is not a booking goes the gift card way (nothing happens for an unknown kind)", async () => {
    const w = worker();
    sessions.push({
      id: "cs_test_other",
      pi: "pi_other",
      idempotencyKey: "other",
      unit_amount: 100,
      currency: "usd",
      amount_total: 100,
      status: "expired",
      payment_status: "unpaid",
      created: 1,
      chargeAt: null,
      expiresAt: null,
      paymentMethods: [],
      metadata: { kind: "gift_card", site: "example-site" },
      piMetadata: {},
    });
    const response = await deliver(w, sessions[0] as Session, "checkout.session.expired");
    assert.equal(response.status, 200);
    assert.equal(emails.length, 0);
  });
});

// ---- the fix wave ----

const FREE2: Service = { ...WORKSHOP, id: "free2", name: "Free workshop", price: null, payment: { kind: "free" } };
const free2Settings: BookingSettings = { ...SETTINGS, services: [FREE2] };
const free2Body = (starts: number[], overrides: Record<string, unknown> = {}) => baseBody(starts, { service: "free2", party: 2, ...overrides });

function capturingLock() {
  const inner = memoryLock(new LockCore(() => clock));
  const released: Claim[][] = [];
  const lock: SlotLock = {
    acquire: () => inner.acquire(),
    release: async (token, claims) => {
      released.push(claims);
      await inner.release(token, claims);
    },
  };
  return { lock, released };
}

describe("a clash is remembered on the event", () => {
  test("a clash whose second patch fails stays a clash on the retry: no confirmation, no ordinary owner note", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    calendar.events.set(`${BUSY_CAL}/ownerevent1`, { id: "ownerevent1", calendar: BUSY_CAL, start: SECOND() + 30 * MINUTE, end: SECOND() + 90 * MINUTE, transparent: false, status: "confirmed", summary: "Owner's own thing", props: {}, description: "", createdAt: 0 });
    pay(session);
    const realPatch = calendar.patchEvent.bind(calendar);
    let patches = 0;
    calendar.patchEvent = async (...args) => {
      patches += 1;
      return patches === 2 ? { ok: false, status: 500, code: null } : realPatch(...args);
    };
    assert.equal((await deliver(w, session)).status, 500);
    assert.equal(session.piMetadata["hl_calendar"], undefined);
    assert.equal(calendar.of(REAL_CAL).filter((event) => event.props["hl_check"] === "1").length, 1, "the first patch carried the marker");
    // The cause goes away before the retry; the marker alone must keep the answer a clash.
    calendar.events.delete(`${BUSY_CAL}/ownerevent1`);
    calendar.patchEvent = realPatch;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(session.piMetadata["hl_calendar"], "clash");
    assert.equal(emailsOf("buyer").length, 0, "no confirmation");
    assert.equal(emailsOf("owner").length, 0, "no ordinary owner note");
    assert.equal(emailsOf("alert").length, 1);
    const events = bookingsIn(REAL_CAL);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.summary.startsWith("CHECK:") && event.props["hl_check"] === "1" && !event.transparent));
  });

  test("a hold whose properties were forged to say booking, but is still transparent, is checked and patched opaque", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    const [first] = holdsIn(REAL_CAL).sort((a, b) => a.start - b.start);
    assert.ok(first);
    first.props["hl_kind"] = "booking";
    pay(session);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(session.piMetadata["hl_calendar"], "booked");
    const events = bookingsIn(REAL_CAL);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => !event.transparent && event.summary.startsWith("Workshop:")), "every event is opaque");
  });
});

describe("insert retries and rollback", () => {
  /** The first insert of each id lands but the caller sees the 409 its own retry got. */
  function landedThenDuplicate() {
    const real = calendar.insertEvent.bind(calendar);
    calendar.insertEvent = async (calendarId, event) => {
      const first = await real(calendarId, event);
      if (!first.ok) return first;
      return real(calendarId, event);
    };
  }

  test("a free booking whose first insert landed but answered 503, then 409 on the retry, still succeeds", async () => {
    landedThenDuplicate();
    const w = worker();
    const result = await checkout(w, baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(bookingsIn(REAL_CAL).length, 1);
  });

  test("a paid checkout with the same trouble on its holds succeeds", async () => {
    landedThenDuplicate();
    const w = worker();
    const result = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(holdsIn(REAL_CAL).length, 2);
  });

  test("a 409 for an event that is not this booking's stays a failure", async () => {
    const real = calendar.insertEvent.bind(calendar);
    calendar.insertEvent = async (calendarId, event) => {
      const stored = await real(calendarId, event);
      const found = calendar.events.get(`${calendarId}/${event.id}`);
      if (stored.ok && found) found.props["hl_ref"] = "BK-SOMEONEELSE";
      return real(calendarId, event);
    };
    const w = worker();
    const result = await checkout(w, baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.equal(result.status, 502);
  });

  test("a free booking whose second insert fails leaves no event behind, even one that landed before its error", async () => {
    const w = worker(BASE, free2Settings);
    const real = calendar.insertEvent.bind(calendar);
    let inserts = 0;
    calendar.insertEvent = async (calendarId, event) => {
      inserts += 1;
      const stored = await real(calendarId, event);
      return inserts === 2 ? { ok: false, status: 503, code: null } : stored;
    };
    const result = await checkout(w, free2Body([FIRST(), SECOND()]));
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { ok: false, error: "unavailable" });
    assert.equal(calendar.of(REAL_CAL).length, 0, "nothing left on the calendar");
    assert.equal(emails.length, 0);
  });

  test("a paid checkout whose second hold fails removes both holds and closes the payment page", async () => {
    const w = worker();
    const real = calendar.insertEvent.bind(calendar);
    let inserts = 0;
    calendar.insertEvent = async (calendarId, event) => {
      inserts += 1;
      const stored = await real(calendarId, event);
      return inserts === 2 ? { ok: false, status: 503, code: null } : stored;
    };
    const result = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.equal(result.status, 502);
    assert.equal(calendar.of(REAL_CAL).length, 0);
    assert.equal(sessions[0]?.status, "expired");
  });
});

describe("the times route", () => {
  const query = { service: "workshop", party: 3, index: 0, from: "2026-12-01", days: 2, chosen: "" };

  test("a cross-site request is refused; an Origin that is not ours is refused; a plain page GET is fine", async () => {
    const w = worker();
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString();
    const get = (headers: Record<string, string>) => w.fetch(new Request(`${ORIGIN}/api/booking/times?${params}`, { headers }), env());
    assert.equal((await get({ "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await get({ "sec-fetch-site": "same-site" })).status, 403);
    assert.equal((await get({ "sec-fetch-site": "same-origin", origin: "https://evil.test" })).status, 403);
    assert.equal((await get({ origin: "https://evil.test" })).status, 403);
    assert.equal((await get({ "sec-fetch-site": "same-origin" })).status, 200);
    assert.equal((await get({ "sec-fetch-site": "same-origin", origin: ORIGIN })).status, 200);
    assert.equal((await get({})).status, 200);
  });

  test("dates outside the window are not answered and make no Google call", async () => {
    const w = worker();
    const far = await times(w, { ...query, from: "2999-01-01" });
    assert.equal(far.status, 200);
    assert.ok(far.body.ok);
    if (far.body.ok) assert.deepEqual(far.body.days, []);
    assert.equal(calendar.log.length, 0, "no calendar call");
    // A range that starts before the window is clamped to it.
    const clamped = await times(w, { ...query, from: "2026-11-20", days: 14 });
    assert.ok(clamped.body.ok);
    if (clamped.body.ok) assert.equal(clamped.body.days[0]?.date, "2026-11-27");
    // Later sessions: only the rule's days around the first.
    const later = await times(w, { ...query, index: 1, chosen: FIRST(), from: "2026-12-20", days: 14 });
    assert.ok(later.body.ok);
    if (later.body.ok) assert.deepEqual(later.body.days, [], "ten days after the first is the last");
  });

  test("busy time is read per fixed 14-day bucket: different queries inside one bucket make one free/busy call", async () => {
    const w = worker();
    await times(w, query);
    await times(w, { ...query, from: "2026-12-02", party: 5 });
    await times(w, { ...query, service: "consult", party: 1, from: "2026-12-02", days: 1 });
    assert.equal(calendar.count("freebusy"), 1);
    assert.equal(calendar.count("list"), 1, "holds are read per bucket too");
    clock += 31_000;
    await times(w, query);
    assert.equal(calendar.count("freebusy"), 2);
  });

  test("the memory is capped at 64 buckets", async () => {
    const w = worker(BASE, { ...SETTINGS, hours: { ...HOURS, aheadDays: 3000 } });
    for (let week = 0; week < 40; week++) {
      const date = new Date(Date.UTC(2026, 10, 30 + week * 14));
      await times(w, { service: "consult", party: 1, index: 0, from: date.toISOString().slice(0, 10), days: 1, chosen: "" });
    }
    const weekQuery = (week: number) => {
      const date = new Date(Date.UTC(2026, 10, 30 + week * 14));
      return times(w, { service: "consult", party: 1, index: 0, from: date.toISOString().slice(0, 10), days: 1, chosen: "" });
    };
    for (let week = 40; week < 80; week++) await weekQuery(week);
    const before = calendar.count("freebusy");
    await weekQuery(79);
    assert.equal(calendar.count("freebusy"), before, "the newest bucket is still remembered");
    await weekQuery(0);
    assert.equal(calendar.count("freebusy"), before + 1, "the oldest was dropped to stay at 64");
  });
});

describe("the time zone of each session", () => {
  test("two sessions straddling the spring change each carry their own zone name everywhere", async () => {
    clock = local("2026-02-20", "12:00");
    const w = worker(BASE, free2Settings);
    const first = local("2026-03-06", "09:00");
    const second = local("2026-03-10", "09:00");
    const result = await checkout(w, free2Body([first, second]));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.ok(result.body.ok && result.body.kind === "booked");
    if (!result.body.ok || result.body.kind !== "booked") return;
    assert.equal(result.body.summary.sessions[0]?.label, "Friday, March 6, 2026, 9:00 AM (Central Standard Time)");
    assert.equal(result.body.summary.sessions[1]?.label, "Tuesday, March 10, 2026, 9:00 AM (Central Daylight Time)");
    assert.equal(result.body.summary.zoneName, "Central Standard Time", "the page heading keeps the first session's zone");
    const buyer = emailsOf("buyer")[0]?.text ?? "";
    assert.ok(buyer.includes("Friday, March 6, 2026, 9:00 AM (Central Standard Time)") && buyer.includes("Tuesday, March 10, 2026, 9:00 AM (Central Daylight Time)"), buyer);
    assert.ok(!buyer.includes("All times are"));
    const cell = rows[0]?.row[2] ?? "";
    assert.ok(cell.includes("(Central Standard Time)") && cell.includes("(Central Daylight Time)"), cell);
    const descriptions = bookingsIn(REAL_CAL).sort((a, b) => a.start - b.start).map((event) => event.description);
    assert.ok(descriptions[0]?.includes("9:00 AM (Central Standard Time)"));
    assert.ok(descriptions[1]?.includes("9:00 AM (Central Daylight Time)"));
  });
});

describe("what a visitor types never becomes markup in the calendar", () => {
  test("&, < and > are escaped in every visitor value of a booking's description", async () => {
    const w = worker();
    const result = await checkout(w, baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: "Ada <b>&</b>", email: EMAIL, phone: PHONE, notes: "<script>alert(1)</script> & more" } }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const [event] = bookingsIn(REAL_CAL);
    assert.ok(event);
    assert.ok(event.description.includes("Name: Ada &lt;b&gt;&amp;&lt;/b&gt;"), event.description);
    assert.ok(event.description.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more"));
    assert.ok(!event.description.includes("<"), "no raw angle bracket survives, whatever the tag or its case");
  });

  test("the same on a paid booking's patch", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()], { answers: { name: "Ada <i>", email: EMAIL, phone: PHONE, notes: "a & b" } }));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    await deliver(w, session);
    for (const event of bookingsIn(REAL_CAL)) {
      assert.ok(event.description.includes("Name: Ada &lt;i&gt;"), event.description);
      assert.ok(event.description.includes("a &amp; b"));
    }
  });
});

describe("a hold with an unreadable expiry", () => {
  test("is stale: its time is offered", async () => {
    const w = worker();
    const hold = { id: "hlbadexpiry", calendar: REAL_CAL, start: local("2026-12-01", "09:00"), end: local("2026-12-01", "11:00"), transparent: true, status: "confirmed", summary: "Hold", description: "", createdAt: 0 };
    calendar.events.set(`${REAL_CAL}/hlbadexpiry`, { ...hold, props: { hl_kind: "hold", hl_site: "example-site", hl_expires: "soon" } });
    const open = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" });
    assert.ok(open.body.ok && open.body.days[0]?.times.some((time) => time.label === "9:00 AM"));
    resetBusyCache();
    // A readable expiry still hides the time.
    calendar.events.set(`${REAL_CAL}/hlbadexpiry`, { ...hold, props: { hl_kind: "hold", hl_site: "example-site", hl_expires: String(Math.floor(clock / 1000) + 600) } });
    const closed = await times(w, { service: "consult", party: 1, index: 0, from: "2026-12-01", days: 1, chosen: "" });
    assert.ok(closed.body.ok && !closed.body.days[0]?.times.some((time) => time.label === "9:00 AM"));
  });
});

describe("the release token", () => {
  const post = (w: ReturnType<typeof worker>, body: unknown) =>
    w.fetch(new Request(`${ORIGIN}/api/booking/release`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) }), env());

  test("only the token handed out at checkout releases the holds; any other answers ok and does nothing", async () => {
    const w = worker();
    const started = await checkout(w, baseBody([FIRST(), SECOND()]));
    assert.ok(started.body.ok && started.body.kind === "checkout");
    const [session] = sessions;
    assert.ok(session && started.body.ok && started.body.kind === "checkout");
    const token = started.body.ok && started.body.kind === "checkout" ? started.body.releaseToken : "";
    assert.equal(token, session.metadata["rt"]);

    assert.equal((await post(w, { sessionId: session.id })).status, 400, "a token is required");
    assert.equal((await post(w, { sessionId: session.id, releaseToken: "short" })).status, 400);
    assert.equal((await post(w, { sessionId: session.id, releaseToken: token, extra: 1 })).status, 400, "unknown keys are refused");
    const wrong = await post(w, { sessionId: session.id, releaseToken: "f".repeat(32) });
    assert.equal(wrong.status, 200);
    assert.deepEqual(await wrong.json(), { ok: true });
    assert.equal(session.status, "open", "nothing was released");
    assert.equal(holdsIn(REAL_CAL).length, 2);
    assert.ok(logs.some((line) => line.includes("booking_release_refused")));

    const right = await post(w, { sessionId: session.id, releaseToken: token });
    assert.deepEqual(await right.json(), { ok: true });
    assert.equal(session.status, "expired");
    assert.equal(holdsIn(REAL_CAL).length, 0);
  });
});

describe("a missing rate limit binding", () => {
  const noLimit = (overrides: Partial<ContactEnv> = {}): ContactEnv => ({ ...env(overrides), CONTACT_RATE_LIMIT: undefined }) as ContactEnv;

  test("checkout and release answer 502 in production and in a preview; development carries on; confirm is unchanged", async () => {
    const w = worker();
    const free = baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } });
    for (const environment of [noLimit(), noLimit({ SITE_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY })]) {
      const response = await w.fetch(checkoutRequest(free), environment);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { ok: false, error: "failed" });
      const release = await w.fetch(new Request(`${ORIGIN}/api/booking/release`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ sessionId: "cs_test_x", releaseToken: "a".repeat(32) }) }), environment);
      assert.equal(release.status, 502);
    }
    assert.equal(calendar.count("insert"), 0);
    assert.ok(logs.some((line) => line.includes("rate_limit_binding_missing")));

    const confirm = await w.fetch(new Request(`${ORIGIN}/api/booking/confirm?session_id=cs_test_none`, { headers: { "sec-fetch-site": "same-origin" } }), noLimit());
    assert.equal(confirm.status, 404, "confirm still goes on to look the session up");

    const dev = await w.fetch(new Request("http://localhost:8787/api/booking/checkout", { method: "POST", headers: { origin: "http://localhost:8787", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(free) }), noLimit({ SITE_ENV: "development" }));
    assert.equal(dev.status, 200);
  });
});

describe("a paid booking that reaches a site that cannot take it", () => {
  test("the owner is told once, with the whole booking; the webhook asks for a retry until that email is sent", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    const off = worker({ ...BASE, booking: null });
    resendFails = () => true;
    assert.equal((await deliver(off, session)).status, 500, "the alert could not be sent");
    assert.equal(emails.length, 0);
    resendFails = () => false;
    assert.equal((await deliver(off, session)).status, 200);
    assert.equal(emails.length, 1);
    const [alert] = emails;
    assert.equal(alert?.key, `book-${session.pi}-unhandled`);
    assert.equal(alert?.to, "hello@example.test");
    assert.ok(alert?.subject.startsWith("ACTION NEEDED"));
    for (const piece of [NAME, EMAIL, PHONE, "Workshop", session.pi, session.metadata["ref"] ?? "?", "Amount paid: $112.50"]) assert.ok(alert?.text.includes(piece), `missing: ${piece}`);
    assert.equal(session.piMetadata["hl_alert"], "sent");
    assert.ok(logs.some((line) => line.includes("booking_unhandled")));
    assert.equal((await deliver(off, session)).status, 200);
    assert.equal(emails.length, 1, "told once");
    assert.equal(bookingsIn(REAL_CAL).length, 0, "the calendar is never touched");
    assert.equal(rows.length, 0);
  });

  test("a session of another site, an unpaid one and a page that closed are 200 and silent", async () => {
    const w = worker();
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    const off = worker({ ...BASE, booking: null });
    assert.equal((await deliver(off, session)).status, 200, "not paid");
    session.status = "expired";
    assert.equal((await deliver(off, session, "checkout.session.expired")).status, 200);
    session.status = "complete";
    session.payment_status = "paid";
    session.metadata["site"] = "another-site";
    assert.equal((await deliver(off, session)).status, 200);
    assert.equal(emails.length, 0);
  });
});

describe("lock use", () => {
  test("a release that throws never replaces the outcome", async () => {
    const inner = memoryLock(new LockCore(() => clock));
    const w = worker(BASE, SETTINGS, {
      lock: {
        acquire: () => inner.acquire(),
        release: async (token: string, claims: Claim[]) => {
          await inner.release(token, claims);
          throw new Error("boom");
        },
      },
    });
    const result = await checkout(w, baseBody([local("2026-12-02", "10:00")], { service: "consult", party: 1, answers: { name: NAME, email: EMAIL, phone: PHONE } }));
    assert.equal(result.status, 200);
    assert.ok(logs.some((line) => line.includes("booking_lock_release_failed")));
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    assert.equal((await deliver(w, session)).status, 200, "fulfilment is not turned into a failure either");
  });

  test("the claims of the events written so far reach release even when a later write fails", async () => {
    const { lock, released } = capturingLock();
    const w = worker(BASE, free2Settings, { lock });
    calendar.failInsertFrom = 2;
    const result = await checkout(w, free2Body([FIRST(), SECOND()]));
    assert.equal(result.status, 502);
    assert.equal(released.length, 1);
    assert.equal(released[0]?.length, 1, "the first session's claim was kept");
  });

  test("checkout out of time before an insert rolls back and answers 502 unavailable", async () => {
    const w = worker(BASE, free2Settings);
    const real = calendar.insertEvent.bind(calendar);
    calendar.insertEvent = async (...args) => {
      const stored = await real(...args);
      clock += 25_000;
      return stored;
    };
    const result = await checkout(w, free2Body([FIRST(), SECOND()]));
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { ok: false, error: "unavailable" });
    assert.equal(calendar.of(REAL_CAL).length, 0, "the first event was rolled back");
    assert.ok(logs.some((line) => line.includes("booking_lock_slow")));
  });

  test("fulfilment out of time before a patch is a failure the next delivery finishes; the claims were still released", async () => {
    const { lock, released } = capturingLock();
    const w = worker(BASE, SETTINGS, { lock });
    await checkout(w, baseBody([FIRST(), SECOND()]));
    const [session] = sessions;
    assert.ok(session);
    pay(session);
    released.length = 0;
    const realPatch = calendar.patchEvent.bind(calendar);
    let patches = 0;
    calendar.patchEvent = async (...args) => {
      patches += 1;
      const done = await realPatch(...args);
      if (patches === 1) clock += 25_000;
      return done;
    };
    assert.equal((await deliver(w, session)).status, 500);
    assert.equal(patches, 1, "no second patch after the time ran out");
    assert.equal(released[0]?.length, 1, "the patched event's claim was kept");
    calendar.patchEvent = realPatch;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(session.piMetadata["hl_calendar"], "booked");
  });
});

void HOUR;
void DAY;
