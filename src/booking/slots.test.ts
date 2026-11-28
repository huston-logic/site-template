import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleBooking } from "./example.ts";
import type { BookingSettings, Hours, Interval, Service, Window } from "./schema.ts";
import { checkSelection, openDays, sessionIntervals, startsOn } from "./slots.ts";
import { localParts, zonedToUtc } from "./zone.ts";

const TZ = "America/Chicago";
const at = (date: string, time: string, tz = TZ) => zonedToUtc(date, time, tz) as number;
const localTimes = (starts: number[], tz = TZ) => starts.map((start) => localParts(start, tz).time);

// Friday 2026-11-27, noon.
const NOW = at("2026-11-27", "12:00");
const workshop = exampleBooking.services[1] as Service;
const consultation = exampleBooking.services[0] as Service;
const MIN = 60_000;

const hoursWith = (weekly: Partial<Hours["weekly"]>, rest: Partial<Hours> = {}): Hours => ({
  ...exampleBooking.hours,
  weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], ...weekly },
  bufferMinutes: 0,
  ...rest,
});
const day = (...windows: Window[]) => windows;

test("startsOn gives local 9:00 starts on both sides of every change", () => {
  const hours = hoursWith({ mon: day(["09:00", "10:00"]), tue: day(["09:00", "10:00"]), sat: day(["09:00", "10:00"]) }, { starts: { every: 60 } });
  for (const tz of ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix"]) {
    for (const date of ["2026-03-09", "2026-11-02", "2026-03-07", "2026-10-31"]) {
      const starts = startsOn(date, hours, 30, tz);
      assert.deepEqual(localTimes(starts, tz), ["09:00"], `${tz} ${date}`);
      assert.equal(starts[0], zonedToUtc(date, "09:00", tz));
    }
  }
});

test("a session that fits the window only counts", () => {
  const hours = hoursWith({ mon: day(["09:00", "11:00"]) }, { starts: { every: 30 } });
  assert.deepEqual(localTimes(startsOn("2026-11-30", hours, 60, TZ)), ["09:00", "09:30", "10:00"]);
  assert.deepEqual(localTimes(startsOn("2026-11-30", hours, 120, TZ)), ["09:00"]);
  assert.deepEqual(startsOn("2026-11-30", hours, 121, TZ), []);
});

test("fixed start times and several windows", () => {
  const hours = hoursWith({ mon: day(["09:00", "12:00"], ["13:00", "15:00"]) }, { starts: { at: ["08:00", "09:00", "11:00", "12:00", "13:30", "14:30"] } });
  assert.deepEqual(localTimes(startsOn("2026-11-30", hours, 60, TZ)), ["09:00", "11:00", "13:30"]);
});

test("a closed date and a closed weekday give nothing", () => {
  const hours = hoursWith({ mon: day(["09:00", "17:00"]) }, { closed: [{ from: "2026-11-30", to: "2026-11-30" }] });
  assert.deepEqual(startsOn("2026-11-30", hours, 60, TZ), []);
  assert.deepEqual(startsOn("2026-12-01", hours, 60, TZ), []);
  assert.equal(startsOn("2026-12-07", hours, 60, TZ).length, 15);
});

test("a window that opens in the spring-forward gap skips the missing times", () => {
  const hours = hoursWith({ sun: day(["01:00", "04:00"]) }, { starts: { every: 30 } });
  const starts = startsOn("2026-03-08", hours, 30, TZ);
  assert.deepEqual(localTimes(starts), ["01:00", "01:30", "03:00", "03:30"]);
});

test("a window closing inside the gap closes at the first real time after it", () => {
  const hours = hoursWith({ sun: day(["01:00", "02:30"]) }, { starts: { every: 30 } });
  // 02:30 does not exist; the window closes when 03:00 begins, so a 30-minute session at 01:30 ends in time and 02:00 does not exist.
  assert.deepEqual(localTimes(startsOn("2026-03-08", hours, 30, TZ)), ["01:00", "01:30"]);
});

