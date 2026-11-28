// A small TrueType reader: just the tables the certificate needs (head, hhea, hmtx, maxp, cmap 4 and 12, OS/2, post).
// Web APIs only; no Node imports.

export type TtfFont = {
  unitsPerEm: number;
  /** xMin, yMin, xMax, yMax in font units. */
  bbox: [number, number, number, number];
  ascender: number;
  descender: number;
  capHeight: number;
  weight: number;
  italicAngle: number;
  numGlyphs: number;
  /** True when the font's cmap has the character itself (no fallback). */
  hasChar(ch: string): boolean;
  /** The glyph id for a character: its own, else its accent-stripped form, else "?", else 0 (.notdef). */
  glyphFor(ch: string): number;
  /** The character whose glyph glyphFor uses: the character, its accent-stripped base, or "?". */
  fallbackChar(ch: string): string;
  /** Advance width of a glyph in font units. */
  advance(glyph: number): number;
};

type Lookup = (codePoint: number) => number;

export function parseTtf(bytes: Uint8Array): TtfFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (bytes.length < 12 || (view.getUint32(0) !== 0x00010000 && tag(0) !== "true")) throw new Error("Not a TrueType font file.");

  const tables = new Map<string, number>();
  const count = view.getUint16(4);
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + i * 16;
    if (entry + 16 > bytes.length) throw new Error("Damaged TrueType table directory.");
    tables.set(tag(entry), view.getUint32(entry + 8));
  }
  const need = (name: string): number => {
    const offset = tables.get(name);
    if (offset === undefined || offset >= bytes.length) throw new Error(`TrueType font has no ${name} table.`);
    return offset;
  };

  const head = need("head");
  const unitsPerEm = view.getUint16(head + 18);
  if (unitsPerEm === 0) throw new Error("TrueType font has no units per em.");
  const bbox: [number, number, number, number] = [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)];

  const hhea = need("hhea");
  let ascender = view.getInt16(hhea + 4);
  let descender = view.getInt16(hhea + 6);
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const hmtx = need("hmtx");
  const numGlyphs = view.getUint16(need("maxp") + 4);

  let weight = 400;
  let capHeight = Math.round(ascender * 0.7);
  const os2 = tables.get("OS/2");
  if (os2 !== undefined && os2 + 68 <= bytes.length) {
    weight = view.getUint16(os2 + 4);
    const version = view.getUint16(os2);
    if (version >= 2 && os2 + 90 <= bytes.length) {
      const cap = view.getInt16(os2 + 88);
      if (cap > 0) capHeight = cap;
    }
    if (ascender === 0 && descender === 0) {
      ascender = view.getInt16(os2 + 68);
      descender = view.getInt16(os2 + 70);
    }
  }

  let italicAngle = 0;
  const post = tables.get("post");
  if (post !== undefined && post + 8 <= bytes.length) italicAngle = view.getInt32(post + 4) / 65536;

  const lookup = readCmap(view, need("cmap"));

  const advance = (glyph: number): number => {
    if (numberOfHMetrics === 0) return 0;
    const index = glyph < numberOfHMetrics ? glyph : numberOfHMetrics - 1;
    const at = hmtx + index * 4;
    return at + 2 <= bytes.length ? view.getUint16(at) : 0;
  };

  const own = (ch: string): number => {
    const cp = ch.codePointAt(0);
    return cp === undefined ? 0 : lookup(cp);
  };

  const fallbackChar = (ch: string): string => {
    if (own(ch) !== 0) return ch;
    const base = [...ch.normalize("NFD")].filter((c) => !/\p{M}/u.test(c)).join("");
    const first = [...base][0];
    if (first !== undefined && first !== ch && own(first) !== 0) return first;
    return "?";
  };

  return {
    unitsPerEm,
    bbox,
    ascender,
    descender,
    capHeight,
    weight,
    italicAngle,
    numGlyphs,
    hasChar: (ch) => own(ch) !== 0,
    glyphFor: (ch) => own(fallbackChar(ch)),
    fallbackChar,
    advance,
  };
}

function readCmap(view: DataView, cmap: number): Lookup {
  const count = view.getUint16(cmap + 2);
  const candidates: { rank: number; offset: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const record = cmap + 4 + i * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const offset = cmap + view.getUint32(record + 4);
    const rank = platform === 3 && encoding === 10 ? 0 : platform === 0 && encoding >= 4 ? 1 : platform === 3 && encoding === 1 ? 2 : platform === 0 ? 3 : 9;
    if (rank < 9) candidates.push({ rank, offset });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  for (const { offset } of candidates) {
    const format = view.getUint16(offset);
    if (format === 4) return format4(view, offset);
    if (format === 12) return format12(view, offset);
  }
  throw new Error("TrueType font has no cmap of format 4 or 12.");
}

function format4(view: DataView, at: number): Lookup {
  const segCount = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segCount; i += 1) {
      if (cp > view.getUint16(ends + i * 2)) continue;
      const start = view.getUint16(starts + i * 2);
      if (cp < start) return 0;
      const delta = view.getInt16(deltas + i * 2);
      const rangeOffset = view.getUint16(rangeOffsets + i * 2);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const glyphAt = rangeOffsets + i * 2 + rangeOffset + (cp - start) * 2;
      if (glyphAt + 2 > view.byteLength) return 0;
      const glyph = view.getUint16(glyphAt);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function format12(view: DataView, at: number): Lookup {
  const groups = view.getUint32(at + 12);
  const first = at + 16;
  return (cp) => {
    let low = 0;
    let high = groups - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const g = first + mid * 12;
      const start = view.getUint32(g);
      if (cp < start) high = mid - 1;
      else if (cp > view.getUint32(g + 4)) low = mid + 1;
      else return view.getUint32(g + 8) + (cp - start);
    }
    return 0;
  };
}
