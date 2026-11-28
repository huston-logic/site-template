// The owner's everyday requests, as edits of a valid settings file: the file stays valid and the times change as asked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleBooking } from "./example.ts";
import { bookingPrice } from "./price.ts";
import type { BookingSettings, Service } from "./schema.ts";
import { openDays } from "./slots.ts";
import { validateBooking } from "./validate.ts";
import { localParts, zonedToUtc } from "./zone.ts";

const TZ = "America/Chicago";
const ON = { calendarOn: true, paymentsOn: true };
const NOW = zonedToUtc("2026-11-27", "12:00", TZ) as number;

const edited = (change: (settings: BookingSettings) => void): BookingSettings => {
  const settings = structuredClone(exampleBooking);
  change(settings);
  return settings;
};
const service = (settings: BookingSettings, id: string) => settings.services.find((candidate) => candidate.id === id) as Service;
const firstSessionDays = (settings: BookingSettings, id: string, days = 90) =>
  openDays({ settings, service: service(settings, id), index: 0, chosen: [], busy: [], now: NOW, from: "2026-11-27", days, tz: TZ });
const allStarts = (settings: BookingSettings, id: string, days?: number) => firstSessionDays(settings, id, days).flatMap((entry) => entry.starts);

test("workshops need 14 days' notice", () => {
  const settings = edited((s) => {
    service(s, "workshop").hours = { noticeHours: 336 };
  });
  assert.deepEqual(validateBooking(settings, ON), []);
  const earliest = Math.min(...allStarts(settings, "workshop"));
  assert.equal(earliest, zonedToUtc("2026-12-11", "12:00", TZ));
  assert.ok(earliest >= NOW + 336 * 3_600_000);
  const before = firstSessionDays(settings, "workshop").filter((entry) => entry.date < "2026-12-11");
  assert.ok(before.every((entry) => entry.starts.length === 0));
  const consultationFirst = Math.min(...allStarts(settings, "consultation"));
  assert.equal(localParts(consultationFirst, TZ).date, "2026-11-30");
});

test("close December 24 to January 2", () => {
  const settings = edited((s) => {
    s.hours.closed = [{ from: "2026-12-24", to: "2027-01-02" }];
  });
  assert.deepEqual(validateBooking(settings, ON), []);
  for (const id of ["consultation", "workshop"]) {
    const days = firstSessionDays(settings, id);
    for (const entry of days) {
      if (entry.date >= "2026-12-24" && entry.date <= "2027-01-02") assert.deepEqual(entry.starts, [], `${id} ${entry.date}`);
    }
    assert.ok(days.find((entry) => entry.date === "2026-12-23")?.starts.length);
    assert.ok(days.find((entry) => entry.date === "2027-01-04")?.starts.length);
  }
  // The second workshop session skips the closed days too.
  const chosen = [zonedToUtc("2026-12-22", "09:00", TZ) as number];
  const second = openDays({ settings, service: service(settings, "workshop"), index: 1, chosen, busy: [], now: NOW, from: "2026-12-23", days: 14, tz: TZ });
  assert.ok(second.filter((entry) => entry.date >= "2026-12-24").every((entry) => entry.starts.length === 0));
});

test("add a free one-hour consultation, weekdays 10 to 4", () => {
  const settings = edited((s) => {
    const window: [string, string][] = [["10:00", "16:00"]];
    s.services.push({
      id: "quick-chat",
      name: "Quick chat",
      description: "A free one-hour chat.",
      status: "live",
      sessions: [{ minutes: 60 }],
      between: null,
      party: { min: 1, max: 1 },
      price: null,
      payment: { kind: "free" },
      hours: { weekly: { mon: window, tue: window, wed: window, thu: window, fri: window, sat: [], sun: [] } },
    });
  });
  assert.deepEqual(validateBooking(settings, { calendarOn: true, paymentsOn: false }).filter((line) => !line.includes("payments")), []);
  const monday = firstSessionDays(settings, "quick-chat").find((entry) => entry.date === "2026-11-30");
  const times = (monday?.starts ?? []).map((start) => localParts(start, TZ).time);
  assert.equal(times[0], "10:00");
  assert.equal(times[times.length - 1], "15:00");
  assert.equal(firstSessionDays(settings, "quick-chat").find((entry) => entry.date === "2026-12-05")?.starts.length, 0);
});

test("take a $100 deposit instead of full payment", () => {
  const settings = edited((s) => {
    const workshop = service(s, "workshop");
    workshop.price = { amount: 150, per: "person" };
    workshop.payment = { kind: "full" };
  });
  assert.equal(bookingPrice(service(settings, "workshop"), 2)?.dueNowMinor, 30000);
  service(settings, "workshop").payment = { kind: "deposit", amount: 100 };
  assert.deepEqual(validateBooking(settings, ON), []);
  assert.deepEqual(bookingPrice(service(settings, "workshop"), 2), { totalMinor: 30000, dueNowMinor: 10000, dueLaterMinor: 20000, perPerson: true });
});

test("the second session must be 2 to 10 days after the first", () => {
  const settings = edited((s) => {
    service(s, "workshop").between = { minDays: 1, maxDays: 3 };
  });
  service(settings, "workshop").between = { minDays: 2, maxDays: 10 };
  assert.deepEqual(validateBooking(settings, ON), []);
  const chosen = [zonedToUtc("2026-11-30", "09:00", TZ) as number];
  const days = openDays({ settings, service: service(settings, "workshop"), index: 1, chosen, busy: [], now: NOW, from: "2026-11-27", days: 30, tz: TZ });
  assert.deepEqual([days[0]?.date, days[days.length - 1]?.date], ["2026-12-02", "2026-12-10"]);
});
