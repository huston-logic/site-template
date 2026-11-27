import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultRange, formatMoney, formatRange, priceRange, resolveSelection } from "./price.ts";
import type { PriceItem, PricingTable } from "./schema.ts";

const table = (over: Partial<PricingTable> = {}): PricingTable => ({
  currency: "USD",
  rounding: 1,
  spread: 0,
  note: "Prices are estimates.",
  groups: [
    { id: "metal", name: "Metal", choices: [{ id: "14k", label: "14k gold", add: 0 }, { id: "18k", label: "18k gold", multiply: 1.25 }, { id: "plat", label: "Platinum", add: 500 }] },
    { id: "size", name: "Size", choices: [{ id: "small", label: "Small", multiply: 1 }, { id: "large", label: "Large", multiply: 1.5 }] },
  ],
  perPerson: { label: "Guests", amount: 6, min: 10, max: 300 },
  exact: {},
  ...over,
});
const item = (over: Partial<PriceItem> = {}): PriceItem => ({ price: { low: 1200, high: 1800 }, options: ["metal", "size"], perPerson: false, ...over });
const range = (it: PriceItem, pricing: PricingTable, selection = {}, slug = "ring") => {
  const priced = priceRange(it, pricing, selection, slug);
  assert.ok(priced.ok, priced.ok ? "" : priced.problem);
  return priced.result;
};
const refused = (it: PriceItem, pricing: PricingTable, selection: object, slug = "ring") => {
  const priced = priceRange(it, pricing, selection, slug);
  assert.equal(priced.ok, false);
  return priced.ok ? "" : priced.problem;
};

describe("ask", () => {
  test("a price on request returns ask and stops", () => assert.deepEqual(range(item({ price: "ask" }), table()), { kind: "ask" }));
  test("an ask item still refuses a bad selection", () => void refused(item({ price: "ask" }), table(), { options: { metal: "nope" } }));
});

describe("defaults", () => {
  test("an empty selection takes the first choice of each group", () => assert.deepEqual(range(item(), table()), { kind: "range", low: 1200, high: 1800 }));
  test("defaultRange matches", () => assert.deepEqual(defaultRange(item(), table(), "ring"), { kind: "range", low: 1200, high: 1800 }));
  test("defaultRange reads a refusal as ask", () => assert.deepEqual(defaultRange(item({ options: ["gone"] }), table(), "ring"), { kind: "ask" }));
  test("an item with no options is just its base price", () => assert.deepEqual(range(item({ options: [] }), table()), { kind: "range", low: 1200, high: 1800 }));
});

describe("multiply then add", () => {
  test("multiply applies to the base, add after", () => {
    assert.deepEqual(range(item(), table(), { options: { metal: "18k" } }), { kind: "range", low: 1500, high: 2250 });
    assert.deepEqual(range(item(), table(), { options: { metal: "plat" } }), { kind: "range", low: 1700, high: 2300 });
  });
  test("an add and a multiply together: multiply first, then add", () => {
    const pricing = table({ groups: [{ id: "a", name: "A", choices: [{ id: "x", label: "X", add: 100 }, { id: "y", label: "Y", add: 200 }] }, { id: "m", name: "M", choices: [{ id: "one", label: "One", multiply: 1 }, { id: "two", label: "Two", multiply: 2 }] }] });
    assert.deepEqual(range(item({ options: ["a", "m"] }), pricing, { options: { a: "y", m: "two" } }), { kind: "range", low: 2600, high: 3800 });
  });
  test("two multiplies stack", () => assert.deepEqual(range(item(), table(), { options: { metal: "18k", size: "large" } }), { kind: "range", low: 2250, high: 3375 }));
  test("a negative add never goes below 0", () => {
    const pricing = table({ groups: [{ id: "g", name: "G", choices: [{ id: "a", label: "A", add: 0 }, { id: "b", label: "B", add: -5000 }] }] });
    assert.deepEqual(range(item({ options: ["g"] }), pricing, { options: { g: "b" } }), { kind: "range", low: 0, high: 0 });
  });
  test("four-decimal multipliers do not drift", () => {
    const pricing = table({ groups: [{ id: "g", name: "G", choices: [{ id: "a", label: "A", multiply: 1 }, { id: "b", label: "B", multiply: 1.1 }] }] });
    assert.deepEqual(range(item({ options: ["g"], price: { low: 1200, high: 1200 } }), pricing, { options: { g: "b" } }), { kind: "range", low: 1320, high: 1320 });
  });
});

describe("exact prices", () => {
  const pricing = table({ exact: { ring: { metal: { "18k": 2100, plat: 2600 } } } });
  test("an exact price replaces the base and that group adds no rule", () => {
    assert.deepEqual(range(item(), pricing, { options: { metal: "18k" } }), { kind: "range", low: 2100, high: 2100 });
    assert.deepEqual(range(item(), pricing, { options: { metal: "plat" } }), { kind: "range", low: 2600, high: 2600 });
  });
  test("the other groups still apply to the exact price", () => assert.deepEqual(range(item(), pricing, { options: { metal: "18k", size: "large" } }), { kind: "range", low: 3150, high: 3150 }));
  test("a choice with no exact price uses the base and the group's rule", () => assert.deepEqual(range(item(), pricing, { options: { metal: "14k" } }), { kind: "range", low: 1200, high: 1800 }));
  test("exact prices belong to their slug", () => assert.deepEqual(range(item(), pricing, { options: { metal: "18k" } }, "other"), { kind: "range", low: 1500, high: 2250 }));
  test("exact prices for two groups of one item are refused", () => {
    const two = table({ exact: { ring: { metal: { "18k": 1 }, size: { large: 2 } } } });
    refused(item(), two, {});
  });
});

