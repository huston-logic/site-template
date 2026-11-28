import { sendEmail } from "../email.ts";
import { log } from "../env.ts";
import type { GiftCardDeps } from "../gift-cards/deps.ts";
import { readMarks, writeMark } from "../payments/marks.ts";
import type { PaymentProvider, PaymentSession } from "../payments/types.ts";
import { formatMoney } from "../payments/money.ts";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "../../src/payments/config.ts";
import { parseBooking } from "./metadata.ts";

/**
 * A paid booking of this site and mode that arrives while booking cannot run (the setting is off, or the details form no
 * longer parses). The money is taken and nothing can write the calendar, so the owner is told once with everything the
 * session holds (never a silent 200). The one alert is keyed `book-<payment>-unhandled` at Resend and marked `hl_alert`; the
 * webhook answers 200 once the owner has it and 500 (Stripe retries) when it could not be sent.
 */

const clip = (text: string | undefined, max = 300): string => (text === undefined ? "" : text.length > max ? text.slice(0, max) : text);

function startsText(metadata: Record<string, string>): string[] {
  const starts = (metadata["starts"] ?? "").split(",").map((part) => (/^\d{1,16}$/.test(part) ? Number(part) : NaN));
  return starts.map((start, index) => `Session ${index + 1}: ${Number.isFinite(start) ? new Date(start).toISOString() : "unreadable"} (UTC)`);
}

function paidText(session: PaymentSession): string {
  if (session.amountTotal === null) return "an unknown amount";
  const currency = session.currency ?? "";
  return (PAYMENT_CURRENCIES as readonly string[]).includes(currency) ? formatMoney(session.amountTotal, currency as PaymentCurrency) : `${(session.amountTotal / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** What to write to the owner: the booking as far as it can be read, and the raw safe fields either way. */
function alertText(session: PaymentSession): string {
  const { metadata } = session;
  const booking = parseBooking(metadata);
  const lines = [
    "A visitor paid for a booking, but booking is switched off on the site (or its details form is not usable), so nothing was written to your calendar.",
    "Please contact them yourself to arrange the time, or refund the payment in Stripe.",
    "",
    `Reference: ${clip(metadata["ref"], 40)}`,
    `Service: ${clip(booking?.serviceName ?? metadata["service_name"])}`,
    ...(booking ? booking.starts.map((start, index) => `Session ${index + 1}: ${new Date(start).toISOString()} (UTC)`) : startsText(metadata)),
    `Name: ${clip(booking?.name ?? metadata["name"])}`,
    `Email: ${clip(booking?.email ?? metadata["email"])}`,
    `Phone: ${clip(booking?.phone ?? metadata["phone"]) || "not given"}`,
    `Amount paid: ${paidText(session)}`,
    `Stripe payment: ${session.payment?.id ?? session.id}`,
  ];
  if (booking) {
    if (booking.party > 0) lines.push(`Party: ${booking.party}`);
    if (booking.dueLaterMinor > 0) lines.push(`Still to pay: ${formatMoney(booking.dueLaterMinor, booking.currency)}`);
    if (booking.item) lines.push(`Catalog item: ${clip(booking.item.name)}`);
    for (const answer of booking.answers) lines.push(`${clip(answer.label, 100)}: ${clip(answer.text, 500)}`);
  }
  return lines.join("\n");
}

/**
 * True when the session needs no more from us now: it is not a paid booking of this site and mode (nothing to say), or the
 * owner has been told (before or just now). False when the alert could not be sent.
 */
export async function alertUnhandledBooking(deps: Pick<GiftCardDeps, "config" | "env" | "mode">, provider: PaymentProvider, session: PaymentSession): Promise<boolean> {
  const { config, env, mode } = deps;
  if (session.metadata["site"] !== config.workerName || session.metadata["site_mode"] !== mode) return true;
  if (session.paymentStatus !== "paid") return true;
  log("booking_unhandled");
  const payment = session.payment;
  if (payment && readMarks(session).hl_alert !== undefined) return true;
  const siteEmail = config.siteEmail;
  if (!siteEmail || !env.RESEND_API_KEY) {
    log("fulfil_config_incomplete");
    return false;
  }
  const subject = `${mode === "production" ? "" : "[Preview] "}ACTION NEEDED: a paid booking could not be taken`;
  const sent = await sendEmail(env.RESEND_API_KEY, { from: `${config.fromName} <${siteEmail}>`, to: siteEmail, replyTo: siteEmail, subject, text: alertText(session) }, `book-${payment?.id ?? session.id}-unhandled`, "booking_unhandled");
  if (sent && payment && !(await writeMark(provider, payment.id, "hl_alert", "sent"))) log("mark_failed", { step: "hl_alert" });
  return sent;
}
