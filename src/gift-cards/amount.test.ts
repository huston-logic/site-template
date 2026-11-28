import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkAmount } from "./amount.ts";
import { exampleGiftCards } from "./example.ts";
import type { GiftCardSettings } from "./schema.ts";

const settings = (change: Partial<GiftCardSettings> = {}): GiftCardSettings => ({ ...exampleGiftCards, ...change });
const reason = (s: GiftCardSettings, choice: unknown) => {
  const result = checkAmount(s, choice);
  return result.ok ? "ok" : result.reason;
};

describe("checkAmount", () => {
  test("a listed preset gives the amount and minor units", () => {
    assert.deepEqual(checkAmount(settings(), { kind: "preset", amount: 50 }), { ok: true, amount: 50, minor: 5000 });
  });

  test("a custom amount inside the range, at both ends, is accepted", () => {
    assert.deepEqual(checkAmount(settings(), { kind: "custom", amount: 25 }), { ok: true, amount: 25, minor: 2500 });
    assert.deepEqual(checkAmount(settings(), { kind: "custom", amount: 500 }), { ok: true, amount: 500, minor: 50_000 });
    assert.deepEqual(checkAmount(settings(), { kind: "custom", amount: 137 }), { ok: true, amount: 137, minor: 13_700 });
  });

  test("selling off is closed, for a good choice", () => {
    assert.equal(reason(settings({ selling: false }), { kind: "preset", amount: 50 }), "closed");
    assert.equal(reason(settings({ selling: false }), { kind: "custom", amount: 50 }), "closed");
  });

  test("a preset that is not listed is not offered", () => {
    assert.equal(reason(settings(), { kind: "preset", amount: 75 }), "not_offered");
    assert.equal(reason(settings(), { kind: "preset", amount: 137 }), "not_offered");
  });

  test("custom when the range is off is not offered", () => {
    assert.equal(reason(settings({ custom: null }), { kind: "custom", amount: 50 }), "not_offered");
  });

  test("custom outside the range is out of range", () => {
    assert.equal(reason(settings(), { kind: "custom", amount: 24 }), "out_of_range");
    assert.equal(reason(settings(), { kind: "custom", amount: 501 }), "out_of_range");
  });

  test("forged shapes are bad requests", () => {
    const forged: unknown[] = [
      undefined,
      null,
      "50",
      50,
      [],
      {},
      { kind: "preset" },
      { amount: 50 },
      { kind: "preset", amount: "50" },
      { kind: "preset", amount: 50.5 },
      { kind: "custom", amount: 25.01 },
      { kind: "preset", amount: -50 },
      { kind: "custom", amount: 0 },
      { kind: "custom", amount: Number.NaN },
      { kind: "custom", amount: Number.POSITIVE_INFINITY },
      { kind: "custom", amount: 1e21 },
      { kind: "other", amount: 50 },
      { kind: "preset", amount: 50, minor: 1 },
      { kind: "preset", amount: 50, currency: "usd" },
      { kind: ["preset"], amount: 50 },
      { kind: "preset", amount: [50] },
      { kind: "preset", amount: null },
    ];
    for (const choice of forged) assert.equal(reason(settings(), choice), "bad_request", JSON.stringify(choice));
  });

  test("inherited keys do not smuggle in a choice", () => {
    assert.equal(reason(settings(), JSON.parse('{"kind":"preset","amount":50,"__proto__":{"x":1}}')), "bad_request");
  });
});
