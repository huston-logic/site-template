// A small PDF 1.7 writer for one-page documents: text in embedded TrueType fonts (Type0, Identity-H, with a ToUnicode map),
// filled and stroked shapes, lines and one RGB image with an optional alpha mask. Streams are Flate-compressed. The
// output holds no date and no random id, so the same input gives the same bytes. Web APIs only; no Node imports.
// Coordinates are PDF points with the origin at the bottom left of the page.
import { deflate } from "./flate.ts";
import { parseTtf, type TtfFont } from "./ttf.ts";

export type Rgb = readonly [number, number, number];

/** "#rrggbb" or "#rgb" as 0 to 1 channels; anything else is black. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export type PdfFont = {
  readonly ttf: TtfFont;
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly resource: string;
  /** glyph id to the character it stands for, for the glyphs written so far. */
  readonly used: Map<number, string>;
};

export type PdfImage = { readonly resource: string; readonly width: number; readonly height: number; readonly rgb: Uint8Array; readonly alpha: Uint8Array | null };

/** Width of the text in points. Character spacing is added between characters, not after the last. */
export function measure(text: string, font: { ttf: TtfFont }, size: number, charSpace = 0): number {
  let units = 0;
  let count = 0;
  for (const ch of text) {
    units += font.ttf.advance(font.ttf.glyphFor(ch));
    count += 1;
  }
  return (units * size) / font.ttf.unitsPerEm + (count > 1 ? (count - 1) * charSpace : 0);
}

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const rgbOps = (c: Rgb): string => `${num(c[0])} ${num(c[1])} ${num(c[2])}`;
const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, "0");
const encoder = new TextEncoder();
const ascii = (s: string): Uint8Array => encoder.encode(s);

function utf16Hex(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) out += hex4(text.charCodeAt(i));
  return out;
}

export type TextOptions = { color: Rgb; charSpace?: number };
export type ShapeOptions = { fill?: Rgb; stroke?: Rgb; lineWidth?: number };

export type PdfDocument = {
  addFont(name: string, bytes: Uint8Array): PdfFont;
  addImage(image: { width: number; height: number; rgb: Uint8Array; alpha: Uint8Array | null }): PdfImage;
  /** Draws text with its baseline at y, starting at x. */
  text(font: PdfFont, size: number, x: number, y: number, text: string, options: TextOptions): void;
  rect(x: number, y: number, w: number, h: number, options: ShapeOptions): void;
  roundedRect(x: number, y: number, w: number, h: number, radius: number, options: ShapeOptions): void;
  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, lineWidth: number): void;
  image(image: PdfImage, x: number, y: number, w: number, h: number): void;
  finish(): Promise<Uint8Array>;
};

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

