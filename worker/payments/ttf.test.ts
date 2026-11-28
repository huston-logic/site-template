import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTtf } from "./ttf.ts";

const font = (name: string) => new Uint8Array(readFileSync(new URL(`../../src/brand/certificate-fonts/${name}`, import.meta.url)));

test("reads the metrics of a real display font", () => {
  const ttf = parseTtf(font("display-outfit-600.ttf"));
  assert.ok(ttf.unitsPerEm >= 500 && ttf.unitsPerEm <= 4096);
  assert.ok(ttf.ascender > 0 && ttf.descender < 0);
  assert.ok(ttf.capHeight > 0 && ttf.capHeight < ttf.unitsPerEm);
  assert.equal(ttf.bbox.length, 4);
  assert.ok(ttf.weight >= 500);
  assert.equal(ttf.italicAngle, 0);
});

test("reads the italic angle of the accent font", () => {
  assert.ok(parseTtf(font("accent-newsreader-italic.ttf")).italicAngle < 0);
});

test("maps characters to glyphs and advances", () => {
  const ttf = parseTtf(font("display-outfit-400.ttf"));
  const a = ttf.glyphFor("A");
  assert.ok(a > 0);
  assert.ok(ttf.advance(a) > 0);
  assert.notEqual(ttf.glyphFor("B"), a);
  assert.ok(ttf.advance(ttf.glyphFor("W")) > ttf.advance(ttf.glyphFor("i")));
  for (const ch of "é ñ ü – — ‘ ’ “ ” • … € ™ Ł ž".split(" ")) assert.ok(ttf.hasChar(ch), `no glyph for ${ch}`);
});

test("a missing character falls back to its accent-stripped form, then to a question mark", () => {
  const ttf = parseTtf(font("display-outfit-400.ttf"));
  assert.equal(ttf.hasChar("ǎ"), false);
  assert.equal(ttf.glyphFor("ǎ").valueOf(), ttf.glyphFor("a"));
  assert.equal(ttf.glyphFor("中"), ttf.glyphFor("?"));
  assert.equal(ttf.glyphFor("\u{1f600}"), ttf.glyphFor("?"));
  assert.equal(ttf.fallbackChar("ǎ"), "a");
  assert.equal(ttf.fallbackChar("中"), "?");
  assert.equal(ttf.fallbackChar("A"), "A");
});

/** A tiny TrueType file: glyphs 0 to 2, with the given cmap subtable bytes. */
function tinyTtf(cmapSubtable: number[], platform: number, encoding: number): Uint8Array {
  const u16 = (n: number) => [(n >> 8) & 255, n & 255];
  const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const head = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0), ...u16(1000), ...new Array(16).fill(0), ...u16(0), ...u16(0), ...u16(1000), ...u16(1000), ...u16(0), ...u16(8), ...u16(2), ...u16(0), ...u16(0)];
  const hhea = [...u32(0x10000), ...u16(800), ...u16(0xfe0c), ...new Array(26).fill(0), ...u16(3)];
  hhea.splice(34, 2, ...u16(3));
  const hmtx = [...u16(500), ...u16(0), ...u16(600), ...u16(0), ...u16(700), ...u16(0)];
  const maxp = [...u32(0x10000), ...u16(3), ...new Array(26).fill(0)];
  const cmap = [...u16(0), ...u16(1), ...u16(platform), ...u16(encoding), ...u32(12), ...cmapSubtable];
  const tables: [string, number[]][] = [["cmap", cmap], ["head", head], ["hhea", hhea], ["hmtx", hmtx], ["maxp", maxp]];
  const out: number[] = [...u32(0x10000), ...u16(tables.length), ...u16(0), ...u16(0), ...u16(0)];
  let offset = 12 + tables.length * 16;
  const bodies: number[] = [];
  for (const [tag, bytes] of tables) {
    out.push(...[...tag].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(offset), ...u32(bytes.length));
    const padded = [...bytes, ...new Array((4 - (bytes.length % 4)) % 4).fill(0)];
    bodies.push(...padded);
    offset += padded.length;
  }
  return new Uint8Array([...out, ...bodies]);
}

test("reads cmap format 12 and falls back on metrics a file does not have", () => {
  const u16 = (n: number) => [(n >> 8) & 255, n & 255];
  const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Two groups: U+0041..U+0042 -> glyph 1.., and U+1F600 -> glyph 2.
  const sub = [...u16(12), ...u16(0), ...u32(16 + 24), ...u32(0), ...u32(2), ...u32(0x41), ...u32(0x42), ...u32(1), ...u32(0x1f600), ...u32(0x1f600), ...u32(2)];
  const ttf = parseTtf(tinyTtf(sub, 3, 10));
  assert.equal(ttf.unitsPerEm, 1000);
  assert.equal(ttf.glyphFor("A"), 1);
  assert.equal(ttf.glyphFor("B"), 2);
  assert.equal(ttf.glyphFor("\u{1f600}"), 2);
  assert.equal(ttf.glyphFor("Z"), 0);
  assert.equal(ttf.advance(2), 700);
  assert.equal(ttf.advance(99), 700);
  assert.ok(ttf.capHeight > 0);
});

test("refuses a file that is not TrueType", () => {
  assert.throws(() => parseTtf(new TextEncoder().encode("OTTO....not a font")), /TrueType/);
  assert.throws(() => parseTtf(new Uint8Array(4)), /TrueType/);
});
