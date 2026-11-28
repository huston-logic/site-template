import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { siteConfig } from "../../site.config.ts";
import { bookingForBuild, FIXTURE_BOOKING } from "./config.ts";

const set = { calendarId: "cal@example.test", busyCalendarIds: ["busy@example.test"], previewCalendarId: null };
const site = (booking: typeof set | null) => ({ booking, domain: { productionBranch: "main" } });

describe("bookingForBuild", () => {
  test("the template has booking off", () => {
    assert.equal(siteConfig.booking, null);
    assert.equal(bookingForBuild(siteConfig, {}), null);
  });

  test("null stays null and a set value is returned as it is, on every build", () => {
    assert.equal(bookingForBuild(site(null), { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), null);
    assert.deepEqual(bookingForBuild(site(set), {}), set);
    assert.deepEqual(bookingForBuild(site(set), { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), set);
  });

  test("BOOKING_FIXTURE=1 gives the fixture on a local build only", () => {
    assert.deepEqual(bookingForBuild(site(null), { BOOKING_FIXTURE: "1" }), FIXTURE_BOOKING);
    assert.match(FIXTURE_BOOKING.calendarId, /example\.test$/);
    assert.throws(() => bookingForBuild(site(null), { BOOKING_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), /BOOKING_FIXTURE/);
    assert.throws(() => bookingForBuild(site(null), { BOOKING_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "feat/x" }), /BOOKING_FIXTURE/);
  });
});
