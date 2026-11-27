// The one map from a site event to the ad products' calls. Import-free except types, so the tests, `track.ts` and
// `TrackingTags` share it. Design: docs/superpowers/specs/2026-11-27-ad-tracking-design.md ("The event layer").
import type { TrackingIds } from "./config.ts";

export const EVENT_NAMES = [
  "page_view",
  "form_start",
  "lead",
  "click_call",
  "click_email",
  "view_item",
  "quote_start",
  "begin_checkout",
  "purchase",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface EventParams {
  page_view: { page_path: string; page_title?: string };
  form_start: { form_id: string };
  lead: { form_id: string };
  click_call: Record<string, never>;
  click_email: Record<string, never>;
  view_item: { item_id: string; item_name?: string };
  quote_start: { item_id: string };
  begin_checkout: { value: number; currency: string };
  purchase: { value: number; currency: string; transaction_id: string };
}

export interface TrackCall {
  to: "gtag" | "fbq";
  args: unknown[];
}

/** The only keys each event may carry, by kind. Anything else is dropped, so no personal field can pass through. */
const ALLOWED: Record<EventName, readonly string[]> = {
  page_view: ["page_path", "page_title"],
  form_start: ["form_id"],
  lead: ["form_id"],
  click_call: [],
  click_email: [],
  view_item: ["item_id", "item_name"],
  quote_start: ["item_id"],
  begin_checkout: ["value", "currency"],
  purchase: ["value", "currency", "transaction_id"],
};

const MAX_TEXT = 300;
const CURRENCY_RE = /^[A-Z]{3}$/;

function clean(name: EventName, params: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (typeof params !== "object" || params === null) return out;
  const source = params as Record<string, unknown>;
  for (const key of ALLOWED[name]) {
    const value = source[key];
    if (key === "value") {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
    } else if (key === "currency") {
      if (typeof value === "string" && CURRENCY_RE.test(value)) out[key] = value;
    } else if (typeof value === "string" && value !== "") {
      out[key] = value.slice(0, MAX_TEXT);
    }
  }
  return out;
}

function pick(params: Record<string, string | number>, keys: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of keys) if (key in params) out[key] = params[key];
  return out;
}

/** The exact gtag and fbq calls for one event under the IDs a build has. Nothing for a product with no ID. */
export function eventCalls(name: string, params: unknown, ids: TrackingIds): TrackCall[] {
  if (!(EVENT_NAMES as readonly string[]).includes(name)) return [];
  const event = name as EventName;
  const p = clean(event, params);
  const calls: TrackCall[] = [];
  const ga4 = (gaName: string, extra: Record<string, string | number> = p) => {
    if (ids.ga4) calls.push({ to: "gtag", args: ["event", gaName, { ...extra, send_to: ids.ga4 }] });
  };
  const adsConversion = (label: string | undefined, extra: Record<string, string | number>) => {
    if (ids.ads && label) calls.push({ to: "gtag", args: ["event", "conversion", { send_to: `${ids.ads.id}/${label}`, ...extra }] });
  };
  const meta = (metaName: string, extra?: Record<string, string | number>) => {
    if (ids.meta) calls.push({ to: "fbq", args: extra ? ["track", metaName, extra] : ["track", metaName] });
  };

  switch (event) {
    case "page_view":
      // No send_to: one call reaches GA4 and Google Ads alike.
      if (ids.ga4 || ids.ads) {
        const location = typeof globalThis.location === "object" ? globalThis.location.href : undefined;
        calls.push({ to: "gtag", args: ["event", "page_view", { ...p, ...(location ? { page_location: location } : {}) }] });
      }
      meta("PageView");
      break;
    case "form_start":
    case "quote_start":
      ga4(event);
      break;
    case "lead":
      ga4("generate_lead");
      adsConversion(ids.ads?.leadLabel, {});
      meta("Lead");
      break;
    case "click_call":
    case "click_email":
      ga4(event, {});
      meta("Contact");
      break;
    case "view_item":
      ga4(event);
      meta("ViewContent");
      break;
    case "begin_checkout":
      ga4(event);
      meta("InitiateCheckout", pick(p, ["value", "currency"]));
      break;
    case "purchase":
      ga4(event);
      adsConversion(ids.ads?.purchaseLabel, pick(p, ["value", "currency", "transaction_id"]));
      meta("Purchase", pick(p, ["value", "currency"]));
      break;
  }
  return calls;
}
