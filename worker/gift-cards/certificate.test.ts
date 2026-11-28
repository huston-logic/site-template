import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import test from "node:test";
import { pdfActiveName, pdfHeaderOk, pdfPageCount, pdfTailOk } from "../../src/lib/pdf-scan.ts";
import { giftCertificateCopy } from "../../src/content/gift-certificate.ts";
import { parseTtf } from "../payments/ttf.ts";
import { certificatePdf, layoutCertificate, SAFE_BOX, type Box, type CertificateLayout, type LayoutElement } from "./certificate.ts";
import type { CertificateAssets, CertificateInput } from "./certificate-types.ts";

const font = (name: string) => new Uint8Array(readFileSync(new URL(`../../src/brand/certificate-fonts/${name}`, import.meta.url)));
const bytes = { display: font("display-outfit-400.ttf"), displayBold: font("display-outfit-600.ttf"), accent: font("accent-newsreader-italic.ttf") };
const fonts = { display: { ttf: parseTtf(bytes.display) }, displayBold: { ttf: parseTtf(bytes.displayBold) }, accent: { ttf: parseTtf(bytes.accent) } };
const assets = (logo: CertificateAssets["logo"] = null): CertificateAssets => ({ ...bytes, logo });

const input: CertificateInput = {
  businessName: "Example Studio",
  siteHost: "example.test",
  amountText: "$150",
  code: "EX-7K3M-9QPD",
  to: "Dana Whitfield",
  from: "Sam Rivera",
  message: "Happy birthday! Treat yourself to something lovely.",
  redeemWording: "To redeem, show this certificate or quote the code when you book.",
  termsLine: "Valid for one visit or purchase. Not exchangeable for cash.",
  issuedOn: "27 November 2026",
  validUntil: "27 November 2027",
  colors: { green: "#1e4fa3", ink: "#1c1917", ink2: "#44403c", rust: "#9a3412", line: "#d6d3d1" },
};
const worst: CertificateInput = {
  ...input,
  to: "Bartholomew Maximilian Featherstonehaugh-Cholmondeley Jr.".padEnd(60, "x").slice(0, 60),
  from: "A".repeat(60),
  message: "Thank you for everything you do. ".repeat(10).slice(0, 300),
  redeemWording: "Show this certificate when you visit and we will take it from there. ".repeat(5).slice(0, 300),
  termsLine: "No cash value and no change given. Lost certificates cannot be replaced. ".repeat(4).slice(0, 200),
  amountText: "$10,000",
  businessName: "The Extraordinarily Long Business Name & Associates Studio",
};

type TextEl = Extract<LayoutElement, { type: "text" }>;
const textOf = (layout: CertificateLayout): TextEl[] => layout.elements.filter((e): e is TextEl => e.type === "text");
const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");
function texts(b: Uint8Array): string {
  const out: string[] = [];
  for (const m of latin(b).matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    try {
      out.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    } catch {
      /* not a Flate stream */
    }
  }
  return out.join("\n=====\n");
}
const inside = (inner: Box, outer: Box) => inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.01 && inner.y + inner.h <= outer.y + outer.h + 0.01;

function png(width: number, height: number): Uint8Array {
  const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const chunk = (t: string, d: Buffer) => Buffer.concat([u32(d.length), Buffer.from(t), d, u32(0)]);
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) rows.push(30, 79, 163, x % 2 ? 255 : 120);
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]));
}

test("one Letter page, three embedded fonts with ToUnicode, no active content", async () => {
  const pdf = await certificatePdf(input, assets());
  const all = latin(pdf);
  assert.ok(pdfHeaderOk(pdf) && pdfTailOk(pdf));
  assert.equal(pdfPageCount(pdf), 1);
  assert.equal(pdfActiveName(pdf), null);
  assert.match(all, /\/MediaBox \[0 0 612 792\]/);
  assert.equal(all.match(/\/Subtype \/Type0/g)?.length, 3);
  assert.equal(all.match(/\/ToUnicode \d+ 0 R/g)?.length, 3);
  assert.equal(all.match(/\/FontFile2 \d+ 0 R/g)?.length, 3);
  assert.equal(all.match(/\/Type \/Page\b/g)?.length, 1);
});

test("the output is the same for the same input", async () => {
  assert.deepEqual(await certificatePdf(input, assets()), await certificatePdf(input, assets()));
});

test("a normal certificate is centered, at full size, with every fixed word from the copy module", () => {
  const layout = layoutCertificate(input, fonts, null);
  assert.equal(layout.scale, 1);
  const words = textOf(layout).map((e) => e.text);
  assert.ok(words.includes(giftCertificateCopy.eyebrow.toUpperCase()));
  assert.ok(words.includes("A gift for Dana Whitfield"));
  assert.ok(words.includes("From Sam Rivera"));
  assert.ok(words.includes(giftCertificateCopy.codeLabel.toUpperCase()));
  assert.ok(words.includes(input.code));
  assert.ok(words.some((w) => w.includes("Issued 27 November 2026") && w.includes("Valid until 27 November 2027")));
  assert.ok(words.includes(input.siteHost));
  for (const e of textOf(layout)) assert.ok(Math.abs(e.box.x + e.box.w / 2 - 306) < 0.01, `${e.text} is off the center axis`);
});

test("no recipient, no message and no expiry change the words, not the structure", () => {
  const layout = layoutCertificate({ ...input, to: null, message: null, validUntil: null }, fonts, null);
  const words = textOf(layout).map((e) => e.text);
  assert.ok(words.includes(giftCertificateCopy.giftForAnyone));
  assert.ok(words.some((w) => w.includes(giftCertificateCopy.noExpiry)));
  assert.ok(!words.some((w) => w.includes("Happy birthday")));
});

