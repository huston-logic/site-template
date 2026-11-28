import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { FONT_FILES } from "./font-files.ts";
import { CURATED_FONTS, DESIGN_FACES, FONT_ROLES, fontsModule, localFontKey, needsLocalFiles, requestFor } from "./fonts.ts";

type FontData = Record<string, { weights: string[]; styles: string[]; subsets: string[]; axes?: { tag: string; min: number; max: number }[] }>;
const data = JSON.parse(
  readFileSync(new URL("../../node_modules/next/dist/compiled/@next/font/dist/google/font-data.json", import.meta.url), "utf8"),
) as FontData;

test("every curated font is a variable Google font with a latin subset (and italic for the accent)", () => {
  for (const role of FONT_ROLES) {
    for (const font of CURATED_FONTS[role]) {
      const entry = data[font.family];
      assert.ok(entry, `${font.family} is not in Next's font data`);
      assert.ok(entry.weights.includes("variable"), `${font.family} is not variable`);
      assert.ok(entry.subsets.includes("latin"), `${font.family} has no latin subset`);
      if (role === "accent") assert.ok(entry.styles.includes("italic"), `${font.family} has no italic`);
      for (const axis of font.axes ?? []) assert.ok(entry.axes?.some((a) => a.tag === axis), `${font.family} has no ${axis} axis`);
    }
  }
});

test("the curated lists are the ruled ones, defaults first", () => {
  const ids = (role: (typeof FONT_ROLES)[number]) => CURATED_FONTS[role].map((f) => f.id);
  assert.deepEqual(ids("display"), ["outfit", "manrope", "sora", "dm-sans", "plus-jakarta-sans", "fraunces"]);
  assert.deepEqual(ids("body"), ["inter", "source-sans-3", "work-sans", "nunito-sans", "figtree", "lora"]);
  assert.deepEqual(ids("accent"), ["newsreader", "fraunces", "lora", "playfair-display"]);
});

test("fontsModule starts with the generated-file header", () => {
  assert.match(fontsModule({ display: "outfit", body: "inter", accent: "newsreader" }), /^\/\/ Generated from src\/content\/brand\.json by `npm run sync:config`; do not edit by hand\.\n/);
});

test("fontsModule for the defaults is the committed src/lib/fonts.ts", () => {
  const committed = readFileSync(new URL("../lib/fonts.ts", import.meta.url), "utf8");
  assert.equal(fontsModule({ display: "outfit", body: "inter", accent: "newsreader" }), committed);
});

