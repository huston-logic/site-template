// Writes a sample gift certificate PDF with made-up data and the default fonts (Outfit, Newsreader), for the design
// critique: `node scripts/certificate-sample.mjs <output.pdf> [--long] [--logo]`.
// --long uses the longest allowed texts; --logo adds a generated test logo.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fontFile = (name) => new Uint8Array(readFileSync(join(root, "src/brand/certificate-fonts", name)));

export const SAMPLE_INPUT = {
  businessName: "Example Studio",
  siteHost: "example.test",
  amountText: "$150",
  code: "EX-7K3M-9QPD",
  to: "Dana Whitfield",
  from: "Sam Rivera",
  message: "Happy birthday, Dana! I hope this gives you a long, quiet afternoon to yourself. You have earned it many times over.",
  redeemWording: "To redeem, show this certificate or quote the code when you book. One certificate per visit.",
  termsLine: "Valid for one visit or purchase. Not exchangeable for cash. Lost certificates cannot be replaced.",
  issuedOn: "27 November 2026",
  validUntil: "27 November 2027",
  colors: { green: "#1e4fa3", ink: "#1c1917", ink2: "#44403c", rust: "#9a3412", line: "#d6d3d1" },
};

/** Whole words from `text` repeated, as many as fit in `max` characters: the limits are real, a cut word would hide the sample's point. */
function wordsUpTo(text, max) {
  let out = "";
  for (let i = 0; ; i += 1) {
    const word = text.split(" ")[i % text.split(" ").length];
    const next = out === "" ? word : `${out} ${word}`;
    if (next.length > max) return out;
    out = next;
  }
}

export const LONG_INPUT = {
  ...SAMPLE_INPUT,
  to: "Bartholomew Maximilian Featherstonehaugh-Cholmondeley",
  from: "Alexandria Wilhelmina Montgomery-Fitzgerald III",
  message: wordsUpTo("Thank you for everything you do for our family, every single week, without ever being asking anything back.", 300),
  redeemWording: wordsUpTo("To redeem, show this certificate or quote the code when you book, and we will take care of everything from there.", 300),
  termsLine: wordsUpTo("Valid for one visit or purchase. Not exchangeable for cash. Lost certificates cannot be replaced. No change given.", 200),
};

/** A small 96 by 32 RGBA PNG with a soft gradient and transparent corners, so the transparency path is exercised. */
export function sampleLogoPng() {
  const w = 96;
  const h = 32;
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    rows.push(0);
    for (let x = 0; x < w; x += 1) {
      const inside = (x - w / 2) ** 2 / (w / 2) ** 2 + (y - h / 2) ** 2 / (h / 2) ** 2 <= 1;
      rows.push(30 + Math.round((x / w) * 40), 79, 163, inside ? 255 : 0);
    }
  }
  const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type), data, u32(0)]);
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", Buffer.concat([u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0])])), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]),
  );
}

export async function makeSample({ long = false, logo = false } = {}) {
  const { certificatePdf } = await import(pathToFileURL(join(root, "worker/gift-cards/certificate.ts")).href);
  const assets = {
    display: fontFile("display-outfit-400.ttf"),
    displayBold: fontFile("display-outfit-600.ttf"),
    accent: fontFile("accent-newsreader-italic.ttf"),
    logo: logo ? { png: sampleLogoPng() } : null,
  };
  return certificatePdf(long ? LONG_INPUT : SAMPLE_INPUT, assets);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: node scripts/certificate-sample.mjs <output.pdf> [--long] [--logo]");
    process.exit(1);
  }
  const bytes = await makeSample({ long: args.includes("--long"), logo: args.includes("--logo") });
  writeFileSync(resolve(target), bytes);
  console.log(`Wrote ${resolve(target)} (${bytes.length} bytes)`);
}
