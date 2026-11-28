import { log } from "../env.ts";
import { paymentProvider } from "../payments/provider.ts";
import { formatMoney } from "../payments/money.ts";
import { readMarks } from "../payments/marks.ts";
import type { GiftCardDeps } from "./deps.ts";
import { fulfil, judgeSession } from "./fulfil.ts";
import { json } from "./respond.ts";

/**
 * GET /api/gift-cards/confirm?session_id=cs_... (design R8): what the thank-you page asks. The session is read from Stripe
 * (never trusted from the URL) and answered as `{ status, value, currency, transactionId, delivered, amountText,
 * recipientCopy }`. `status` is "paid", "pending" (a slow payment method has not cleared), "unpaid" (the buyer did not pay) or
 * "error". `transactionId` is the payment id, never the gift card code. When the money is in but the certificate has not gone out
 * and the payment is over 90 seconds old, the webhook did not arrive: the same fulfilment runs here (the marks make that
 * safe) and the owner is told so.
 */

export const REPAIR_AFTER_SECONDS = 90;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/;

export async function handleConfirm(request: Request, deps: GiftCardDeps): Promise<Response> {
  const { env, mode, url } = deps;
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== url.origin) || (fetchSite !== null && fetchSite !== "same-origin") || (origin === null && fetchSite === null)) {
    log("rejected_origin");
    return json(403, { status: "error" });
  }

  const ip = request.headers.get("cf-connecting-ip");
  if (env.CONTACT_RATE_LIMIT) {
    const { success } = await env.CONTACT_RATE_LIMIT.limit({ key: `gift-confirm:${ip ?? "unknown"}` });
    if (!success) {
      log("rate_limited");
      return json(429, { status: "error" });
    }
  } else {
    log("rate_limit_binding_missing");
  }

  const id = url.searchParams.get("session_id") ?? "";
  if (!SESSION_ID.test(id) || mode === "development") return json(404, { status: "error" });

  const made = paymentProvider(deps.payments, env, mode);
  if (!made.ok) {
    log("payments_misconfigured", { reason: made.reason });
    return json(502, { status: "error" });
  }
  const read = await made.provider.readSession(id);
  if (!read.ok) return json(502, { status: "error" });
  const session = read.value;
  if (session === null) return json(404, { status: "error" });

  const judged = judgeSession(deps, session);
  if (judged.kind === "ignore") return json(404, { status: "error" });
  if (judged.kind === "mismatch") {
    log("payment_mismatch");
    return json(409, { status: "error" });
  }
  if (judged.kind === "not_paid") return json(200, { status: judged.pending ? "pending" : "unpaid" });

  const { sale } = judged;
  const payment = session.payment;
  if (!payment) return json(409, { status: "error" });
  let delivered = readMarks(session).hl_buyer !== undefined;
  const takenAt = payment.paidAt ?? session.created;
  if (!delivered && deps.now() / 1000 - takenAt > REPAIR_AFTER_SECONDS) {
    log("webhook_repair");
    delivered = (await fulfil(deps, made.provider, session, sale, { webhookMissing: true })).delivered;
  }
  return json(200, {
    status: "paid",
    value: sale.amountMinor / 100,
    currency: sale.currency.toUpperCase(),
    transactionId: payment.id,
    delivered,
    amountText: formatMoney(sale.amountMinor, sale.currency),
    recipientCopy: sale.recipientEmail !== "",
  });
}