test("display and body keep their variable file; the accent is pinned at the design's one weight", () => {
  const out = fontsModule({ display: "outfit", body: "inter", accent: "newsreader" });
  assert.match(out, /export const outfit = Outfit\(\{\n  subsets: \["latin"\],\n  variable: "--hl-outfit",/);
  assert.match(out, /export const inter = Inter\(\{\n  subsets: \["latin"\],\n  variable: "--font-inter",/);
  assert.doesNotMatch(out, /from "next\/font\/google";[\s\S]*Newsreader\(/);
  assert.match(out, /export const newsreader = localFont\(\{\n  src: "..\/brand\/font-files\/accent-newsreader-latin.woff2",\n  weight: "400",\n  style: "italic",/);
  assert.match(out, /preload: false,\n  adjustFontFallback: "Times New Roman",/);
});

test("a pinned accent without an extra axis comes from next/font/google at weight 400", () => {
  for (const accent of ["lora", "playfair-display"]) {
    const out = fontsModule({ display: "outfit", body: "inter", accent });
    assert.match(out, /export const newsreader = (Lora|Playfair_Display)\(\{\n  subsets: \["latin"\],\n  weight: "400",\n  style: \["italic"\],\n  variable: "--font-newsreader",/);
    assert.doesNotMatch(out, /localFont/);
  }
});

test("every local subset declares the one family and Google's unicode-range, latin last", () => {
  const out = fontsModule({ display: "outfit", body: "inter", accent: "newsreader" });
  const families = [...out.matchAll(/\{ prop: "font-family", value: "([^"]+)" \}/g)].map((m) => m[1]);
  assert.deepEqual(families, ["Newsreader", "Newsreader", "Newsreader"]);
  const files = [...out.matchAll(/src: "..\/brand\/font-files\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(files, FONT_FILES["accent-newsreader"].faces.map((face) => face.file));
  assert.equal(files.at(-1), "accent-newsreader-latin.woff2");
  assert.match(out, /export const fontVariables = \[outfit\.variable, inter\.variable, newsreader\.variable, newsreaderVietnamese\.variable, newsreaderLatinExt\.variable\]\.join\(" "\);/);
});

test("every font that needs local files has them, and they are the bytes the table records", () => {
  for (const role of FONT_ROLES) {
    for (const font of CURATED_FONTS[role]) {
      if (!needsLocalFiles(role, font)) continue;
      const entry = FONT_FILES[localFontKey(role, font)];
      assert.ok(entry, `no files for ${localFontKey(role, font)}`);
      assert.equal(entry.request, requestFor(role, font, data[font.family]));
      assert.ok(entry.faces.some((face) => face.subset === "latin"));
      for (const face of entry.faces) {
        const bytes = readFileSync(new URL(`./font-files/${face.file}`, import.meta.url));
        assert.equal(bytes.length, face.bytes, face.file);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), face.sha256, face.file);
      }
    }
  }
  const expected = FONT_ROLES.flatMap((role) => CURATED_FONTS[role].filter((font) => needsLocalFiles(role, font)).map((font) => localFontKey(role, font)));
  assert.deepEqual(Object.keys(FONT_FILES).sort(), expected.sort());
});

test("only the accent pins a weight, and every curated font carries the design's weights", () => {
  for (const role of FONT_ROLES) {
    for (const font of CURATED_FONTS[role]) {
      const entry = data[font.family];
      for (const weight of DESIGN_FACES[role].weights) assert.ok(entry.weights.includes(String(weight)), `${font.family} has no ${weight}`);
      if (needsLocalFiles(role, font)) assert.equal(role, "accent");
    }
  }
  assert.equal(
    requestFor("accent", CURATED_FONTS.accent[0], data.Newsreader),
    "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@1,6..72,400&display=swap",
  );
});

test("fontsModule keeps the export names and CSS variables whatever the choice", () => {
  const out = fontsModule({ display: "dm-sans", body: "source-sans-3", accent: "playfair-display" });
  assert.match(out, /import \{ DM_Sans, Playfair_Display, Source_Sans_3 \} from "next\/font\/google";/);
  assert.match(out, /export const outfit = DM_Sans\(\{/);
  assert.match(out, /export const inter = Source_Sans_3\(\{/);
  assert.match(out, /export const newsreader = Playfair_Display\(\{/);
  assert.match(out, /export const fontVariables = \[outfit\.variable, inter\.variable, newsreader\.variable\]/);
  assert.match(out, /--hl-outfit/);
  assert.match(out, /--font-inter/);
  assert.match(out, /--font-newsreader/);
  assert.doesNotMatch(out, /axes/);
});

test("the same family in two roles is imported once and called twice", () => {
  const out = fontsModule({ display: "fraunces", body: "inter", accent: "fraunces" });
  assert.match(out, /import \{ Fraunces, Inter \} from/);
  assert.match(out, /export const outfit = Fraunces\(/);
  assert.match(out, /export const fraunces = localFont\(\{/);
  assert.match(out, /\{ prop: "font-family", value: "Fraunces" \}/);
  assert.match(out, /fraunces\.variable/);
});

test("fontsModule throws on an id that is not in the role's list", () => {
  assert.throws(() => fontsModule({ display: "comic-sans", body: "inter", accent: "newsreader" }), /not an allowed display font/);
  assert.throws(() => fontsModule({ display: "outfit", body: "newsreader", accent: "newsreader" }), /not an allowed body font/);
  assert.throws(() => fontsModule({ display: "outfit", body: "inter", accent: 'x"; evil(); //' }), /not an allowed accent font/);
});
