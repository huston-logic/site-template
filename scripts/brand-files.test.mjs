// Tests for the files generated from src/content/brand.json: `npm run check:config` fails when src/app/palette.css or
// src/lib/fonts.ts differ from it (scripts/config-rules.mjs: brandFiles, driftedFiles).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { brandFiles, driftedFiles } from "./config-rules.mjs";

const brand = JSON.parse(readFileSync(new URL("../src/content/brand.json", import.meta.url), "utf8"));
const read = (files) => (path) => files[path] ?? null;

describe("generated brand files", () => {
  test("the committed palette.css and fonts.ts match brand.json", () => {
    const generated = brandFiles(brand);
    const committed = Object.fromEntries(Object.keys(generated).map((path) => [path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8")]));
    assert.deepEqual(driftedFiles(generated, read(committed)), []);
  });

  test("a palette.css that differs from brand.json is reported with the differing line", () => {
    const generated = brandFiles(brand);
    const stale = { ...generated, "src/app/palette.css": generated["src/app/palette.css"].replace(brand.colors.green, "#000000") };
    const drift = driftedFiles(generated, read(stale));
    assert.equal(drift.length, 1);
    assert.match(drift[0], /src\/app\/palette\.css/);
    assert.match(drift[0], /--hl-green: #000000/);
  });

  test("a fonts.ts that differs from brand.json is reported", () => {
    const generated = brandFiles(brand);
    const other = brandFiles({ ...brand, fonts: { ...brand.fonts, display: "fraunces", body: "work-sans" } });
    const drift = driftedFiles(generated, read({ ...generated, "src/lib/fonts.ts": other["src/lib/fonts.ts"] }));
    assert.equal(drift.length, 1);
    assert.match(drift[0], /src\/lib\/fonts\.ts/);
  });

  test("a missing generated file counts as drift", () => {
    assert.equal(driftedFiles(brandFiles(brand), () => null).length, 2);
  });

  test("a font that is not curated and a color that is not #rrggbb are refused", () => {
    assert.throws(() => brandFiles({ ...brand, fonts: { ...brand.fonts, body: "comic-sans" } }), /not an allowed body font/);
    assert.throws(() => brandFiles({ ...brand, colors: { ...brand.colors, green: "blue" } }), /#rrggbb/);
  });
});
