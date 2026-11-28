import assert from "node:assert/strict";
import { test } from "node:test";
import bookingFile from "../content/booking.json" with { type: "json" };
import { exampleBooking } from "./example.ts";
import { CALENDAR_OFF_MESSAGE, PAID_NEEDS_PAYMENTS_MESSAGE } from "./schema.ts";
import type { BookingSettings } from "./schema.ts";
import { findService, liveServices, validateBooking } from "./validate.ts";

const ON = { calendarOn: true, paymentsOn: true };
const OFF = { calendarOn: false, paymentsOn: false };
const copy = (): BookingSettings => structuredClone(exampleBooking);
/** Edits a copy through a loose view, so a test can break the file on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests write wrong shapes into a copy on purpose
type Loose = Record<string, any>;
const edit = (change: (data: Loose) => void): unknown => {
  const data = copy() as unknown as Loose;
  change(data);
  return data;
};
const problems = (data: unknown, options = ON) => validateBooking(data, options);
const has = (list: string[], text: string) => list.some((line) => line.includes(text));

test("the template file and the example are valid", () => {
  assert.deepEqual(validateBooking(bookingFile, OFF), []);
  assert.deepEqual(problems(exampleBooking), []);
});

test("not an object", () => {
  assert.equal(problems(null).length, 1);
  assert.equal(problems([]).length, 1);
  assert.match(problems("x")[0] ?? "", /src\/content\/booking\.json/);
});

test("unknown keys are refused with the accepted list; missing keys are named", () => {
  const list = problems(edit((d) => (d["colour"] = 1)));
  assert.ok(has(list, '"colour" is not a booking setting here. It accepts: taking, policy'));
  assert.ok(has(problems(edit((d) => delete d["policy"])), '"policy" is missing'));
  assert.ok(has(problems(edit((d) => (d["services"][0]["sparkle"] = true))), '"sparkle"'));
  assert.ok(has(problems(edit((d) => delete d["services"][0]["price"])), '"price" is missing'));
  assert.ok(has(problems(edit((d) => delete d["hours"]["closed"])), '"closed" is missing'));
});

test("texts need words, a length and plain text", () => {
  assert.ok(has(problems(edit((d) => (d["policy"] = "  "))), "the policy is empty"));
  assert.ok(has(problems(edit((d) => (d["policy"] = "x".repeat(601)))), "at most 600"));
  assert.ok(has(problems(edit((d) => (d["changeWording"] = "x".repeat(301)))), "at most 300"));
  assert.ok(has(problems(edit((d) => (d["giftCardLine"] = "<b>hi</b>"))), "HTML tag"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["name"] = 4))), "the name must be text"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["description"] = "x".repeat(301)))), "at most 300"));
  assert.equal(problems(edit((d) => (d["policy"] = "[[Write the policy]] and **bold**"))).length, 0);
});

test("taking needs the calendar; paid services need payments (once)", () => {
  assert.deepEqual(problems(exampleBooking, { calendarOn: false, paymentsOn: true }), [CALENDAR_OFF_MESSAGE]);
  assert.deepEqual(problems(exampleBooking, { calendarOn: true, paymentsOn: false }), [PAID_NEEDS_PAYMENTS_MESSAGE]);
  const both = problems(exampleBooking, OFF);
  assert.deepEqual(both, [CALENDAR_OFF_MESSAGE, PAID_NEEDS_PAYMENTS_MESSAGE]);
  const twoPaid = edit((d) => d["services"].push({ ...d["services"][1], id: "second-paid", payment: { kind: "full" } }));
  assert.equal(problems(twoPaid, { calendarOn: true, paymentsOn: false }).filter((line) => line === PAID_NEEDS_PAYMENTS_MESSAGE).length, 1);
});

test("a free service passes without payments; an archived paid one is not refused", () => {
  const free = edit((d) => (d["services"] = [d["services"][0]]));
  assert.deepEqual(problems(free, { calendarOn: true, paymentsOn: false }), []);
  const archived = edit((d) => (d["services"][1]["status"] = "archived"));
  assert.deepEqual(problems(archived, { calendarOn: true, paymentsOn: false }), []);
  const turnedOff = edit((d) => (d["taking"] = false));
  assert.deepEqual(problems(turnedOff, OFF).filter((line) => line === CALENDAR_OFF_MESSAGE), []);
});

test("archived services are still checked for shape", () => {
  const broken = edit((d) => {
    d["services"][1]["status"] = "archived";
    d["services"][1]["party"] = { min: 5, max: 2 };
  });
  assert.ok(has(problems(broken), "smallest party (5) is more than the largest (2)"));
});

test("taking needs a live service", () => {
  const none = edit((d) => d["services"].forEach((service: Record<string, unknown>) => (service["status"] = "archived")));
  assert.ok(has(problems(none), "no service is live"));
  assert.ok(!has(problems(edit((d) => { d["taking"] = false; d["services"] = []; })), "no service is live"));
});

test("service ids are slugs, unique, and the list is capped", () => {
  assert.ok(has(problems(edit((d) => (d["services"][0]["id"] = "Not A Slug"))), "lowercase letters"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["id"] = "consultation"))), 'used twice'));
  const many = edit((d) => (d["services"] = Array.from({ length: 21 }, (_, i) => ({ ...d["services"][0], id: `s-${i}` }))));
  assert.ok(has(problems(many), "21 services"));
  assert.ok(has(problems(edit((d) => (d["services"] = "x"))), "list of services"));
  assert.ok(has(problems(edit((d) => (d["services"][0] = 5))), "service 1 must have"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["status"] = "paused"))), '"live" or "archived"'));
});

test("sessions: count, length, grid", () => {
  assert.ok(has(problems(edit((d) => (d["services"][0]["sessions"] = []))), "1 to 6 sessions"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["sessions"] = Array.from({ length: 7 }, () => ({ minutes: 60 }))))), "1 to 6 sessions"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["sessions"][0]["minutes"] = 62))), "5-minute step"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["sessions"][0]["minutes"] = 10))), "from 15 to 720"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["sessions"][0]["minutes"] = 725))), "from 15 to 720"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["sessions"][0]["minutes"] = 60.5))), "whole number"));
  assert.deepEqual(problems(edit((d) => (d["services"][0]["sessions"][0]["minutes"] = 720))), []);
});

test("between: required with 2+ sessions, null with one, ordered and in range", () => {
  assert.ok(has(problems(edit((d) => (d["services"][1]["between"] = null))), "needs \"between\""));
  assert.ok(has(problems(edit((d) => (d["services"][0]["between"] = { minDays: 1, maxDays: 2 }))), "has no \"between\""));
  assert.ok(has(problems(edit((d) => (d["services"][1]["between"] = { minDays: 5, maxDays: 2 }))), "fewest days between sessions (5) is more than the most (2)"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["between"] = { minDays: -1, maxDays: 2 }))), "0 to 365"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["between"] = { minDays: 1, maxDays: 366 }))), "0 to 365"));
  assert.deepEqual(problems(edit((d) => (d["services"][1]["between"] = { minDays: 0, maxDays: 365 }))), []);
});

test("party: whole numbers, ordered, within 50", () => {
  assert.ok(has(problems(edit((d) => (d["services"][0]["party"] = { min: 0, max: 1 }))), "from 1 to 50"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["party"] = { min: 1, max: 51 }))), "from 1 to 50"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["party"] = { min: 1.5, max: 2 }))), "from 1 to 50"));
  assert.ok(has(problems(edit((d) => (d["services"][0]["party"] = [1, 2]))), '"party" must be'));
});

test("price: null or a whole amount with who it is per", () => {
  assert.ok(has(problems(edit((d) => (d["services"][1]["price"] = { amount: 0, per: "person" }))), "from 1 to 100,000"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["price"] = { amount: 100001, per: "person" }))), "from 1 to 100,000"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["price"] = { amount: 10.5, per: "person" }))), "whole number"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["price"] = { amount: 10, per: "hour" }))), '"person" or "booking"'));
  assert.ok(has(problems(edit((d) => (d["services"][1]["price"] = "free"))), '"price" must be null'));
});

test("payment: a live service's percent deposit is at least 1.00 for the smallest party", () => {
  const small = (d: Loose, percent: number, price: { amount: number; per: string }, min = 1) => {
    d["services"][1]["price"] = price;
    d["services"][1]["party"] = { min, max: 6 };
    d["services"][1]["payment"] = { kind: "deposit", percent };
    d["services"][1]["status"] = "live";
  };
  assert.ok(has(problems(edit((d) => small(d, 1, { amount: 50, per: "booking" }))), "under 1.00 in the site's currency"));
  assert.ok(has(problems(edit((d) => small(d, 1, { amount: 50, per: "person" }))), "Raise the percent or the price"));
  assert.deepEqual(problems(edit((d) => small(d, 1, { amount: 50, per: "person" }, 2))), [], "two people at 50 is exactly 1.00");
  assert.deepEqual(problems(edit((d) => small(d, 2, { amount: 50, per: "booking" }))), []);
  assert.deepEqual(problems(edit((d) => { small(d, 1, { amount: 50, per: "booking" }); d["services"][1]["status"] = "archived"; })), [], "an archived service is not judged");
});

test("payment: full and deposit need a price, a deposit stays under it", () => {
  assert.ok(has(problems(edit((d) => (d["services"][1]["price"] = null))), "needs a price"));
  assert.ok(has(problems(edit((d) => { d["services"][0]["payment"] = { kind: "full" }; })), "full payment needs a price"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", amount: 900 }))), "less than the price (900)"));
  assert.deepEqual(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", amount: 899 }))), []);
  assert.ok(has(problems(edit((d) => { d["services"][1]["price"] = { amount: 150, per: "booking" }; d["services"][1]["payment"] = { kind: "deposit", amount: 150 }; })), "less than the price (150)"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", amount: 0 }))), "at least 1"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", amount: 10.5 }))), "whole number"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", percent: 100 }))), "from 1 to 99"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", percent: 0 }))), "from 1 to 99"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", percent: 25.5 }))), "from 1 to 99"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit", percent: 20, amount: 10 }))), "not both and not neither"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "deposit" }))), "not both and not neither"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "cash" }))), '"free", "full" or "deposit"'));
  assert.ok(has(problems(edit((d) => (d["services"][1]["payment"] = { kind: "full", amount: 3 }))), '"amount" is not a booking setting'));
  assert.deepEqual(problems(edit((d) => (d["services"][1]["payment"] = { kind: "free" }))), []);
});

test("weekly hours: seven days, windows in order on a 5-minute grid", () => {
  assert.ok(has(problems(edit((d) => delete d["hours"]["weekly"]["sun"])), "sun is missing"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["funday"] = []))), '"funday" is not a day'));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = "09:00"))), "must be a list of opening times"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["9:00", "17:00"]]))), "opening and a closing time"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["09:00", "17:03"]]))), "5-minute step"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["17:00", "09:00"]]))), "must close after it opens"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["09:00", "09:00"]]))), "must close after it opens"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["13:00", "17:00"], ["09:00", "12:00"]]))), "in order, without overlap"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["09:00", "13:00"], ["12:00", "17:00"]]))), "in order, without overlap"));
  assert.ok(has(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["01:00", "02:00"], ["03:00", "04:00"], ["05:00", "06:00"], ["07:00", "08:00"], ["09:00", "10:00"]]))), "at most 4"));
  assert.deepEqual(problems(edit((d) => (d["hours"]["weekly"]["mon"] = [["09:00", "12:00"], ["12:00", "17:00"]]))), []);
});

test("starts: every N minutes or a list of times", () => {
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { every: 7 }))), "5-minute step"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { every: 245 }))), "from 5 to 240"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { every: 5, at: ["09:00"] }))), "exactly one of"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = {}))), "exactly one of"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { at: [] }))), "1 to 24 start times"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { at: Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, "0")}:00`) }))), "1 to 24 start times"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { at: ["10:00", "09:00"] }))), "in order, each once"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { at: ["09:00", "09:00"] }))), "in order, each once"));
  assert.ok(has(problems(edit((d) => (d["hours"]["starts"] = { at: ["09:03"] }))), "5-minute step"));
  assert.deepEqual(problems(edit((d) => (d["hours"]["starts"] = { at: ["09:00", "13:30"] }))), []);
});

test("buffer, notice, ahead and closed dates have limits", () => {
  assert.ok(has(problems(edit((d) => (d["hours"]["bufferMinutes"] = 241))), "0 to 240"));
  assert.ok(has(problems(edit((d) => (d["hours"]["bufferMinutes"] = -5))), "0 to 240"));
  assert.ok(has(problems(edit((d) => (d["hours"]["noticeHours"] = 2161))), "0 to 2160"));
  assert.ok(has(problems(edit((d) => (d["hours"]["noticeHours"] = 1.5))), "0 to 2160"));
  assert.ok(has(problems(edit((d) => (d["hours"]["aheadDays"] = 0))), "1 to 365"));
  assert.ok(has(problems(edit((d) => (d["hours"]["aheadDays"] = 366))), "1 to 365"));
  assert.ok(has(problems(edit((d) => (d["hours"]["closed"] = [{ from: "2026-02-30", to: "2026-03-01" }]))), "real dates"));
  assert.ok(has(problems(edit((d) => (d["hours"]["closed"] = [{ from: "2026-12-24", to: "2026-12-01" }]))), "must not be after"));
  assert.ok(has(problems(edit((d) => (d["hours"]["closed"] = [{ from: "2026-12-24" }]))), "real dates"));
  assert.ok(has(problems(edit((d) => (d["hours"]["closed"] = Array.from({ length: 51 }, () => ({ from: "2026-12-24", to: "2026-12-25" }))))), "at most 50"));
  assert.ok(has(problems(edit((d) => (d["hours"]["closed"] = "never"))), "list of closed dates"));
  assert.deepEqual(problems(edit((d) => (d["hours"]["closed"] = [{ from: "2026-12-24", to: "2026-12-24" }]))), []);
});

test("a service's own hours may hold any subset, each judged the same way", () => {
  assert.deepEqual(problems(edit((d) => (d["services"][1]["hours"] = { noticeHours: 336 }))), []);
  assert.deepEqual(problems(edit((d) => (d["services"][1]["hours"] = {}))), []);
  assert.ok(has(problems(edit((d) => (d["services"][1]["hours"] = { noticeHours: 9999 }))), "its own hours"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["hours"] = { weekly: { mon: [] } }))), "tue is missing"));
  assert.ok(has(problems(edit((d) => (d["services"][1]["hours"] = { colour: 1 }))), '"colour"'));
  assert.ok(has(problems(edit((d) => (d["services"][1]["hours"] = [])), ON), '"hours" must hold'));
});

test("liveServices and findService see live services only", () => {
  const settings = copy();
  (settings.services[1] as { status: string }).status = "archived";
  assert.deepEqual(liveServices(settings).map((service) => service.id), ["consultation"]);
  assert.equal(findService(settings, "consultation")?.name, "Consultation");
  assert.equal(findService(settings, "workshop"), null);
  assert.equal(findService(settings, "missing"), null);
});
