// The gift certificate: one US Letter page, drawn on the small PDF writer in worker/payments/pdf.ts. layoutCertificate
// is pure (it only measures text) and returns every element with its box, so the tests can check that nothing leaves the
// border; certificatePdf draws that layout. Every fixed word comes from src/content/gift-certificate.ts.
import { giftCertificateCopy as copy } from "../../src/content/gift-certificate.ts";
import { createPdf, hexToRgb, measure, PAGE_HEIGHT, PAGE_WIDTH, type PdfFont } from "../payments/pdf.ts";
import { decodePng } from "../payments/png.ts";
import type { TtfFont } from "../payments/ttf.ts";
import type { CertificateAssets, CertificateInput } from "./certificate-types.ts";

/** A rectangle in PDF points: x and y are its bottom left corner. */
export type Box = { x: number; y: number; w: number; h: number };
export type ColorKey = keyof CertificateInput["colors"];
export type FontKey = "display" | "displayBold" | "accent";
export type Role = "business" | "eyebrow" | "giftFor" | "amount" | "from" | "message" | "codeLabel" | "code" | "redeem" | "terms" | "dates" | "host";

export type LayoutElement =
  | { type: "text"; role: Role; font: FontKey; size: number; text: string; x: number; baseline: number; charSpace: number; color: ColorKey; box: Box }
  | { type: "rule"; box: Box; color: ColorKey }
  | { type: "codeBox"; box: Box; color: ColorKey }
  | { type: "logo"; box: Box };

export type CertificateLayout = {
  elements: LayoutElement[];
  frame: { outer: Box; inner: Box };
  /** The layout's size factor: 1 when everything fits at its designed size, smaller when long texts squeezed it. */
  scale: number;
  /** False only if even the smallest sizes and shortest line limits did not fit (never expected). */
  fits: boolean;
};

type Fonts = Record<FontKey, { ttf: TtfFont }>;

const CENTER = PAGE_WIDTH / 2;
const OUTER: Box = { x: 40, y: 40, w: PAGE_WIDTH - 80, h: PAGE_HEIGHT - 80 };
const INNER: Box = { x: 47, y: 47, w: PAGE_WIDTH - 94, h: PAGE_HEIGHT - 94 };
/** Everything the layout draws stays inside this box: 24 pt inside the inner rule, and more than half an inch from the paper's edge. */
export const SAFE_BOX: Box = { x: 71, y: 71, w: PAGE_WIDTH - 142, h: PAGE_HEIGHT - 142 };
const CONTENT_W = 440;
const TEXT_W = 400;
/** The stack of blocks is centered between these distances from the top of the page. */
const STACK_TOP = 84;
const STACK_BOTTOM = 676;
const HOST_TOP = 690;

/** One line of plain text: control and invisible characters gone, marks without a base gone, white space collapsed. */
export function cleanText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\p{Cf}\p{M}︀-️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, font: { ttf: TtfFont }, size: number, width: number, charSpace: number): string[] {
  const lines: string[] = [];
  let line = "";
  const fits = (s: string) => measure(s, font, size, charSpace) <= width;
  for (const word of text.split(" ")) {
    if (word === "") continue;
    const trial = line === "" ? word : `${line} ${word}`;
    if (fits(trial)) {
      line = trial;
      continue;
    }
    if (line !== "") lines.push(line);
    let rest = word;
    while (!fits(rest)) {
      const chars = [...rest];
      let n = chars.length - 1;
      while (n > 1 && !fits(chars.slice(0, n).join(""))) n -= 1;
      lines.push(chars.slice(0, n).join(""));
      rest = chars.slice(n).join("");
    }
    line = rest;
  }
  if (line !== "") lines.push(line);
  return lines;
}

