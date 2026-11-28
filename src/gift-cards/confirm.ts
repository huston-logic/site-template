// What `GET /api/gift-cards/confirm` answers and how the thank-you page reads it. The page trusts nothing it cannot check:
// an answer of any other shape is "error", which the page shows as "I could not check your payment". Import-free.

export const CONFIRM_STATUSES = ["paid", "pending", "unpaid", "error"] as const;
export type ConfirmStatus = (typeof CONFIRM_STATUSES)[number];

export type Confirmation = {
  status: ConfirmStatus;
  /** Whole currency units, for display and for analytics. */
  value: number;
  currency: string;
  /** The payment's id (never the gift card's code), for reporting the purchase once. */
  transactionId: string;
  /** True once the certificate has been emailed. */
  delivered: boolean;
  /** True when the buyer named a recipient email and a copy went to it. */
  recipientCopy: boolean;
};

/** The ask-again schedule while the card is not delivered: seconds after the page opened. */
export const RECHECK_AT_SECONDS = [30, 100] as const;

const SESSION_ID = /^[A-Za-z0-9_]{1,200}$/;

/** The checkout session id from the page's query string, or null when it is missing or not shaped like one. */
export function sessionIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("session_id");
  return id !== null && SESSION_ID.test(id) ? id : null;
}

/** The answer as a Confirmation, or null when it is not one. A "paid" answer must carry its figures. */
export function readConfirmation(body: unknown): Confirmation | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  const status = CONFIRM_STATUSES.find((candidate) => candidate === data["status"]);
  if (status === undefined) return null;
  const value = data["value"];
  const currency = data["currency"];
  const transactionId = data["transactionId"];
  const figures = typeof value === "number" && Number.isFinite(value) && value > 0 && typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) && typeof transactionId === "string" && transactionId.length > 0 && transactionId.length <= 200;
  if (status === "paid" && !figures) return null;
  return {
    status,
    value: figures ? value : 0,
    currency: figures ? currency.toUpperCase() : "",
    transactionId: figures ? transactionId : "",
    delivered: data["delivered"] === true,
    recipientCopy: data["recipientCopy"] === true,
  };
}

/** Whether to ask again: not for a payment that is known to have failed, nor once the card is delivered. */
export function shouldRecheck(confirmation: Confirmation | null): boolean {
  if (confirmation === null) return true;
  if (confirmation.status === "unpaid") return false;
  return !(confirmation.status === "paid" && confirmation.delivered);
}
