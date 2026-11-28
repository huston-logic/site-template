import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleBooking } from "./example.ts";
import { bookingPrice } from "./price.ts";
import type { Payment, Price, Service } from "./schema.ts";

const base = exampleBooking.services[1] as Service;
const make = (price: Price | null, payment: Payment): Service => ({ ...base, price, payment });

test("no price means nothing is due anywhere", () => {
  assert.equal(bookingPrice(make(null, { kind: "free" }), 2), null);
});

test("full payment takes the whole total, per person or per booking", () => {
  assert.deepEqual(bookingPrice(make({ amount: 150, per: "person" }, { kind: "full" }), 3), { totalMinor: 45000, dueNowMinor: 45000, dueLaterMinor: 0, perPerson: true });
  assert.deepEqual(bookingPrice(make({ amount: 150, per: "booking" }, { kind: "full" }), 3), { totalMinor: 15000, dueNowMinor: 15000, dueLaterMinor: 0, perPerson: false });
});

test("a whole-amount deposit is capped at the total", () => {
  assert.deepEqual(bookingPrice(make({ amount: 150, per: "person" }, { kind: "deposit", amount: 100 }), 3), { totalMinor: 45000, dueNowMinor: 10000, dueLaterMinor: 35000, perPerson: true });
  assert.equal(bookingPrice(make({ amount: 150, per: "person" }, { kind: "deposit", amount: 100 }), 3)?.dueNowMinor, 10000);
  assert.equal(bookingPrice(make({ amount: 150, per: "booking" }, { kind: "deposit", amount: 500 }), 1)?.dueNowMinor, 15000);
});

test("a percent deposit rounds to the cent and takes at least one minor unit", () => {
  assert.equal(bookingPrice(make({ amount: 150, per: "person" }, { kind: "deposit", percent: 25 }), 3)?.dueNowMinor, 11250);
  assert.equal(bookingPrice(make({ amount: 1, per: "booking" }, { kind: "deposit", percent: 33 }), 1)?.dueNowMinor, 33);
  assert.equal(bookingPrice(make({ amount: 3, per: "booking" }, { kind: "deposit", percent: 1 }), 1)?.dueNowMinor, 3);
  assert.equal(bookingPrice(make({ amount: 1, per: "booking" }, { kind: "deposit", percent: 1 }), 1)?.dueNowMinor, 1);
  assert.equal(bookingPrice(make({ amount: 7, per: "booking" }, { kind: "deposit", percent: 50 }), 1)?.dueNowMinor, 350);
});

test("a free service with a price owes it all later", () => {
  assert.deepEqual(bookingPrice(make({ amount: 40, per: "person" }, { kind: "free" }), 2), { totalMinor: 8000, dueNowMinor: 0, dueLaterMinor: 8000, perPerson: true });
});
