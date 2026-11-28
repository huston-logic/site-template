import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { exampleGiftCards } from "./example.ts";
import { PAYMENTS_OFF_MESSAGE } from "./schema.ts";
import { validateGiftCards } from "./validate.ts";

const on = { paymentsOn: true };
const off = { paymentsOn: false };
const good = () => structuredClone(exampleGiftCards) as unknown as Record<string, unknown>;
const withChange = (change: Record<string, unknown>) => ({ ...good(), ...change });

describe("validateGiftCards", () => {
  test("the example passes with payments on", () => {
    assert.deepEqual(validateGiftCards(exampleGiftCards, on), []);
  });

  test("the committed file passes with payments off (selling is false)", () => {
    const data: unknown = JSON.parse(readFileSync(new URL("../content/gift-cards.json", import.meta.url), "utf8"));
    assert.deepEqual(validateGiftCards(data, off), []);
  });

  test("selling on while payments is off gives the one plain message", () => {
    assert.deepEqual(validateGiftCards(good(), off), [PAYMENTS_OFF_MESSAGE]);
    assert.equal(PAYMENTS_OFF_MESSAGE, "Gift card sales cannot be turned on yet: payments are not set up on this site. Huston Logic sets them up (docs/PAYMENTS.md).");
    assert.deepEqual(validateGiftCards(withChange({ selling: false }), off), []);
  });

  test("not an object, missing keys and unknown keys are refused", () => {
    for (const bad of [null, [], "x", 3]) assert.equal(validateGiftCards(bad, on).length, 1);
    const rest = good();
    delete rest["custom"];
    assert.ok(validateGiftCards(rest, on).some((p) => p.includes('"custom" is missing')));
    assert.ok(validateGiftCards({ ...good(), extra: 1 }, on).some((p) => p.includes('"extra" is not a gift card setting')));
  });

  test("selling must be true or false", () => {
    assert.ok(validateGiftCards(withChange({ selling: "yes" }), on).some((p) => p.includes('"selling" must be true or false')));
  });

  test("amounts: count, whole numbers, range, duplicates, labels, unknown keys", () => {
    assert.ok(validateGiftCards(withChange({ amounts: [] }), on).some((p) => p.includes("lists 1 to 8")));
    assert.ok(validateGiftCards(withChange({ amounts: Array.from({ length: 9 }, (_, i) => ({ amount: 10 + i })) }), on).some((p) => p.includes("lists 1 to 8")));
    for (const amount of [4, 10_001, 12.5, "25", -5, null, Number.NaN]) {
      assert.ok(validateGiftCards(withChange({ amounts: [{ amount }] }), on).some((p) => p.includes("whole number from 5 to 10,000")), String(amount));
    }
    assert.ok(validateGiftCards(withChange({ amounts: [{ amount: 25 }, { amount: 25 }] }), on).some((p) => p.includes("repeats 25")));
    assert.ok(validateGiftCards(withChange({ amounts: [{ amount: 25, label: "x".repeat(41) }] }), on).some((p) => p.includes("at most 40")));
    assert.ok(validateGiftCards(withChange({ amounts: [{ amount: 25, label: "<b>hi</b>" }] }), on).some((p) => p.includes("HTML tag")));
    assert.ok(validateGiftCards(withChange({ amounts: [{ amount: 25, price: 1 }] }), on).some((p) => p.includes('"price" is not a gift card setting')));
    assert.ok(validateGiftCards(withChange({ amounts: ["25"] }), on).length > 0);
    assert.ok(validateGiftCards(withChange({ amounts: "25" }), on).length > 0);
  });

  test("custom: null or a range of whole numbers with min below max", () => {
    assert.deepEqual(validateGiftCards(withChange({ custom: null }), on), []);
    assert.deepEqual(validateGiftCards(withChange({ custom: { min: 5, max: 10_000 } }), on), []);
    assert.ok(validateGiftCards(withChange({ custom: { min: 50, max: 50 } }), on).some((p) => p.includes("less than")));
    assert.ok(validateGiftCards(withChange({ custom: { min: 100, max: 50 } }), on).some((p) => p.includes("less than")));
    assert.ok(validateGiftCards(withChange({ custom: { min: 4, max: 50 } }), on).some((p) => p.includes("smallest must be")));
    assert.ok(validateGiftCards(withChange({ custom: { min: 5, max: 10_001 } }), on).some((p) => p.includes("largest must be")));
    assert.ok(validateGiftCards(withChange({ custom: { min: 5.5, max: 50 } }), on).some((p) => p.includes("smallest must be")));
    assert.ok(validateGiftCards(withChange({ custom: { min: 5, max: 50, step: 5 } }), on).some((p) => p.includes('"step"')));
    assert.ok(validateGiftCards(withChange({ custom: 25 }), on).length > 0);
  });

  test("wording: text, not empty, within the limits, plain", () => {
    assert.ok(validateGiftCards(withChange({ redeemWording: "" }), on).some((p) => p.includes("is empty")));
    assert.ok(validateGiftCards(withChange({ redeemWording: "x".repeat(301) }), on).some((p) => p.includes("at most 300")));
    assert.deepEqual(validateGiftCards(withChange({ redeemWording: "x".repeat(300) }), on), []);
    assert.ok(validateGiftCards(withChange({ termsLine: "x".repeat(201) }), on).some((p) => p.includes("at most 200")));
    assert.ok(validateGiftCards(withChange({ termsLine: 5 }), on).some((p) => p.includes("must be text")));
    assert.ok(validateGiftCards(withChange({ termsLine: "see <script>" }), on).some((p) => p.includes("HTML tag")));
    assert.deepEqual(validateGiftCards(withChange({ redeemWording: "[[How to redeem]]", termsLine: "[[Terms]]" }), on), []);
  });

  test("validForMonths: null, or 60 to 240 whole months", () => {
    assert.deepEqual(validateGiftCards(withChange({ validForMonths: 60 }), on), []);
    assert.deepEqual(validateGiftCards(withChange({ validForMonths: 240 }), on), []);
    for (const months of [59, 241, 12, 60.5, "60", 0]) {
      assert.ok(validateGiftCards(withChange({ validForMonths: months }), on).some((p) => p.includes("validForMonths")), String(months));
    }
  });
});