function ellipsize(text: string, font: { ttf: TtfFont }, size: number, width: number, charSpace: number): string {
  const chars = [...text];
  while (chars.length > 1 && measure(`${chars.join("").trimEnd()}…`, font, size, charSpace) > width) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

type Fit = { size: number; lines: string[] };

/** The same text in the same number of lines, wrapped at the narrowest width that keeps that count, so no line is left with one short word. */
function balanced(text: string, font: { ttf: TtfFont }, size: number, width: number, charSpace: number, count: number): string[] {
  let low = width * 0.5;
  let high = width;
  for (let i = 0; i < 12; i += 1) {
    const mid = (low + high) / 2;
    if (wrap(text, font, size, mid, charSpace).length === count) high = mid;
    else low = mid;
  }
  const lines = wrap(text, font, size, high, charSpace);
  return lines.length === count ? lines : wrap(text, font, size, width, charSpace);
}

/** The largest size from max down to min (steps of half a point) whose wrapped text has at most maxLines lines; at min, the rest is cut with an ellipsis. */
function fit(text: string, font: { ttf: TtfFont }, max: number, min: number, width: number, maxLines: number, charSpace = 0): Fit {
  const top = Math.max(max, min);
  for (let size = top; size > min; size -= 0.5) {
    const lines = wrap(text, font, size, width, charSpace);
    if (lines.length <= maxLines) return { size, lines: lines.length > 1 ? balanced(text, font, size, width, charSpace, lines.length) : lines };
  }
  const lines = wrap(text, font, min, width, charSpace);
  if (lines.length <= maxLines) return { size: min, lines: lines.length > 1 ? balanced(text, font, min, width, charSpace, lines.length) : lines };
  const kept = lines.slice(0, maxLines - 1);
  kept.push(ellipsize(lines.slice(maxLines - 1).join(" "), font, min, width, charSpace));
  return { size: min, lines: kept };
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

type Block = { gap: number; height: number; make: (top: number) => LayoutElement[] };

type Caps = { message: number; redeem: number; terms: number };

function blocks(input: CertificateInput, fonts: Fonts, logo: { width: number; height: number } | null, k: number, caps: Caps): Block[] {
  const out: Block[] = [];
  const textBlock = (role: Role, font: FontKey, color: ColorKey, f: Fit, lineHeight: number, gap: number, charSpace = 0): Block => {
    const lineH = f.size * lineHeight;
    return {
      gap,
      height: lineH * f.lines.length,
      make: (top) =>
        f.lines.map((text, i): LayoutElement => {
          const w = measure(text, fonts[font], f.size, charSpace);
          const lineTop = top + i * lineH;
          const capH = (fonts[font].ttf.capHeight / fonts[font].ttf.unitsPerEm) * f.size;
          return {
            type: "text", role, font, size: f.size, text, x: CENTER - w / 2, charSpace, color,
            baseline: PAGE_HEIGHT - (lineTop + (lineH + capH) / 2),
            box: { x: CENTER - w / 2, y: PAGE_HEIGHT - lineTop - lineH, w, h: lineH },
          };
        }),
    };
  };

  // Logo, or the business name set in type.
  if (logo) {
    const ratio = logo.width / logo.height;
    const h = Math.min(58 * Math.max(k, 0.8), 210 / ratio);
    const w = h * ratio;
    out.push({ gap: 0, height: h, make: (top) => [{ type: "logo", box: { x: CENTER - w / 2, y: PAGE_HEIGHT - top - h, w, h } }] });
  } else {
    out.push(textBlock("business", "displayBold", "ink", fit(cleanText(input.businessName), fonts.displayBold, 24 * k, 13, CONTENT_W, 2, 0.6), 1.25, 0, 0.6));
  }

  const eyebrow = fit(copy.eyebrow.toUpperCase(), fonts.displayBold, 9, 9, CONTENT_W, 1, 3.2);
  out.push(textBlock("eyebrow", "displayBold", "rust", eyebrow, 1.3, 30 * k, 3.2));
  out.push({ gap: 12 * k, height: 1.2, make: (top) => [{ type: "rule", color: "green", box: { x: CENTER - 16, y: PAGE_HEIGHT - top - 1.2, w: 32, h: 1.2 } }] });

  const to = cleanText(input.to ?? "");
  const giftText = to === "" ? copy.giftForAnyone : fill(copy.giftFor, { name: to });
  const single = wrap(giftText, fonts.accent, 24, CONTENT_W, 0).length === 1;
  const gift = single ? fit(giftText, fonts.accent, 34 * k, 24, CONTENT_W, 1) : fit(giftText, fonts.accent, Math.max(17, 24 * k), 17, CONTENT_W, 3);
  out.push(textBlock("giftFor", "accent", "ink", gift, 1.25, 20 * k));

  out.push(textBlock("amount", "displayBold", "green", fit(cleanText(input.amountText), fonts.displayBold, 76 * k, 34, CONTENT_W, 1), 1.05, 6 * k));

  const from = cleanText(input.from);
  if (from !== "") out.push(textBlock("from", "accent", "ink2", fit(fill(copy.from, { name: from }), fonts.accent, 18 * k, 11, CONTENT_W, 2), 1.3, 12 * k));

  const message = cleanText(input.message ?? "");
  if (message !== "") out.push(textBlock("message", "accent", "ink", fit(message, fonts.accent, 16 * k, 9.5, TEXT_W, caps.message), 1.4, 26 * k));

  // The code in its box: the small label above, the code in letter-spaced display type.
  const code = fit(cleanText(input.code), fonts.displayBold, 26 * Math.max(k, 0.8), 12, 340, 1, 3.4);
  const codeW = Math.min(CONTENT_W, Math.max(230, measure(code.lines[0] ?? "", fonts.displayBold, code.size, 3.4) + 64));
  const boxH = 62 * Math.max(k, 0.85);
  out.push({
    gap: 28 * k,
    height: boxH,
    make: (top) => {
      const label = copy.codeLabel.toUpperCase();
      const labelSize = 7;
      const labelW = measure(label, fonts.displayBold, labelSize, 2.4);
      const labelCap = (fonts.displayBold.ttf.capHeight / fonts.displayBold.ttf.unitsPerEm) * labelSize;
      const codeCap = (fonts.displayBold.ttf.capHeight / fonts.displayBold.ttf.unitsPerEm) * code.size;
      const text = code.lines[0] ?? "";
      const w = measure(text, fonts.displayBold, code.size, 3.4);
      const labelTop = top + 11;
      const codeBaselineTop = top + boxH - 13 - (boxH - 26 - labelCap) * 0.1 - 2;
      return [
        { type: "codeBox", color: "green", box: { x: CENTER - codeW / 2, y: PAGE_HEIGHT - top - boxH, w: codeW, h: boxH } },
        { type: "text", role: "codeLabel", font: "displayBold", size: labelSize, text: label, x: CENTER - labelW / 2, charSpace: 2.4, color: "rust", baseline: PAGE_HEIGHT - (labelTop + labelCap), box: { x: CENTER - labelW / 2, y: PAGE_HEIGHT - labelTop - labelCap - 2, w: labelW, h: labelCap + 2 } },
        { type: "text", role: "code", font: "displayBold", size: code.size, text, x: CENTER - w / 2, charSpace: 3.4, color: "ink", baseline: PAGE_HEIGHT - codeBaselineTop, box: { x: CENTER - w / 2, y: PAGE_HEIGHT - codeBaselineTop - 0.03 * code.size, w, h: codeCap + 0.03 * code.size } },
      ];
    },
  });

  const redeem = cleanText(input.redeemWording);
  if (redeem !== "") out.push(textBlock("redeem", "display", "ink2", fit(redeem, fonts.display, 10.5 * k, 7.5, TEXT_W, caps.redeem), 1.45, 26 * k));
  const terms = cleanText(input.termsLine);
  if (terms !== "") out.push(textBlock("terms", "display", "ink2", fit(terms, fonts.display, 8.5 * k, 7, TEXT_W, caps.terms), 1.45, 8 * k));

  const issued = fill(copy.issued, { date: cleanText(input.issuedOn) });
  const valid = input.validUntil === null ? copy.noExpiry : fill(copy.validUntil, { date: cleanText(input.validUntil) });
  const both = `${issued}   •   ${valid}`;
  if (wrap(both, fonts.display, Math.max(7.5, 9.5 * k), CONTENT_W, 0.3).length === 1) {
    out.push(textBlock("dates", "display", "ink", fit(both, fonts.display, 9.5 * k, 7.5, CONTENT_W, 1, 0.3), 1.4, 20 * k, 0.3));
  } else {
    out.push(textBlock("dates", "display", "ink", fit(issued, fonts.display, 9.5 * k, 7.5, CONTENT_W, 1, 0.3), 1.4, 20 * k, 0.3));
    out.push(textBlock("dates", "display", "ink", fit(valid, fonts.display, 9.5 * k, 7.5, CONTENT_W, 1, 0.3), 1.4, 2 * k, 0.3));
  }
  return out;
}

export function layoutCertificate(input: CertificateInput, fonts: Fonts, logo: { width: number; height: number } | null): CertificateLayout {
  const available = STACK_BOTTOM - STACK_TOP;
  const capSets: Caps[] = [{ message: 6, redeem: 6, terms: 4 }, { message: 5, redeem: 4, terms: 3 }, { message: 4, redeem: 3, terms: 2 }];
  let chosen: { list: Block[]; height: number; k: number } | null = null;
  let last: { list: Block[]; height: number; k: number } | null = null;
  search: for (const caps of capSets) {
    for (let step = 0; step <= 10; step += 1) {
      const k = Math.round((1 - step * 0.05) * 100) / 100;
      const list = blocks(input, fonts, logo, k, caps);
      const height = list.reduce((n, b, i) => n + b.height + (i === 0 ? 0 : b.gap), 0);
      last = { list, height, k };
      if (height <= available) {
        chosen = last;
        break search;
      }
    }
  }
  const pick = chosen ?? last;
  if (!pick) throw new Error("No layout.");

  const elements: LayoutElement[] = [];
  let top = STACK_TOP + Math.max(0, (available - pick.height) / 2);
  pick.list.forEach((block, i) => {
    if (i > 0) top += block.gap;
    elements.push(...block.make(top));
    top += block.height;
  });

  const hostSize = 8.5;
  const host = cleanText(input.siteHost);
  if (host !== "") {
    const w = measure(host, fonts.displayBold, hostSize, 1.6);
    const lineH = hostSize * 1.4;
    const cap = (fonts.displayBold.ttf.capHeight / fonts.displayBold.ttf.unitsPerEm) * hostSize;
    elements.push({
      type: "text", role: "host", font: "displayBold", size: hostSize, text: host, x: CENTER - w / 2, charSpace: 1.6, color: "green",
      baseline: PAGE_HEIGHT - (HOST_TOP + (lineH + cap) / 2),
      box: { x: CENTER - w / 2, y: PAGE_HEIGHT - HOST_TOP - lineH, w, h: lineH },
    });
  }

  const fits = chosen !== null && elements.every((e) => e.box.x >= SAFE_BOX.x && e.box.y >= SAFE_BOX.y && e.box.x + e.box.w <= SAFE_BOX.x + SAFE_BOX.w && e.box.y + e.box.h <= SAFE_BOX.y + SAFE_BOX.h);
  return { elements, frame: { outer: OUTER, inner: INNER }, scale: pick.k, fits };
}

export async function certificatePdf(input: CertificateInput, assets: CertificateAssets): Promise<Uint8Array> {
  const pdf = createPdf({ title: fill(copy.documentTitle, { business: cleanText(input.businessName) }) });
  const font: Record<FontKey, PdfFont> = {
    display: pdf.addFont("CertificateDisplay", assets.display),
    displayBold: pdf.addFont("CertificateDisplayBold", assets.displayBold),
    accent: pdf.addFont("CertificateAccent", assets.accent),
  };

  let logo: { rgb: Uint8Array; alpha: Uint8Array | null; width: number; height: number } | null = null;
  if (assets.logo) {
    try {
      logo = await decodePng(assets.logo.png);
    } catch {
      logo = null;
    }
  }

  const layout = layoutCertificate(input, font, logo);
  const color = (key: ColorKey) => hexToRgb(input.colors[key]);

  pdf.rect(layout.frame.outer.x, layout.frame.outer.y, layout.frame.outer.w, layout.frame.outer.h, { stroke: color("green"), lineWidth: 1.4 });
  pdf.rect(layout.frame.inner.x, layout.frame.inner.y, layout.frame.inner.w, layout.frame.inner.h, { stroke: color("line"), lineWidth: 0.6 });

  const image = logo ? pdf.addImage(logo) : null;
  for (const e of layout.elements) {
    if (e.type === "text") pdf.text(font[e.font], e.size, e.x, e.baseline, e.text, { color: color(e.color), charSpace: e.charSpace });
    else if (e.type === "rule") pdf.rect(e.box.x, e.box.y, e.box.w, e.box.h, { fill: color(e.color) });
    else if (e.type === "codeBox") pdf.roundedRect(e.box.x, e.box.y, e.box.w, e.box.h, 6, { stroke: color(e.color), lineWidth: 1 });
    else if (image) pdf.image(image, e.box.x, e.box.y, e.box.w, e.box.h);
  }
  return pdf.finish();
}
