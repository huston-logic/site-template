import { giftCardEmails, type Facts } from "../../src/content/gift-card-emails.ts";
import { autoReplyFirstName } from "../../src/lib/first-name.ts";
import type { OutgoingEmail } from "../email.ts";
import type { PaymentSession } from "../payments/types.ts";
import type { GiftCardDeps } from "./deps.ts";
import { formatMoney } from "../payments/money.ts";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "../../src/payments/config.ts";
import { ledgerCells, ledgerRow } from "./ledger.ts";
import type { Sale } from "./sale.ts";

/**
 * The gift card emails as Resend takes them (design R12). All plain text; the certificate is a PDF attachment. In a
 * preview every email goes to the site's own address and the subject says who it would have gone to. The wording is in
 * src/content/gift-card-emails.ts. Idempotency keys (`gift-<payment>-<step>`) are chosen by fulfil.ts.
 */

const REPLY_HEADERS = { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const certificateAttachment = (code: string, pdf: Uint8Array) => ({ filename: `gift-card-${code}.pdf`, content: toBase64(pdf) });

/** A long date in the business's time zone ("November 27, 2026"); UTC if the zone is not one the runtime knows. */
export function dateText(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(ms);
  }
}

/** The day the card stops working, `validForMonths` after it was issued, or null when it does not expire. */
export function validUntilText(deps: GiftCardDeps, issuedMs: number): string | null {
  const months = deps.settings.validForMonths;
  if (months === null) return null;
  const date = new Date(issuedMs);
  date.setUTCMonth(date.getUTCMonth() + months);
  return dateText(date.getTime(), deps.config.editor.timeZone);
}

export function facts(deps: GiftCardDeps, sale: Sale, issuedMs: number): Facts {
  return {
    business: deps.config.businessName,
    amount: formatMoney(sale.amountMinor, sale.currency),
    code: sale.code,
    redeemWording: deps.settings.redeemWording,
    termsLine: deps.settings.termsLine,
    validUntil: validUntilText(deps, issuedMs),
  };
}

/** Where a message goes: the person in production, the site's own address otherwise (with the usual subject marker). */
function routed(deps: GiftCardDeps, siteEmail: string, person: string, subject: string): { to: string; subject: string } {
  return deps.mode === "production" ? { to: person, subject } : { to: siteEmail, subject: `[Preview → would go to ${person}] ${subject}` };
}

const fromPerson = (deps: GiftCardDeps, siteEmail: string) => `${deps.config.replyFromName} <${siteEmail}>`;
const fromSite = (deps: GiftCardDeps, siteEmail: string) => `${deps.config.fromName} <${siteEmail}>`;
const previewMark = (deps: GiftCardDeps) => (deps.mode === "production" ? null : deps.mode);

export function buyerEmail(deps: GiftCardDeps, siteEmail: string, sale: Sale, issuedMs: number, pdf: Uint8Array): OutgoingEmail {
  const { subject, text } = giftCardEmails.buyer({ ...facts(deps, sale, issuedMs), firstName: autoReplyFirstName(sale.buyerName), recipientCopy: sale.recipientEmail !== "" });
  return { from: fromPerson(deps, siteEmail), replyTo: siteEmail, headers: REPLY_HEADERS, ...routed(deps, siteEmail, sale.buyerEmail, subject), text, attachments: [certificateAttachment(sale.code, pdf)] };
}

export function recipientEmail(deps: GiftCardDeps, siteEmail: string, sale: Sale, issuedMs: number, pdf: Uint8Array): OutgoingEmail {
  const { subject, text } = giftCardEmails.recipient({
    ...facts(deps, sale, issuedMs),
    to: autoReplyFirstName(sale.recipientName),
    from: sale.buyerName || "someone",
    message: sale.message || null,
  });
  return { from: fromPerson(deps, siteEmail), replyTo: siteEmail, headers: REPLY_HEADERS, ...routed(deps, siteEmail, sale.recipientEmail, subject), text, attachments: [certificateAttachment(sale.code, pdf)] };
}

