import type { PaymentCurrency } from "../../src/payments/config.ts";

/** What a product asks of the provider: one hosted payment page for one line. */
export interface CheckoutParams {
  currency: PaymentCurrency;
  amountMinor: number;
  productName: string;
  customerEmail: string;
  /** May hold the provider's session placeholder, `{CHECKOUT_SESSION_ID}`. */
  successUrl: string;
  cancelUrl: string;
  /** Text values only, each at most 500 characters. Copied to the payment, where the step marks also live. */
  metadata: Record<string, string>;
}

/** A hosted payment page as the Worker reads it back (only the fields it uses). */
export interface PaymentSession {
  id: string;
  /** "complete" once the buyer has finished, "open" while they are still on the page, "expired" after the time limit. */
  status: string;
  /** "paid" is the only value that releases anything. */
  paymentStatus: string;
  amountTotal: number | null;
  /** Lower case, as Stripe sends it. */
  currency: string | null;
  /** Unix seconds. */
  created: number;
  metadata: Record<string, string>;
  payment: { id: string; metadata: Record<string, string>; /** Unix seconds the money was taken, when the provider says. */ paidAt: number | null } | null;
}

/** A failed provider call. `status` is the HTTP status, or 0 when the provider could not be reached. `code` is the provider's fixed error code, safe to log. */
export type Failure = { ok: false; status: number; code: string | null };
export type Outcome<T> = { ok: true; value: T } | Failure;

export interface PaymentProvider {
  createCheckout(params: CheckoutParams, idempotencyKey: string): Promise<Outcome<{ id: string; url: string }>>;
  /** `null` inside a successful outcome means the provider has no such session. */
  readSession(sessionId: string): Promise<Outcome<PaymentSession | null>>;
  writeMarks(paymentId: string, marks: Record<string, string>): Promise<boolean>;
}
