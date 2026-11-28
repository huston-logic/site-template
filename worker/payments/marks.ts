import type { PaymentProvider, PaymentSession } from "./types.ts";

/**
 * Step marks (design R6): each step of fulfilment writes one into the payment's metadata when it succeeds, and every
 * later delivery skips a marked step. That is how a repeated, replayed or out-of-order webhook redoes nothing, without a
 * database. The marks live on the provider's payment record, next to the sale's own details.
 */

export const MARK_KEYS = ["hl_buyer", "hl_recipient", "hl_ledger", "hl_owner", "hl_alert", "hl_mismatch", "hl_calendar", "hl_wait"] as const;
export type MarkKey = (typeof MARK_KEYS)[number];
export type Marks = Partial<Record<MarkKey, string>>;

/** The marks already on a payment. Anything else in its metadata is ignored. */
export function readMarks(session: PaymentSession): Marks {
  const out: Marks = {};
  const metadata = session.payment?.metadata ?? {};
  for (const key of MARK_KEYS) {
    const value = metadata[key];
    if (value) out[key] = value;
  }
  return out;
}

/** Writes one mark. True only when the provider accepted it; the caller treats false as a step that must be retried. */
export function writeMark(provider: PaymentProvider, paymentId: string, key: MarkKey, value: string): Promise<boolean> {
  return provider.writeMarks(paymentId, { [key]: value });
}
