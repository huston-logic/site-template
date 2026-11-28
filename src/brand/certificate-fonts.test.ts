import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { CERTIFICATE_FONT_FILES } from "./certificate-fonts.ts";
import { CURATED_FONTS } from "./fonts.ts";

const dir = new URL("./certificate-fonts/", import.meta.url);

function expectedFiles(): string[] {
  const files: string[] = [];
  for (const font of CURATED_FONTS.display) files.push(`display-${font.id}-400.ttf`, `display-${font.id}-600.ttf`);
  for (const font of CURATED_FONTS.accent) files.push(`accent-${font.id}-italic.ttf`);
  return files.sort();
}

test("every curated display font (400, 600) and accent font (italic) has its certificate file, and no other", () => {
  assert.deepEqual(Object.keys(CERTIFICATE_FONT_FILES).sort(), expectedFiles());
  assert.deepEqual(readdirSync(dir).filter((f) => !f.startsWith(".")).sort(), expectedFiles());
});

test("each file is TrueType, its size and sha256 match the table", () => {
  for (const [file, { bytes, sha256 }] of Object.entries(CERTIFICATE_FONT_FILES)) {
    const data = readFileSync(new URL(file, dir));
    assert.equal(data.length, bytes, `${file} size`);
    assert.equal(createHash("sha256").update(data).digest("hex"), sha256, `${file} hash`);
    const tag = data.subarray(0, 4).toString("latin1");
    assert.ok(tag === "\u0000\u0001\u0000\u0000" || tag === "true", `${file} is not TrueType`);
  }
});
