import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LoadedItem } from "../collections/schema.ts";
import { buildCatalogData, parseCatalogData } from "./data.ts";
import type { PricingTable } from "./schema.ts";

const pricing: PricingTable = {
  currency: "USD",
  rounding: 5,
  spread: 0,
  note: "Estimates only.",
  groups: [{ id: "metal", name: "Metal", choices: [{ id: "plain", label: "Plain", add: 0 }, { id: "gilded", label: "Gilded", multiply: 1.25 }] }],
  perPerson: null,
  exact: {
    "live-ring": { metal: { gilded: 2100 } },
    "draft-ring": { metal: { gilded: 3100 } },
    "archived-ring": { metal: { gilded: 4100 } },
  },
};

const piece = (slug: string, status: LoadedItem["status"]): LoadedItem => ({
  kind: "catalog",
  slug,
  status,
  data: { name: slug, price: { low: 1000, high: 1500 }, options: ["metal"], perPerson: false },
});
const settings = { itemWord: { singular: "piece", plural: "pieces" }, filters: [] };

describe("buildCatalogData", () => {
  test("production data (visible items only) leaves out a draft and an archived piece's exact prices and slugs", () => {
    const data = buildCatalogData({ items: [piece("live-ring", "live"), piece("draft-ring", "draft"), piece("archived-ring", "archived")].filter((item) => item.status === "live"), settings, pricing, pagePath: "/shop" });
    assert.deepEqual(Object.keys(data.pricing.exact), ["live-ring"]);
    const text = JSON.stringify(data);
    for (const hidden of ["draft-ring", "archived-ring", "3100", "4100"]) assert.ok(!text.includes(hidden), hidden);
    assert.ok(parseCatalogData(JSON.parse(text)), "the strict reader still accepts it");
  });

  test("an archived item given by mistake is still left out, with its exact prices", () => {
    const data = buildCatalogData({ items: [piece("live-ring", "live"), piece("archived-ring", "archived")], settings, pricing, pagePath: null });
    assert.deepEqual(Object.keys(data.items), ["live-ring"]);
    assert.deepEqual(Object.keys(data.pricing.exact), ["live-ring"]);
  });

  test("a preview build (drafts shown) keeps a draft piece and its exact prices, never an archived one's", () => {
    const data = buildCatalogData({ items: [piece("live-ring", "live"), piece("draft-ring", "draft")], settings, pricing, pagePath: "/shop" });
    assert.deepEqual(Object.keys(data.items), ["live-ring", "draft-ring"]);
    assert.equal(data.items["draft-ring"]?.status, "draft");
    assert.deepEqual(Object.keys(data.pricing.exact), ["live-ring", "draft-ring"]);
  });

  test("the pricing table given is not changed", () => {
    buildCatalogData({ items: [piece("live-ring", "live")], settings, pricing, pagePath: null });
    assert.equal(Object.keys(pricing.exact).length, 3);
  });
});
