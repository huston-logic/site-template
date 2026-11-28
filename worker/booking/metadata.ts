import { GIFT_CODE_ALPHABET } from "../../src/gift-cards/code.ts";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "../../src/payments/config.ts";
import type { Attribution, PipelineAttribution } from "../attribution.ts";
import { parseCells, parseLead, sourceMetadata } from "../gift-cards/sale.ts";

/**
 * One booking as it is written into the payment's metadata at checkout and read back by every later step (booking design
 * R10, R11). The metadata is the only store besides the calendar: the Worker writes it with its own key, so it is trusted,
 * but it is read defensively. Each value is at most 500 characters (Stripe's limit) and there are at most 50 keys.
 */

export const BOOKING_KIND = "booking";
const CHUNK = 480;
const ANSWER_CHUNKS = 5;
const REFERENCE = new RegExp(`^BK-[${GIFT_CODE_ALPHABET}]{8}$`);
const EVENT_ID = /^[0-9a-v]{5,100}$/;

export interface Booking {
  reference: string;
  serviceId: string;
  serviceName: string;
  party: number;
  /** Unix milliseconds, one per session, with the same count of ends and event ids. */
  starts: number[];
  ends: number[];
  eventIds: string[];
  totalMinor: number;
  dueNowMinor: number;
  dueLaterMinor: number;
  currency: PaymentCurrency;
  name: string;
  email: string;
  phone: string;
  /** The form's other answers, one line each. */
  answers: { label: string; text: string }[];
  /** The catalog piece's slug and name, when the visitor came from a piece page. */
  item: { slug: string; name: string } | null;
  cells: string[];
  cameFrom: string;
  lead: { source?: string; attribution?: PipelineAttribution };
  siteMode: string;
  site: string;
}

export interface BookingInput {
  reference: string;
  serviceId: string;
  serviceName: string;
  party: number;
  starts: number[];
  ends: number[];
  eventIds: string[];
  totalMinor: number;
  dueNowMinor: number;
  dueLaterMinor: number;
  currency: PaymentCurrency;
  name: string;
  email: string;
  phone: string;
  answers: { label: string; text: string }[];
  item: { slug: string; name: string } | null;
  siteMode: string;
  site: string;
}

const cap = (text: string, max = 500): string => (text.length > max ? text.slice(0, max) : text);

/** `BK-` and eight characters of the gift code alphabet (30 characters that cannot be confused aloud). */
export function newBookingReference(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const limit = 256 - (256 % GIFT_CODE_ALPHABET.length);
  let chars = "";
  while (chars.length < 8) {
    for (const byte of random(16)) {
      if (byte >= limit) continue;
      chars += GIFT_CODE_ALPHABET[byte % GIFT_CODE_ALPHABET.length];
      if (chars.length === 8) break;
    }
  }
  return `BK-${chars}`;
}

/** The other answers as JSON in at most five pieces; the longest texts are shortened until it fits. */
function answerChunks(answers: { label: string; text: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (answers.length === 0) return out;
  const budget = CHUNK * ANSWER_CHUNKS;
  let json = JSON.stringify(answers.map((answer) => [answer.label, answer.text]));
  if (json.length > budget) {
    const room = Math.max(0, Math.floor((budget - 40 - answers.length * 130) / answers.length));
    json = JSON.stringify(answers.map((answer) => [answer.label.slice(0, 100), answer.text.slice(0, room)]));
  }
  for (let i = 0; i * CHUNK < json.length && i < ANSWER_CHUNKS; i++) out[`ans${i}`] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}

export function bookingMetadata(input: BookingInput, attribution: Attribution | null, receivedAtIso: string): Record<string, string> {
  const out: Record<string, string> = {
    kind: BOOKING_KIND,
    ref: input.reference,
    service: input.serviceId,
    service_name: cap(input.serviceName),
    party: String(input.party),
    starts: input.starts.join(","),
    ends: input.ends.join(","),
    events: input.eventIds.join(","),
    total_minor: String(input.totalMinor),
    due_minor: String(input.dueNowMinor),
    later_minor: String(input.dueLaterMinor),
    currency: input.currency,
    name: cap(input.name),
    email: cap(input.email),
    site_mode: input.siteMode,
    site: input.site,
    cal_preview: input.siteMode === "preview" ? "1" : "0",
    ...answerChunks(input.answers),
    ...sourceMetadata(attribution, receivedAtIso),
  };
  if (input.phone) out["phone"] = cap(input.phone);
  if (input.item) {
    out["item"] = cap(input.item.slug);
    out["item_name"] = cap(input.item.name);
  }
  return out;
}

function numbers(text: string | undefined): number[] | null {
  if (!text) return null;
  const out = text.split(",").map((part) => (/^\d{1,16}$/.test(part) ? Number(part) : NaN));
  return out.every((n) => Number.isSafeInteger(n)) ? out : null;
}

function readAnswers(metadata: Record<string, string>): { label: string; text: string }[] {
  let json = "";
  for (let i = 0; i < ANSWER_CHUNKS; i++) {
    const part = metadata[`ans${i}`];
    if (part === undefined) break;
    json += part;
  }
  if (json === "") return [];
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    const out: { label: string; text: string }[] = [];
    for (const pair of data) if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") out.push({ label: pair[0], text: pair[1] });
    return out;
  } catch {
    return [];
  }
}

const minor = (text: string | undefined): number | null => (text !== undefined && /^\d{1,12}$/.test(text) ? Number(text) : null);

/** The booking in a session's metadata, or null when it is not a booking or is malformed in any way. */
export function parseBooking(metadata: Record<string, string>): Booking | null {
  if (metadata["kind"] !== BOOKING_KIND) return null;
  const reference = metadata["ref"];
  const starts = numbers(metadata["starts"]);
  const ends = numbers(metadata["ends"]);
  const eventIds = (metadata["events"] ?? "").split(",");
  const total = minor(metadata["total_minor"]);
  const due = minor(metadata["due_minor"]);
  const later = minor(metadata["later_minor"]);
  const party = Number(metadata["party"]);
  const currency = metadata["currency"];
  const email = metadata["email"];
  const serviceId = metadata["service"];
  if (!reference || !REFERENCE.test(reference) || !starts || !ends || starts.length !== ends.length || starts.length !== eventIds.length) return null;
  if (!eventIds.every((id) => EVENT_ID.test(id)) || new Set(eventIds).size !== eventIds.length) return null;
  if (total === null || due === null || later === null || total !== due + later) return null;
  if (!Number.isInteger(party) || party < 1 || !serviceId || !email) return null;
  if (!currency || !(PAYMENT_CURRENCIES as readonly string[]).includes(currency)) return null;
  const slug = metadata["item"];
  return {
    reference,
    serviceId,
    serviceName: metadata["service_name"] ?? serviceId,
    party,
    starts,
    ends,
    eventIds,
    totalMinor: total,
    dueNowMinor: due,
    dueLaterMinor: later,
    currency: currency as PaymentCurrency,
    name: metadata["name"] ?? "",
    email,
    phone: metadata["phone"] ?? "",
    answers: readAnswers(metadata),
    item: slug ? { slug, name: metadata["item_name"] || slug } : null,
    cells: parseCells(metadata["src_cells"]),
    cameFrom: metadata["src_line"] || "Came from: not known",
    lead: parseLead(metadata),
    siteMode: metadata["site_mode"] ?? "",
    site: metadata["site"] ?? "",
  };
}
