/**
 * Stripe's webhook signature (https://docs.stripe.com/webhooks#verify-manually): the header is `t=<seconds>,v1=<hex>[,v1=...]`
 * and each `v1` is HMAC-SHA256 of `<t>.<raw body>` with the endpoint's `whsec_` secret. The body is parsed only after a
 * signature matches. The comparison is done by Web Crypto's `verify`, which does not stop at the first different byte.
 */

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type VerifyFailure = "missing" | "malformed" | "stale" | "mismatch";
export type VerifyResult = { ok: true; event: StripeEvent } | { ok: false; reason: VerifyFailure };

const HEX = /^[0-9a-f]{64}$/;

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function parseEvent(text: string): StripeEvent | null {
  try {
    const data = JSON.parse(text) as { id?: unknown; type?: unknown; data?: { object?: unknown } };
    const object = data.data?.object;
    if (typeof data.id !== "string" || typeof data.type !== "string" || typeof object !== "object" || object === null || Array.isArray(object)) return null;
    return { id: data.id, type: data.type, data: { object: object as Record<string, unknown> } };
  } catch {
    return null;
  }
}

export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds = 300): Promise<VerifyResult> {
  if (header === null || header.trim() === "") return { ok: false, reason: "missing" };
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t") timestamp = value;
    else if (name === "v1") signatures.push(value);
  }
  const issued = Number(timestamp);
  if (!/^\d{1,12}$/.test(timestamp) || !Number.isSafeInteger(issued) || signatures.length === 0) return { ok: false, reason: "malformed" };

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  let matched = false;
  for (const candidate of signatures) {
    if (!HEX.test(candidate)) continue;
    if (await crypto.subtle.verify("HMAC", key, fromHex(candidate), signed)) matched = true;
  }
  if (!matched) return { ok: false, reason: "mismatch" };
  if (Math.abs(nowSeconds - issued) > toleranceSeconds) return { ok: false, reason: "stale" };

  const event = parseEvent(rawBody);
  return event ? { ok: true, event } : { ok: false, reason: "malformed" };
}

/** Test and harness helper: the header Stripe would send for this body. */
export async function signStripePayload(rawBody: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  return `t=${timestamp},v1=${[...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
