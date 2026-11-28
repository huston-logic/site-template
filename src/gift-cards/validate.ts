// The content check for src/content/gift-cards.json, in the owner's words. Import-free apart from sibling shared modules.
import { textProblem } from "../blocks/validate.ts";
import {
  AMOUNT_KEYS,
  AMOUNT_MAX,
  AMOUNT_MIN,
  CUSTOM_KEYS,
  GIFT_CARDS_PATH,
  LABEL_MAX,
  MAX_AMOUNTS,
  MIN_AMOUNTS,
  PAYMENTS_OFF_MESSAGE,
  REDEEM_WORDING_MAX,
  SETTINGS_KEYS,
  TERMS_LINE_MAX,
  VALID_MONTHS_MAX,
  VALID_MONTHS_MIN,
} from "./schema.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function checkKeys(data: Record<string, unknown>, allowed: readonly string[], where: string, out: string[]): void {
  for (const key of Object.keys(data)) if (!allowed.includes(key)) out.push(`${where}: "${key}" is not a gift card setting. It accepts: ${allowed.join(", ")}.`);
}

function checkText(value: unknown, max: number, what: string, out: string[]): void {
  const where = GIFT_CARDS_PATH;
  if (typeof value !== "string") return void out.push(`${where}: ${what} must be text.`);
  if (value.trim().length === 0) return void out.push(`${where}: ${what} is empty; it needs some text.`);
  if (value.length > max) return void out.push(`${where}: ${what} is ${value.length} characters; it takes at most ${max}.`);
  const bad = textProblem(value);
  if (bad) out.push(`${where}: ${what} ${bad}.`);
}

/** Why `gift-cards.json` is not acceptable. `paymentsOn` is whether site.config.ts has payments set. */
export function validateGiftCards(data: unknown, options: { paymentsOn: boolean }): string[] {
  const where = GIFT_CARDS_PATH;
  if (!isRecord(data)) return [`${where}: the file must be an object with ${SETTINGS_KEYS.map((key) => `"${key}"`).join(", ")}.`];
  const out: string[] = [];
  checkKeys(data, SETTINGS_KEYS, where, out);
  for (const key of SETTINGS_KEYS) if (!(key in data)) out.push(`${where}: "${key}" is missing.`);

  if ("selling" in data) {
    if (typeof data["selling"] !== "boolean") out.push(`${where}: "selling" must be true or false.`);
    else if (data["selling"] && !options.paymentsOn) out.push(PAYMENTS_OFF_MESSAGE);
  }

  const amounts = data["amounts"];
  const seen = new Set<number>();
  if ("amounts" in data) {
    if (!Array.isArray(amounts)) out.push(`${where}: "amounts" must be a list of amounts.`);
    else {
      if (amounts.length < MIN_AMOUNTS || amounts.length > MAX_AMOUNTS) out.push(`${where}: there are ${amounts.length} amounts; a site lists ${MIN_AMOUNTS} to ${MAX_AMOUNTS}.`);
      amounts.forEach((entry, index) => {
        const here = `${where}: amount ${index + 1}`;
        if (!isRecord(entry)) return void out.push(`${here} must have an "amount" and, if you like, a "label".`);
        checkKeys(entry, AMOUNT_KEYS, here, out);
        const value = entry["amount"];
        if (!isWhole(value, AMOUNT_MIN, AMOUNT_MAX)) out.push(`${here} must be a whole number from ${AMOUNT_MIN} to ${AMOUNT_MAX.toLocaleString("en-US")}.`);
        else if (seen.has(value)) out.push(`${here} repeats ${value}; every amount is listed once.`);
        else seen.add(value);
        if ("label" in entry) {
          const label = entry["label"];
          if (typeof label !== "string" || label.trim().length === 0) out.push(`${here}: the label must be text, or left out.`);
          else if (label.length > LABEL_MAX) out.push(`${here}: the label is ${label.length} characters; it takes at most ${LABEL_MAX}.`);
          else {
            const bad = textProblem(label);
            if (bad) out.push(`${here}: the label ${bad}.`);
          }
        }
      });
    }
  }

  if ("custom" in data) {
    const custom = data["custom"];
    if (custom !== null) {
      if (!isRecord(custom)) out.push(`${where}: "custom" must be null (no other amount) or have a "min" and a "max".`);
      else {
        checkKeys(custom, CUSTOM_KEYS, `${where}: custom`, out);
        const { min, max } = custom;
        const range = `a whole number from ${AMOUNT_MIN} to ${AMOUNT_MAX.toLocaleString("en-US")}`;
        const minOk = isWhole(min, AMOUNT_MIN, AMOUNT_MAX);
        const maxOk = isWhole(max, AMOUNT_MIN, AMOUNT_MAX);
        if (!minOk) out.push(`${where}: the other amount's smallest must be ${range}.`);
        if (!maxOk) out.push(`${where}: the other amount's largest must be ${range}.`);
        if (minOk && maxOk && min >= max) out.push(`${where}: the other amount's smallest (${min}) must be less than its largest (${max}).`);
      }
    }
  }

  if ("redeemWording" in data) checkText(data["redeemWording"], REDEEM_WORDING_MAX, "the redeem wording", out);
  if ("termsLine" in data) checkText(data["termsLine"], TERMS_LINE_MAX, "the terms line", out);

  if ("validForMonths" in data) {
    const months = data["validForMonths"];
    if (months !== null && !isWhole(months, VALID_MONTHS_MIN, VALID_MONTHS_MAX)) {
      out.push(`${where}: "validForMonths" must be null (never expires) or a whole number of months from ${VALID_MONTHS_MIN} to ${VALID_MONTHS_MAX}; the law does not allow a gift card to expire in under five years.`);
    }
  }
  return out;
}
