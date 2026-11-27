import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCatalogLinks, validateCatalogSettings, validatePricing } from "./validate.ts";
import type { LinkItem } from "./validate.ts";
import type { CatalogSettings, PricingTable } from "./schema.ts";

const has = (list: string[], text: string) => assert.ok(list.some((line) => line.includes(text)), `expected "${text}" in:\n${list.join("\n")}`);
const settings = (): CatalogSettings => ({
  itemWord: { singular: "piece", plural: "pieces" },
  filters: [{ id: "glaze", name: "Glaze", values: [{ id: "ash", label: "Ash" }, { id: "rust", label: "Rust" }] }],
});
const pricing = (): PricingTable => ({
  currency: "USD",
  rounding: 10,
  spread: 0,
  note: "Prices are estimates.",
  groups: [{ id: "metal", name: "Metal", choices: [{ id: "a", label: "A", add: 0 }, { id: "b", label: "B", multiply: 1.25 }] }],
  perPerson: { label: "Guests", amount: 6, min: 10, max: 300 },
  exact: { ring: { metal: { b: 2100 } } },
});

describe("validateCatalogSettings", () => {
  test("a good file and the empty template pass", () => {
    assert.deepEqual(validateCatalogSettings(settings()), []);
    assert.deepEqual(validateCatalogSettings({ itemWord: { singular: "piece", plural: "pieces" }, filters: [] }), []);
  });
  test("names the file in every sentence", () => {
    for (const line of validateCatalogSettings({ itemWord: {}, filters: 3, extra: 1 })) assert.ok(line.startsWith("src/content/catalog.json"), line);
  });
  test("limits", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: "F", values: [{ id: "v", label: "V" }] }));
    has(validateCatalogSettings({ ...settings(), filters: eight }), "at most 7");
    const many = { id: "f", name: "F", values: Array.from({ length: 25 }, (_, i) => ({ id: `v${i}`, label: "V" })) };
    has(validateCatalogSettings({ ...settings(), filters: [many] }), "takes 1 to 24");
    has(validateCatalogSettings({ ...settings(), filters: [{ id: "f", name: "F", values: [] }] }), "takes 1 to 24");
    has(validateCatalogSettings({ ...settings(), itemWord: { singular: "x".repeat(25), plural: "pieces" } }), "at most 24");
    has(validateCatalogSettings({ ...settings(), filters: [{ id: "f", name: "x".repeat(31), values: [{ id: "v", label: "V" }] }] }), "at most 30");
  });
  test("ids are slugs and unique", () => {
    has(validateCatalogSettings({ ...settings(), filters: [{ id: "Bad Id", name: "F", values: [{ id: "v", label: "V" }] }] }), "lowercase words");
    const f = { id: "f", name: "F", values: [{ id: "v", label: "V" }, { id: "v", label: "W" }] };
    has(validateCatalogSettings({ ...settings(), filters: [f] }), 'the id "v" is used twice');
    has(validateCatalogSettings({ ...settings(), filters: [f, f] }), 'the id "f" is used twice');
  });
  test("unknown keys and html are refused", () => {
    has(validateCatalogSettings({ ...settings(), color: "red" }), '"color" is not');
    has(validateCatalogSettings({ ...settings(), itemWord: { singular: "<b>x</b>", plural: "xs" } }), "HTML tag");
  });
});

