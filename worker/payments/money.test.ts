import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYMENT_CURRENCIES } from "../../src/payments/config.ts";
import { formatMoney, toMinor } from "./money.ts";

test("formats minor units with two decimals and grouping", () => {
  assert.equal(formatMoney(5000, "usd"), "$50.00");
  assert.equal(formatMoney(125_000, "usd"), "$1,250.00");
  assert.equal(formatMoney(1_000_000, "usd"), "$10,000.00");
  assert.equal(formatMoney(2505, "gbp"), "£25.05");
  assert.equal(formatMoney(500, "eur"), "€5.00");
});

test("every supported currency has a symbol and the minor factor is 100", () => {
  for (const currency of PAYMENT_CURRENCIES) assert.match(formatMoney(100, currency), /1\.00$/);
  assert.equal(toMinor(50), 5000);
});
