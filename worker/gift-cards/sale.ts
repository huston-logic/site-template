import { isGiftCode } from "../../src/gift-cards/code.ts";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "../../src/payments/config.ts";
import { emailLine, leadSource, sheetCells, type Attribution, type PipelineAttribution } from "../attribution.ts";

/**
 * One gift card sale as it is written into the payment's metadata at checkout and read back by every later step. The
 * metadata is the only store (design R5, R6): it is written by the Worker with its own key, so it is trusted, but it is still
 * read defensively. Each value is at most 500 characters (the provider's limit); the lead source is computed from the
 * visitor's cookie at checkout time and carried here, because the webhook has no cookie.
 */

export const GIFT_CARD_KIND = "gift_card";
const VALUE_MAX = 500;
const CHUNK = 480;
const MAX_CHUNKS = 8;

export interface Sale {
  code: string;
  amountMinor: number;
  currency: PaymentCurrency;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
  /** The five lead-source Sheet cells. */
  cells: string[];
  /** The `Came from:` line of the owner's email. */
  cameFrom: string;
  lead: { source?: string; attribution?: PipelineAttribution };
  siteMode: string;
  /** The Worker name of the site that started this sale: two sites on one Stripe account never act on each other's sales. */
  site: string;
}

export interface SaleInput {
  code: string;
  amountMinor: number;
  currency: PaymentCurrency;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
  siteMode: string;
  site: string;
}

const cap = (text: string, max = VALUE_MAX): string => (text.length > max ? text.slice(0, max) : text);

/** The lead source as metadata values: the cells, the email line and the Pipeline post (in pieces when it is long). */
export function sourceMetadata(attribution: Attribution | null, receivedAtIso: string): Record<string, string> {
  const cells = sheetCells(attribution, receivedAtIso);
  const lean = [cells[0] ?? "Not known", "", "", cells[3] ?? "", cells[4] ?? ""];
  const out: Record<string, string> = {
    src_cells: JSON.stringify(cells).length <= VALUE_MAX ? JSON.stringify(cells) : JSON.stringify(lean),
    src_line: cap(emailLine(attribution, receivedAtIso)),
  };
  const lead = leadSource(attribution, receivedAtIso);
  let json = JSON.stringify(lead);
  if (json.length > CHUNK * MAX_CHUNKS) json = JSON.stringify(lead.source ? { source: lead.source } : {});
  for (let i = 0; i * CHUNK < json.length; i++) out[`src_pipe${i}`] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}

export function saleMetadata(sale: SaleInput, attribution: Attribution | null, receivedAtIso: string): Record<string, string> {
  return {
    kind: GIFT_CARD_KIND,
    code: sale.code,
    amount_minor: String(sale.amountMinor),
    currency: sale.currency,
    buyer_name: cap(sale.buyerName),
    buyer_email: cap(sale.buyerEmail),
    recipient_name: cap(sale.recipientName),
    recipient_email: cap(sale.recipientEmail),
    message: cap(sale.message),
    site_mode: sale.siteMode,
    site: sale.site,
    ...sourceMetadata(attribution, receivedAtIso),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseLead(metadata: Record<string, string>): Sale["lead"] {
  let json = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = metadata[`src_pipe${i}`];
    if (part === undefined) break;
    json += part;
  }
  try {
    const data: unknown = JSON.parse(json);
    if (!isRecord(data)) return {};
    const lead: Sale["lead"] = {};
    if (typeof data["source"] === "string") lead.source = data["source"];
    const attribution = data["attribution"];
    if (isRecord(attribution) && isRecord(attribution["first"]) && typeof attribution["daysToNote"] === "number") lead.attribution = attribution as unknown as PipelineAttribution;
    return lead;
  } catch {
    return {};
  }
}

export function parseCells(text: string | undefined): string[] {
  try {
    const data: unknown = JSON.parse(text ?? "");
    if (Array.isArray(data) && data.length === 5 && data.every((cell) => typeof cell === "string")) return data as string[];
  } catch {
    // Falls through to the "not known" cells.
  }
  return ["Not known", "", "", "", ""];
}

/** The sale in a session's metadata, or null when it is not a gift card or is malformed. */
export function parseSale(metadata: Record<string, string>): Sale | null {
  if (metadata["kind"] !== GIFT_CARD_KIND) return null;
  const code = metadata["code"];
  const amount = Number(metadata["amount_minor"]);
  const currency = metadata["currency"];
  const buyerEmail = metadata["buyer_email"];
  if (!isGiftCode(code) || !Number.isSafeInteger(amount) || amount <= 0 || !buyerEmail) return null;
  if (!currency || !(PAYMENT_CURRENCIES as readonly string[]).includes(currency)) return null;
  return {
    code: code as string,
    amountMinor: amount,
    currency: currency as PaymentCurrency,
    buyerName: metadata["buyer_name"] ?? "",
    buyerEmail,
    recipientName: metadata["recipient_name"] ?? "",
    recipientEmail: metadata["recipient_email"] ?? "",
    message: metadata["message"] ?? "",
    cells: parseCells(metadata["src_cells"]),
    cameFrom: metadata["src_line"] || "Came from: not known",
    lead: parseLead(metadata),
    siteMode: metadata["site_mode"] ?? "",
    site: metadata["site"] ?? "",
  };
}
