// Tests for scripts/image-metadata.mjs: removing location, camera and other hidden data from jpg, png and webp files.
// Files are built by scripts/image-fixtures.mjs; the structure of every result is read back by that file's own parsers.
//   node --test scripts/image-metadata.test.mjs   (or `npm run test:scripts`)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCAN_ONE,
  SCAN_TWO,
  SECRET,
  app0Jfif,
  app0JfifWithThumbnail,
  app13Iptc,
  app14Adobe,
  app1Exif,
  app1Xmp,
  app2Icc,
  app2Mpf,
  app5Other,
  comment,
  jpeg,
  jpegSegment,
  listJpegSegments,
  listPngChunks,
  listRiffChunks,
  png,
  pngChunk,
  pngExif,
  pngText,
  pngXmp,
  webp,
  webpSimple,
} from "./image-fixtures.mjs";
import { inspectMetadata, stripMetadata } from "./image-metadata.mjs";

const leaks = (bytes) => Object.values(SECRET).filter((text) => bytes.includes(Buffer.from(text)));
const markers = (bytes) => listJpegSegments(bytes).map((s) => s.marker);
/** The only EXIF block a stripped photo may keep: the rotation flag, big-endian, and nothing else. */
const rotationOnly = (n) => Buffer.concat([Buffer.from("Exif\0\0MM\0*"), Buffer.from([0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, n, 0, 0, 0, 0, 0, 0])]);

// ---- JPEG --------------------------------------------------------------------------------------------------------

test("jpg: camera and GPS data in EXIF is removed, and the picture data is untouched", () => {
  const input = jpeg([app1Exif({ orientation: 0 })]);
  assert.deepEqual(leaks(input).sort(), [SECRET.gps, SECRET.make].sort(), "the fixture really does carry the data");
  const { bytes, removed } = stripMetadata(input, ".jpg");
  assert.deepEqual(leaks(bytes), []);
  assert.deepEqual(markers(bytes), [0xe0, 0xc0, 0xda], "JFIF header, frame header and scan are what is left");
  assert.ok(bytes.includes(SCAN_ONE), "the scan data is copied byte for byte");
  assert.ok(bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) && bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9])));
  assert.equal(removed.length, 1);
  assert.match(removed[0], /EXIF/);
  assert.match(removed[0], /location/);
});

test("jpg: XMP, IPTC, comments and unknown vendor segments are removed and each is named", () => {
  const input = jpeg([app1Xmp(), app13Iptc(), comment(), app5Other(), app2Mpf()]);
  const { bytes, removed } = stripMetadata(input, ".jpg");
  assert.deepEqual(leaks(bytes), []);
  assert.deepEqual(markers(bytes), [0xe0, 0xc0, 0xda]);
  const text = removed.join(" | ");
  assert.match(text, /XMP/);
  assert.match(text, /IPTC/);
  assert.match(text, /comment/);
  assert.equal(removed.length, 5);
});

test("jpg: the colour profile and the Adobe colour marker stay, because dropping them changes how the picture looks", () => {
  const input = jpeg([app2Icc(), app14Adobe(), app1Exif({ orientation: 0 })]);
  const { bytes } = stripMetadata(input, ".jpg");
  assert.deepEqual(markers(bytes), [0xe0, 0xe2, 0xee, 0xc0, 0xda]);
  assert.ok(bytes.includes(Buffer.from("FAKE-COLOUR-PROFILE")));
});

test("jpg: a rotation flag survives as a tiny EXIF block holding nothing else (little and big endian input)", () => {
  for (const bigEndian of [false, true]) {
    const { bytes, removed } = stripMetadata(jpeg([app1Exif({ orientation: 6, bigEndian })]), ".jpg");
    const exif = listJpegSegments(bytes).filter((s) => s.marker === 0xe1);
    assert.equal(exif.length, 1, `bigEndian=${bigEndian}`);
    assert.ok(exif[0].payload.equals(rotationOnly(6)), `bigEndian=${bigEndian}`);
    assert.deepEqual(leaks(bytes), []);
    assert.equal(removed.length, 1, "the rest of the EXIF block is still reported as removed");
  }
});

test("jpg: an orientation of 1 (upright) or no orientation at all leaves no EXIF block", () => {
  for (const orientation of [1, 0]) {
    const { bytes } = stripMetadata(jpeg([app1Exif({ orientation })]), ".jpg");
    assert.deepEqual(markers(bytes), [0xe0, 0xc0, 0xda], `orientation ${orientation}`);
  }
});

