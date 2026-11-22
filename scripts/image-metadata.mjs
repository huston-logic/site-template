// Removes hidden data (camera make and model, GPS location, capture time, captions, editing history, thumbnails, comments)
// from jpg, png and webp files, without decoding or re-encoding the picture. Plain Node, no dependencies: the picture data
// is copied byte for byte and only the metadata segments or chunks are left out. Used by scripts/strip-image-metadata.mjs
// (`npm run strip:images`, which fixes files) and scripts/check-change-scope.mjs (which refuses a change that still has
// such data). Explanation: docs/CHANGE-SCOPE.md.
//
// Kept on purpose, because dropping it changes how the picture looks:
//   - the colour profile (JPEG ICC_PROFILE and Adobe segments, PNG iCCP, WebP ICCP);
//   - a rotation flag. Phone photos are stored sideways with a flag saying "turn me". Without the flag they show on
//     their side, and fixing that needs the picture re-encoded. So when a JPEG says it is rotated, one EXIF block holding
//     only that flag (big-endian, 32 bytes of data) is kept. It names no camera, place or time.
// Everything else that can carry data is dropped, including unknown vendor segments and bytes after the end of the picture.

const MARKER_SOI = 0xd8;
const MARKER_EOI = 0xd9;
const MARKER_SOS = 0xda;

/** Thrown for a file that is not what its extension says or is cut short. The message is meant for a person. */
const damaged = (kind, why) => new Error(`not a valid ${kind}: ${why}`);

const startsWithText = (bytes, text) => bytes.length >= text.length && bytes.toString("latin1", 0, text.length) === text;

// ---- JPEG --------------------------------------------------------------------------------------------------------

const XMP_PREFIXES = ["http://ns.adobe.com/xap/1.0/\0", "http://ns.adobe.com/xmp/extension/\0"];

