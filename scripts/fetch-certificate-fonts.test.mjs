import assert from "node:assert/strict";
import test from "node:test";
import { certificateText, cssUrl, fontUrlFrom, isTrueType } from "./fetch-certificate-fonts.mjs";

test("the text list covers ASCII, Latin-1, Latin Extended-A and typographic punctuation", () => {
  const text = certificateText();
  for (const ch of "Az09 ~éñŁž–—‘’“”•…€™") assert.ok(text.includes(ch), ch);
});

test("css2 addresses ask only fonts.googleapis.com, with the weight or italic axis and the text", () => {
  const regular = new URL(cssUrl("Plus Jakarta Sans", "600"));
  assert.equal(regular.host, "fonts.googleapis.com");
  assert.equal(regular.searchParams.get("family"), "Plus Jakarta Sans:wght@600");
  assert.ok(regular.searchParams.get("text")?.includes("é"));
  assert.equal(new URL(cssUrl("Newsreader", "italic")).searchParams.get("family"), "Newsreader:ital,wght@1,400");
});

test("only a fonts.gstatic.com TrueType url is taken from the answer", () => {
  assert.equal(fontUrlFrom("src: url(https://fonts.gstatic.com/l/font?kit=abc) format('truetype');"), "https://fonts.gstatic.com/l/font?kit=abc");
  assert.equal(fontUrlFrom("src: url(https://evil.example/f.ttf) format('truetype');"), null);
  assert.equal(fontUrlFrom("src: url(https://fonts.gstatic.com/x.woff2) format('woff2');"), null);
});

test("TrueType files are recognised by their first four bytes", () => {
  assert.ok(isTrueType(new Uint8Array([0, 1, 0, 0, 9])));
  assert.ok(isTrueType(new TextEncoder().encode("true....")));
  assert.ok(!isTrueType(new TextEncoder().encode("wOFF....")));
  assert.ok(!isTrueType(new Uint8Array(2)));
});
