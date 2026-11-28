import { fieldLimits, honeypot } from "../../src/content/contact-fields.ts";
import { checkAmount } from "../../src/gift-cards/amount.ts";
import { newGiftCode } from "../../src/gift-cards/code.ts";
import { cleanLine, EMAIL_PATTERN } from "../../src/lib/contact-validation.ts";
import { readAttribution } from "../attribution.ts";
import { log } from "../env.ts";
import { paymentProvider } from "../payments/provider.ts";
import { formatMoney } from "../payments/money.ts";
import { readBody } from "../read-body.ts";
import { verifyTurnstile } from "../turnstile.ts";
import type { GiftCardDeps } from "./deps.ts";
import { json } from "./respond.ts";
import { saleMetadata } from "./sale.ts";

/**
 * POST /api/gift-cards/checkout. The same layers, in the same order, as the form routes (worker/contact.ts,
 * `handleSubmission`): mode, same-origin, JSON, 8 KB, unknown keys, rate limit, honeypot, validation, Turnstile (action
 * `gift_card`). Then the Worker, never the browser, decides the amount (`checkAmount` against the owner's settings), checks
 * that selling is on and that the Stripe key's mode matches the site's, draws a new code and starts the hosted payment page.
 * Answers `{ ok: true, url }`; the block then leaves for `url`.
 */

export const CHECKOUT_BODY_BYTES = 8192;
export const MESSAGE_MAX = 300;
const RETURN_PATH = /^\/[a-z0-9/-]{0,120}$/;
const TOKEN_KEY = "turnstileToken";
const MAX_TOKEN_LENGTH = 2048;
const KEYS = new Set<string>(["choice", "buyerName", "buyerEmail", "recipientName", "recipientEmail", "message", "returnPath", TOKEN_KEY, honeypot.name]);

type Fields = { buyerName: string; buyerEmail: string; recipientName: string; recipientEmail: string; message: string; returnPath: string };
type Validation = { ok: true; value: Fields } | { ok: false; malformed: boolean; fields: string[] };

/** The fields the block shows, judged with the shared text and email rules (src/lib/contact-validation.ts). */
function validate(fields: Record<string, unknown>): Validation {
  let malformed = false;
  const text = (key: string): string => {
    const value = fields[key];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      malformed = true;
      return "";
    }
    return cleanLine(value);
  };
  const buyerName = text("buyerName");
  const buyerEmail = text("buyerEmail");
  const recipientName = text("recipientName");
  const recipientEmail = text("recipientEmail");
  const message = text("message");
  const returnPath = typeof fields["returnPath"] === "string" ? fields["returnPath"] : "";
  if (!RETURN_PATH.test(returnPath)) malformed = true;
  const bad: string[] = [];
  if (buyerName === "" || buyerName.length > fieldLimits.name) bad.push("buyerName");
  if (!EMAIL_PATTERN.test(buyerEmail) || buyerEmail.length > fieldLimits.email) bad.push("buyerEmail");
  if (recipientName.length > fieldLimits.name) bad.push("recipientName");
  if (recipientEmail !== "" && (!EMAIL_PATTERN.test(recipientEmail) || recipientEmail.length > fieldLimits.email)) bad.push("recipientEmail");
  if (message.length > MESSAGE_MAX) bad.push("message");
  if (malformed) return { ok: false, malformed: true, fields: [] };
  return bad.length > 0 ? { ok: false, malformed: false, fields: bad } : { ok: true, value: { buyerName, buyerEmail, recipientName, recipientEmail, message, returnPath } };
}