test("jpg: a thumbnail inside the JFIF header is removed", () => {
  const input = jpeg([], { noJfif: true });
  const withThumb = Buffer.concat([input.subarray(0, 2), app0JfifWithThumbnail(), input.subarray(2)]);
  assert.deepEqual(leaks(withThumb), [SECRET.thumbnail]);
  const { bytes, removed } = stripMetadata(withThumb, ".jpg");
  assert.deepEqual(leaks(bytes), []);
  assert.ok(listJpegSegments(bytes)[0].payload.equals(app0Jfif().subarray(4)), "back to the plain 14-byte JFIF header");
  assert.match(removed.join(" "), /thumbnail/);
});

test("jpg: bytes after the end of the picture are removed", () => {
  const input = jpeg([], { trailing: Buffer.from(SECRET.trailer) });
  const { bytes, removed } = stripMetadata(input, ".jpg");
  assert.deepEqual(leaks(bytes), []);
  assert.ok(bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9])));
  assert.match(removed.join(" "), /after the end/);
});

test("jpg: a picture stored in two scans keeps both scans and the table between them", () => {
  const input = jpeg([app1Xmp()], { twoScans: true });
  const { bytes } = stripMetadata(input, ".jpg");
  assert.deepEqual(leaks(bytes), []);
  assert.ok(bytes.includes(SCAN_ONE) && bytes.includes(SCAN_TWO));
  assert.ok(bytes.includes(jpegSegment(0xc4, Buffer.from([0, 1, 2, 3]))));
});

test("jpg: a file with nothing to remove comes back byte for byte, and stripping twice changes nothing more", () => {
  const clean = jpeg([app2Icc()]);
  const first = stripMetadata(clean, ".jpg");
  assert.ok(first.bytes.equals(clean));
  assert.deepEqual(first.removed, []);
  const dirty = jpeg([app1Exif(), app1Xmp(), comment()], { trailing: Buffer.from(SECRET.trailer) });
  const once = stripMetadata(dirty, ".jpg");
  const twice = stripMetadata(once.bytes, ".jpg");
  assert.ok(twice.bytes.equals(once.bytes));
  assert.deepEqual(twice.removed, []);
});

test("jpg: .jpeg and upper-case extensions work", () => {
  assert.deepEqual(leaks(stripMetadata(jpeg([comment()]), ".JPEG").bytes), []);
  assert.deepEqual(leaks(stripMetadata(jpeg([comment()]), ".Jpg").bytes), []);
});

test("jpg: a damaged file is refused with a reason, never half-processed", () => {
  const good = jpeg([comment()]);
  assert.throws(() => stripMetadata(Buffer.from("not a jpeg at all"), ".jpg"), /JPEG/);
  assert.throws(() => stripMetadata(good.subarray(0, good.length - 2), ".jpg"), /end/i, "no end-of-image marker");
  const overrun = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0xff, 0xff]), Buffer.from("short")]);
  assert.throws(() => stripMetadata(overrun, ".jpg"), /past the end|damaged|truncated/i);
  assert.throws(() => stripMetadata(Buffer.from([0xff, 0xd8]), ".jpg"), /JPEG/);
});

// ---- PNG ---------------------------------------------------------------------------------------------------------

test("png: text, XMP, EXIF and timestamp chunks are removed; the picture and colour chunks stay with valid checksums", () => {
  const keep = [pngChunk("gAMA", Buffer.from([0, 1, 0, 0])), pngChunk("iCCP", Buffer.from("profile\0\0data")), pngChunk("pHYs", Buffer.alloc(9)), pngChunk("tRNS", Buffer.from([0]))];
  const input = png([pngText("Author", SECRET.comment), pngXmp(), pngExif(), pngChunk("tIME", Buffer.alloc(7)), ...keep]);
  assert.ok(leaks(input).length >= 2);
  const { bytes, removed } = stripMetadata(input, ".png");
  assert.deepEqual(leaks(bytes), []);
  const chunks = listPngChunks(bytes);
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "gAMA", "iCCP", "pHYs", "tRNS", "IDAT", "IEND"]);
  assert.ok(chunks.every((c) => c.crcOk));
  assert.match(removed.join(" "), /text/);
  assert.match(removed.join(" "), /EXIF/);
  assert.match(removed.join(" "), /XMP/);
});

test("png: unknown private ancillary chunks are removed, unknown critical chunks are kept", () => {
  const { bytes, removed } = stripMetadata(png([pngChunk("prVt", Buffer.from("private")), pngChunk("CrIt", Buffer.from("critical"))]), ".png");
  assert.deepEqual(listPngChunks(bytes).map((c) => c.type), ["IHDR", "CrIt", "IDAT", "IEND"]);
  assert.equal(removed.length, 1);
});