describe("per person", () => {
  const fee = item({ options: [], perPerson: true });
  test("the fee joins the total for an item that takes it, at the minimum by default", () => assert.deepEqual(range(fee, table()), { kind: "range", low: 1260, high: 1860 }));
  test("the visitor's number", () => assert.deepEqual(range(fee, table(), { people: 40 }), { kind: "range", low: 1440, high: 2040 }));
  test("the fee comes after multiplying", () => assert.deepEqual(range(item({ perPerson: true }), table(), { options: { size: "large" }, people: 10 }), { kind: "range", low: 1860, high: 2760 }));
  test("an item without the flag has no fee", () => assert.deepEqual(range(item({ options: [] }), table()), { kind: "range", low: 1200, high: 1800 }));
  test("people given for an item with no fee are refused", () => void refused(item({ options: [] }), table(), { people: 20 }));
  test("people given when the table has no fee are refused", () => void refused(fee, table({ perPerson: null }), { people: 20 }));
  test("people below min, above max and not whole are refused", () => {
    refused(fee, table(), { people: 9 });
    refused(fee, table(), { people: 301 });
    refused(fee, table(), { people: 12.5 });
  });
  test("the limits themselves are fine", () => {
    range(fee, table(), { people: 10 });
    range(fee, table(), { people: 300 });
  });
});

describe("spread and rounding", () => {
  test("spread 0 and rounding 1 leave the figures alone", () => assert.deepEqual(range(item({ options: [] }), table()), { kind: "range", low: 1200, high: 1800 }));
  test("spread 10 lowers the low end and raises the high end", () => assert.deepEqual(range(item({ options: [] }), table({ spread: 10 })), { kind: "range", low: 1080, high: 1980 }));
  test("low rounds down and high rounds up to the step", () => {
    assert.deepEqual(range(item({ options: [], price: { low: 1234, high: 1766 } }), table({ rounding: 100 })), { kind: "range", low: 1200, high: 1800 });
    assert.deepEqual(range(item({ options: [], price: { low: 1234, high: 1766 } }), table({ rounding: 25 })), { kind: "range", low: 1225, high: 1775 });
  });
  test("spread and rounding together", () => assert.deepEqual(range(item({ options: [], price: { low: 1234, high: 1766 } }), table({ spread: 10, rounding: 50 })), { kind: "range", low: 1100, high: 1950 }));
  test("a figure already on the step stays put", () => assert.deepEqual(range(item({ options: [], price: { low: 1200, high: 1800 } }), table({ rounding: 100 })), { kind: "range", low: 1200, high: 1800 }));
  test("the low end never goes below 0", () => assert.deepEqual(range(item({ options: [], price: { low: 3, high: 3 } }), table({ rounding: 10 })), { kind: "range", low: 0, high: 10 }));
  test("spread 50 rounds sensibly", () => assert.deepEqual(range(item({ options: [], price: { low: 100, high: 100 } }), table({ spread: 50 })), { kind: "range", low: 50, high: 150 }));
});

describe("refusals", () => {
  const sentence = (text: string) => assert.match(text, /^[A-Z][^"]*\.$/);
  test("an unknown group, a group the item lacks, an unknown choice", () => {
    sentence(refused(item(), table(), { options: { nope: "x" } }));
    sentence(refused(item({ options: ["metal"] }), table(), { options: { size: "large" } }));
    sentence(refused(item(), table(), { options: { metal: "nope" } }));
  });
  test("the problem never echoes the input", () => {
    assert.ok(!refused(item(), table(), { options: { metal: "SECRET-CHOICE" } }).includes("SECRET"));
    assert.ok(!refused(item(), table(), { options: { SECRET: "x" } }).includes("SECRET"));
  });
  test("an item naming a group the table lacks is refused", () => sentence(refused(item({ options: ["gone"] }), table(), {})));
  test("resolveSelection reports the same refusals", () => {
    assert.equal(resolveSelection(item(), table(), { options: { metal: "nope" } }).ok, false);
    const ok = resolveSelection(item({ perPerson: true }), table(), {});
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.deepEqual(ok.choices.map((c) => [c.group.id, c.choice.id]), [["metal", "14k"], ["size", "small"]]);
      assert.equal(ok.people, 10);
    }
  });
});

describe("formatting", () => {
  const words = { about: "About", to: "to", onRequest: "Price on request" };
  test("formatMoney has no cents and uses separators", () => {
    assert.equal(formatMoney(2100, "USD"), "$2,100");
    assert.equal(formatMoney(1234567, "USD"), "$1,234,567");
  });
  test("equal ends read About", () => assert.equal(formatRange({ kind: "range", low: 2100, high: 2100 }, "USD", words), "About $2,100"));
  test("a range reads low to high", () => assert.equal(formatRange({ kind: "range", low: 1200, high: 1800 }, "USD", words), "$1,200 to $1,800"));
  test("ask reads the on-request words", () => assert.equal(formatRange({ kind: "ask" }, "USD", words), "Price on request"));
});

describe("own keys only", () => {
  test("a slug that names a prototype property finds no exact price", () => {
    assert.deepEqual(range(item(), table(), {}, "constructor"), { kind: "range", low: 1200, high: 1800 });
  });
  test("an option named like a prototype property is refused", () => {
    refused(item(), table(), { options: { constructor: "14k" } });
  });
});
