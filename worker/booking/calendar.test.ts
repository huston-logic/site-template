import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resetGoogleTokenCache } from "../google-auth.ts";
import { googleCalendar, newEventId } from "./calendar.ts";
import type { NewEvent } from "./calendar.ts";

const realFetch = globalThis.fetch;
const realLog = console.log;
const CAL = "owner-secret-calendar@group.calendar.google.com";
const DAY = 86_400_000;
const FROM = Date.parse("2026-12-01T00:00:00Z");

type Call = { method: string; url: URL; body: Record<string, unknown> | null; auth: string };
let calls: Call[] = [];
let logs: string[] = [];
let tokenCount = 0;
let respond: (call: Call) => Response = () => Response.json({});
let client = googleCalendar(undefined);

const toPem = (der: ArrayBuffer): string => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
const apiCalls = () => calls.filter((call) => call.url.host === "www.googleapis.com");

beforeEach(async () => {
  calls = [];
  logs = [];
  tokenCount = 0;
  respond = () => Response.json({});
  resetGoogleTokenCache();
  console.log = (line: unknown) => {
    logs.push(String(line));
  };
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const key = JSON.stringify({ client_email: "writer@test.iam.gserviceaccount.com", private_key: toPem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer) });
  client = googleCalendar(key);
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host === "oauth2.googleapis.com") {
      tokenCount += 1;
      return Response.json({ access_token: `token-${tokenCount}`, expires_in: 3600 });
    }
    const headers = new Headers(init.headers);
    const call: Call = { method: init.method ?? "GET", url, body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null, auth: headers.get("authorization") ?? "" };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

const busyAnswer = (call: Call, busy: Record<string, { start: string; end: string }[]>): Response => {
  const items = (call.body?.items ?? []) as { id: string }[];
  return Response.json({ calendars: Object.fromEntries(items.map((item) => [item.id, { busy: busy[item.id] ?? [] }])) });
};

test("freeBusy asks in 60-day pieces and merges every calendar into one sorted list", async () => {
  const to = FROM + 150 * DAY;
  respond = (call) => {
    const min = Date.parse(String(call.body?.timeMin));
    const first = new Date(min + DAY).toISOString();
    const second = new Date(min + DAY + 3_600_000).toISOString();
    return busyAnswer(call, { a: [{ start: second, end: new Date(min + 2 * DAY).toISOString() }], b: [{ start: first, end: second }] });
  };
  const result = await client.freeBusy(["a", "b"], FROM, to);
  assert.equal(apiCalls().length, 3);
  assert.deepEqual(apiCalls().map((call) => call.body?.timeMin), [FROM, FROM + 60 * DAY, FROM + 120 * DAY].map((ms) => new Date(ms).toISOString()));
  assert.equal(apiCalls()[2]?.body?.timeMax, new Date(to).toISOString());
  assert.ok(result.ok);
  assert.equal(result.value.length, 3, "touching spans from the two calendars join");
  assert.deepEqual(result.value.map((span) => span.start), [FROM + DAY, FROM + 61 * DAY, FROM + 121 * DAY]);
  assert.equal(result.value[0]?.end, FROM + 2 * DAY);
  assert.ok(apiCalls().every((call) => call.auth === "Bearer token-1" && call.url.pathname === "/calendar/v3/freeBusy"));
});

test("a calendar that answers with errors fails the whole call", async () => {
  respond = () => Response.json({ calendars: { a: { busy: [] }, b: { errors: [{ domain: "global", reason: "notFound" }], busy: [] } } });
  const result = await client.freeBusy(["a", "b"], FROM, FROM + DAY);
  assert.deepEqual(result, { ok: false, status: 200, code: "calendar_error" });
});

test("a calendar missing from the answer fails the call", async () => {
  respond = () => Response.json({ calendars: { a: { busy: [] } } });
  const result = await client.freeBusy(["a", "b"], FROM, FROM + DAY);
  assert.deepEqual(result, { ok: false, status: 200, code: "calendar_error" });
});

test("a failing piece fails the call", async () => {
  respond = (call) => (call.body?.timeMin === new Date(FROM + 60 * DAY).toISOString() ? new Response("{}", { status: 403 }) : busyAnswer(call, {}));
  const result = await client.freeBusy(["a"], FROM, FROM + 100 * DAY);
  assert.equal(result.ok, false);
});

