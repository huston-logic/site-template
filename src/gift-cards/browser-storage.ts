// What the gift card pages keep in the browser: the form's choices while the buyer is on Stripe (sessionStorage, so a
// cancel brings them back), and which purchases have been reported to analytics (localStorage, so a reload or a second tab
// does not report one again). Every read and write is wrapped, because storage can be off or full. The caller passes the
// storage, so the rules can be tested without a browser. Import-free apart from sibling shared modules.
import { emptyValues, MESSAGE_MAX, type GiftCardValues } from "./form-check.ts";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SAVED_FIELDS_KEY = "hl-gift-card-fields";
export const REPORTED_KEY = "hl-gift-card-reported";
/** How many reported purchases are remembered; older ones fall off. */
export const REPORTED_KEEP = 20;

const keys = Object.keys(emptyValues) as (keyof GiftCardValues)[];

/** Saves the form's fields (never the bot-check token) before the buyer leaves for Stripe. */
export function saveFields(storage: StorageLike | null, values: GiftCardValues): void {
  try {
    storage?.setItem(SAVED_FIELDS_KEY, JSON.stringify(values));
  } catch {
    // Without storage the buyer just types again.
  }
}

/** Forgets the saved fields: once the payment is confirmed they are not needed, and they hold the buyer's details. */
export function clearFields(storage: StorageLike | null): void {
  try {
    storage?.removeItem(SAVED_FIELDS_KEY);
  } catch {
    // Nothing to forget without storage.
  }
}

/** The saved fields, or null when there are none or they are not what saveFields wrote. Each is capped, so a stale or edited value cannot grow. */
export function loadFields(storage: StorageLike | null): GiftCardValues | null {
  try {
    const text = storage?.getItem(SAVED_FIELDS_KEY);
    if (!text) return null;
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const out: GiftCardValues = { ...emptyValues };
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value !== "string") return null;
      out[key] = value.slice(0, key === "message" ? MESSAGE_MAX + 1 : 300);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * True the first time a purchase is seen, and records it; false when it was reported before. When storage is unavailable
 * it cannot know, so it answers true: a missed purchase costs more than a repeated one in a browser with storage off.
 */
export function firstReport(storage: StorageLike | null, transactionId: string): boolean {
  try {
    if (!storage) return true;
    const raw = storage.getItem(REPORTED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const seen = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    if (seen.includes(transactionId)) return false;
    storage.setItem(REPORTED_KEY, JSON.stringify([...seen, transactionId].slice(-REPORTED_KEEP)));
    return true;
  } catch {
    return true;
  }
}
