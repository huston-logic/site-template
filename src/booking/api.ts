// What the booking block and the Worker say to each other (design R8 to R13). Import-free types and names only, so the
// browser and the Worker share one shape. Times are Unix milliseconds; money is minor units with a display text beside it.

export const TIMES_PATH = "/api/booking/times";
export const CHECKOUT_PATH = "/api/booking/checkout";
export const RELEASE_PATH = "/api/booking/release";
export const CONFIRM_PATH = "/api/booking/confirm";
/** The Turnstile action of every booking checkout, paid or free. */
export const TURNSTILE_ACTION = "booking";
/** Before leaving for Stripe the block keeps its choices and the session id here (sessionStorage), never in a URL. */
export const RESUME_KEY = "hl-booking-resume";
/** A free booking's summary, handed to the thank-you page (sessionStorage). */
export const FREE_SUMMARY_KEY = "hl-booking-free";

/**
 * GET /api/booking/times?service=<id>&party=<n>&index=<i>&from=<YYYY-MM-DD>&days=<1..14>&chosen=<ms,ms>
 * `chosen` holds the starts already picked for sessions 0..index-1 (empty for the first session).
 */
export interface TimesQuery {
  service: string;
  party: number;
  index: number;
  from: string;
  days: number;
  chosen: number[];
}

export interface TimesDay {
  date: string;
  /** Ascending. `label` is the local time in the business's zone, like "9:00 AM". */
  times: { start: number; label: string }[];
}

export type TimesAnswer =
  | {
      ok: true;
      /** The business's IANA zone and its long name at the first day asked for ("Central Standard Time"). */
      zone: string;
      zoneName: string;
      days: TimesDay[];
      /** The dates this session may fall on at all (today to the horizon for the first; the rule's window for later ones), so the block knows where paging stops. */
      window: { first: string; last: string };
    }
  | { ok: false; error: "closed" | "rejected" | "unavailable" | "not_found" };

/** POST /api/booking/checkout. The browser never sends a price: the Worker computes every amount. Unknown keys are refused. */
export interface CheckoutRequest {
  service: string;
  party: number;
  starts: number[];
  /** The booking form's answers, keyed by field id (src/content/forms/booking.json). */
  answers: Record<string, string | boolean>;
  /** A catalog piece's slug, when the visitor came from a piece page. */
  item?: string;
  /** The block's page, for Stripe's cancel address. */
  returnPath: string;
  turnstileToken: string;
  /** The honeypot (`honeypot.name` in src/content/contact-fields.ts), always empty from a person. */
  [honeypot: string]: unknown;
}

export interface BookedSession {
  start: number;
  end: number;
  /** "Tuesday, December 1, 2026, 9:00 AM" in the business's zone. */
  label: string;
}

/** What the thank-you page shows, for both kinds. */
export interface BookingSummary {
  reference: string;
  service: string;
  party: number;
  sessions: BookedSession[];
  zoneName: string;
  /** "$112.50", or "" when nothing was paid. */
  paidText: string;
  /** "$337.50 due later", or "" when nothing is due later. */
  dueLaterText: string;
  item: string | null;
}

export type CheckoutAnswer =
  /** A paid booking: leave for `url`. `dueNow` is in whole currency units with cents (for begin_checkout). */
  | { ok: true; kind: "checkout"; url: string; sessionId: string; dueNow: number; currency: string }
  /** A free booking: confirmed already. */
  | { ok: true; kind: "booked"; summary: BookingSummary }
  | { ok: false; error: "invalid"; fields: string[] }
  /** `index` is the session whose time just went to someone else. */
  | { ok: false; error: "taken"; index: number }
  | { ok: false; error: "rejected" | "closed" | "rate_limited" | "failed" | "unavailable" | "payments_misconfigured" | "preview_calendar_missing" };

/** POST /api/booking/release { sessionId }: the visitor came back from Stripe without paying. Always `{ ok: true }` for a well-formed id. */
export interface ReleaseRequest {
  sessionId: string;
}

/**
 * GET /api/booking/confirm?session_id=cs_...: the thank-you page's question. `booked` says what the calendar holds:
 * "booked", "clash" (the owner will contact the visitor) or "waiting" (paid, not written yet).
 */
export type ConfirmAnswer =
  | {
      status: "paid";
      booked: "booked" | "clash" | "waiting";
      summary: BookingSummary;
      /** For `purchase`: what was paid now, in whole units with cents, its currency in capitals, and the payment id. */
      value: number;
      currency: string;
      transactionId: string;
      emailed: boolean;
    }
  | { status: "pending" | "unpaid" | "error" };