export async function handleCheckout(request: Request, deps: GiftCardDeps): Promise<Response> {
  const { config, env, mode, url } = deps;

  // Only the site's own pages may post here; a JSON content type also forces a CORS preflight from anywhere else.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== url.origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    log("rejected_origin");
    return json(403, { ok: false, error: "rejected" });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { ok: false, error: "rejected" });
  if (Number(request.headers.get("content-length") ?? "0") > CHECKOUT_BODY_BYTES) return json(413, { ok: false, error: "rejected" });
  const body = await readBody(request, CHECKOUT_BODY_BYTES);
  if (body === null) return json(413, { ok: false, error: "rejected" });

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return json(400, { ok: false, error: "rejected" });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data) || Object.keys(data).some((key) => !KEYS.has(key))) return json(400, { ok: false, error: "rejected" });
  const fields = data as Record<string, unknown>;

  const ip = request.headers.get("cf-connecting-ip");
  if (env.CONTACT_RATE_LIMIT) {
    const { success } = await env.CONTACT_RATE_LIMIT.limit({ key: `gift:${ip ?? "unknown"}` });
    if (!success) {
      log("rate_limited");
      return json(429, { ok: false, error: "rate_limited" });
    }
  } else {
    log("rate_limit_binding_missing");
  }

  const trap = fields[honeypot.name];
  if (trap !== undefined && trap !== "") {
    log("honeypot_filled");
    return json(400, { ok: false, error: "rejected" });
  }

  const result = validate(fields);
  if (!result.ok) return result.malformed ? json(400, { ok: false, error: "rejected" }) : json(400, { ok: false, error: "invalid", fields: result.fields });
  const value = result.value;

  if (!env.TURNSTILE_SECRET_KEY) {
    log("turnstile_config_missing");
    return json(502, { ok: false, error: "failed" });
  }
  const token = fields[TOKEN_KEY];
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    log("turnstile_token_missing");
    return json(403, { ok: false, error: "rejected" });
  }
  const check = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip);
  if (check.unavailable) {
    log("turnstile_unavailable", { codes: check.errorCodes.join(",") });
    return json(502, { ok: false, error: "failed" });
  }
  // Cloudflare's test keys (local development only) return no action and hostname "example.com".
  const strict = mode !== "development";
  const reason = !check.success ? "not_success" : strict && check.hostname !== url.hostname ? "hostname_mismatch" : strict && check.action !== "gift_card" ? "action_mismatch" : null;
  if (reason) {
    log("turnstile_failed", { reason, codes: check.errorCodes.join(",") });
    return json(403, { ok: false, error: "rejected" });
  }

  // The Worker, not the browser, decides the amount: only a figure in the owner's settings is ever charged.
  const choice = (fields["choice"] ?? null) as unknown;
  const amount = checkAmount(deps.settings, choice);
  if (!amount.ok) {
    log("amount_refused", { reason: amount.reason });
    return amount.reason === "closed" ? json(409, { ok: false, error: "closed" }) : json(400, { ok: false, error: "rejected" });
  }

  const cancelUrl = `${url.origin}${value.returnPath}?checkout=cancelled`;
  if (mode === "development") {
    log("dry_run", { giftCard: true });
    return json(200, { ok: true, url: cancelUrl });
  }

  const { siteEmail, payments } = config;
  if (!siteEmail || !payments) {
    log("config_incomplete");
    return json(502, { ok: false, error: "failed" });
  }
  const made = paymentProvider(payments, env, mode);
  if (!made.ok) {
    log("payments_misconfigured", { reason: made.reason });
    return json(502, { ok: false, error: "payments_misconfigured" });
  }

  const received = new Date(deps.now());
  const receivedAt = received.toISOString();
  const attribution = readAttribution(request.headers.get("cookie"), Math.floor(received.getTime() / 1000));
  const code = newGiftCode();
  const metadata = saleMetadata(
    { code, amountMinor: amount.minor, currency: payments.currency, buyerName: value.buyerName, buyerEmail: value.buyerEmail, recipientName: value.recipientName, recipientEmail: value.recipientEmail, message: value.message, siteMode: mode },
    attribution,
    receivedAt,
  );
  const created = await made.provider.createCheckout(
    {
      currency: payments.currency,
      amountMinor: amount.minor,
      productName: `${config.businessName} gift card (${formatMoney(amount.minor, payments.currency)})`,
      customerEmail: value.buyerEmail,
      successUrl: `${url.origin}/gift-cards/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl,
      metadata,
    },
    `gift-checkout-${code}`,
  );
  if (!created.ok) {
    log("checkout_failed", { status: created.status, ...(created.code ? { code: created.code } : {}) });
    return json(502, { ok: false, error: "unavailable" });
  }
  return json(200, { ok: true, url: created.value.url });
}
