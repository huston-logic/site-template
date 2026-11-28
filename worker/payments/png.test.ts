import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { decodePng } from "./png.ts";

const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
function chunk(type: string, data: Buffer): Buffer {
  return Buffer.concat([u32(data.length), Buffer.from(type, "ascii"), data, u32(0)]); // the CRC is not checked
}
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Encodes raw samples with a chosen filter per row. */
function png(width: number, height: number, colorType: number, samples: number[], filters: number[], opts: { depth?: number; interlace?: number; split?: boolean } = {}): Uint8Array {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 1;
  const bpp = channels;
  const stride = width * channels;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const filter = filters[y % filters.length];
    rows.push(filter);
    for (let x = 0; x < stride; x += 1) {
      const raw = samples[y * stride + x];
      const left = x >= bpp ? samples[y * stride + x - bpp] : 0;
      const up = y > 0 ? samples[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? samples[(y - 1) * stride + x - bpp] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      rows.push((raw - predictor) & 255);
    }
  }
  const compressed = deflateSync(Buffer.from(rows));
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([opts.depth ?? 8, colorType, 0, 0, opts.interlace ?? 0])]);
  const idats = opts.split ? [compressed.subarray(0, 5), compressed.subarray(5)] : [compressed];
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...idats.map((d) => chunk("IDAT", d)), chunk("IEND", Buffer.alloc(0))]));
}

const noise = (n: number) => Array.from({ length: n }, (_, i) => (i * 73 + (i % 5) * 41 + 19) & 255);

test("decodes RGBA with every row filter and splits the alpha", async () => {
  const samples = noise(5 * 5 * 4);
  const out = await decodePng(png(5, 5, 6, samples, [0, 1, 2, 3, 4], { split: true }));
  assert.equal(out.width, 5);
  assert.equal(out.height, 5);
  assert.equal(out.rgb.length, 75);
  assert.ok(out.alpha);
  for (let i = 0; i < 25; i += 1) {
    assert.deepEqual([...out.rgb.subarray(i * 3, i * 3 + 3)], samples.slice(i * 4, i * 4 + 3));
    assert.equal(out.alpha[i], samples[i * 4 + 3]);
  }
});

test("decodes RGB (no alpha), gray and gray with alpha", async () => {
  const rgb = noise(4 * 3 * 3);
  const a = await decodePng(png(4, 3, 2, rgb, [4, 3, 2]));
  assert.deepEqual([...a.rgb], rgb);
  assert.equal(a.alpha, null);

  const gray = noise(4 * 3);
  const b = await decodePng(png(4, 3, 0, gray, [1]));
  assert.equal(b.alpha, null);
  assert.deepEqual([...b.rgb], gray.flatMap((g) => [g, g, g]));

  const ga = noise(4 * 3 * 2);
  const c = await decodePng(png(4, 3, 4, ga, [2, 0]));
  assert.deepEqual([...c.rgb], Array.from({ length: 12 }, (_, i) => ga[i * 2]).flatMap((g) => [g, g, g]));
  assert.deepEqual([...(c.alpha ?? [])], Array.from({ length: 12 }, (_, i) => ga[i * 2 + 1]));
});

test("an opaque alpha channel is dropped", async () => {
  const samples = Array.from({ length: 8 }, (_, i) => (i % 4 === 3 ? 255 : i * 20));
  assert.equal((await decodePng(png(2, 1, 6, samples, [0]))).alpha, null);
});

test("refuses palette, 16-bit, interlaced, truncated and non-PNG files", async () => {
  await assert.rejects(decodePng(png(2, 2, 3, noise(4), [0])), /color type/);
  await assert.rejects(decodePng(png(2, 2, 2, noise(12), [0], { depth: 16 })), /8-bit/);
  await assert.rejects(decodePng(png(2, 2, 2, noise(12), [0], { interlace: 1 })), /nterlaced/);
  await assert.rejects(decodePng(png(2, 2, 2, noise(12), [0]).subarray(0, 40)), /PNG/);
  await assert.rejects(decodePng(new TextEncoder().encode("GIF89a not a png")), /PNG/);
});