describe("validatePricing", () => {
  test("a good table and the empty template pass", () => {
    assert.deepEqual(validatePricing(pricing()), []);
    assert.deepEqual(validatePricing({ currency: "USD", rounding: 10, spread: 0, note: "n", groups: [], perPerson: null, exact: {} }), []);
  });
  test("scalar limits", () => {
    has(validatePricing({ ...pricing(), currency: "JPY" }), '"currency" must be one of');
    has(validatePricing({ ...pricing(), rounding: 7 }), '"rounding" must be one of');
    has(validatePricing({ ...pricing(), spread: 51 }), '"spread"');
    has(validatePricing({ ...pricing(), spread: 2.5 }), '"spread"');
    has(validatePricing({ ...pricing(), note: "" }), '"note" is empty');
    has(validatePricing({ ...pricing(), note: "x".repeat(161) }), "at most 160");
  });
  test("unknown keys and missing keys", () => {
    has(validatePricing({ ...pricing(), tax: 1 }), '"tax" is not');
    const rest: Record<string, unknown> = { ...pricing() };
    delete rest["exact"];
    has(validatePricing(rest), '"exact" is missing');
  });
  test("groups and choices", () => {
    const group = (choices: unknown[]) => ({ ...pricing(), groups: [{ id: "g", name: "G", choices }] });
    const one = { id: "a", label: "A", add: 0 };
    has(validatePricing(group([one])), "takes 2 to 12");
    has(validatePricing(group(Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, label: "C", add: 0 })))), "takes 2 to 12");
    has(validatePricing(group([one, { id: "b", label: "B" }])), 'exactly one of "add" or "multiply"');
    has(validatePricing(group([one, { id: "b", label: "B", add: 1, multiply: 2 }])), 'exactly one of "add" or "multiply"');
    has(validatePricing(group([one, { id: "b", label: "B", add: 1.5 }])), '"add" must be a whole number');
    has(validatePricing(group([one, { id: "b", label: "B", add: 1_000_001 }])), '"add" must be a whole number');
    has(validatePricing(group([one, { id: "b", label: "B", multiply: 0.05 }])), '"multiply"');
    has(validatePricing(group([one, { id: "b", label: "B", multiply: 10.5 }])), '"multiply"');
    has(validatePricing(group([one, { id: "b", label: "B", multiply: 1.12345 }])), "at most 4 decimals");
    assert.deepEqual(validatePricing(group([one, { id: "b", label: "B", multiply: 1.1234 }])), []);
    has(validatePricing(group([one, { ...one, label: "Again" }])), 'the id "a" is used twice');
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, name: "G", choices: [one, { id: "b", label: "B", add: 1 }] }));
    has(validatePricing({ ...pricing(), groups: seven }), "at most 6");
    has(validatePricing({ ...pricing(), groups: [pricing().groups[0], pricing().groups[0]] }), 'the id "metal" is used twice');
  });
  test("per person", () => {
    const fee = (over: Record<string, unknown>) => ({ ...pricing(), perPerson: { label: "Guests", amount: 6, min: 10, max: 300, ...over } });
    has(validatePricing(fee({ min: 20, max: 10 })), "above");
    has(validatePricing(fee({ amount: 10_001 })), '"amount"');
    has(validatePricing(fee({ max: 1001 })), '"max"');
    has(validatePricing(fee({ min: 0 })), '"min"');
    has(validatePricing(fee({ label: "x".repeat(25) })), "at most 24");
    has(validatePricing(fee({ extra: 1 })), '"extra" is not');
  });
  test("exact prices are whole amounts under slugs", () => {
    has(validatePricing({ ...pricing(), exact: { Ring: {} } }), "not a piece slug");
    has(validatePricing({ ...pricing(), exact: { ring: { metal: { b: 20.5 } } } }), "whole amount");
    has(validatePricing({ ...pricing(), exact: { ring: { metal: { b: -1 } } } }), "whole amount");
    has(validatePricing({ ...pricing(), exact: { ring: 5 } }), "must be an object");
  });
});

const item = (slug: string, data: Record<string, unknown> = {}, status = "live"): LinkItem => ({ slug, status, data: { options: ["metal"], ...data } });
const links = (over: Partial<Parameters<typeof validateCatalogLinks>[0]> = {}) =>
  validateCatalogLinks({ settings: settings(), pricing: pricing(), items: [item("ring")], ...over });

describe("validateCatalogLinks", () => {
  test("a joined set passes", () => assert.deepEqual(links(), []));
  test("an item names a filter or value that is gone, and a live item says it cannot lose it", () => {
    const out = links({ items: [item("ring", { filters: { glaze: ["moss"], size: ["small"] } })] });
    has(out, 'src/content/collections/catalog/ring.json: "moss" is not a value of the filter "glaze"');
    has(out, 'the filter "size" is not in src/content/catalog.json');
    has(out, "A piece that is live cannot lose them");
    assert.ok(!links({ items: [item("ring", { filters: { size: ["small"] } }, "draft")] }).join().includes("cannot lose"));
  });
  test("an item names an option group that is gone", () => has(links({ items: [item("ring", { options: ["metal", "gone"] })] }), 'the option group "gone"'));
  test("itemRefs false skips the item references", () => {
    const out = links({ items: [item("ring", { options: ["metal", "gone"], filters: { x: ["y"] } })], itemRefs: false });
    assert.deepEqual(out, []);
  });
  test("exact prices need a known item of any status", () => {
    has(links({ items: [] }), 'prices for "ring", which is not a piece');
    assert.deepEqual(links({ items: [item("ring", {}, "archived")] }), []);
  });
  test("exact prices need a group the item uses, and known choices", () => {
    has(links({ items: [item("ring", { options: [] })] }), "which src/content/collections/catalog/ring.json does not use");
    has(links({ pricing: { ...pricing(), exact: { ring: { metal: { zz: 1 } } } } }), 'names the choice "zz"');
    has(links({ pricing: { ...pricing(), exact: { ring: { nope: { b: 1 } } } } }), 'names the option group "nope"');
  });
  test("only one group per item may have exact prices", () => {
    const two: PricingTable = {
      ...pricing(),
      groups: [...pricing().groups, { id: "size", name: "Size", choices: [{ id: "s", label: "S", multiply: 1 }, { id: "l", label: "L", multiply: 2 }] }],
      exact: { ring: { metal: { b: 1 }, size: { l: 2 } } },
    };
    has(links({ pricing: two, items: [item("ring", { options: ["metal", "size"] })] }), "only one group per piece");
  });
  test("a per-person item needs the table's fee", () => {
    has(links({ items: [item("ring", { perPerson: true })], pricing: { ...pricing(), perPerson: null } }), "has no per-person fee");
    assert.deepEqual(links({ items: [item("ring", { perPerson: true })] }), []);
  });
  test("a null settings or pricing skips what it would judge", () => assert.deepEqual(links({ settings: null, pricing: null }), []));
});