test("png: bytes after IEND are removed, and a clean file is returned unchanged and unchanged again on a second pass", () => {
  const trailing = stripMetadata(png([], { trailing: Buffer.from(SECRET.trailer) }), ".png");
  assert.deepEqual(leaks(trailing.bytes), []);
  assert.match(trailing.removed.join(" "), /after the end/);
  const clean = png([pngChunk("gAMA", Buffer.from([0, 1, 0, 0]))]);
  assert.ok(stripMetadata(clean, ".png").bytes.equals(clean));
  const dirty = png([pngText("Author", "x"), pngXmp()]);
  const once = stripMetadata(dirty, ".png");
  assert.ok(stripMetadata(once.bytes, ".png").bytes.equals(once.bytes));
});

test("png: a damaged file is refused", () => {
  assert.throws(() => stripMetadata(Buffer.from("GIF89a....."), ".png"), /PNG/);
  const good = png();
  assert.throws(() => stripMetadata(good.subarray(0, good.length - 14), ".png"), /end|truncated|damaged/i);
  const noEnd = Buffer.concat([good.subarray(0, good.length - 12)]);
  assert.throws(() => stripMetadata(noEnd, ".png"), /IEND|end/i);
});

// ---- WebP --------------------------------------------------------------------------------------------------------

test("webp: EXIF and XMP chunks are removed, their flags cleared, and the size in the header is corrected", () => {
  const input = webp({ exif: true, xmp: true, icc: true });
  assert.deepEqual(leaks(input).sort(), [SECRET.exifChunk, SECRET.xmp].sort());
  const { bytes, removed } = stripMetadata(input, ".webp");
  assert.deepEqual(leaks(bytes), []);
  const { riffSize, chunks, end } = listRiffChunks(bytes);
  assert.deepEqual(chunks.map((c) => c.id), ["VP8X", "ICCP", "VP8L"]);
  assert.equal(chunks[0].data[0], 0x20, "only the colour-profile flag is left set");
  assert.equal(riffSize, bytes.length - 8);
  assert.equal(end, bytes.length, "the padding byte after the odd-sized image chunk is kept");
  assert.match(removed.join(" "), /EXIF/);
  assert.match(removed.join(" "), /XMP/);
});

test("webp: a plain file, and a file with nothing hidden, come back unchanged; bytes after the RIFF data are removed", () => {
  const simple = webpSimple();
  assert.ok(stripMetadata(simple, ".webp").bytes.equals(simple));
  const clean = webp({ icc: true });
  const result = stripMetadata(clean, ".webp");
  assert.ok(result.bytes.equals(clean));
  assert.deepEqual(result.removed, []);
  const trailing = stripMetadata(webp({ trailing: Buffer.from(SECRET.trailer) }), ".webp");
  assert.deepEqual(leaks(trailing.bytes), []);
  assert.match(trailing.removed.join(" "), /after the end/);
});

test("webp: stripping twice changes nothing more, and a damaged file is refused", () => {
  const once = stripMetadata(webp({ exif: true, xmp: true }), ".webp");
  assert.ok(stripMetadata(once.bytes, ".webp").bytes.equals(once.bytes));
  assert.throws(() => stripMetadata(Buffer.from("RIFFxxxxAVI LIST"), ".webp"), /WebP/);
  const good = webp({ exif: true });
  assert.throws(() => stripMetadata(good.subarray(0, good.length - 6), ".webp"), /truncated|damaged|past the end/i);
});

// ---- all types ---------------------------------------------------------------------------------------------------

test("an extension that is not jpg, png or webp is refused", () => {
  assert.throws(() => stripMetadata(Buffer.from("<svg/>"), ".svg"), /not a jpg, png or webp/i);
  assert.throws(() => stripMetadata(jpeg(), ""), /not a jpg, png or webp/i);
});

test("inspectMetadata reports what would be removed, or why the file could not be read, and never throws", () => {
  assert.deepEqual(inspectMetadata(jpeg([app2Icc()]), ".jpg"), { removed: [] });
  assert.equal(inspectMetadata(jpeg([app1Exif({ orientation: 0 })]), ".jpg").removed.length, 1);
  assert.equal(inspectMetadata(png([pngText("a", "b")]), ".png").removed.length, 1);
  assert.equal(inspectMetadata(webp({ exif: true }), ".webp").removed.length, 1);
  assert.match(inspectMetadata(Buffer.from("junk"), ".jpg").error, /JPEG/);
  assert.match(inspectMetadata(Buffer.from("junk"), ".gif").error, /not a jpg, png or webp/);
  assert.deepEqual(inspectMetadata(jpeg([app1Exif({ orientation: 6 })], { noJfif: false }), ".jpg").removed.length, 1);
});

test("a photo whose only EXIF is the bare rotation flag counts as clean", () => {
  const already = jpeg([jpegSegment(0xe1, rotationOnly(8))]);
  const result = stripMetadata(already, ".jpg");
  assert.ok(result.bytes.equals(already));
  assert.deepEqual(result.removed, []);
});