/** The rotation flag (2 to 8) from the TIFF block inside an EXIF segment, or undefined. Upright (1) and unreadable count as none. */
function readOrientation(tiff) {
  if (tiff.length < 8) return undefined;
  const little = tiff.toString("latin1", 0, 2) === "II";
  if (!little && tiff.toString("latin1", 0, 2) !== "MM") return undefined;
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (u16(2) !== 42) return undefined;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return undefined;
  const count = u16(ifd);
  for (let n = 0; n < count; n += 1) {
    const at = ifd + 2 + n * 12;
    if (at + 12 > tiff.length) return undefined;
    if (u16(at) === 0x0112 && u16(at + 2) === 3 && u32(at + 4) === 1) {
      const value = u16(at + 8);
      return value >= 2 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

const segment = (marker, payload) => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
};

/** The only EXIF block a stripped photo keeps: a big-endian TIFF with one entry, the rotation flag. */
function rotationOnlyPayload(orientation) {
  const tiff = Buffer.alloc(32); // "Exif\0\0" (6) + TIFF header (8) + entry count (2) + one entry (12) + next-directory pointer (4)
  tiff.write("Exif\0\0MM\0*", 0, "latin1");
  tiff.writeUInt32BE(8, 10); // offset of the first (and only) directory
  tiff.writeUInt16BE(1, 14); // one entry
  tiff.writeUInt16BE(0x0112, 16); // tag: orientation
  tiff.writeUInt16BE(3, 18); // type: short
  tiff.writeUInt32BE(1, 20); // count
  tiff.writeUInt16BE(orientation, 24);
  return tiff;
}

/**
 * What to do with one JPEG segment: { keep: Buffer } to write these bytes instead, or { label } to drop it and say what it was.
 * `state.rotationKept` makes sure at most one rotation-only EXIF block is written.
 */
function judgeJpegSegment(marker, payload, whole, state) {
  if (marker === 0xe0) {
    if (!startsWithText(payload, "JFIF\0") || payload.length < 14) return { label: "unknown APP0 data" };
    if (payload.length === 14 && payload[12] === 0 && payload[13] === 0) return { keep: whole };
    const plain = Buffer.from(payload.subarray(0, 14));
    plain[12] = 0;
    plain[13] = 0;
    return { keep: segment(marker, plain), label: "embedded thumbnail picture" };
  }
  if (marker === 0xe1) {
    if (startsWithText(payload, "Exif\0\0")) {
      const orientation = state.rotationKept ? undefined : readOrientation(payload.subarray(6));
      if (orientation === undefined) return { label: "EXIF (camera and location data)" };
      state.rotationKept = true;
      const rotation = segment(marker, rotationOnlyPayload(orientation));
      return whole.equals(rotation) ? { keep: whole } : { keep: rotation, label: "EXIF (camera and location data; only the rotation flag is kept)" };
    }
    return { label: XMP_PREFIXES.some((prefix) => startsWithText(payload, prefix)) ? "XMP (editing history, author, location)" : "unknown APP1 data" };
  }
  if (marker === 0xe2) return startsWithText(payload, "ICC_PROFILE\0") ? { keep: whole } : { label: "unknown APP2 data (such as a second embedded picture)" };
  if (marker === 0xee) return startsWithText(payload, "Adobe") ? { keep: whole } : { label: "unknown APP14 data" };
  if (marker === 0xed) return { label: "IPTC/Photoshop data (captions, credits, location)" };
  if (marker === 0xfe) return { label: "comment" };
  if (marker >= 0xe3 && marker <= 0xef) return { label: `unknown APP${marker - 0xe0} data` };
  return { keep: whole };
}

function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== MARKER_SOI) throw damaged("JPEG", "it does not start with the JPEG marker");
  const out = [buf.subarray(0, 2)];
  const removed = [];
  const state = { rotationKept: false };
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw damaged("JPEG", `expected a marker at byte ${i}, so the file is damaged`);
    while (buf[i + 1] === 0xff) i += 1; // fill bytes before a marker
    const marker = buf[i + 1];
    if (marker === undefined) throw damaged("JPEG", "it is cut short in the middle of a marker");
    if (marker === MARKER_EOI) {
      out.push(buf.subarray(i, i + 2));
      if (i + 2 < buf.length) removed.push("data after the end of the picture");
      return finish(buf, out, removed);
    }
    if (marker === 0x01 || marker === MARKER_SOI || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) throw damaged("JPEG", "it is cut short in the middle of a segment header");
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) throw damaged("JPEG", "a segment runs past the end of the file (truncated or damaged)");
    const whole = buf.subarray(i, i + 2 + length);
    const verdict = judgeJpegSegment(marker, whole.subarray(4), whole, state);
    if (verdict.label) removed.push(verdict.label);
    if (verdict.keep) out.push(verdict.keep);
    i += 2 + length;
    if (marker === MARKER_SOS) {
      // Entropy-coded data: copy it until the next real marker. FF00 is a stuffed byte and FFD0-FFD7 are restart markers.
      let j = i;
      while (j < buf.length) {
        if (buf[j] === 0xff) {
          const next = buf[j + 1];
          if (next === undefined) throw damaged("JPEG", "it is cut short inside the picture data");
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          if (next === 0xff) {
            j += 1;
            continue;
          }
          break;
        }
        j += 1;
      }
      if (j >= buf.length) throw damaged("JPEG", "there is no end-of-image marker, so the file is cut short");
      out.push(buf.subarray(i, j));
      i = j;
    }
  }
  throw damaged("JPEG", "there is no end-of-image marker, so the file is cut short");
}

// ---- PNG ---------------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Ancillary chunks that only describe how to draw the picture. Critical chunks (first letter capital) are always kept. */
const PNG_KEEP = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", "hIST", "sPLT", "acTL", "fcTL", "fdAT", "cICP", "mDCV", "cLLI"]);

function pngLabel(type, data) {
  if (type === "tEXt" || type === "zTXt") return "text notes";
  if (type === "iTXt") return startsWithText(data, "XML:com.adobe.xmp") ? "XMP (editing history, author, location)" : "text notes";
  if (type === "eXIf") return "EXIF (camera and location data)";
  if (type === "tIME") return "last-changed timestamp";
  return `unknown private chunk ${type}`;
}

