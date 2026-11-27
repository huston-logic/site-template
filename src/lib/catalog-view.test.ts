import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exampleCatalog } from "../catalog/example.ts";
import { cardPrice, factsOf, itemView, pricingForItems, quietFacts } from "../components/hl/catalog-data.ts";

const { settings, pricing, items } = exampleCatalog;
const first = items[0]!;

describe("the catalog's card and item lines", () => {
  it("a card shows the default range with the first choices and says whether it is an estimate", () => {
    const price = cardPrice(itemView(first), pricing);
    assert.equal(price.isEstimate, true);
    assert.match(price.text, /^\$[\d,]+ to \$[\d,]+$|^About \$[\d,]+$/);
  });
  it("a piece whose price is left to ask about shows the on-request words and no estimate tag", () => {
    const ask = items.find((item) => item.data["price"] === "ask");
    assert.ok(ask);
    assert.deepEqual(cardPrice(itemView(ask), pricing), { text: "Price on request", isEstimate: false });
  });
  it("facts follow the site's filter order and use labels, not ids", () => {
    const facts = factsOf(itemView(first), settings);
    assert.equal(facts[0]?.name, "Type");
    assert.deepEqual(facts[0]?.labels, ["Jugs"]);
    assert.equal(quietFacts(itemView(first), settings, 2).split(", ").length, 2);
  });
});

describe("the pricing sent to the browser", () => {
  it("keeps exact prices only for the named pieces", () => {
    const table = { ...pricing, exact: { a: { g: { c: 1 } }, b: { g: { c: 2 } } } };
    assert.deepEqual(pricingForItems(table, ["a"]).exact, { a: { g: { c: 1 } } });
    assert.deepEqual(pricingForItems(table, ["z"]).exact, {});
    assert.deepEqual(Object.keys(pricingForItems(table, ["a", "b"]).exact), ["a", "b"]);
    assert.equal(pricingForItems(table, ["a"]).currency, pricing.currency);
  });
});