test("a three-hour session at 00:30 on the fall-back night lasts three real hours", () => {
  const hours = hoursWith({ sun: day(["00:00", "06:00"]) }, { starts: { every: 30 } });
  const starts = startsOn("2026-11-01", hours, 180, TZ);
  assert.deepEqual(localTimes(starts), ["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00"]);
  const start = starts[1] as number;
  assert.equal(localParts(start, TZ).time, "00:30");
  const [interval] = sessionIntervals({ ...consultation, sessions: [{ minutes: 180 }] }, [start]);
  assert.equal((interval as Interval).end - start, 3 * 60 * MIN);
  assert.equal(localParts((interval as Interval).end, TZ).time, "02:30");
  // The repeated 01:30 is offered once, at its first instant.
  assert.equal(starts[3], zonedToUtc("2026-11-01", "01:30", TZ));
  assert.equal(new Set(starts).size, starts.length);
});

const first = (date: string, busy: Interval[] = [], settings: BookingSettings = exampleBooking, service = workshop, now = NOW) =>
  openDays({ settings, service, index: 0, chosen: [], busy, now, from: date, days: 14, tz: TZ });

test("openDays for the first session respects notice, ahead and the days asked for", () => {
  const days = first("2026-11-27");
  assert.equal(days[0]?.date, "2026-11-27");
  assert.equal(days.length, 14);
  assert.deepEqual(days[0]?.starts, []);
  const monday = days.find((entry) => entry.date === "2026-11-30");
  assert.deepEqual(localTimes(monday?.starts ?? []), ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"]);
  assert.deepEqual(first("2026-11-01")[0]?.date, "2026-11-27");
  // Today is day 0: 60 days ahead is January 26.
  const far = openDays({ settings: exampleBooking, service: workshop, index: 0, chosen: [], busy: [], now: NOW, from: "2027-01-20", days: 14, tz: TZ });
  assert.equal(far[0]?.date, "2027-01-20");
  assert.equal(far[far.length - 1]?.date, "2027-01-26");
  assert.deepEqual(openDays({ settings: exampleBooking, service: workshop, index: 0, chosen: [], busy: [], now: NOW, from: "2027-01-27", days: 5, tz: TZ }), []);
  assert.deepEqual(openDays({ settings: exampleBooking, service: workshop, index: 5, chosen: [], busy: [], now: NOW, from: "2027-01-01", days: 5, tz: TZ }), []);
});

test("notice counts from now, to the minute", () => {
  const hours = hoursWith({ sat: day(["09:00", "17:00"]) }, { noticeHours: 24, starts: { every: 30 } });
  const settings: BookingSettings = { ...exampleBooking, hours };
  const sat = (now: number) => openDays({ settings, service: { ...consultation, hours: undefined }, index: 0, chosen: [], busy: [], now, from: "2026-11-28", days: 1, tz: TZ })[0]?.starts ?? [];
  assert.equal(localTimes(sat(at("2026-11-27", "12:00")))[0], "12:00");
  assert.equal(localTimes(sat(at("2026-11-27", "12:01")))[0], "12:30");
});

test("later sessions fall on days 2 to 10 after the first", () => {
  const chosen = [at("2026-11-30", "09:00")];
  const days = openDays({ settings: exampleBooking, service: workshop, index: 1, chosen, busy: [], now: NOW, from: "2026-11-27", days: 30, tz: TZ });
  assert.equal(days[0]?.date, "2026-12-02");
  assert.equal(days[days.length - 1]?.date, "2026-12-10");
  assert.equal(days.length, 9);
  assert.deepEqual(days.find((entry) => entry.date === "2026-12-05")?.starts, []);
  assert.ok((days.find((entry) => entry.date === "2026-12-02")?.starts.length ?? 0) > 0);
  const clipped = openDays({ settings: exampleBooking, service: workshop, index: 1, chosen, busy: [], now: NOW, from: "2026-12-04", days: 3, tz: TZ });
  assert.deepEqual(clipped.map((entry) => entry.date), ["2026-12-04", "2026-12-05", "2026-12-06"]);
});

test("later sessions ignore notice and the horizon", () => {
  const chosen = [at("2027-01-26", "09:00")];
  const days = openDays({ settings: exampleBooking, service: workshop, index: 1, chosen, busy: [], now: NOW, from: "2027-01-27", days: 14, tz: TZ });
  assert.equal(days[0]?.date, "2027-01-28");
  assert.ok(days.some((entry) => entry.starts.length > 0));
});

test("the buffer keeps a gap around busy time", () => {
  const busy = [{ start: at("2026-11-30", "07:00"), end: at("2026-11-30", "08:45") }];
  const monday = (list: Interval[]) => first("2026-11-30", list).find((entry) => entry.date === "2026-11-30")?.starts ?? [];
  assert.equal(localTimes(monday(busy))[0], "09:00");
  const later = [{ start: at("2026-11-30", "07:00"), end: at("2026-11-30", "08:46") }];
  assert.equal(localTimes(monday(later))[0], "09:30");
  const after = [{ start: at("2026-11-30", "12:00"), end: at("2026-11-30", "13:00") }];
  assert.deepEqual(localTimes(monday(after)), ["13:30", "14:00"]);
});

const SECOND = at("2026-12-03", "10:00");
const pick = (...starts: number[]) => checkSelection(exampleBooking, workshop, 3, starts, [], NOW, TZ);

test("checkSelection accepts a good two-session choice", () => {
  assert.deepEqual(pick(at("2026-11-30", "09:00"), SECOND), { ok: true });
  assert.deepEqual(pick(at("2026-11-30", "14:00"), at("2026-12-10", "14:00")), { ok: true });
});

test("checkSelection names what is wrong, with the session", () => {
  const A = at("2026-11-30", "09:00");
  assert.deepEqual(checkSelection(exampleBooking, { ...workshop, status: "archived" }, 3, [A, SECOND], [], NOW, TZ), { ok: false, reason: "service", index: 0 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 7, [A, SECOND], [], NOW, TZ), { ok: false, reason: "party", index: 0 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 0, [A, SECOND], [], NOW, TZ), { ok: false, reason: "party", index: 0 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 2.5, [A, SECOND], [], NOW, TZ), { ok: false, reason: "party", index: 0 });
  assert.deepEqual(pick(A), { ok: false, reason: "count", index: 0 });
  assert.deepEqual(pick(A, SECOND, SECOND), { ok: false, reason: "count", index: 0 });
  assert.deepEqual(pick(A, Number.NaN), { ok: false, reason: "count", index: 0 });
  assert.deepEqual(pick(at("2026-11-28", "10:00"), SECOND), { ok: false, reason: "notice", index: 0 });
  assert.deepEqual(pick(at("2027-01-27", "09:00"), at("2027-01-30", "09:00")), { ok: false, reason: "ahead", index: 0 });
  assert.deepEqual(pick(at("2026-12-05", "10:00"), at("2026-12-08", "10:00")), { ok: false, reason: "hours", index: 0 });
  assert.deepEqual(pick(at("2026-11-30", "08:00"), SECOND), { ok: false, reason: "hours", index: 0 });
  assert.deepEqual(pick(at("2026-11-30", "15:00"), SECOND), { ok: false, reason: "hours", index: 0 });
  assert.deepEqual(pick(at("2026-11-30", "09:10"), SECOND), { ok: false, reason: "hours", index: 0 });
  assert.deepEqual(pick(A, at("2026-11-30", "13:00")), { ok: false, reason: "rule", index: 1 });
  assert.deepEqual(pick(A, at("2026-12-01", "09:00")), { ok: false, reason: "rule", index: 1 });
  assert.deepEqual(pick(A, at("2026-12-11", "09:00")), { ok: false, reason: "rule", index: 1 });
});

test("checkSelection: same day is refused when the rule says at least one day", () => {
  const settings: BookingSettings = { ...exampleBooking, services: [consultation, { ...workshop, between: { minDays: 1, maxDays: 10 } }] };
  const service = settings.services[1] as Service;
  const result = checkSelection(settings, service, 2, [at("2026-11-30", "09:00"), at("2026-11-30", "14:00")], [], NOW, TZ);
  assert.deepEqual(result, { ok: false, reason: "rule", index: 1 });
  const zero: BookingSettings = { ...exampleBooking, hours: { ...exampleBooking.hours, starts: { every: 30 } }, services: [consultation, { ...workshop, between: { minDays: 0, maxDays: 10 } }] };
  const same = checkSelection(zero, zero.services[1] as Service, 2, [at("2026-11-30", "09:00"), at("2026-11-30", "12:15")], [], NOW, TZ);
  assert.equal(same.ok, false);
});

test("checkSelection: busy time counts with the buffer, and a rule break is reported as a rule break", () => {
  const A = at("2026-11-30", "09:00");
  const busy = (from: string, to: string, date = "2026-11-30") => [{ start: at(date, from), end: at(date, to) }];
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, SECOND], busy("11:00", "11:30"), NOW, TZ), { ok: false, reason: "busy", index: 0 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, SECOND], busy("07:00", "08:46"), NOW, TZ), { ok: false, reason: "busy", index: 0 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, SECOND], busy("07:00", "08:45"), NOW, TZ), { ok: true });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, SECOND], busy("12:10", "12:30"), NOW, TZ), { ok: false, reason: "busy", index: 0 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, SECOND], busy("12:15", "13:00"), NOW, TZ), { ok: true });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, SECOND], busy("09:00", "10:00", "2026-12-03"), NOW, TZ), { ok: false, reason: "busy", index: 1 });
  assert.deepEqual(checkSelection(exampleBooking, workshop, 3, [A, at("2026-12-01", "09:00")], busy("08:00", "20:00", "2026-12-01"), NOW, TZ), { ok: false, reason: "rule", index: 1 });
});

