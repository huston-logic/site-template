import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleBooking } from "../booking/example.ts";
import { readConfirm, clearResume, dayName, dayTile, durationText, lengthText, loadResume, moneyText, priceParts, ruleText, saveResume, weekDays, type StorageLike } from "./booking-flow.ts";

const [consultation, workshop] = exampleBooking.services;
if (!consultation || !workshop) throw new Error("example services missing");

const memory = (): StorageLike => {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) };
};

test("money shows cents only when there are some", () => {
  assert.equal(moneyText(15000, "usd"), "$150");
  assert.equal(moneyText(11250, "usd"), "$112.50");
});

test("durations and lengths read in words", () => {
  assert.equal(durationText(180), "3 hours");
  assert.equal(durationText(90), "1 hour 30 minutes");
  assert.equal(durationText(45), "45 minutes");
  assert.equal(lengthText(consultation), "1 hour");
  assert.equal(lengthText(workshop), "Two sessions of 3 hours, 2 to 10 days apart");
});

test("the price line says the price and what is taken online", () => {
  assert.deepEqual(priceParts(consultation, "usd"), { price: "Free", terms: "" });
  assert.deepEqual(priceParts(workshop, "usd"), { price: "$150 per person", terms: "25% deposit" });
  const onTheDay = { ...consultation, price: { amount: 80, per: "booking" as const } };
  assert.equal(priceParts(onTheDay, "usd").price, "$80 for the booking, paid on the day");
});

test("the rule between sessions in words", () => {
  assert.equal(ruleText(workshop), "2 to 10 days after the one before.");
  assert.equal(ruleText({ ...workshop, between: { minDays: 0, maxDays: 3 } }), "On the same day as the one before, or up to 3 days after it.");
  assert.equal(ruleText(consultation), "");
});

test("a week strip is seven consecutive days", () => {
  assert.deepEqual(weekDays("2026-12-29"), ["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]);
  assert.equal(dayName("2026-12-01"), "Tuesday, December 1");
  assert.deepEqual(dayTile("2026-12-01"), { weekday: "Tue", day: "1", month: "Dec" });
});

test("a confirm answer is read only when it is whole", () => {
  const summary = { reference: "r", service: "Workshop", party: 2, sessions: [{ start: 1, end: 2, label: "Tuesday, December 1, 2026, 9:00 AM" }], zoneName: "Central Standard Time", paidText: "$75", dueLaterText: "$225 due later", item: null };
  const paid = { status: "paid", booked: "booked", summary, value: 75, currency: "usd", transactionId: "pi_1", emailed: true };
  assert.equal(readConfirm(paid)?.status, "paid");
  assert.equal(readConfirm({ ...paid, currency: "dollars" }), null);
  assert.equal(readConfirm({ ...paid, booked: "maybe" }), null);
  assert.equal(readConfirm({ ...paid, summary: { ...summary, sessions: "x" } }), null);
  assert.deepEqual(readConfirm({ status: "pending" }), { status: "pending" });
  assert.equal(readConfirm({ status: "weird" }), null);
  assert.equal(readConfirm(null), null);
});

test("resume data round-trips and bad data is ignored", () => {
  const storage = memory();
  const resume = { service: "workshop", party: 3, starts: [1, 2], answers: { name: "Ada", box: true }, sessionId: "cs_1", item: null };
  saveResume(storage, "k", resume);
  assert.deepEqual(loadResume(storage, "k"), resume);
  clearResume(storage, "k");
  assert.equal(loadResume(storage, "k"), null);
  storage.setItem("k", "{not json");
  assert.equal(loadResume(storage, "k"), null);
  storage.setItem("k", JSON.stringify({ service: 1 }));
  assert.equal(loadResume(storage, "k"), null);
  assert.equal(loadResume(null, "k"), null);
});
