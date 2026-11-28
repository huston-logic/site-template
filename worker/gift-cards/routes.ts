import { log } from "../env.ts";
import { readBody } from "../read-body.ts";
import { paymentProvider, verifyPaymentWebhook } from "../payments/provider.ts";
import { handleCheckout } from "./checkout.ts";
import { handleConfirm } from "./confirm.ts";
import type { GiftCardDeps } from "./deps.ts";
import { alertMismatch, fulfil, judgeSession } from "./fulfil.ts";
import { json } from "./respond.ts";

/**
 * The payments routes, answered only while `payments` is set in site.config.ts (the caller returns 404 before this
 * otherwise, design R1):
 *   POST /api/gift-cards/checkout   the block starts a payment (worker/gift-cards/checkout.ts)
 *   GET  /api/gift-cards/confirm    the thank-you page asks what happened (confirm.ts)
 *   POST /api/payments/stripe       Stripe's signed webhook (below)
 */

export const CHECKOUT_PATH = "/api/gift-cards/checkout";
export const CONFIRM_PATH = "/api/gift-cards/confirm";
export const WEBHOOK_PATH = "/api/payments/stripe";
export const WEBHOOK_BODY_BYTES = 262_144;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/;
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const HANDLED_EVENTS = new Set([...PAID_EVENTS, "checkout.session.expired"]);

export const isPaymentsPath = (pathname: string): boolean => pathname === CHECKOUT_PATH || pathname === CONFIRM_PATH || pathname === WEBHOOK_PATH;

/**
 * Stripe's webhook (design R6, R7). The signature is checked first, over the raw body; then only the two payment events act (and `checkout.session.expired`, for booking's holds).
 * The session is read again from Stripe (the event body is not trusted); a booking session goes to booking (`deps.booking`), and a gift card must be a paid one of this site whose amount
 * and currency match what the Worker sent (a paid one that does not match is a log and one owner alert, never a certificate), and then fulfilment runs. 200 means done or nothing to do; 500 asks Stripe to retry.
 */
async function handleWebhook(request: Request, deps: GiftCardDeps): Promise<Response> {
  const { env, mode, payments } = deps;
  if (Number(request.headers.get("content-length") ?? "0") > WEBHOOK_BODY_BYTES) return json(413, { received: false });
  const body = await readBody(request, WEBHOOK_BODY_BYTES);
  if (body === null) return json(413, { received: false });

  const verdict = await verifyPaymentWebhook(payments, env, body, request.headers.get("stripe-signature"), Math.floor(deps.now() / 1000));
  if (!verdict.ok) {
    log("webhook_refused", { reason: verdict.reason });
    return json(verdict.reason === "unconfigured" ? 500 : 400, { received: false });
  }
  const { event } = verdict;
  if (!HANDLED_EVENTS.has(event.type)) return json(200, { received: true });
  const id = event.data.object["id"];
  if (typeof id !== "string" || !SESSION_ID.test(id)) return json(200, { received: true });

  const made = paymentProvider(payments, env, mode);
  if (!made.ok) {
    log("payments_misconfigured", { reason: made.reason });
    return json(500, { received: false });
  }
  const read = await made.provider.readSession(id);
  if (!read.ok) return json(500, { received: false });
  if (read.value === null) {
    log("webhook_session_missing");
    return json(200, { received: true });
  }
  const session = read.value;
  // A booking's payment (or its page closing) belongs to booking; an absent hook means booking is off, so nothing happens.
  if (session.metadata["kind"] === "booking") {
    if (!deps.booking) {
      log("webhook_nothing_to_do", { reason: "booking_off" });
      return json(200, { received: true });
    }
    const done = await deps.booking(event.type, session, made.provider);
    return json(done ? 200 : 500, { received: done });
  }
  // Only a payment acts for a gift card; its page closing unpaid is nothing.
  if (!PAID_EVENTS.has(event.type)) return json(200, { received: true });
  const judged = judgeSession(deps, session);
  if (judged.kind === "ignore" || judged.kind === "not_paid") {
    log("webhook_nothing_to_do", { reason: judged.kind });
    return json(200, { received: true });
  }
  if (judged.kind === "mismatch") {
    log("payment_mismatch");
    // Never a code, never a retry for the amounts themselves; only an owner alert that could not be sent asks Stripe to try again.
    const told = await alertMismatch(deps, made.provider, session, judged.sale);
    return json(told ? 200 : 500, { received: told });
  }
  const result = await fulfil(deps, made.provider, session, judged.sale, { webhookMissing: false });
  return json(result.done ? 200 : 500, { received: result.done });
}

/** Routes one request. `deps.payments` is set: the caller already answered 404 for a site without payments. */
export async function handlePaymentsRoute(pathname: string, request: Request, deps: GiftCardDeps): Promise<Response> {
  const wantsGet = pathname === CONFIRM_PATH;
  if (request.method !== (wantsGet ? "GET" : "POST")) return json(405, { error: "method_not_allowed" }, { allow: wantsGet ? "GET" : "POST" });
  if (pathname === CHECKOUT_PATH) return handleCheckout(request, deps);
  if (pathname === CONFIRM_PATH) return handleConfirm(request, deps);
  if (deps.mode === "development") return json(404, { error: "not_found" });
  return handleWebhook(request, deps);
}