test("checkSelection: a consultation uses its own hours", () => {
  const ok = (time: string) => checkSelection(exampleBooking, consultation, 1, [at("2026-11-30", time)], [], NOW, TZ);
  assert.deepEqual(ok("10:00"), { ok: true });
  assert.deepEqual(ok("15:00"), { ok: true });
  assert.deepEqual(ok("15:30"), { ok: false, reason: "hours", index: 0 });
  assert.deepEqual(ok("09:30"), { ok: false, reason: "hours", index: 0 });
});

test("checkSelection refuses a closed date before anything else about the hours", () => {
  const settings: BookingSettings = { ...exampleBooking, hours: { ...exampleBooking.hours, closed: [{ from: "2026-11-30", to: "2026-11-30" }] } };
  assert.deepEqual(checkSelection(settings, consultation, 1, [at("2026-11-30", "10:00")], [], NOW, TZ), { ok: false, reason: "closed", index: 0 });
});

test("every start openDays offers passes checkSelection, and nothing else does", () => {
  const settings = exampleBooking;
  const firstDays = openDays({ settings, service: workshop, index: 0, chosen: [], busy: [], now: NOW, from: "2026-11-27", days: 14, tz: TZ });
  const firsts = firstDays.flatMap((entry) => entry.starts);
  assert.ok(firsts.length > 0);
  for (const start of firsts) {
    const seconds = openDays({ settings, service: workshop, index: 1, chosen: [start], busy: [], now: NOW, from: "2026-11-27", days: 40, tz: TZ }).flatMap((entry) => entry.starts);
    assert.ok(seconds.length > 0);
    for (const second of seconds.slice(0, 3)) assert.deepEqual(checkSelection(settings, workshop, 2, [start, second], [], NOW, TZ), { ok: true });
  }
});
