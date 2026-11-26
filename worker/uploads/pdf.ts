/** The PDF check (mirrored in the scope check, scripts/change-scope-rules.mjs). Names inside compressed object streams are not seen. */

export const ACTIVE_PDF_NAMES: ReadonlySet<string> = new Set([
  "JavaScript",
  "JS",
  "Launch",
  "EmbeddedFile",
  "EmbeddedFiles",
  "RichMedia",
  "XFA",
  "AA",
  "SubmitForm",
  "ImportData",
]);

export type PdfCheck = { ok: true; pages: number } | { ok: false; reason: "damaged" | "active" | "too_big" };

/** A PDF name: a slash and everything up to white space or a delimiter. */
const NAME = /\/[^\s/<>[\](){}%]+/g;

const decodeName = (token: string): string => token.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

export function checkPdf(bytes: Uint8Array, maxBytes: number): PdfCheck {
  if (bytes.length > maxBytes) return { ok: false, reason: "too_big" };
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith("%PDF-")) return { ok: false, reason: "damaged" };
  if (!text.slice(-1024).includes("%%EOF")) return { ok: false, reason: "damaged" };
  let decoded = "";
  let last = 0;
  for (const match of text.matchAll(NAME)) {
    const name = decodeName(match[0]);
    if (ACTIVE_PDF_NAMES.has(name.slice(1))) return { ok: false, reason: "active" };
    decoded += text.slice(last, match.index) + name;
    last = match.index + match[0].length;
  }
  decoded += text.slice(last);
  const pages = (decoded.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  return { ok: true, pages: Math.max(1, pages) };
}
