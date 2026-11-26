// The byte checks for a PDF a client change adds under public/files/ (scripts/check-change-scope.mjs). Pure: bytes in, one
// plain message or null out. The Worker's upload check (worker/uploads/pdf.ts) applies the same rules to an uploaded PDF.
// No imports: plain Node loads it directly.

// PDF names end at whitespace or one of these delimiters; "/JSFoo" is one name, "/JS(" is "JS" followed by a string.
const NAME = /\/([^\u0000\t\n\f\r ()<>[\]{}/%]*)/g;

const decodeName = (raw) => raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/** The PDF names in the bytes, with `#xx` escapes decoded (so /J#61vaScript is JavaScript). */
export function pdfNames(bytes) {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  return new Set([...text.matchAll(NAME)].map((m) => decodeName(m[1])));
}

/**
 * Why this PDF cannot go on the site, or null. `rules` carries maxPdfBytes and pdfActiveNames (change-scope-rules.mjs).
 * Names inside compressed object streams are not seen; the /files/* headers (public/_headers) are the layer for that.
 */
export function pdfProblem(bytes, rules) {
  if (bytes.length > rules.maxPdfBytes) {
    return `${(bytes.length / 1e6).toFixed(1)} MB is over the ${Math.round(rules.maxPdfBytes / 1e6)} MB limit. Save a smaller PDF (for example, export it again at a lower image quality)`;
  }
  const start = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (start !== "%PDF-") return "the file's contents are not really a PDF (renamed file?). Save it as a PDF and add that";
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString("latin1");
  if (!tail.includes("%%EOF")) return "the PDF looks cut off (it has no end marker). Save it again as a PDF and add that";
  const names = pdfNames(bytes);
  const found = rules.pdfActiveNames.filter((name) => names.has(name));
  if (found.length > 0) {
    return `it holds a script, a form action or an attached file (${found.map((n) => `/${n}`).join(", ")}), which a website can't safely offer. Save it again as a plain PDF (Print, then Save as PDF)`;
  }
  return null;
}
