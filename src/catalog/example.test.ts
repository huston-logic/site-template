import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateItems } from "../collections/validate.ts";
import type { Context } from "../blocks/validate.ts";
import { buildCatalogData, parseCatalogData } from "./data.ts";
import { exampleCatalog, exampleCardPaths } from "./example.ts";
import { defaultRange } from "./price.ts";
import { cardPathFor } from "./schema.ts";
import { validateCatalogLinks, validateCatalogSettings, validatePricing } from "./validate.ts";

const { settings, pricing, items } = exampleCatalog;
const ctx: Context = {
  repo: { imageExists: (src) => src.startsWith("/images/examples/"), fileExists: () => true },
  pages: null,
  catalog: { settings, pricing, items: new Set(items.map((item) => item.slug)) },
};

describe("the example catalog", () => {
  test("has about sixty live ceramics pieces and the six filters", () => {
    assert.equal(items.length, 60);
    assert.ok(items.every((item) => item.kind === "catalog" && item.status === "live"));
    assert.deepEqual(settings.filters.map((f) => f.name), ["Type", "Glaze", "Size", "Finish", "Collection", "Made"]);
    assert.equal(new Set(items.map((item) => item.slug)).size, 60);
  });
  test("passes the settings, pricing, item and link checks", () => {
    assert.deepEqual(validateCatalogSettings(settings), []);
    assert.deepEqual(validatePricing(pricing), []);
    const files = items.map((item) => ({ kind: item.kind, slug: item.slug, data: { status: item.status, ...item.data } }));
    assert.deepEqual(validateItems(files, ctx), []);
    assert.deepEqual(validateCatalogLinks({ settings, pricing, items: items.map((i) => ({ slug: i.slug, status: i.status, data: i.data })), itemRefs: true }), []);
  });
  test("uses only the six example photos and lists their card files", () => {
    const sources = new Set(items.flatMap((item) => (item.data["photos"] as { src: string }[]).map((photo) => photo.src)));
    assert.equal(sources.size, 6);
    assert.deepEqual([...sources].map(cardPathFor).sort(), [...exampleCardPaths].sort());
    for (const item of items) assert.ok((item.data["photos"] as unknown[]).length >= 1 && (item.data["photos"] as unknown[]).length <= 4);
  });
  test("has two ask pieces, a few exact prices and a fee only on dinner sets", () => {
    assert.equal(items.filter((item) => item.data["price"] === "ask").length, 2);
    assert.ok(Object.keys(pricing.exact).length >= 3);
    const fee = items.filter((item) => item.data["perPerson"] === true);
    assert.equal(fee.length, 10);
    assert.ok(fee.every((item) => (item.data["filters"] as Record<string, string[]>)["type"]?.[0] === "dinner-set"));
  });
  test("every piece has a price figure the price function can read", () => {
    for (const item of items) {
      const result = defaultRange({ price: item.data["price"] as never, options: item.data["options"] as string[], perPerson: item.data["perPerson"] === true }, pricing, item.slug);
      assert.ok(result.kind === "ask" ? item.data["price"] === "ask" : result.high >= result.low && result.low > 0);
    }
  });
});

describe("catalog data", () => {
  const data = buildCatalogData({ items, settings, pricing, pagePath: "/catalog" });
  test("holds the visible items, the pricing table and the item word", () => {
    assert.equal(Object.keys(data.items).length, 60);
    assert.deepEqual(data.itemWord, settings.itemWord);
    assert.equal(data.items["tall-jug-ash-glaze"]?.perPerson, false);
    assert.equal(data.pagePath, "/catalog");
  });
  test("round-trips through the strict parser", () => assert.deepEqual(parseCatalogData(JSON.parse(JSON.stringify(data))), data));
  test("the parser refuses anything off", () => {
    assert.equal(parseCatalogData(null), null);
    assert.equal(parseCatalogData({ ...data, version: 2 }), null);
    assert.equal(parseCatalogData({ ...data, extra: 1 }), null);
    assert.equal(parseCatalogData({ ...data, pagePath: "catalog" }), null);
    assert.equal(parseCatalogData({ ...data, pricing: { ...pricing, rounding: 3 } }), null);
    assert.equal(parseCatalogData({ ...data, items: { x: { name: "x", price: { low: 5, high: 1 }, options: [], perPerson: false, status: "live" } } }), null);
    assert.equal(parseCatalogData({ ...data, items: { x: { name: "x", price: "ask", options: [], perPerson: false, status: "live", range: [1, 2] } } }), null);
    assert.equal(parseCatalogData({ ...data, items: { x: { name: "x", price: "ask", options: [], perPerson: "no", status: "live" } } }), null);
  });
  test("leaves out items of other kinds and archived ones", () => {
    const first = items[0] as (typeof items)[number];
    const built = buildCatalogData({ items: [{ ...first, status: "archived" }, { ...first, slug: "p", kind: "posts" }], settings, pricing, pagePath: null });
    assert.deepEqual(built.items, {});
    assert.equal(built.pagePath, null);
  });
});
