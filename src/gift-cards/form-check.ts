// The browser's own check of the gift card form, so a visitor sees a problem before anything is sent. The Worker runs its
// own rules and is the authority; this mirrors them with the same shared pieces (checkAmount, the text cleaning). Import-free
// apart from sibling shared modules.
import { fieldLimits } from "../content/contact-fields.ts";
import { cleanLine, cleanText, EMAIL_PATTERN } from "../forms/clean.ts";
import { checkAmount } from "./amount.ts";
import type { GiftCardSettings } from "./schema.ts";

export const MESSAGE_MAX = 300;
/** The value of the "Other amount" card; every preset card's value is its amount as text. */
export const OTHER_CHOICE = "other";

/** What the visitor has entered. `choice` is a preset amount as text, `OTHER_CHOICE` or "" (nothing chosen yet). */
export type GiftCardValues = {
  choice: string;
  custom: string;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  message: string;
  recipientEmail: string;
};

export const emptyValues: GiftCardValues = { choice: "", custom: "", buyerName: "", buyerEmail: "", recipientName: "", message: "", recipientEmail: "" };

/** The fields a problem can be shown on, in form order. `amount` covers the cards, `custom` the "Other amount" box. */
export const FIELD_ORDER = ["amount", "custom", "buyerName", "buyerEmail", "recipientName", "message", "recipientEmail"] as const;
export type GiftCardField = (typeof FIELD_ORDER)[number];

export type GiftCardChoice = { kind: "preset" | "custom"; amount: number };

/** The amount the visitor chose as the Worker receives it, or null while nothing valid is chosen. */
export function chosenAmount(values: GiftCardValues): GiftCardChoice | null {
  if (values.choice === "") return null;
  const custom = values.choice === OTHER_CHOICE;
  const text = (custom ? values.custom : values.choice).trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  return { kind: custom ? "custom" : "preset", amount: Number.parseInt(text, 10) };
}

/** The fields to show a problem on, in form order. Empty means the form can be sent. */
export function giftCardProblems(settings: GiftCardSettings, values: GiftCardValues): GiftCardField[] {
  const out: GiftCardField[] = [];
  if (values.choice === "") out.push("amount");
  else {
    const choice = chosenAmount(values);
    if (choice === null || !checkAmount(settings, choice).ok) out.push(values.choice === OTHER_CHOICE ? "custom" : "amount");
  }
  const name = cleanLine(values.buyerName);
  if (name.length === 0 || name.length > fieldLimits.name) out.push("buyerName");
  const email = cleanLine(values.buyerEmail);
  if (!EMAIL_PATTERN.test(email) || email.length > fieldLimits.email) out.push("buyerEmail");
  const recipient = cleanLine(values.recipientName);
  if (recipient.length > fieldLimits.name) out.push("recipientName");
  if (cleanText(values.message).length > MESSAGE_MAX) out.push("message");
  const theirs = cleanLine(values.recipientEmail);
  if (theirs.length > 0 && (!EMAIL_PATTERN.test(theirs) || theirs.length > fieldLimits.email)) out.push("recipientEmail");
  return out;
}

/** What the browser posts, besides the bot check and the trap: cleaned text, empty optional fields left out. */
export function checkoutBody(values: GiftCardValues, choice: GiftCardChoice, returnPath: string) {
  const recipientEmail = cleanLine(values.recipientEmail);
  const message = cleanText(values.message);
  return {
    choice,
    buyerName: cleanLine(values.buyerName),
    buyerEmail: cleanLine(values.buyerEmail),
    recipientName: cleanLine(values.recipientName),
    ...(message === "" ? {} : { message }),
    ...(recipientEmail === "" ? {} : { recipientEmail }),
    returnPath,
  };
}
