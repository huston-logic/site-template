import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readConfirmation, searchWithoutSessionId, sessionIdFrom, shouldRecheck } from "./confirm.ts";

const paid = { status: "paid", value: 50, currency: "usd", transactionId: "pi_123", delivered: true, recipientCopy: true };

describe("sessionIdFrom", () => {
  test("reads a Stripe-shaped id and refuses anything else", () => {
    assert.equal(sessionIdFrom("?session_id=cs_test_a1B2"), "cs_test_a1B2");
    assert.equal(sessionIdFrom(""), null);
    assert.equal(sessionIdFrom("?session_id="), null);
    assert.equal(sessionIdFrom("?session_id=a/b"), null);
    assert.equal(sessionIdFrom("?session_id=<script>"), null);
    assert.equal(sessionIdFrom(`?session_id=${"a".repeat(201)}`), null);
  });
});

describe("readConfirmation", () => {
  test("a paid answer is read, with the currency in capitals", () => {
    assert.deepEqual(readConfirmation(paid), { ...paid, currency: "USD" });
  });

  test("pending and unpaid answers need no figures", () => {
    assert.equal(readConfirmation({ status: "pending", delivered: false })?.status, "pending");
    assert.equal(readConfirmation({ status: "unpaid" })?.status, "unpaid");
    assert.equal(readConfirmation({ status: "error" })?.delivered, false);
  });

  test("a paid answer without its figures, or any answer of another shape, is not read", () => {
    assert.equal(readConfirmation({ status: "paid", delivered: true }), null);
    assert.equal(readConfirmation({ ...paid, value: 0 }), null);
    assert.equal(readConfirmation({ ...paid, value: "50" }), null);
    assert.equal(readConfirmation({ ...paid, currency: "dollars" }), null);
    assert.equal(readConfirmation({ ...paid, transactionId: "" }), null);
    assert.equal(readConfirmation({ status: "open" }), null);
    assert.equal(readConfirmation(null), null);
    assert.equal(readConfirmation([paid]), null);
    assert.equal(readConfirmation("paid"), null);
  });

  test("delivered is true only when it is exactly true", () => {
    assert.equal(readConfirmation({ ...paid, delivered: "yes" })?.delivered, false);
  });
});

describe("shouldRecheck", () => {
  test("asks again until the card is delivered, and never for an unpaid checkout", () => {
    assert.equal(shouldRecheck(null), true);
    assert.equal(shouldRecheck(readConfirmation({ ...paid, delivered: false })), true);
    assert.equal(shouldRecheck(readConfirmation({ status: "pending", delivered: false })), true);
    assert.equal(shouldRecheck(readConfirmation({ status: "error" })), true);
    assert.equal(shouldRecheck(readConfirmation(paid)), false);
    assert.equal(shouldRecheck(readConfirmation({ status: "unpaid" })), false);
  });
});

describe("searchWithoutSessionId", () => {
  test("drops only session_id", () => {
    assert.equal(searchWithoutSessionId("?session_id=cs_test_a"), "");
    assert.equal(searchWithoutSessionId("?a=1&session_id=cs_test_a&b=2"), "?a=1&b=2");
    assert.equal(searchWithoutSessionId(""), "");
  });
});
