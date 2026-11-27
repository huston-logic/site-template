import assert from "node:assert/strict";
import { test } from "node:test";
import type { PricingTable } from "../../src/catalog/schema.ts";
import { IMPACT_LINES, impactLines, priceImpact, rangeText, type ImpactItem } from "./price-impact.ts";

const table = (over: Partial<PricingTable> = {}): PricingTable => ({
  currency: "USD",
  rounding: 10,
  spread: 0,
  note: "Prices are estimates.",
  groups: [
    {
      id: "metal",
      name: "Metal",
      choices: [
        { id: "14k-gold", label: "14k gold", add: 0 },
        { id: "18k-gold", label: "18k gold", multiply: 1.25 },
      ],
    },
  ],
  perPerson: null,
  exact: {},
  ...over,
});

const ring = (slug: string, order = 1): ImpactItem => ({ slug, name: `Ring ${slug}`, order, item: { price: { low: 1000, high: 1200 }, options: ["metal"] } });
const plain: ImpactItem = { slug: "plain", name: "Plain piece", order: 99, item: { price: { low: 500, high: 500 } } };
const scaled = (percent: number): PricingTable =>
  table({ groups: [{ id: "metal", name: "Metal", choices: [{ id: "14k-gold", label: "14k gold", add: 0 }, { id: "18k-gold", label: "18k gold", multiply: Math.round(1.25 * (1 + percent / 100) * 1e4) / 1e4 }] }] });

test("a change to one choice reports the first selection that shows it", () => {
  const impact = priceImpact(table(), scaled(5), [ring("a"), plain]);
  assert.equal(impact.total, 1);
  assert.deepEqual(impact.lines, [{ name: "Ring a", choice: "18k gold", was: "$1,250 to $1,500", now: "$1,310 to $1,580" }]);
  assert.equal(impact.more, 0);
});

test("the default selection is tried first, and is named by its default choices", () => {
  const raised = table({ groups: [{ id: "metal", name: "Metal", choices: [{ id: "14k-gold", label: "14k gold", add: 100 }, { id: "18k-gold", label: "18k gold", multiply: 1.25 }] }] });
  const impact = priceImpact(table(), raised, [ring("a")]);
  assert.deepEqual(impact.lines, [{ name: "Ring a", choice: "14k gold", was: "$1,000 to $1,200", now: "$1,100 to $1,300" }]);
});

test("an exact price that changes shows under its own choice", () => {
  const was = table({ exact: { a: { metal: { "18k-gold": 2000 } } } });
  const now = table({ exact: { a: { metal: { "18k-gold": 2100 } } } });
  const impact = priceImpact(was, now, [ring("a"), ring("b")]);
  assert.equal(impact.total, 1);
  assert.deepEqual(impact.lines, [{ name: "Ring a", choice: "18k gold", was: "About $2,000", now: "About $2,100" }]);
});

test("a piece with no options is named 'no options' when its own range moves", () => {
  const impact = priceImpact(table(), table({ spread: 10 }), [plain]);
  assert.deepEqual(impact.lines, [{ name: "Plain piece", choice: "no options", was: "About $500", now: "$450 to $550" }]);
});

test("pieces are listed by order then name, at most 12, and the rest are counted", () => {
  const items = Array.from({ length: 15 }, (_, i) => ring(`r${String(i).padStart(2, "0")}`, 15 - i));
  const impact = priceImpact(table(), scaled(10), items);
  assert.equal(impact.total, 15);
  assert.equal(impact.lines.length, IMPACT_LINES);
  assert.equal(impact.more, 3);
  assert.equal(impact.lines[0]?.name, "Ring r14", "lowest order first");
  const text = impactLines(impact, { singular: "piece", plural: "pieces" });
  assert.equal(text[0], "This changes the price of 15 pieces.");
  assert.equal(text.length, 1 + 12 + 1);
  assert.equal(text[text.length - 1], "and 3 more.");
});

test("no change says so in the owner's item word, and one piece reads in the singular", () => {
  const words = { singular: "cake", plural: "cakes" };
  assert.deepEqual(impactLines(priceImpact(table(), table(), [ring("a")]), words), ["No cake's price changes."]);
  assert.equal(impactLines(priceImpact(table(), scaled(5), [ring("a")]), words)[0], "This changes the price of 1 cake.");
});

test("a price on request stays on request", () => {
  const ask: ImpactItem = { slug: "x", name: "X", order: 1, item: { price: "ask", options: ["metal"] } };
  assert.equal(priceImpact(table(), scaled(5), [ask]).total, 0);
  assert.equal(rangeText(ask.item, table(), {}, "x"), "Price on request");
});