function ledgerBlock(deps: GiftCardDeps, sale: Sale, session: PaymentSession, state: string | undefined, soldAtIso: string): string[] {
  const where = deps.config.destination === "pipeline" ? "Pipeline app" : "Sheet";
  const known = state === "saved" || state === "skipped" ? state : "by-hand";
  return giftCardEmails.ledgerLines(where, known, known === "by-hand" ? ledgerCells(ledgerRow(sale, session.payment?.id ?? "", soldAtIso)) : []);
}

export function ownerEmail(
  deps: GiftCardDeps,
  siteEmail: string,
  sale: Sale,
  session: PaymentSession,
  soldAtIso: string,
  state: { buyerLate: boolean; recipient: "sent" | "not-sent" | "none"; ledger: string | undefined; webhookMissing: boolean },
): OutgoingEmail {
  const recipientState = state.recipient === "sent" ? `sent to ${sale.recipientEmail}` : state.recipient === "none" ? "none (no email given)" : `NOT sent to ${sale.recipientEmail} - Stripe will try again; if it has not arrived, forward the buyer's copy`;
  const { subject, text } = giftCardEmails.owner({
    amount: formatMoney(sale.amountMinor, sale.currency),
    code: sale.code,
    buyer: sale.buyerName,
    buyerEmail: sale.buyerEmail,
    recipient: sale.recipientName || null,
    recipientEmail: sale.recipientEmail || null,
    message: sale.message || null,
    payment: session.payment?.id ?? "",
    cameFrom: sale.cameFrom,
    buyerEmailState: state.buyerLate ? "late" : "sent",
    recipientState,
    ledger: ledgerBlock(deps, sale, session, state.ledger, soldAtIso),
    webhookMissing: state.webhookMissing,
    mode: previewMark(deps),
  });
  return { from: fromSite(deps, siteEmail), to: siteEmail, replyTo: sale.buyerEmail, subject: `${deps.mode === "production" ? "" : "[Preview] "}${subject}`, text };
}

export function alertEmail(deps: GiftCardDeps, siteEmail: string, sale: Sale, session: PaymentSession, soldAtIso: string, ledger: string | undefined, pdf: Uint8Array | null): OutgoingEmail {
  const { subject, text } = giftCardEmails.alert({
    amount: formatMoney(sale.amountMinor, sale.currency),
    code: sale.code,
    buyer: sale.buyerName,
    buyerEmail: sale.buyerEmail,
    recipient: sale.recipientName || null,
    recipientEmail: sale.recipientEmail || null,
    message: sale.message || null,
    payment: session.payment?.id ?? "",
    attached: pdf !== null,
    ledger: ledger === undefined ? [] : ledgerBlock(deps, sale, session, ledger, soldAtIso),
  });
  return {
    from: fromSite(deps, siteEmail),
    to: siteEmail,
    replyTo: sale.buyerEmail,
    subject: `${deps.mode === "production" ? "" : "[Preview] "}${subject}`,
    text,
    ...(pdf ? { attachments: [certificateAttachment(sale.code, pdf)] } : {}),
  };
}

/** What Stripe took, written plainly even when its currency is not one the site supports. */
function takenText(session: PaymentSession): string {
  if (session.amountTotal === null) return "an unknown amount";
  const currency = session.currency ?? "";
  return (PAYMENT_CURRENCIES as readonly string[]).includes(currency) ? formatMoney(session.amountTotal, currency as PaymentCurrency) : `${(session.amountTotal / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** The note to the owner for a paid session that does not match its sale. It carries no code and no certificate. */
export function mismatchEmail(deps: GiftCardDeps, siteEmail: string, sale: Sale, session: PaymentSession): OutgoingEmail {
  const { subject, text } = giftCardEmails.mismatch({ amount: takenText(session), payment: session.payment?.id ?? session.id, expected: formatMoney(sale.amountMinor, sale.currency) });
  return { from: fromSite(deps, siteEmail), to: siteEmail, replyTo: siteEmail, subject: `${deps.mode === "production" ? "" : "[Preview] "}${subject}`, text };
}