test("listHolds filters on both private properties and follows the pages", async () => {
  const hold = (id: string, props: Record<string, string>) => ({
    id,
    status: "confirmed",
    summary: "Hold",
    transparency: "transparent",
    start: { dateTime: "2026-12-02T15:00:00-05:00" },
    end: { dateTime: "2026-12-02T16:00:00-05:00" },
    extendedProperties: { private: props },
  });
  respond = (call) =>
    call.url.searchParams.get("pageToken") === "p2"
      ? Response.json({ items: [hold("h2", { hl_kind: "hold" })] })
      : Response.json({ items: [hold("h1", { hl_kind: "hold", hl_site: "s" }), { id: "allday", start: { date: "2026-12-03" }, end: { date: "2026-12-04" } }], nextPageToken: "p2" });
  const result = await client.listHolds(CAL, FROM, FROM + 14 * DAY, "site-1");
  assert.equal(apiCalls().length, 2);
  const query = apiCalls()[0]?.url.searchParams;
  assert.deepEqual(query?.getAll("privateExtendedProperty"), ["hl_kind=hold", "hl_site=site-1"]);
  assert.equal(query?.get("singleEvents"), "true");
  assert.equal(query?.get("showDeleted"), "false");
  assert.equal(query?.get("maxResults"), "250");
  assert.equal(query?.get("timeMin"), new Date(FROM).toISOString());
  assert.equal(apiCalls()[0]?.url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CAL)}/events`);
  assert.ok(result.ok);
  assert.deepEqual(result.value.map((event) => event.id), ["h1", "h2"], "the all-day event is skipped");
  assert.equal(result.value[0]?.start, Date.parse("2026-12-02T20:00:00Z"));
  assert.equal(result.value[0]?.transparent, true);
  assert.equal(result.value[0]?.props.hl_site, "s");
});

test("listHolds fails rather than miss holds past ten pages", async () => {
  respond = () => Response.json({ items: [], nextPageToken: "more" });
  const result = await client.listHolds(CAL, FROM, FROM + DAY, "s");
  assert.equal(apiCalls().length, 10);
  assert.equal(result.ok, false);
});

const NEW: NewEvent = { id: "hl0123", start: FROM, end: FROM + 3_600_000, timeZone: "America/New_York", summary: "Hold", description: "d", transparent: true, props: { hl_kind: "hold" } };

test("insertEvent sends the id, times, transparency and private properties", async () => {
  respond = (call) => Response.json({ ...call.body, status: "confirmed" });
  const result = await client.insertEvent(CAL, NEW);
  const body = apiCalls()[0]?.body;
  assert.equal(body?.id, "hl0123");
  assert.deepEqual(body?.start, { dateTime: new Date(FROM).toISOString(), timeZone: "America/New_York" });
  assert.equal(body?.transparency, "transparent");
  assert.deepEqual(body?.extendedProperties, { private: { hl_kind: "hold" } });
  assert.ok(result.ok);
  assert.equal(result.value.start, FROM);
  assert.equal(result.value.props.hl_kind, "hold");
});

test("insertEvent reports a 409 as a duplicate and does not retry", async () => {
  respond = () => new Response(JSON.stringify({ error: { errors: [{ reason: "duplicate" }] } }), { status: 409 });
  const result = await client.insertEvent(CAL, NEW);
  assert.deepEqual(result, { ok: false, status: 409, code: "duplicate" });
  assert.equal(apiCalls().length, 1);
});

test("getEvent gives null for 404, 410 and a cancelled event", async () => {
  for (const status of [404, 410]) {
    respond = () => new Response("{}", { status });
    assert.deepEqual(await client.getEvent(CAL, "e1"), { ok: true, value: null });
  }
  respond = () => Response.json({ id: "e1", status: "cancelled", start: { dateTime: "2026-12-02T15:00:00Z" }, end: { dateTime: "2026-12-02T16:00:00Z" } });
  assert.deepEqual(await client.getEvent(CAL, "e1"), { ok: true, value: null });
});

test("getEvent reads an all-day event from its dates at UTC midnight", async () => {
  respond = () => Response.json({ id: "e1", start: { date: "2026-12-03" }, end: { date: "2026-12-04" } });
  const result = await client.getEvent(CAL, "e1");
  assert.ok(result.ok && result.value);
  assert.equal(result.value.start, Date.parse("2026-12-03T00:00:00Z"));
  assert.equal(result.value.end, Date.parse("2026-12-04T00:00:00Z"));
});

test("patchEvent sends only what changed", async () => {
  respond = () => Response.json({ id: "e1", start: { dateTime: "2026-12-02T15:00:00Z" }, end: { dateTime: "2026-12-02T16:00:00Z" }, transparency: "opaque", extendedProperties: { private: { hl_kind: "booking" } } });
  const result = await client.patchEvent(CAL, "e1", { transparent: false, props: { hl_kind: "booking" } });
  assert.equal(apiCalls()[0]?.method, "PATCH");
  assert.deepEqual(apiCalls()[0]?.body, { transparency: "opaque", extendedProperties: { private: { hl_kind: "booking" } } });
  assert.ok(result.ok);
  assert.equal(result.value.transparent, false);
});

test("deleteEvent treats 204, 404 and 410 as done", async () => {
  for (const status of [204, 404, 410]) {
    respond = () => new Response(null, { status });
    assert.deepEqual(await client.deleteEvent(CAL, "e1"), { ok: true, value: null });
  }
  respond = () => new Response("{}", { status: 403 });
  assert.equal((await client.deleteEvent(CAL, "e1")).ok, false);
});

test("one retry on a 503, then the answer", async () => {
  let n = 0;
  respond = () => (++n === 1 ? new Response("{}", { status: 503 }) : Response.json({ id: "e1", start: { dateTime: "2026-12-02T15:00:00Z" }, end: { dateTime: "2026-12-02T16:00:00Z" } }));
  const result = await client.getEvent(CAL, "e1");
  assert.ok(result.ok);
  assert.equal(apiCalls().length, 2);
});

test("two 503s in a row fail with the status", async () => {
  respond = () => new Response("{}", { status: 503 });
  const result = await client.getEvent(CAL, "e1");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? 0 : result.status, 503);
  assert.equal(apiCalls().length, 2);
});

test("a network failure is retried once, then reported as unreachable", async () => {
  respond = () => {
    throw new Error("network down");
  };
  const result = await client.deleteEvent(CAL, "e1");
  assert.deepEqual(result, { ok: false, status: 0, code: "unreachable" });
  assert.equal(apiCalls().length, 2);
});

test("a 401 gets a new token and one more try", async () => {
  respond = (call) => (call.auth === "Bearer token-1" ? new Response("{}", { status: 401 }) : Response.json({ id: "e1", start: { dateTime: "2026-12-02T15:00:00Z" }, end: { dateTime: "2026-12-02T16:00:00Z" } }));
  const result = await client.getEvent(CAL, "e1");
  assert.ok(result.ok);
  assert.deepEqual(apiCalls().map((call) => call.auth), ["Bearer token-1", "Bearer token-2"]);
  respond = () => new Response("{}", { status: 401 });
  assert.equal((await client.getEvent(CAL, "e1")).ok, false);
});

test("without a key every call fails with no_key", async () => {
  const keyless = googleCalendar(undefined);
  assert.deepEqual(await keyless.getEvent(CAL, "e1"), { ok: false, status: 0, code: "no_key" });
  assert.deepEqual(await googleCalendar("not json").freeBusy([CAL], FROM, FROM + DAY), { ok: false, status: 0, code: "no_key" });
  assert.equal(apiCalls().length, 0);
});

test("logs never hold a calendar id, an event id or a token", async () => {
  respond = () => new Response("{}", { status: 503 });
  await client.getEvent(CAL, "event-private-id");
  respond = () => {
    throw new Error("down");
  };
  await client.deleteEvent(CAL, "event-private-id");
  assert.ok(logs.length > 0);
  for (const line of logs) assert.ok(!/owner-secret|event-private|token-|Bearer/.test(line), line);
});

test("newEventId uses only Google's id alphabet and a fixed length", () => {
  const all = newEventId(() => Uint8Array.from({ length: 24 }, (_, i) => i * 11));
  assert.match(all, /^hl[0-9a-v]{24}$/);
  assert.match(newEventId(), /^hl[0-9a-v]{24}$/);
  assert.notEqual(newEventId(), newEventId());
  assert.equal(newEventId(() => new Uint8Array(24).fill(255)), `hl${"v".repeat(24)}`);
});
