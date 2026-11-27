import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cardPathFor } from "../src/catalog/schema.ts";
import { validateCatalogLinks, validateCatalogSettings, validatePricing } from "../src/catalog/validate.ts";
import { validateItems } from "../src/collections/validate.ts";
import { buildFixture, writeFixture } from "./catalog-fixture.mjs";

const repo = new URL("..", import.meta.url).pathname;

test("the fixture is deterministic and has n pieces plus the settings and a catalog page", () => {
  const a = buildFixture(30);
  assert.deepEqual(a, buildFixture(30));
  const items = Object.keys(a).filter((path) => path.startsWith("src/content/collections/catalog/"));
  assert.equal(items.length, 30);
  assert.ok(a["src/content/catalog.json"].filters.length === 6);
  assert.ok(a["src/content/pricing.json"].groups.length === 2);
  assert.deepEqual(a["src/content/pages/catalog.json"].blocks.map((block) => block.type), ["hero", "catalog"]);
  assert.throws(() => buildFixture(-1), /whole number/);
});

test("the settings, pricing and pieces pass the catalog validators, and every photo has its card file", () => {
  const files = buildFixture(120);
  const settings = files["src/content/catalog.json"];
  const pricing = files["src/content/pricing.json"];
  assert.deepEqual(validateCatalogSettings(settings), []);
  assert.deepEqual(validatePricing(pricing), []);
  const items = Object.entries(files)
    .filter(([path]) => path.startsWith("src/content/collections/catalog/"))
    .map(([path, { status, ...data }]) => ({ slug: path.split("/").pop().slice(0, -5), status, data }));
  assert.deepEqual(validateCatalogLinks({ settings, pricing, items }), []);
  const repoFiles = { imageExists: (src) => existsSync(join(repo, "public", src)), fileExists: () => true };
  const loaded = items.map(({ slug, status, data }) => ({ kind: "catalog", slug, data: { status, ...data } }));
  const ctx = { repo: repoFiles, pages: new Map(), forms: new Map(), catalog: { settings, pricing, items: new Set(items.map((i) => i.slug)) } };
  assert.deepEqual(validateItems(loaded, ctx), []);
  for (const item of items) for (const photo of item.data.photos) assert.ok(repoFiles.imageExists(cardPathFor(photo.src)), cardPathFor(photo.src));
});

test("writeFixture writes the files under the folder and nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-fixture-"));
  try {
    assert.equal(writeFixture(5, dir), 8);
    assert.equal(readdirSync(join(dir, "src/content/collections/catalog")).length, 5);
    assert.equal(JSON.parse(readFileSync(join(dir, "src/content/pages/catalog.json"), "utf8")).path, "/catalog");
    assert.equal(existsSync(join(dir, "public")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
