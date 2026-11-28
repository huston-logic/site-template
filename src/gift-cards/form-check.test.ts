import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { exampleGiftCards } from "./example.ts";
import { checkoutBody, chosenAmount, emptyValues, giftCardProblems, OTHER_CHOICE, type GiftCardValues } from "./form-check.ts";

const good: GiftCardValues = { ...emptyValues, choice: "50", buyerName: "Ada Lovelace", buyerEmail: "ada@example.test", recipientName: "Grace" };
const problems = (change: Partial<GiftCardValues>, settings = exampleGiftCards) => giftCardProblems(settings, { ...good, ...change });

describe("giftCardProblems", () => {
  test("a complete form has no problems, with the optional fields empty", () => {
    assert.deepEqual(problems({}), []);
    assert.deepEqual(problems({ message: "Happy birthday", recipientEmail: "grace@example.test" }), []);
  });

  test("nothing chosen is an amount problem", () => {
    assert.deepEqual(problems({ choice: "" }), ["amount"]);
  });

  test("a preset the owner does not list is an amount problem", () => {
    assert.deepEqual(problems({ choice: "75" }), ["amount"]);
  });

  test("the other amount is judged by the owner's range, at both ends", () => {
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "25" }), []);
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "500" }), []);
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "24" }), ["custom"]);
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "501" }), ["custom"]);
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "" }), ["custom"]);
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "12.50" }), ["custom"]);
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "1e3" }), ["custom"]);
  });

  test("the other amount is refused when the site does not offer one", () => {
    assert.deepEqual(problems({ choice: OTHER_CHOICE, custom: "100" }, { ...exampleGiftCards, custom: null }), ["custom"]);
  });

  test("the buyer's name and email are required; the recipient's name and email are optional", () => {
    assert.deepEqual(problems({ buyerName: "  " }), ["buyerName"]);
    assert.deepEqual(problems({ buyerEmail: "ada" }), ["buyerEmail"]);
    assert.deepEqual(problems({ recipientName: "" }), []);
    assert.deepEqual(problems({ recipientName: "x".repeat(101) }), ["recipientName"]);
    assert.deepEqual(problems({ recipientEmail: "grace" }), ["recipientEmail"]);
  });

  test("the message holds up to 300 characters and the problems come in form order", () => {
    assert.deepEqual(problems({ message: "a".repeat(300) }), []);
    assert.deepEqual(problems({ message: "a".repeat(301), choice: "", buyerName: "" }), ["amount", "buyerName", "message"]);
  });
});

describe("chosenAmount and checkoutBody", () => {
  test("a preset and a custom amount are told apart, and junk is no amount", () => {
    assert.deepEqual(chosenAmount({ ...good, choice: "50" }), { kind: "preset", amount: 50 });
    assert.deepEqual(chosenAmount({ ...good, choice: OTHER_CHOICE, custom: " 137 " }), { kind: "custom", amount: 137 });
    assert.equal(chosenAmount({ ...good, choice: "" }), null);
    assert.equal(chosenAmount({ ...good, choice: OTHER_CHOICE, custom: "-5" }), null);
  });

  test("the body is cleaned and leaves empty optional fields out", () => {
    const body = checkoutBody({ ...good, buyerName: "  Ada   Lovelace ", message: "  Hi\r\nthere ", recipientEmail: "" }, { kind: "preset", amount: 50 }, "/gift-cards");
    assert.deepEqual(body, { choice: { kind: "preset", amount: 50 }, buyerName: "Ada Lovelace", buyerEmail: "ada@example.test", recipientName: "Grace", message: "Hi\nthere", returnPath: "/gift-cards" });
  });
});
