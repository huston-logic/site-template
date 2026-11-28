import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveHours, isClosed } from "./hours.ts";
import { exampleBooking } from "./example.ts";
import type { Service } from "./schema.ts";

const site = { ...exampleBooking.hours, closed: [{ from: "2026-12-24", to: "2027-01-02" }] };
const workshop = exampleBooking.services[1] as Service;
const consultation = exampleBooking.services[0] as Service;

test("a service without hours uses the site's", () => {
  assert.deepEqual(effectiveHours(site, workshop), site);
});

test("a service's keys replace the site's, closed adds", () => {
  const own: Service = { ...workshop, hours: { noticeHours: 336, closed: [{ from: "2027-02-01", to: "2027-02-03" }] } };
  const hours = effectiveHours(site, own);
  assert.equal(hours.noticeHours, 336);
  assert.equal(hours.aheadDays, site.aheadDays);
  assert.deepEqual(hours.closed, [...site.closed, { from: "2027-02-01", to: "2027-02-03" }]);
  assert.deepEqual(effectiveHours(site, consultation).weekly.mon, [["10:00", "16:00"]]);
});

test("isClosed includes both ends", () => {
  assert.ok(isClosed("2026-12-24", site) && isClosed("2027-01-02", site) && isClosed("2026-12-31", site));
  assert.ok(!isClosed("2026-12-23", site) && !isClosed("2027-01-03", site));
});
