import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, clockFromMinutes, clockMinutes, daysBetween, formatLocal, formatTime, isClockTime, isLocalDate, localParts, startOfLocalDay, weekdayOf, zonedToUtc, zoneName } from "./zone.ts";

const hourUtc = (ms: number | null) => (ms === null ? null : new Date(ms).getUTCHours());

// Standard-time offset hours (the UTC hour of 9:00 local in winter), and the daylight one.
const ZONES: [string, number, number][] = [
  ["America/Chicago", 15, 14],
  ["America/New_York", 14, 13],
  ["America/Denver", 16, 15],
  ["America/Los_Angeles", 17, 16],
];

test("9:00 local is the right UTC hour either side of both changes", () => {
  for (const [tz, standard, daylight] of ZONES) {
    assert.equal(hourUtc(zonedToUtc("2026-03-07", "09:00", tz)), standard, `${tz} 2026-03-07`);
    assert.equal(hourUtc(zonedToUtc("2026-03-09", "09:00", tz)), daylight, `${tz} 2026-03-09`);
    assert.equal(hourUtc(zonedToUtc("2026-10-31", "09:00", tz)), daylight, `${tz} 2026-10-31`);
    assert.equal(hourUtc(zonedToUtc("2026-11-02", "09:00", tz)), standard, `${tz} 2026-11-02`);
  }
});

test("Phoenix never shifts", () => {
  for (const date of ["2026-03-07", "2026-03-09", "2026-10-31", "2026-11-02"]) assert.equal(hourUtc(zonedToUtc(date, "09:00", "America/Phoenix")), 16);
});

test("a time in the spring-forward gap does not exist", () => {
  for (const [tz] of ZONES) {
    assert.equal(zonedToUtc("2026-03-08", "02:30", tz), null, tz);
    assert.equal(zonedToUtc("2026-03-08", "02:00", tz), null, tz);
    assert.notEqual(zonedToUtc("2026-03-08", "03:00", tz), null, tz);
    assert.notEqual(zonedToUtc("2026-03-08", "01:55", tz), null, tz);
  }
  assert.notEqual(zonedToUtc("2026-03-08", "02:30", "America/Phoenix"), null);
});

test("a time that happens twice is the first (daylight) instant", () => {
  const first: [string, number][] = [
    ["America/Chicago", 6],
    ["America/New_York", 5],
    ["America/Denver", 7],
    ["America/Los_Angeles", 8],
  ];
  for (const [tz, hour] of first) {
    const ms = zonedToUtc("2026-11-01", "01:30", tz);
    assert.equal(hourUtc(ms), hour, tz);
    assert.equal(new Date(ms as number).getUTCMinutes(), 30);
  }
  assert.equal(hourUtc(zonedToUtc("2026-11-01", "01:30", "America/Phoenix")), 8);
});

test("zonedToUtc refuses malformed input", () => {
  assert.equal(zonedToUtc("2026-02-30", "09:00", "America/Chicago"), null);
  assert.equal(zonedToUtc("2026-02-01", "9:00", "America/Chicago"), null);
});

test("localParts reads back a local time, date and weekday", () => {
  const ms = zonedToUtc("2026-12-01", "09:00", "America/Chicago") as number;
  assert.deepEqual(localParts(ms, "America/Chicago"), { date: "2026-12-01", time: "09:00", weekday: "tue" });
  assert.deepEqual(localParts(Date.UTC(2026, 11, 1, 3, 0), "America/Chicago"), { date: "2026-11-30", time: "21:00", weekday: "mon" });
  assert.equal(localParts(Date.UTC(2026, 0, 1, 0, 0), "UTC").time, "00:00");
});

test("localParts round-trips every half hour across a change", () => {
  const tz = "America/Chicago";
  for (const date of ["2026-03-08", "2026-11-01"]) {
    for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
      const time = clockFromMinutes(minutes);
      const ms = zonedToUtc(date, time, tz);
      if (ms !== null) assert.deepEqual([localParts(ms, tz).date, localParts(ms, tz).time], [date, time]);
    }
  }
});

test("calendar arithmetic", () => {
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-12-01", "2026-12-11"), 10);
  assert.equal(daysBetween("2026-12-11", "2026-12-01"), -10);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(weekdayOf("2026-12-01"), "tue");
  assert.equal(weekdayOf("2026-03-08"), "sun");
  assert.equal(weekdayOf("2026-11-30"), "mon");
});

test("startOfLocalDay is local midnight", () => {
  assert.equal(startOfLocalDay("2026-12-01", "America/Chicago"), Date.UTC(2026, 11, 1, 6, 0));
  assert.equal(startOfLocalDay("2026-03-08", "America/Chicago"), Date.UTC(2026, 2, 8, 6, 0));
});

test("names and formats", () => {
  const ms = zonedToUtc("2026-12-01", "09:00", "America/Chicago") as number;
  assert.equal(zoneName("America/Chicago", ms), "Central Standard Time");
  assert.equal(zoneName("America/Chicago", zonedToUtc("2026-07-01", "09:00", "America/Chicago") as number), "Central Daylight Time");
  assert.equal(formatLocal(ms, "America/Chicago"), "Tuesday, December 1, 2026, 9:00 AM");
  assert.equal(formatTime(ms, "America/Chicago"), "9:00 AM");
  assert.equal(formatTime(zonedToUtc("2026-12-01", "15:05", "America/Chicago") as number, "America/Chicago"), "3:05 PM");
  assert.equal(formatTime(zonedToUtc("2026-12-01", "00:00", "America/Chicago") as number, "America/Chicago"), "12:00 AM");
});

test("date and time guards", () => {
  assert.ok(isLocalDate("2026-02-28"));
  assert.ok(!isLocalDate("2026-02-29"));
  assert.ok(!isLocalDate("2026-2-1"));
  assert.ok(!isLocalDate(20260201));
  assert.ok(isClockTime("00:00") && isClockTime("23:55"));
  assert.ok(!isClockTime("24:00") && !isClockTime("9:00") && !isClockTime("09:60") && !isClockTime(null));
  assert.equal(clockMinutes("13:45"), 825);
  assert.equal(clockFromMinutes(825), "13:45");
});
