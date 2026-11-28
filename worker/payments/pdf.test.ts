import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { pdfActiveName, pdfHeaderOk, pdfPageCount, pdfTailOk } from "../../src/lib/pdf-scan.ts";
import { createPdf, hexToRgb, measure } from "./pdf.ts";

const font = (name: string) => new Uint8Array(readFileSync(new URL(`../../src/brand/certificate-fonts/${name}`, import.meta.url)));
const latin = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Every object's text, with its stream (if any) inflated. */
function objects(bytes: Uint8Array): Map<number, string> {
  const text = latin(bytes);
  const out = new Map<number, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) {
    let body = m[2];
    const s = body.indexOf("stream\n");
    if (s >= 0 && body.includes("/FlateDecode")) {
      const data = Buffer.from(body.slice(s + 7, body.lastIndexOf("\nendstream")), "latin1");
      body = `${body.slice(0, s)}STREAM:${inflateSync(data).toString("latin1")}`;
    }
    out.set(Number(m[1]), body);
  }
  return out;
}

async function sample() {
  const pdf = createPdf({ title: "Test" });
  const f = pdf.addFont("TestOutfit", font("display-outfit-400.ttf"));
  pdf.text(f, 20, 100, 700, "Hello é", { color: [0, 0, 0] });
  pdf.rect(10, 10, 100, 50, { fill: [1, 0, 0], stroke: [0, 0, 1], lineWidth: 2 });
  pdf.roundedRect(10, 100, 100, 50, 8, { stroke: [0, 0, 0] });
  pdf.line(0, 0, 50, 50, [0, 0, 0], 0.5);
  return { pdf, f };
}

test("one Letter page with a valid cross-reference table", async () => {
  const { pdf } = await sample();
  const bytes = await pdf.finish();
  const text = latin(bytes);
  assert.ok(pdfHeaderOk(bytes) && pdfTailOk(bytes));
  assert.equal(pdfPageCount(bytes), 1);
  assert.equal(pdfActiveName(bytes), null);
  assert.match(text, /\/MediaBox \[0 0 612 792\]/);
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  assert.equal(text.slice(start, start + 4), "xref");
  const rows = text.slice(start).split("\n").slice(2);
  const count = Number(/\/Size (\d+)/.exec(text)?.[1]);
  for (let n = 1; n < count; n += 1) {
    const offset = Number(rows[n].slice(0, 10));
    assert.ok(text.startsWith(`${n} 0 obj`, offset), `object ${n} is not at its offset`);
  }
});

test("a font is embedded as Type0 / CIDFontType2 with widths, a descriptor, the file and a ToUnicode map", async () => {
  const { pdf, f } = await sample();
  const objs = [...objects(await pdf.finish()).values()].join("\n---\n");
  assert.match(objs, /\/Subtype \/Type0 \/BaseFont \/TestOutfit \/Encoding \/Identity-H/);
  assert.match(objs, /\/Subtype \/CIDFontType2/);
  assert.match(objs, /\/CIDToGIDMap \/Identity/);
  assert.match(objs, /\/FontFile2 \d+ 0 R/);
  assert.match(objs, /\/W \[\d+ \[\d+\]/);
  assert.match(objs, /\/Length1 \d+/);
  const hex = (ch: string) => f.ttf.glyphFor(ch).toString(16).toUpperCase().padStart(4, "0");
  assert.match(objs, new RegExp(`<${hex("H")}> <0048>`));
  assert.match(objs, new RegExp(`<${hex("é")}> <00E9>`));
  assert.ok(objs.includes(`<${[..."Hello é"].map(hex).join("")}> Tj`));
});

test("the output has no active content and does not change from run to run", async () => {
  const a = await (await sample()).pdf.finish();
  const b = await (await sample()).pdf.finish();
  assert.deepEqual(a, b);
  assert.equal(pdfActiveName(a), null);
});

test("an image with alpha gets a soft mask", async () => {
  const { pdf } = await sample();
  const img = pdf.addImage({ width: 2, height: 1, rgb: new Uint8Array([255, 0, 0, 0, 255, 0]), alpha: new Uint8Array([255, 128]) });
  pdf.image(img, 50, 50, 20, 10);
  const objs = objects(await pdf.finish());
  const all = [...objs.values()].join("\n");
  assert.match(all, /\/Subtype \/Image \/Width 2 \/Height 1 \/ColorSpace \/DeviceRGB[^>]*\/SMask \d+ 0 R/);
  assert.match(all, /\/ColorSpace \/DeviceGray/);
  assert.match(all, /\/Im1 \d+ 0 R/);
  assert.match(all, /20 0 0 10 50 50 cm\n\/Im1 Do/);
});

test("measure follows the font's advances and character spacing", async () => {
  const { f } = await sample();
  const w = measure("Hello", f, 10);
  assert.ok(w > 10 && w < 60);
  assert.ok(Math.abs(measure("Hello", f, 20) - 2 * w) < 1e-9);
  assert.ok(Math.abs(measure("Hello", f, 10, 2) - (w + 8)) < 1e-9);
  assert.equal(measure("", f, 10, 2), 0);
  assert.equal(measure("中", f, 10), measure("?", f, 10));
});

test("hexToRgb reads short and long hex, and falls back to black", () => {
  assert.deepEqual(hexToRgb("#ff0000"), [1, 0, 0]);
  assert.deepEqual(hexToRgb("#0f0"), [0, 1, 0]);
  assert.deepEqual(hexToRgb("nonsense"), [0, 0, 0]);
});
