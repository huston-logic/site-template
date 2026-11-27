// The catalog photo step: turns one source photo into the two files a catalog item needs, in headless Chrome (Playwright's
// Chromium, or the installed Google Chrome, the way scripts/change-report.mjs opens a browser; no new dependency).
//   web   the photo itself: EXIF orientation applied, at most 1600 px on the long side, WebP, at most 450 KB
//   card  the grid thumbnail: 720 by 900 (4:5) cover crop honouring `focus`, WebP, at most 150 KB
// Both then go through the metadata cleaner (scripts/image-metadata.mjs) and are checked clean. Only JPEG, PNG and WebP are
// accepted, judged by their first bytes.
//
//   node scripts/catalog-images.mjs --examples      writes public/images/examples/<name>-card.webp for each example photo
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cardPathFor } from "../src/catalog/schema.ts";
import { inspectMetadata, stripMetadata } from "./image-metadata.mjs";

export const WEB_MAX_SIDE = 1600;
export const WEB_MAX_BYTES = 450 * 1024;
export const CARD_WIDTH = 720;
export const CARD_HEIGHT = 900;
export const CARD_MAX_BYTES = 150 * 1024;
/** Each step is [longest side, quality]; the first one that fits the size cap wins. */
export const WEB_LADDER = [
  [WEB_MAX_SIDE, 0.82],
  [WEB_MAX_SIDE, 0.75],
  [1280, 0.72],
  [1280, 0.6],
];
export const CARD_LADDER = [0.78, 0.7, 0.62];

/** "jpeg", "png" or "webp" from the first bytes; "heic" for a HEIC/HEIF photo; null for anything else. */
export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp" && /^(?:heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(bytes.subarray(8, 12).toString("latin1"))) return "heic";
  return null;
}

/** Why a file cannot be used, or null when it is a JPEG, PNG or WebP. */
export function unsupportedReason(bytes) {
  const kind = sniffImage(bytes);
  if (kind === "jpeg" || kind === "png" || kind === "webp") return null;
  if (kind === "heic") return "HEIC photos must be converted to JPEG first";
  return "the photo is not a JPEG, PNG or WebP image";
}

/**
 * The part of a width by height photo the 4:5 card shows: the biggest 4:5 rectangle that fits, placed by `focus`
 * (center, top, bottom, left, right). Returns whole pixels { sx, sy, sw, sh }.
 */
export function cardCrop(width, height, focus = "center") {
  const target = CARD_WIDTH / CARD_HEIGHT;
  let sw = width;
  let sh = Math.round(width / target);
  if (sh > height) {
    sh = height;
    sw = Math.round(height * target);
  }
  sw = Math.min(sw, width);
  const slackX = width - sw;
  const slackY = height - sh;
  const sx = focus === "left" ? 0 : focus === "right" ? slackX : Math.floor(slackX / 2);
  const sy = focus === "top" ? 0 : focus === "bottom" ? slackY : Math.floor(slackY / 2);
  return { sx, sy, sw, sh };
}

/** The size of a photo scaled to at most `side` pixels on its long side (never enlarged). */
export function fitWithin(width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function openBrowser() {
  const { chromium } = await import("@playwright/test");
  try {
    return await chromium.launch();
  } catch {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw new Error("Could not open a browser. Install one with `npx playwright install chromium` (ask Grant first) or install Google Chrome.");
    }
  }
}

/** Runs in the page. Decodes the photo (EXIF orientation applied) and keeps the bitmap for the encode steps. */
async function decodeInPage(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  window.__photo = bitmap;
  return { width: bitmap.width, height: bitmap.height };
}

/** Runs in the page. Draws the (cropped) bitmap at the given size and encodes it as WebP; returns base64. */
async function encodeInPage({ crop, width, height, quality }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(window.__photo, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) return null;
  const data = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(text);
}

function cleaned(bytes, what) {
  const result = stripMetadata(bytes, ".webp");
  const check = inspectMetadata(result.bytes, ".webp");
  if (check.error || check.removed.length > 0) throw new Error(`the ${what} file still carries hidden data (${check.error ?? check.removed.join("; ")})`);
  return result.bytes;
}

/**
 * Makes the web photo and the card from one source file. `browser` comes from openBrowser. Returns
 * { web: Buffer, card: Buffer, width, height } (the web photo's size), or throws an Error with a plain-sentence message.
 */
export async function makeCatalogPhotos(browser, inputPath, { focus = "center" } = {}) {
  const source = readFileSync(inputPath);
  const reason = unsupportedReason(source);
  if (reason) throw new Error(reason);
  const page = await browser.newPage();
  try {
    let size;
    try {
      size = await page.evaluate(decodeInPage, source.toString("base64"));
    } catch {
      throw new Error("the photo could not be read; it may be damaged");
    }
    const encode = async (crop, width, height, quality) => {
      const b64 = await page.evaluate(encodeInPage, { crop, width, height, quality });
      if (b64 === null) throw new Error("the browser could not write a WebP file");
      return Buffer.from(b64, "base64");
    };
    const whole = { sx: 0, sy: 0, sw: size.width, sh: size.height };
    let web = null;
    let webSize = fitWithin(size.width, size.height, WEB_MAX_SIDE);
    for (const [side, quality] of WEB_LADDER) {
      webSize = fitWithin(size.width, size.height, side);
      const bytes = await encode(whole, webSize.width, webSize.height, quality);
      web = bytes;
      if (bytes.length <= WEB_MAX_BYTES) break;
    }
    if (web.length > WEB_MAX_BYTES) throw new Error(`the photo is still ${Math.round(web.length / 1024)} KB at the lowest quality; it needs a smaller source`);
    const crop = cardCrop(size.width, size.height, focus);
    let card = null;
    for (const quality of CARD_LADDER) {
      card = await encode(crop, CARD_WIDTH, CARD_HEIGHT, quality);
      if (card.length <= CARD_MAX_BYTES) break;
    }
    if (card.length > CARD_MAX_BYTES) throw new Error(`the card is still ${Math.round(card.length / 1024)} KB at the lowest quality`);
    return { web: cleaned(web, "photo"), card: cleaned(card, "card"), width: webSize.width, height: webSize.height };
  } finally {
    await page.close();
  }
}

/** Writes the card files for the example photos (the showcase uses them). Run once; commit the result. */
export async function makeExampleCards(root, log = console.log) {
  const dir = join(root, "public/images/examples");
  const names = readdirSync(dir).filter((name) => /\.jpe?g$/i.test(name)).sort();
  const browser = await openBrowser();
  try {
    for (const name of names) {
      const { card } = await makeCatalogPhotos(browser, join(dir, name), { focus: "center" });
      const target = join(root, "public", cardPathFor(`/images/examples/${name}`));
      writeFileSync(target, card);
      log(`${target.slice(root.length)}: ${Math.round(card.length / 1024)} KB`);
    }
  } finally {
    await browser.close();
  }
  return names.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("..", import.meta.url).pathname;
  if (process.argv.includes("--examples")) {
    if (!existsSync(join(root, "public/images/examples"))) throw new Error("public/images/examples is missing");
    await makeExampleCards(root);
  } else {
    console.log("Usage: node scripts/catalog-images.mjs --examples");
    process.exitCode = 2;
  }
}
