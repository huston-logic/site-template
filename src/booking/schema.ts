// Booking: the settings file (src/content/booking.json), its limits and the names every part shares. Import-free, so the
// content check, the editor, the block and the Worker share one set of rules. Design:
// docs/superpowers/specs/2026-11-27-booking-design.md (R3 to R8).

export const BOOKING_PATH = "src/content/booking.json";
export const BOOKING_BLOCK = "booking";
/** The one designated form whose questions the booking block asks (src/content/forms/booking.json). Bound in code, like the quote form. */
export const BOOKING_FORM_ID = "booking";
export const BOOKING_THANKS_PATH = "/booking/thanks";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** "HH:MM", 24-hour, local to `business.timeZone`. */
export type ClockTime = string;
/** "YYYY-MM-DD", a local calendar date in `business.timeZone`. */
export type LocalDate = string;

/** One opening window on a weekday: [opens, closes), both on a 5-minute grid, opens before closes, never past midnight. */
export type Window = [ClockTime, ClockTime];

/** When a session may start inside the open windows: every N minutes from each window's opening, or a fixed list of times. */
export type Starts = { every: number } | { at: ClockTime[] };

/** A closed stretch, both ends included. */
export type ClosedDates = { from: LocalDate; to: LocalDate };

export interface Hours {
  weekly: Record<Weekday, Window[]>;
  starts: Starts;
  /** Kept free before and after every booking (and every busy time on the calendars). */
  bufferMinutes: number;
  /** How long before its start the first session can still be booked. */
  noticeHours: number;
  /** How many days ahead the first session can be booked (today counts as day 0). */
  aheadDays: number;
  closed: ClosedDates[];
}

/** A service's own hours. Every key replaces the site-wide value, except `closed`, which adds to the site-wide dates. */
export type HoursOverride = Partial<Hours>;

export interface Session {
  minutes: number;
}

/** Between one session and the next, in local calendar days: 0 allows the same day, 1 means never the same day. */
export interface Between {
  minDays: number;
  maxDays: number;
}

/** Whole currency units. `per: "person"` multiplies by the party size; `"booking"` is one price for the whole party. */
export interface Price {
  amount: number;
  per: "person" | "booking";
}

/**
 * What is taken online when booking. `full`: the whole price. `deposit`: a whole amount or a percent of the price, the rest due
 * later. `free`: nothing online (no Stripe at all); with a price set, the whole price is due later (paid on the day).
 */
export type Payment = { kind: "full" } | { kind: "deposit"; amount: number } | { kind: "deposit"; percent: number } | { kind: "free" };

export type ServiceStatus = "live" | "archived";

export interface Service {
  /** A slug, unique in the file, never reused. */
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  sessions: Session[];
  /** Required when there are two or more sessions, null with one. The same rule holds between every pair of neighbours. */
  between: Between | null;
  party: { min: number; max: number };
  /** null means no price is shown (a free service). Required for `full` and `deposit`. */
  price: Price | null;
  payment: Payment;
  hours?: HoursOverride;
}

export interface BookingSettings {
  /** Whether visitors can book. Can be true only while the calendar is connected (`booking` in site.config.ts). */
  taking: boolean;
  /** The owner's policy wording, shown on the summary before paying or confirming. */
  policy: string;
  /** How a visitor changes or cancels a booking; in every visitor email. */
  changeWording: string;
  /** Shown on the block while gift cards are on sale: how to book with a certificate (they are not redeemed online). */
  giftCardLine: string;
  hours: Hours;
  services: Service[];
}

/** The calendar connection in site.config.ts (owner-only). null means booking is off and nothing ships. */
export interface BookingConfig {
  /** The calendar bookings are written to (shared with the site's service account, "Make changes to events"). */
  calendarId: string;
  /** Extra calendars read for busy time only ("See only free/busy"). */
  busyCalendarIds: string[];
  /**
   * A test calendar for branch previews (design R19): previews write holds and bookings here and read busy time from it and
   * the real calendars. null means a preview shows times but refuses to book.
   */
  previewCalendarId: string | null;
}

/** A span of time in Unix milliseconds, start included, end excluded. */
export interface Interval {
  start: number;
  end: number;
}

// ---- limits ----

export const SETTINGS_KEYS = ["taking", "policy", "changeWording", "giftCardLine", "hours", "services"] as const;
export const HOURS_KEYS = ["weekly", "starts", "bufferMinutes", "noticeHours", "aheadDays", "closed"] as const;
export const SERVICE_KEYS = ["id", "name", "description", "status", "sessions", "between", "party", "price", "payment", "hours"] as const;

export const POLICY_MAX = 600;
export const CHANGE_WORDING_MAX = 300;
export const GIFT_CARD_LINE_MAX = 200;
export const MAX_SERVICES = 20;
export const SERVICE_NAME_MAX = 60;
export const SERVICE_DESCRIPTION_MAX = 300;
export const MAX_SESSIONS = 6;
/** Session length in minutes, on a 5-minute grid. */
export const SESSION_MINUTES = { min: 15, max: 720 } as const;
export const BETWEEN_DAYS_MAX = 365;
export const PARTY_MAX = 50;
/** Whole currency units. */
export const PRICE_MAX = 100_000;
export const PERCENT = { min: 1, max: 99 } as const;
export const MAX_WINDOWS_PER_DAY = 4;
/** `starts.every`, on a 5-minute grid. */
export const STARTS_EVERY = { min: 5, max: 240 } as const;
export const MAX_START_TIMES = 24;
export const BUFFER_MAX = 240;
/** 90 days. */
export const NOTICE_HOURS_MAX = 2160;
export const AHEAD_DAYS = { min: 1, max: 365 } as const;
export const MAX_CLOSED = 50;
/** The booking form's answers ride in the payment's metadata (500 characters a value), so their text limits add up to at most this. */
export const BOOKING_FORM_ANSWER_CHARS = 2000;

// ---- timing (design R9 to R12) ----

/** The hosted payment page closes after this (Stripe's minimum). */
export const CHECKOUT_MINUTES = 30;
/**
 * A hold counts as busy until it is deleted (its checkout expired, or it became a booking). This long past its checkout's end
 * it is treated as stale anyway: a safety valve for a hold whose expiry webhook and cron both failed (design R10).
 */
export const HOLD_GRACE_MINUTES = 1440;
/** The most days the times route answers in one call. */
export const TIMES_DAYS_MAX = 14;

// ---- the owner's refusals (editor and content check) ----

export const CALENDAR_OFF_MESSAGE = "Booking cannot be turned on yet: the calendar is not connected on this site. Huston Logic connects it (docs/BOOKING.md).";
export const PAID_NEEDS_PAYMENTS_MESSAGE = "A service that takes payment cannot be offered yet: payments are not set up on this site. Make it free (paid on the day), or ask Huston Logic to set up payments (docs/PAYMENTS.md).";
