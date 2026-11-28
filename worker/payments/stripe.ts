import { log, retryable, TIMEOUT_MS } from "../env.ts";
import type { CheckoutParams, Outcome, PaymentSession } from "./types.ts";

/**
 * A small Stripe REST client over `fetch`, with no library. Bodies are form-encoded with Stripe's bracket syntax, the key
 * goes in `Authorization: Bearer`, the API version is pinned, and every POST carries an `Idempotency-Key`. A call is
 * retried once on a rate limit, a server error or a network failure. Logs hold fixed event names, status codes and
 * Stripe's fixed error code only, never the key, an address, an amount or a body. Failures come back as a typed value.
 * https://docs.stripe.com/api
 */

const API = "https://api.stripe.com/v1";
/** Pinned so a change on Stripe's side never changes what the Worker reads. Raise it on purpose, with the tests. */
export const STRIPE_VERSION = "2025-10-29.clover";

type FormValue = string | number | boolean | FormValue[] | { [key: string]: FormValue | undefined };

/** Stripe's bracket syntax: `{ a: { b: [1] } }` becomes `a[b][0]=1`. */
export function encodeForm(params: { [key: string]: FormValue | undefined }): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (name: string, value: FormValue | undefined): void => {
    if (value === undefined) return;
    if (Array.isArray(value)) value.forEach((item, index) => walk(`${name}[${index}]`, item));
    else if (typeof value === "object") for (const [key, inner] of Object.entries(value)) walk(`${name}[${key}]`, inner);
    else out.append(name, String(value));
  };
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return out;
}

async function call(key: string, method: "GET" | "POST", path: string, body: URLSearchParams | null, idempotencyKey?: string): Promise<Outcome<Record<string, unknown>>> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION };
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  if (method === "POST" && idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let last: Outcome<Record<string, unknown>> = { ok: false, status: 0, code: null };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${API}${path}`, { method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(TIMEOUT_MS) });
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok && data !== null && typeof data === "object") return { ok: true, value: data };
      const raw = (data?.["error"] as { code?: unknown } | undefined)?.code;
      const code = typeof raw === "string" && /^[a-z_]{1,60}$/.test(raw) ? raw : null;
      log("stripe_failed", { status: response.status, attempt, ...(code ? { code } : {}) });
      last = { ok: false, status: response.status, code };
      if (!retryable(response.status)) return last;
    } catch {
      log("stripe_unreachable", { attempt });
      last = { ok: false, status: 0, code: null };
    }
  }
  return last;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function textMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isRecord(value)) for (const [key, text] of Object.entries(value)) if (typeof text === "string") out[key] = text;
  return out;
}

/** Creates the hosted payment page: one payment, one line, the Worker's amount. `payment_method_types` is left to Stripe's defaults. */
export async function createCheckoutSession(key: string, params: CheckoutParams, idempotencyKey: string): Promise<Outcome<{ id: string; url: string }>> {
  const body = encodeForm({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: params.currency, unit_amount: params.amountMinor, product_data: { name: params.productName } } }],
    customer_email: params.customerEmail,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata,
    payment_intent_data: { metadata: params.metadata },
  });
  const result = await call(key, "POST", "/checkout/sessions", body, idempotencyKey);
  if (!result.ok) return result;
  const { id, url } = result.value;
  if (typeof id !== "string" || typeof url !== "string" || !url.startsWith("https://")) return { ok: false, status: 200, code: "bad_session" };
  return { ok: true, value: { id, url } };
}

/** Reads a session with its payment (and that payment's latest charge, for the time it was taken). A 404 is a successful `null`. */
export async function getSession(key: string, id: string): Promise<Outcome<PaymentSession | null>> {
  const query = new URLSearchParams({ "expand[]": "payment_intent.latest_charge" });
  const result = await call(key, "GET", `/checkout/sessions/${encodeURIComponent(id)}?${query.toString()}`, null);
  if (!result.ok) return result.status === 404 ? { ok: true, value: null } : result;
  const data = result.value;
  if (typeof data["id"] !== "string") return { ok: false, status: 200, code: "bad_session" };
  const intent = isRecord(data["payment_intent"]) ? data["payment_intent"] : null;
  const charge = intent !== null && isRecord(intent["latest_charge"]) ? intent["latest_charge"] : null;
  const paidAt = charge !== null && typeof charge["created"] === "number" ? charge["created"] : null;
  return {
    ok: true,
    value: {
      id: data["id"],
      status: typeof data["status"] === "string" ? data["status"] : "",
      paymentStatus: typeof data["payment_status"] === "string" ? data["payment_status"] : "",
      amountTotal: typeof data["amount_total"] === "number" ? data["amount_total"] : null,
      currency: typeof data["currency"] === "string" ? data["currency"] : null,
      created: typeof data["created"] === "number" ? data["created"] : 0,
      metadata: textMap(data["metadata"]),
      payment: intent !== null && typeof intent["id"] === "string" ? { id: intent["id"], metadata: textMap(intent["metadata"]), paidAt } : null,
    },
  };
}

/** Writes step marks into the payment's metadata. The idempotency key names the values, so the same call is safe to repeat. */
export async function markPayment(key: string, paymentIntentId: string, marks: Record<string, string>): Promise<boolean> {
  const stamp = Object.entries(marks).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, value]) => `${name}=${value}`).join(",");
  const result = await call(key, "POST", `/payment_intents/${encodeURIComponent(paymentIntentId)}`, encodeForm({ metadata: marks }), `pay-${paymentIntentId}-mark-${stamp}`.slice(0, 250));
  return result.ok;
}