function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw damaged("PNG", "it does not start with the PNG signature");
  const out = [buf.subarray(0, 8)];
  const removed = [];
  let i = 8;
  while (i < buf.length) {
    if (i + 12 > buf.length) throw damaged("PNG", "a chunk is cut short (truncated or damaged)");
    const length = buf.readUInt32BE(i);
    if (i + 12 + length > buf.length) throw damaged("PNG", "a chunk runs past the end of the file (truncated or damaged)");
    const type = buf.toString("latin1", i + 4, i + 8);
    const whole = buf.subarray(i, i + 12 + length);
    const critical = (buf[i + 4] & 0x20) === 0;
    if (critical || PNG_KEEP.has(type)) out.push(whole);
    else removed.push(pngLabel(type, whole.subarray(8, 8 + length)));
    i += 12 + length;
    if (type === "IEND") {
      if (i < buf.length) removed.push("data after the end of the picture");
      return finish(buf, out, removed);
    }
  }
  throw damaged("PNG", "there is no IEND chunk, so the file is cut short");
}

// ---- WebP --------------------------------------------------------------------------------------------------------

function stripWebp(buf) {
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") throw damaged("WebP", "it is not a RIFF/WEBP file");
  const total = buf.readUInt32LE(4) + 8;
  if (total > buf.length || total < 12) throw damaged("WebP", "the file is shorter than it says (truncated or damaged)");
  const chunks = [];
  const removed = [];
  let clear = 0;
  let i = 12;
  while (i < total) {
    if (i + 8 > total) throw damaged("WebP", "a chunk is cut short (truncated or damaged)");
    const id = buf.toString("latin1", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (i + 8 + size > total) throw damaged("WebP", "a chunk runs past the end of the file (truncated or damaged)");
    const padded = Math.min(size + (size % 2), total - i - 8);
    const data = buf.subarray(i + 8, i + 8 + size);
    if (id === "EXIF") {
      removed.push("EXIF (camera and location data)");
      clear |= 0x08;
    } else if (id === "XMP ") {
      removed.push("XMP (editing history, author, location)");
      clear |= 0x04;
    } else {
      const pad = size % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
      chunks.push({ id, data: Buffer.from(data), pad });
    }
    i += 8 + padded;
  }
  if (total < buf.length) removed.push("data after the end of the picture");
  if (removed.length === 0) return { bytes: buf, removed };
  const head = chunks.find((c) => c.id === "VP8X");
  if (head && head.data.length > 0) head.data[0] &= ~clear;
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks.flatMap((c) => [Buffer.from(c.id, "latin1"), uint32le(c.data.length), c.data, c.pad])]);
  return { bytes: Buffer.concat([Buffer.from("RIFF"), uint32le(body.length), body]), removed };
}

const uint32le = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

// ---- public API --------------------------------------------------------------------------------------------------

/** When nothing was removed the file is returned as it came in, so a clean file is never rewritten. */
function finish(original, parts, removed) {
  return { bytes: removed.length === 0 ? original : Buffer.concat(parts), removed };
}

const STRIPPERS = { ".jpg": stripJpeg, ".jpeg": stripJpeg, ".png": stripPng, ".webp": stripWebp };

/**
 * Returns { bytes, removed }: the file without hidden data, and a plain-English name for each thing taken out (empty when
 * the file was already clean, in which case `bytes` is the input). Throws an Error whose message a person can read when the
 * file is damaged or its extension is not jpg, jpeg, png or webp.
 */
export function stripMetadata(bytes, extension) {
  const key = String(extension).toLowerCase();
  if (!Object.hasOwn(STRIPPERS, key)) throw new Error(`${extension || "a file with no extension"} is not a jpg, png or webp image`);
  return STRIPPERS[key](bytes);
}

/** Like stripMetadata but never throws and never returns bytes: { removed } or { error }. For checks that only need to know. */
export function inspectMetadata(bytes, extension) {
  try {
    return { removed: stripMetadata(bytes, extension).removed };
  } catch (error) {
    return { error: error.message };
  }
}
