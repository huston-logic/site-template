// The one check of an amount the buyer chose (R4). The browser's choice is never trusted: the Worker runs this against the
// owner's settings and charges only the figure it returns. Two-decimal currencies only (R2), so minor units are amount * 100.
import { CHOICE_KEYS } from "./schema.ts";
import type { GiftCardSettings } from "./schema.ts";

export type AmountResult = { ok: true; amount: number; minor: number } | { ok: false; reason: "closed" | "not_offered" | "out_of_range" | "bad_request" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function checkAmount(settings: GiftCardSettings, choice: unknown): AmountResult {
  if (!isRecord(choice)) return { ok: false, reason: "bad_request" };
  if (Object.keys(choice).some((key) => !(CHOICE_KEYS as readonly string[]).includes(key))) return { ok: false, reason: "bad_request" };
  const { kind, amount } = choice;
  if ((kind !== "preset" && kind !== "custom") || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: "bad_request" };
  }
  if (!settings.selling) return { ok: false, reason: "closed" };
  if (kind === "preset") {
    if (!settings.amounts.some((entry) => entry.amount === amount)) return { ok: false, reason: "not_offered" };
  } else {
    if (settings.custom === null) return { ok: false, reason: "not_offered" };
    if (amount < settings.custom.min || amount > settings.custom.max) return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, amount, minor: amount * 100 };
}
