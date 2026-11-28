// Tests for the booking part of scripts/config-rules.mjs: the Google key, the lock binding, its migration, the cron and the
// checks on `booking` in site.config.ts. Fixture configs only.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { configProblems, secretsFor, wranglerText } from "./config-rules.mjs";

function config() {
  return {
    domain: { workerName: "example-site" },
    business: { timeZone: "America/Chicago" },
    contact: { destination: "sheet", pipelineUrl: null, sheetWriter: "apps-script", rateLimitIds: { production: "2001", preview: "2002" }, rateLimit: { limit: 5, periodSeconds: 60 } },
  };
}

const calendar = { calendarId: "bookings@calendar.example.test", busyCalendarIds: [], previewCalendarId: "preview@calendar.example.test" };
const parse = (text) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));

describe("secretsFor: booking", () => {
  const sheet = { destination: "sheet", sheetWriter: "apps-script" };

  test("booking set appends the Google service-account key", () => {
    assert.deepEqual(secretsFor(sheet, null, calendar), ["RESEND_API_KEY", "TURNSTILE_SECRET_KEY", "SHEET_WEBHOOK_URL", "SHEET_WEBHOOK_SECRET", "GOOGLE_SERVICE_ACCOUNT_KEY"]);
    assert.equal(secretsFor(sheet, { provider: "stripe", currency: "usd" }, calendar).at(-1), "GOOGLE_SERVICE_ACCOUNT_KEY");
  });
  test("the key is listed once when the Sheet writer already needs it", () => {
    const names = secretsFor({ destination: "sheet", sheetWriter: "service-account" }, null, calendar);
    assert.equal(names.filter((name) => name === "GOOGLE_SERVICE_ACCOUNT_KEY").length, 1);
  });
  test("booking null or missing adds nothing", () => {
    for (const booking of [null, undefined]) assert.ok(!secretsFor(sheet, null, booking).includes("GOOGLE_SERVICE_ACCOUNT_KEY"));
  });
});

describe("wranglerText: booking", () => {
  test("booking set adds the lock binding, its migration and the 15-minute cron, each with a comment", () => {
    const text = wranglerText({ ...config(), booking: calendar });
    const parsed = parse(text);
    assert.deepEqual(parsed.durable_objects, { bindings: [{ name: "BOOKING_LOCK", class_name: "BookingLock" }] });
    assert.deepEqual(parsed.migrations, [{ tag: "booking-lock-v1", new_sqlite_classes: ["BookingLock"] }]);
    assert.deepEqual(parsed.triggers, { crons: ["*/15 * * * *"] });
    assert.deepEqual(parsed.previews.durable_objects, parsed.durable_objects);
    assert.ok(parsed.secrets.required.includes("GOOGLE_SERVICE_ACCOUNT_KEY"));
    for (const key of ['"durable_objects"', '"migrations"', '"triggers"']) {
      const before = text.slice(0, text.indexOf(key));
      assert.match(before.trimEnd().split("\n").at(-1), /^\s*\/\/ /, key);
    }
    assert.match(text, /cannot be removed without a delete migration/);
  });
  test("booking null generates the same text as no booking setting", () => {
    assert.equal(wranglerText({ ...config(), booking: null }), wranglerText(config()));
    assert.doesNotMatch(wranglerText({ ...config(), booking: null }), /BOOKING_LOCK|migrations|crons|GOOGLE_SERVICE/);
  });
  test("booking with payments still makes valid JSON with one Images binding", () => {
    const text = wranglerText({ ...config(), payments: { provider: "stripe", currency: "usd" }, booking: calendar });
    assert.ok(parse(text));
    assert.equal(text.match(/"images"/g).length, 1);
  });
});

describe("configProblems: booking", () => {
  const good = { calendarId: "bookings@calendar.example.test", busyCalendarIds: ["busy@calendar.example.test"], previewCalendarId: "preview@calendar.example.test" };
  const withBooking = (booking) => ({ ...config(), booking });

  test("null, missing and a good booking have no problems; the preview calendar may be null", () => {
    assert.deepEqual(configProblems(withBooking(null)), []);
    assert.deepEqual(configProblems(config()), []);
    assert.deepEqual(configProblems(withBooking(good)), []);
    assert.deepEqual(configProblems(withBooking({ ...good, busyCalendarIds: [], previewCalendarId: null })), []);
  });
  test("calendarId must be text without spaces, at most 254 characters", () => {
    assert.match(configProblems(withBooking({ ...good, calendarId: "" }))[0], /booking\.calendarId must be a calendar id/);
    assert.match(configProblems(withBooking({ ...good, calendarId: "my calendar" }))[0], /booking\.calendarId must not contain spaces/);
    assert.match(configProblems(withBooking({ ...good, calendarId: "a".repeat(255) }))[0], /at most 254 characters/);
    assert.deepEqual(configProblems(withBooking({ ...good, calendarId: "a".repeat(254) })), []);
    assert.match(configProblems(withBooking({ ...good, calendarId: 5 }))[0], /booking\.calendarId/);
  });
  test("busyCalendarIds is a list of at most 10 other calendars", () => {
    assert.match(configProblems(withBooking({ ...good, busyCalendarIds: "x" }))[0], /busyCalendarIds must be a list/);
    const eleven = Array.from({ length: 11 }, (_, i) => `busy${i}@calendar.example.test`);
    assert.match(configProblems(withBooking({ ...good, busyCalendarIds: eleven }))[0], /lists 11 calendars; at most 10/);
    assert.match(configProblems(withBooking({ ...good, busyCalendarIds: [good.calendarId] }))[0], /is the booking calendar itself/);
    assert.match(configProblems(withBooking({ ...good, busyCalendarIds: ["has space"] }))[0], /busyCalendarIds\[0\] must not contain spaces/);
  });
  test("the preview calendar must differ from the real one, so a preview never writes to it", () => {
    assert.match(configProblems(withBooking({ ...good, previewCalendarId: good.calendarId }))[0], /previewCalendarId is the same as calendarId/);
    assert.match(configProblems(withBooking({ ...good, previewCalendarId: "has space" }))[0], /previewCalendarId must not contain spaces/);
    assert.match(configProblems(withBooking({ calendarId: good.calendarId, busyCalendarIds: [] }))[0], /previewCalendarId is missing/);
  });
  test("booking needs the business's own time zone: a real zone name, not UTC, not missing", () => {
    const zoned = (timeZone) => ({ ...withBooking(good), business: timeZone === undefined ? {} : { timeZone } });
    assert.deepEqual(configProblems(zoned("America/Chicago")), []);
    for (const bad of ["UTC", "utc", "", "Mars/Olympus", 5, undefined]) assert.match(configProblems(zoned(bad))[0], /Booking needs the business's own time zone, like "America\/Chicago"/, String(bad));
    assert.deepEqual(configProblems({ ...config(), business: { timeZone: "UTC" } }), [], "booking off: any zone is fine");
  });
  test("an unknown key or a non-object is refused", () => {
    assert.match(configProblems(withBooking({ ...good, color: "red" }))[0], /booking\.color is not a booking setting/);
    assert.match(configProblems(withBooking("cal"))[0], /booking must be null or/);
    assert.match(configProblems(withBooking([]))[0], /booking must be null or/);
  });
});
