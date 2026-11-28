import { formatAmount } from "../payments/money.ts";
import { sendEmail } from "../email.ts";
import { log } from "../env.ts";
import { readMarks, writeMark, type MarkKey } from "../payments/marks.ts";
import type { PaymentProvider, PaymentSession } from "../payments/types.ts";
import type { CertificateInput } from "./certificate-types.ts";
import type { GiftCardDeps } from "./deps.ts";
import { alertEmail, buyerEmail, dateText, facts, ownerEmail, recipientEmail } from "./emails.ts";
import { saveLedger } from "./ledger.ts";
import { parseSale, type Sale } from "./sale.ts";

/**
 * What a paid gift card sale sets in motion (design R6, R7). Safe to run any number of times for one payment, from the
 * webhook or from the thank-you page's repair: every step that succeeds writes a mark into the payment's metadata and a
 * later run skips it, and every email has a Resend idempotency key (`gift-<payment>-<step>`) for two runs in the same second.
 *
 * Order: buyer email (certificate attached), recipient copy, ledger row, owner email.
 * - The buyer's email fails (after its one retry): the ledger row is still saved, the owner gets an alert at once with the
 *   certificate attached, and the run answers "not done" so the webhook answers 500 and Stripe retries for up to three days.
 *   A later success marks the buyer, and the owner email then says it was delivered late. The alert is sent once.
 * - The ledger fails: the owner email says the row was NOT saved and gives it cell by cell; the mark `by-hand` stops a
 *   retry adding it a second time.
 * - The recipient copy or the owner email fails: "not done" so Stripe retries; the marked steps are skipped.
 */

export type JudgedSession =
  | { kind: "paid"; sale: Sale }
  | { kind: "not_paid"; pending: boolean }
  | { kind: "ignore" }
  | { kind: "mismatch" };

/** Decides whether a session is a paid gift card of this site, by its own metadata. The amount and currency must match what the Worker sent. */
export function judgeSession(deps: Pick<GiftCardDeps, "payments" | "mode">, session: PaymentSession): JudgedSession {
  const sale = parseSale(session.metadata);
  if (!sale || sale.siteMode !== deps.mode) return { kind: "ignore" };
  if (session.paymentStatus !== "paid") return { kind: "not_paid", pending: session.status === "complete" };
  if (session.amountTotal !== sale.amountMinor || session.currency !== sale.currency || sale.currency !== deps.payments.currency || session.payment === null) return { kind: "mismatch" };
  return { kind: "paid", sale };
}

export interface FulfilResult {
  /** True when every step is done (marked now or before). False asks the caller to answer 500 so Stripe retries. */
  done: boolean;
  /** True when the buyer's certificate email has gone out. */
  delivered: boolean;
}

const idempotency = (paymentId: string, step: string) => `gift-${paymentId}-${step}`;

export async function fulfil(deps: GiftCardDeps, provider: PaymentProvider, session: PaymentSession, sale: Sale, options: { webhookMissing: boolean }): Promise<FulfilResult> {
  const payment = session.payment;
  const siteEmail = deps.config.siteEmail;
  if (!payment || !siteEmail || !deps.env.RESEND_API_KEY) {
    log("fulfil_config_incomplete");
    return { done: false, delivered: false };
  }
  const { env, config } = deps;
  const marks = readMarks(session);
  const paidMs = (payment.paidAt ?? session.created) * 1000;
  const soldAtIso = new Date(paidMs).toISOString();
  const issuedMs = session.created * 1000;
  let done = true;

  const mark = async (key: MarkKey, value: string): Promise<void> => {
    if (await writeMark(provider, payment.id, key, value)) marks[key] = value;
    else {
      done = false;
      log("mark_failed", { step: key });
    }
  };

  let pdf: Uint8Array | null | undefined;
  const certificate = async (): Promise<Uint8Array | null> => {
    if (pdf !== undefined) return pdf;
    const input: CertificateInput = {
      businessName: config.businessName,
      siteHost: config.editor.host,
      amountText: formatAmount(sale.amountMinor, sale.currency),
      code: sale.code,
      to: sale.recipientName || null,
      from: sale.buyerName,
      message: sale.message || null,
      redeemWording: deps.settings.redeemWording,
      termsLine: deps.settings.termsLine,
      issuedOn: dateText(issuedMs, config.editor.timeZone),
      validUntil: facts(deps, sale, issuedMs).validUntil,
      colors: { ...config.emailColors },
    };
    try {
      pdf = await deps.makeCertificate(input, env, deps.url.href);
    } catch {
      log("certificate_failed");
      pdf = null;
    }
    return pdf;
  };

  // 1. The buyer's certificate.
  let buyerSent = marks.hl_buyer !== undefined;
  if (!buyerSent) {
    const bytes = await certificate();
    if (bytes && (await sendEmail(env.RESEND_API_KEY, buyerEmail(deps, siteEmail, sale, issuedMs, bytes), idempotency(payment.id, "buyer"), "gift_buyer"))) {
      buyerSent = true;
      await mark("hl_buyer", "sent");
    }
  }

  // 2. The ledger row. Done now, even when the buyer's email failed, so the sale is on record whatever happens next.
  if (marks.hl_ledger === undefined) await mark("hl_ledger", await saveLedger(deps, sale, payment.id, soldAtIso));

  if (!buyerSent) {
    if (marks.hl_alert === undefined) {
      const alerted = await sendEmail(env.RESEND_API_KEY, alertEmail(deps, siteEmail, sale, session, soldAtIso, marks.hl_ledger, await certificate()), idempotency(payment.id, "alert"), "gift_alert");
      if (alerted) await mark("hl_alert", "sent");
    }
    return { done: false, delivered: false };
  }

  // 3. The recipient's copy, only when the buyer gave an email.
  let recipient: "sent" | "not-sent" | "none" = sale.recipientEmail ? "sent" : "none";
  if (sale.recipientEmail && marks.hl_recipient === undefined) {
    const bytes = await certificate();
    if (bytes && (await sendEmail(env.RESEND_API_KEY, recipientEmail(deps, siteEmail, sale, issuedMs, bytes), idempotency(payment.id, "recipient"), "gift_recipient"))) await mark("hl_recipient", "sent");
    else {
      recipient = "not-sent";
      done = false;
    }
  }

  // 4. The note to the owner, once.
  if (marks.hl_owner === undefined) {
    const email = ownerEmail(deps, siteEmail, sale, session, soldAtIso, { buyerLate: marks.hl_alert !== undefined, recipient, ledger: marks.hl_ledger, webhookMissing: options.webhookMissing });
    if (await sendEmail(env.RESEND_API_KEY, email, idempotency(payment.id, "owner"), "gift_owner")) await mark("hl_owner", "sent");
    else done = false;
  }

  return { done, delivered: true };
}
