import type { Delivery } from "../forms.ts";
import { formatMoney } from "../payments/money.ts";
import type { Sale } from "./sale.ts";
import type { GiftCardDeps } from "./deps.ts";

/**
 * The ledger row of a gift card sale (design R11): the owner's Sheet tab, or a Pipeline lead, chosen by `saveSubmission`
 * from `contact.destination`. The code is in column B (index 1) and unique in its tab: the Apps Script skips a code it
 * already holds, and the service-account writer reads the column first.
 */

export const LEDGER_HEADERS = [
  "Sold (UTC)",
  "Code",
  "Amount",
  "Buyer",
  "Buyer email",
  "Recipient",
  "Message",
  "Stripe payment",
  "Came from",
  "Campaign",
  "Click ID",
  "First seen (UTC)",
  "Days to note",
  "Used",
  "Balance",
  "Notes",
] as const;

const CODE_COLUMN = 1;
const PIPELINE_MESSAGE_MAX = 5000;

export function ledgerRow(sale: Sale, paymentId: string, soldAtIso: string): string[] {
  const recipient = [sale.recipientName, sale.recipientEmail ? `<${sale.recipientEmail}>` : ""].filter(Boolean).join(" ");
  return [soldAtIso, sale.code, formatMoney(sale.amountMinor, sale.currency), sale.buyerName, sale.buyerEmail, recipient, sale.message, paymentId, ...sale.cells, "", "", ""];
}

/** The row cell by cell, for the owner's email when it could not be saved. Empty cells are left out. */
export function ledgerCells(row: string[]): { label: string; value: string }[] {
  return row.flatMap((value, index) => (value === "" ? [] : [{ label: LEDGER_HEADERS[index] ?? `Column ${index + 1}`, value }]));
}

function delivery(deps: GiftCardDeps, sale: Sale, paymentId: string, soldAtIso: string): Delivery {
  const row = ledgerRow(sale, paymentId, soldAtIso);
  const message = [
    "Gift card sold",
    `Code: ${sale.code}`,
    `Amount: ${formatMoney(sale.amountMinor, sale.currency)}`,
    `Recipient: ${row[5] || "(not named)"}`,
    ...(sale.message ? [`Message: ${sale.message}`] : []),
    `Stripe payment: ${paymentId}`,
  ].join("\n");
  const { sheetTabs } = deps.config;
  return {
    tabs: { production: sheetTabs.giftCards, preview: sheetTabs.giftCardsPreview },
    row,
    lead: { name: sale.buyerName || sale.buyerEmail, email: sale.buyerEmail, message: message.slice(0, PIPELINE_MESSAGE_MAX), ...sale.lead },
    uniqueCell: CODE_COLUMN,
  };
}

/** "saved", "skipped" (a preview never posts to the real app) or "by-hand" (the owner adds the row; the mark stops a retry doing it twice). */
export async function saveLedger(deps: GiftCardDeps, sale: Sale, paymentId: string, soldAtIso: string): Promise<"saved" | "by-hand" | "skipped"> {
  const status = await deps.save(deps.mode, delivery(deps, sale, paymentId, soldAtIso));
  return status === "saved" ? "saved" : status === "skipped" ? "skipped" : "by-hand";
}
