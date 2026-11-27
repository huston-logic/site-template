import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Fields } from "../blocks/schema.ts";
import { validateFields } from "../blocks/validate.ts";
import type { Context } from "../blocks/validate.ts";
import { collectionFor } from "../collections/definitions.ts";
import { exampleCatalog } from "./example.ts";

const repo = { imageExists: () => true, fileExists: () => true };
const { settings, pricing } = exampleCatalog;
const full: Context = { repo, pages: null, catalog: { settings, pricing, items: new Set(["tall-jug-ash-glaze"]) } };
const shapeOnly: Context = { repo, pages: null };
const fields: Fields = {
  price: { kind: "price", label: "Price", required: false },
  filters: { kind: "filter-values", label: "Filters", required: false },
  options: { kind: "option-groups", label: "Options", required: false },
  item: { kind: "catalog-item", label: "Piece", required: false },
};
const check = (value: Record<string, unknown>, ctx: Context = full) => validateFields(fields, value, "page.json", ctx);
const has = (list: string[], text: string) => assert.ok(list.some((line) => line.includes(text)), `expected "${text}" in:\n${list.join("\n")}`);

describe("price", () => {
  test("accepts a range, an equal range and ask", () => {
    assert.deepEqual(check({ price: { low: 100, high: 200 } }), []);
    assert.deepEqual(check({ price: { low: 100, high: 100 } }), []);
    assert.deepEqual(check({ price: "ask" }), []);
  });
  test("refuses the rest", () => {
    has(check({ price: { low: 300, high: 200 } }), "above its high");
    has(check({ price: { low: 1.5, high: 2 } }), "whole");
    has(check({ price: { low: -1, high: 2 } }), "whole");
    has(check({ price: { low: 0, high: 10_000_001 } }), "whole");
    has(check({ price: { low: 1, high: 2, extra: 3 } }), '"extra"');
    has(check({ price: "free" }), "must be");
    has(check({ price: 5 }), "must be");
  });
});

describe("filter-values", () => {
  test("accepts known values", () => assert.deepEqual(check({ filters: { glaze: ["ash", "rust"], made: ["to-order"] } }), []));
  test("refuses an unknown filter or value, naming the settings file", () => {
    has(check({ filters: { nope: ["ash"] } }), 'the filter "nope", which is not in src/content/catalog.json');
    has(check({ filters: { glaze: ["moss"] } }), 'the value "moss", which is not in src/content/catalog.json');
  });
  test("refuses empty, too long, repeated and non-slug lists", () => {
    has(check({ filters: { glaze: [] } }), "1 to 6");
    has(check({ filters: { glaze: ["a", "b", "c", "d", "e", "f", "g"] } }, shapeOnly), "1 to 6");
    has(check({ filters: { glaze: ["ash", "ash"] } }), "twice");
    has(check({ filters: { glaze: ["Ash!"] } }), "not a value id");
    has(check({ filters: { "Bad Id": ["ash"] } }), "not a filter id");
    has(check({ filters: ["ash"] }), "must be an object");
  });
  test("without settings only the shape is checked", () => assert.deepEqual(check({ filters: { anything: ["goes"] } }, shapeOnly), []));
});

describe("option-groups", () => {
  test("accepts known groups", () => assert.deepEqual(check({ options: ["glaze-colour", "size"] }), []));
  test("refuses unknown, repeated, too many and malformed", () => {
    has(check({ options: ["nope"] }), 'the option group "nope", which is not in src/content/pricing.json');
    has(check({ options: ["size", "size"] }), "twice");
    has(check({ options: ["a", "b", "c", "d", "e"] }, shapeOnly), "at most 4");
    has(check({ options: "size" }), "must be a list");
    has(check({ options: [5] }), "not an option group id");
  });
  test("without pricing only the shape is checked", () => assert.deepEqual(check({ options: ["whatever"] }, shapeOnly), []));
});

describe("catalog-item", () => {
  test("accepts a live piece, or any slug when the site's pieces are not known", () => {
    assert.deepEqual(check({ item: "tall-jug-ash-glaze" }), []);
    assert.deepEqual(check({ item: "anything-at-all" }, shapeOnly), []);
  });
  test("refuses a piece that is not live, and a non-slug", () => {
    has(check({ item: "ghost" }), "is not a live piece");
    has(check({ item: "Not A Slug" }), "slug of a catalog piece");
  });
});

describe("the catalog collection", () => {
  const def = collectionFor("catalog");
  const good = () => ({ name: "Tall jug", photos: [{ src: "/images/examples/jug-and-cups.jpg", alt: "A tall blue jug beside two small cups" }], description: "A jug.", price: { low: 60, high: 80 }, order: 1 });
  const run = (data: Record<string, unknown>) => validateFields(def?.fields as Fields, data, "src/content/collections/catalog/tall-jug.json", full);
  test("is sorted by order and labelled by name", () => {
    assert.equal(def?.sort, "order");
    assert.equal(def?.labelField, "name");
  });
  test("a minimal piece passes", () => assert.deepEqual(run(good()), []));
  test("limits", () => {
    has(run({ ...good(), photos: [] }), "at least 1");
    has(run({ ...good(), photos: Array.from({ length: 7 }, () => good().photos[0]) }), "at most 6");
    has(run({ ...good(), name: "x".repeat(81) }), "at most 80");
    has(run({ ...good(), description: "x".repeat(601) }), "at most 600");
    has(run({ ...good(), order: 10_000 }), "at most 9999");
    has(run({ ...good(), perPerson: "yes" }), "true or false");
    has(run({ ...good(), photos: [{ src: "/images/examples/jug-and-cups.jpg", alt: "photo" }] }), "says nothing");
  });
});
