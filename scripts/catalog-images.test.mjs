import assert from "node:assert/strict";
import { test } from "node:test";
import { cardCrop, fitWithin, sniffImage, unsupportedReason } from "./catalog-images.mjs";

test("cardCrop takes the biggest 4:5 rectangle, centred by default", () => {
  // A 1600 by 1200 landscape photo: the card is 960 wide (1200 * 4 / 5), centred.
  assert.deepEqual(cardCrop(1600, 1200), { sx: 320, sy: 0, sw: 960, sh: 1200 });
  // A tall 1000 by 2000 photo: the card is 1000 by 1250, centred vertically.
  assert.deepEqual(cardCrop(1000, 2000), { sx: 0, sy: 375, sw: 1000, sh: 1250 });
  // Already 4:5: the whole photo.
  assert.deepEqual(cardCrop(800, 1000), { sx: 0, sy: 0, sw: 800, sh: 1000 });
});

test("cardCrop honours focus on the side that has room", () => {
  assert.deepEqual(cardCrop(1600, 1200, "left"), { sx: 0, sy: 0, sw: 960, sh: 1200 });
  assert.deepEqual(cardCrop(1600, 1200, "right"), { sx: 640, sy: 0, sw: 960, sh: 1200 });
  assert.deepEqual(cardCrop(1000, 2000, "top"), { sx: 0, sy: 0, sw: 1000, sh: 1250 });
  assert.deepEqual(cardCrop(1000, 2000, "bottom"), { sx: 0, sy: 750, sw: 1000, sh: 1250 });
  // Focus on an axis with no room changes nothing.
  assert.deepEqual(cardCrop(1000, 2000, "left"), cardCrop(1000, 2000, "center"));
});

test("cardCrop never leaves the photo, whatever the shape", () => {
  for (const [w, h] of [[1, 1], [3, 7], [4000, 3], [3, 4000], [720, 900], [721, 900]]) {
    for (const focus of ["center", "top", "bottom", "left", "right"]) {
      const { sx, sy, sw, sh } = cardCrop(w, h, focus);
      assert.ok(sx >= 0 && sy >= 0 && sw >= 1 || w < 2, `${w}x${h} ${focus}`);
      assert.ok(sx + sw <= w && sy + sh <= h, `${w}x${h} ${focus} stays inside`);
    }
  }
});

test("fitWithin shrinks to the long side and never enlarges", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1280), { width: 960, height: 1280 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
});

test("sniffImage judges by the first bytes", () => {
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "jpeg");
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "png");
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "webp");
  assert.equal(sniffImage(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(4)])), "heic");
  assert.equal(sniffImage(Buffer.from("<svg></svg>")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test("unsupportedReason names HEIC and anything else, and passes the three formats", () => {
  assert.equal(unsupportedReason(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.match(unsupportedReason(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(4)])), /HEIC photos must be converted to JPEG first/);
  assert.match(unsupportedReason(Buffer.from("GIF89a")), /not a JPEG, PNG or WebP/);
});