test("the longest allowed texts fit inside the border and do not overlap", () => {
  const layout = layoutCertificate(worst, fonts, null);
  assert.equal(layout.fits, true);
  assert.ok(inside(layout.frame.inner, layout.frame.outer));
  const lines = textOf(layout);
  for (const e of layout.elements) assert.ok(inside(e.box, SAFE_BOX), `${e.type} leaves the safe area`);
  assert.ok(SAFE_BOX.x >= 36 && SAFE_BOX.y >= 36 && SAFE_BOX.x + SAFE_BOX.w <= 576 && SAFE_BOX.y + SAFE_BOX.h <= 756, "the safe area keeps half an inch");
  assert.ok(inside(SAFE_BOX, layout.frame.inner));
  const sorted = [...lines].sort((a, b) => b.box.y - a.box.y);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].box.y + sorted[i].box.h <= sorted[i - 1].box.y + 0.01, `"${sorted[i].text}" overlaps "${sorted[i - 1].text}"`);
  const messageLines = lines.filter((e) => e.role === "message");
  assert.ok(messageLines.length >= 1 && messageLines.length <= 6);
  assert.ok(lines.filter((e) => e.role === "redeem").length <= 4);
  assert.ok(lines.filter((e) => e.role === "terms").length <= 3);
});

test("within the limits no word is ever cut: the laid-out lines hold every word of each text", () => {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).join(" ");
  const complete: CertificateInput = {
    ...worst,
    to: "Bartholomew Maximilian Featherstonehaugh Cholmondeley Jr Esquire The Third",
    message: words("Thank you for everything you do for our family every single week without ever being asked and without ever asking for anything back. ".repeat(3)).slice(0, 300).replace(/ \S*$/, ""),
    redeemWording: words("To redeem, show this certificate or quote the code when you book, and we will take care of everything from there. ".repeat(3)).slice(0, 300).replace(/ \S*$/, ""),
    termsLine: words("Valid for one visit or purchase. Not exchangeable for cash. Lost certificates cannot be replaced. ".repeat(3)).slice(0, 200).replace(/ \S*$/, ""),
  };
  for (const [role, text] of [["message", complete.message], ["redeem", complete.redeemWording], ["terms", complete.termsLine]] as const) {
    assert.ok(text !== null && text.length > 150);
    const layout = layoutCertificate(complete, fonts, null);
    const joined = textOf(layout).filter((e) => e.role === role).map((e) => e.text).join(" ");
    assert.equal(joined, words(text ?? ""), `${role} lost words`);
    assert.ok(!joined.includes("\u2026"));
  }
  const layout = layoutCertificate(complete, fonts, null);
  assert.equal(textOf(layout).filter((e) => e.role === "giftFor").map((e) => e.text).join(" "), `A gift for ${complete.to}`);
  assert.equal(layout.fits, true);
});

test("any text longer than the limits is cut with an ellipsis, never overflowing", () => {
  const huge = { ...worst, message: "word ".repeat(400), redeemWording: "word ".repeat(400), termsLine: "x".repeat(900), to: "y".repeat(300), from: "z".repeat(300), code: "C".repeat(80), amountText: "$99,999,999.99" };
  const layout = layoutCertificate(huge, fonts, null);
  assert.equal(layout.fits, true);
  for (const e of layout.elements) assert.ok(inside(e.box, SAFE_BOX), `${e.type} leaves the safe area`);
  assert.ok(textOf(layout).filter((e) => e.role === "message").length <= 6);
});

test("a character the fonts lack is shown without its accent or as a question mark, and still copies as text", async () => {
  const pdf = await certificatePdf({ ...input, to: "Zoǎ 中", message: "Hi \u{1f600} there" }, assets());
  const all = texts(pdf);
  assert.match(all, /<0*[0-9A-F]+> <0061>/, "the a with a caron maps to a");
  assert.match(all, /<[0-9A-F]{4}> <003F>/, "unknown characters map to ?");
});

test("with a logo the image is embedded with its transparency; without one the business name is set in type", async () => {
  const withLogo = await certificatePdf(input, assets({ png: png(8, 4) }));
  const all = latin(withLogo);
  assert.match(all, /\/Subtype \/Image/);
  assert.match(all, /\/SMask \d+ 0 R/);
  const layout = layoutCertificate(input, fonts, { width: 8, height: 4 });
  const logo = layout.elements.find((e) => e.type === "logo");
  assert.ok(logo && inside(logo.box, SAFE_BOX));
  assert.ok(!textOf(layout).some((e) => e.role === "business"));
  const noLogo = layoutCertificate(input, fonts, null);
  assert.ok(textOf(noLogo).some((e) => e.role === "business" && e.text === "Example Studio"));
  assert.doesNotMatch(latin(await certificatePdf(input, assets())), /\/Subtype \/Image/);
});

test("a logo that cannot be decoded falls back to the business name", async () => {
  const pdf = await certificatePdf(input, assets({ png: new Uint8Array([1, 2, 3]) }));
  assert.doesNotMatch(latin(pdf), /\/Subtype \/Image/);
  assert.equal(pdfPageCount(pdf), 1);
});

test("control characters and line breaks in the texts are flattened", () => {
  const layout = layoutCertificate({ ...input, message: "Line one\n\nLine\ttwo\u0000 ​ end" }, fonts, null);
  const message = textOf(layout).filter((e) => e.role === "message").map((e) => e.text).join(" ");
  assert.equal(message, "Line one Line two end");
});
