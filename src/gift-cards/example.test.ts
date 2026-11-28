import assert from "node:assert/strict";
import { test } from "node:test";
import { exampleGiftCards } from "./example.ts";
import { validateGiftCards } from "./validate.ts";

test("the showcase settings sell, and pass the check when payments is on", () => {
  assert.equal(exampleGiftCards.selling, true);
  assert.deepEqual(validateGiftCards(exampleGiftCards, { paymentsOn: true }), []);
});