export function createPdf(options: { title?: string } = {}): PdfDocument {
  const fonts: PdfFont[] = [];
  const images: PdfImage[] = [];
  const ops: string[] = [];

  const paint = (o: ShapeOptions): string => {
    const lines: string[] = [];
    if (o.fill) lines.push(`${rgbOps(o.fill)} rg`);
    if (o.stroke) lines.push(`${rgbOps(o.stroke)} RG ${num(o.lineWidth ?? 1)} w`);
    const op = o.fill && o.stroke ? "B" : o.fill ? "f" : o.stroke ? "S" : "n";
    return `${lines.join("\n")}\n${op}`;
  };

  const doc: PdfDocument = {
    addFont(name, bytes) {
      const font: PdfFont = { ttf: parseTtf(bytes), bytes, name, resource: `F${fonts.length + 1}`, used: new Map() };
      fonts.push(font);
      return font;
    },
    addImage(image) {
      const entry: PdfImage = { resource: `Im${images.length + 1}`, ...image };
      images.push(entry);
      return entry;
    },
    text(font, size, x, y, text, o) {
      let hex = "";
      for (const ch of text) {
        const gid = font.ttf.glyphFor(ch);
        if (!font.used.has(gid)) font.used.set(gid, font.ttf.fallbackChar(ch));
        hex += hex4(gid);
      }
      if (hex === "") return;
      ops.push(`BT\n${rgbOps(o.color)} rg\n/${font.resource} ${num(size)} Tf\n${num(o.charSpace ?? 0)} Tc\n${num(x)} ${num(y)} Td\n<${hex}> Tj\nET`);
    },
    rect(x, y, w, h, o) {
      ops.push(`q\n${num(x)} ${num(y)} ${num(w)} ${num(h)} re\n${paint(o)}\nQ`);
    },
    roundedRect(x, y, w, h, r, o) {
      const k = r * 0.5522847498;
      const p = [
        `${num(x + r)} ${num(y)} m`,
        `${num(x + w - r)} ${num(y)} l`,
        `${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c`,
        `${num(x + w)} ${num(y + h - r)} l`,
        `${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c`,
        `${num(x + r)} ${num(y + h)} l`,
        `${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c`,
        `${num(x)} ${num(y + r)} l`,
        `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c`,
        "h",
      ];
      ops.push(`q\n${p.join("\n")}\n${paint(o)}\nQ`);
    },
    line(x1, y1, x2, y2, color, lineWidth) {
      ops.push(`q\n${rgbOps(color)} RG ${num(lineWidth)} w\n${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S\nQ`);
    },
    image(image, x, y, w, h) {
      ops.push(`q\n${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm\n/${image.resource} Do\nQ`);
    },
    async finish() {
      const objects: Uint8Array[] = []; // objects[n - 1] is object n
      const add = (body: Uint8Array): number => {
        objects.push(body);
        return objects.length;
      };
      const reserve = (): number => add(new Uint8Array(0));
      const set = (n: number, body: Uint8Array) => {
        objects[n - 1] = body;
      };
      const dict = (text: string) => ascii(text);
      const stream = async (head: string, data: Uint8Array, extra = ""): Promise<Uint8Array> => {
        const packed = await deflate(data);
        const open = ascii(`<< ${head} ${extra}/Filter /FlateDecode /Length ${packed.length} >>\nstream\n`);
        return concat([open, packed, ascii("\nendstream")]);
      };

      const catalog = reserve();
      const pages = reserve();
      const page = reserve();
      const info = options.title ? reserve() : 0;
      const contentId = reserve();
      if (info) set(info, dict(`<< /Title <FEFF${utf16Hex(options.title ?? "")}> >>`));

      const fontRefs: string[] = [];
      for (const font of fonts) {
        const type0 = reserve();
        const cid = reserve();
        const descriptor = reserve();
        const file = reserve();
        const toUnicode = reserve();
        const upm = font.ttf.unitsPerEm;
        const scale = (v: number) => Math.round((v * 1000) / upm);
        const gids = [...font.used.keys()].sort((a, b) => a - b);
        const widths = gids.map((g) => `${g} [${scale(font.ttf.advance(g))}]`).join(" ");
        const bbox = font.ttf.bbox.map(scale).join(" ");
        const flags = 32 + (font.ttf.italicAngle !== 0 ? 64 : 0);
        const stemV = Math.max(40, Math.round(40 + (font.ttf.weight - 400) / 4));
        set(type0, dict(`<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`));
        set(cid, dict(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`));
        set(descriptor, dict(`<< /Type /FontDescriptor /FontName /${font.name} /Flags ${flags} /FontBBox [${bbox}] /ItalicAngle ${num(font.ttf.italicAngle)} /Ascent ${scale(font.ttf.ascender)} /Descent ${scale(font.ttf.descender)} /CapHeight ${scale(font.ttf.capHeight)} /StemV ${stemV} /FontFile2 ${file} 0 R >>`));
        set(file, await stream(`/Length1 ${font.bytes.length}`, font.bytes));
        set(toUnicode, await stream("", ascii(toUnicodeCMap(font))));
        fontRefs.push(`/${font.resource} ${type0} 0 R`);
      }

      const imageRefs: string[] = [];
      for (const image of images) {
        const id = reserve();
        let mask = "";
        if (image.alpha) {
          const maskId = reserve();
          set(maskId, await stream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, image.alpha));
          mask = `/SMask ${maskId} 0 R `;
        }
        set(id, await stream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8`, image.rgb, mask));
        imageRefs.push(`/${image.resource} ${id} 0 R`);
      }

      set(contentId, await stream("", ascii(ops.join("\n"))));
      set(catalog, dict(`<< /Type /Catalog /Pages ${pages} 0 R /Lang (en-US) >>`));
      set(pages, dict(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`));
      const resources = `/Resources << /ProcSet [/PDF /Text /ImageC]${fontRefs.length ? ` /Font << ${fontRefs.join(" ")} >>` : ""}${imageRefs.length ? ` /XObject << ${imageRefs.join(" ")} >>` : ""} >>`;
      set(page, dict(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ${resources} /Contents ${contentId} 0 R >>`));

      const chunks: Uint8Array[] = [new Uint8Array([...ascii("%PDF-1.7\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
      let offset = chunks[0].length;
      const offsets: number[] = [];
      objects.forEach((body, i) => {
        offsets.push(offset);
        const piece = concat([ascii(`${i + 1} 0 obj\n`), body, ascii("\nendobj\n")]);
        chunks.push(piece);
        offset += piece.length;
      });
      const id = await fingerprint(concat(chunks));
      const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
      const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""} /ID [<${id}> <${id}>] >>\nstartxref\n${offset}\n%%EOF\n`;
      chunks.push(ascii(xref + trailer));
      return concat(chunks);
    },
  };
  return doc;
}

function toUnicodeCMap(font: PdfFont): string {
  const entries = [...font.used.entries()].filter(([gid]) => gid !== 0).sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const part = entries.slice(i, i + 100);
    blocks.push(`${part.length} beginbfchar\n${part.map(([gid, ch]) => `<${hex4(gid)}> <${utf16Hex(ch)}>`).join("\n")}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${blocks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The first 16 bytes of the SHA-256 of the body, as hex: the file's /ID, the same for the same content. */
async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
  return [...digest.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
