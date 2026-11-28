// An 8-bit, non-interlaced PNG decoder for the certificate's logo: color types 0, 2, 4 and 6 become RGB bytes plus an
// optional alpha channel (dropped when fully opaque). Web APIs only.
import { inflate } from "./flate.ts";

export type DecodedPng = { width: number; height: number; rgb: Uint8Array; alpha: Uint8Array | null };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const MAX_PIXELS = 16_000_000;

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error("Not a PNG file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colorType = -1;
  const parts: Uint8Array[] = [];
  let offset = 8;
  let sawEnd = false;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = offset + 8;
    if (data + length > bytes.length) throw new Error("Damaged PNG file.");
    if (type === "IHDR") {
      width = view.getUint32(data);
      height = view.getUint32(data + 4);
      if (bytes[data + 8] !== 8) throw new Error("Only 8-bit PNG files are supported.");
      colorType = bytes[data + 9];
      if (CHANNELS[colorType] === undefined) throw new Error(`PNG color type ${colorType} is not supported.`);
      if (bytes[data + 12] !== 0) throw new Error("Interlaced PNG files are not supported.");
    } else if (type === "IDAT") {
      parts.push(bytes.subarray(data, data + length));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = data + length + 4;
  }
  if (!sawEnd || colorType < 0 || parts.length === 0) throw new Error("Damaged PNG file.");
  if (width === 0 || height === 0 || width * height > MAX_PIXELS) throw new Error("PNG size is not supported.");

  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  const raw = await inflate(joined);
  const channels = CHANNELS[colorType];
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("Damaged PNG file.");

  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[dst + x - channels] : 0;
      const up = y > 0 ? pixels[dst - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[dst - stride + x - channels] : 0;
      let predictor: number;
      switch (filter) {
        case 0: predictor = 0; break;
        case 1: predictor = left; break;
        case 2: predictor = up; break;
        case 3: predictor = (left + up) >> 1; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default: throw new Error("Damaged PNG file.");
      }
      pixels[dst + x] = (raw[src + x] + predictor) & 255;
    }
  }

  const count = width * height;
  if (colorType === 2) return { width, height, rgb: pixels, alpha: null };
  const rgb = new Uint8Array(count * 3);
  let alpha: Uint8Array | null = null;
  if (colorType === 0 || colorType === 4) {
    if (colorType === 4) alpha = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      const g = pixels[i * channels];
      rgb[i * 3] = g;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = g;
      if (alpha) alpha[i] = pixels[i * 2 + 1];
    }
  } else {
    alpha = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      rgb[i * 3] = pixels[i * 4];
      rgb[i * 3 + 1] = pixels[i * 4 + 1];
      rgb[i * 3 + 2] = pixels[i * 4 + 2];
      alpha[i] = pixels[i * 4 + 3];
    }
  }
  if (alpha && alpha.every((a) => a === 255)) alpha = null;
  return { width, height, rgb, alpha };
}
