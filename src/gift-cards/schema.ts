// The gift card settings file (src/content/gift-cards.json) and the limits on it. Import-free, so the content check, the
// editor, the block and the Worker share one set of rules. Design: docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md (R4, R13).

export type GiftCardAmount = { amount: number; label?: string };

export type GiftCardSettings = {
  selling: boolean;
  amounts: GiftCardAmount[];
  /** null means no "other amount": only the listed amounts can be bought. */
  custom: null | { min: number; max: number };
  redeemWording: string;
  termsLine: string;
  /** null means the card does not expire. */
  validForMonths: number | null;
};

export const GIFT_CARDS_PATH = "src/content/gift-cards.json";
export const GIFT_CARD_BLOCK = "gift-card";

export const SETTINGS_KEYS = ["selling", "amounts", "custom", "redeemWording", "termsLine", "validForMonths"] as const;
export const AMOUNT_KEYS = ["amount", "label"] as const;
export const CUSTOM_KEYS = ["min", "max"] as const;
export const CHOICE_KEYS = ["kind", "amount"] as const;

export const MIN_AMOUNTS = 1;
export const MAX_AMOUNTS = 8;
/** Whole currency units. */
export const AMOUNT_MIN = 5;
export const AMOUNT_MAX = 10_000;
export const LABEL_MAX = 40;
export const REDEEM_WORDING_MAX = 300;
export const TERMS_LINE_MAX = 200;
/** US federal law forbids a gift card expiring in under five years. */
export const VALID_MONTHS_MIN = 60;
export const VALID_MONTHS_MAX = 240;

export const PAYMENTS_OFF_MESSAGE = "Gift card sales cannot be turned on yet: payments are not set up on this site. Huston Logic sets them up (docs/PAYMENTS.md).";
