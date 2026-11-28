import type { ConfirmAnswer } from "../../src/booking/api.ts";
import { log } from "../env.ts";
import { json } from "../gift-cards/respond.ts";
import { readMarks } from "../payments/marks.ts";
import { paymentProvider } from "../payments/provider.ts";
import type { BookingDeps } from "./deps.ts";
import { summaryOf } from "./events.ts";
import { fulfil, judgeBooking } from "./fulfil.ts";

/**
 * GET /api/booking/confirm?session_id=cs_...: what the thank-you page asks, like the gift card route. The session is read
 * from Stripe (never trusted from the URL) and answered as a `ConfirmAnswer`. When the money is in but the calendar has not
 * been written, or the visitor has not had their email, and the payment is over 90 seconds old (the webhook is late), the
 * same fulfilment runs here: the marks make that safe, and the owner's note says the thank-you page finished it.
 */

export const REPAIR_AFTER_SECONDS = 90;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/;
const reply = (body: ConfirmAnswer, status: number): Response => json(status, body);

export async function handleConfirm(request: Request, deps: BookingDeps): Promise<Response> {
  const { env, mode, url } = deps;
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== url.origin) || (fetchSite !== null && fetchSite !== "same-origin") || (origin === null && fetchSite === null)) {
    log("rejected_origin");
    return reply({ status: "error" }, 403);
  }

  const ip = request.headers.get("cf-connecting-ip");
  if (env.CONTACT_RATE_LIMIT) {
    const { success } = await env.CONTACT_RATE_LIMIT.limit({ key: `booking-confirm:${ip ?? "unknown"}` });
    if (!success) {
      log("rate_limited");
      return reply({ status: "error" }, 429);
    }
  } else {
    log("rate_limit_binding_missing");
  }

  const id = url.searchParams.get("session_id") ?? "";
  if (!SESSION_ID.test(id) || mode === "development" || !deps.payments) return reply({ status: "error" }, 404);

  const made = paymentProvider(deps.payments, env, mode);
  if (!made.ok) {
    log("payments_misconfigured", { reason: made.reason });
    return reply({ status: "error" }, 502);
  }
  const read = await made.provider.readSession(id);
  if (!read.ok) return reply({ status: "error" }, 502);
  const session = read.value;
  if (session === null) return reply({ status: "error" }, 404);

  const judged = judgeBooking(deps, session);
  if (judged.kind === "ignore") return reply({ status: "error" }, 404);
  if (judged.kind === "mismatch") {
    log("payment_mismatch");
    return reply({ status: "error" }, 409);
  }
  if (judged.kind === "not_paid") return reply({ status: judged.pending ? "pending" : "unpaid" }, 200);

  const { booking } = judged;
  const payment = session.payment;
  if (!payment) return reply({ status: "error" }, 409);
  const marks = readMarks(session);
  let calendar: "booked" | "clash" | "waiting" = marks.hl_calendar === "booked" ? "booked" : marks.hl_calendar === "clash" ? "clash" : "waiting";
  let emailed = calendar === "booked" ? marks.hl_buyer !== undefined : marks.hl_wait !== undefined;
  const complete = calendar !== "waiting" && emailed;
  const takenAt = payment.paidAt ?? session.created;
  if (!complete && deps.now() / 1000 - takenAt > REPAIR_AFTER_SECONDS) {
    log("webhook_repair");
    const result = await fulfil(deps, made.provider, session, booking, { webhookMissing: true });
    calendar = result.calendar;
    emailed = result.emailed;
  }
  return reply(
    { status: "paid", booked: calendar, summary: summaryOf(deps, booking), value: booking.dueNowMinor / 100, currency: booking.currency.toUpperCase(), transactionId: payment.id, emailed },
    200,
  );
}
