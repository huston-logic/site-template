// The showcase settings (/blocks): selling on, so the block shows its form. Template wording, not a client's.
import type { GiftCardSettings } from "./schema.ts";

export const exampleGiftCards: GiftCardSettings = {
  selling: true,
  amounts: [{ amount: 25 }, { amount: 50, label: "Most given" }, { amount: 100 }],
  custom: { min: 25, max: 500 },
  redeemWording: "Show this certificate or give the code when you book.",
  termsLine: "Not redeemable for cash.",
  validForMonths: null,
};
