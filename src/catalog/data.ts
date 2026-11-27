// `/catalog.json`: the one file the Worker reads prices from (spec R9, R15). `buildCatalogData` writes it at build time from
// the visible items; `parseCatalogData` reads it back strictly, and returns null on any doubt so the Worker fails closed.
// Import-free apart from siblings.
import type { LoadedItem } from "../collections/schema.ts";
import { validatePricing } from "./validate.ts";
import type { CatalogData, CatalogSettings, PricingTable } from "./schema.ts";

/** The data file for these visible catalog items. Pass only items the build shows (live, and drafts outside production). */
export function buildCatalogData(input: { items: readonly LoadedItem[]; settings: CatalogSettings; pricing: PricingTable; pagePath: string | null }): CatalogData {
  const items: CatalogData["items"] = {};
  for (const item of input.items) {
    if (item.kind !== "catalog" || (item.status !== "live" && item.status !== "draft")) continue;
    const { name, price, options, perPerson } = item.data;
    items[item.slug] = {
      name: name as string,
      price: price as CatalogData["items"][string]["price"],
      options: Array.isArray(options) ? [...(options as string[])] : [],
      perPerson: perPerson === true,
      status: item.status,
    };
  }
  // Exact prices (and their slugs) of a draft or archived piece stay out of the public file: only visible pieces keep theirs.
  const exact: PricingTable["exact"] = {};
  for (const [slug, prices] of Object.entries(input.pricing.exact)) if (Object.hasOwn(items, slug)) exact[slug] = prices;
  return { version: 1, pagePath: input.pagePath, itemWord: { ...input.settings.itemWord }, pricing: { ...input.pricing, exact }, items };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const KEYS = ["version", "pagePath", "itemWord", "pricing", "items"];
const ITEM_KEYS = ["name", "price", "options", "perPerson", "status"];

/** The data file as typed data, or null when anything is off (unknown key, wrong type, a pricing table that fails its own check). */
export function parseCatalogData(data: unknown): CatalogData | null {
  if (!isRecord(data) || Object.keys(data).some((key) => !KEYS.includes(key)) || KEYS.some((key) => data[key] === undefined)) return null;
  if (data["version"] !== 1) return null;
  const pagePath = data["pagePath"];
  if (pagePath !== null && (typeof pagePath !== "string" || !/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pagePath))) return null;
  const word = data["itemWord"];
  if (!isRecord(word) || typeof word["singular"] !== "string" || typeof word["plural"] !== "string" || Object.keys(word).length !== 2) return null;
  if (validatePricing(data["pricing"]).length > 0) return null;
  const items = data["items"];
  if (!isRecord(items)) return null;
  for (const [slug, item] of Object.entries(items)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !isRecord(item)) return null;
    if (Object.keys(item).some((key) => !ITEM_KEYS.includes(key)) || ITEM_KEYS.some((key) => item[key] === undefined)) return null;
    if (typeof item["name"] !== "string") return null;
    const price = item["price"];
    if (price !== "ask") {
      if (!isRecord(price) || Object.keys(price).length !== 2 || !isWhole(price["low"]) || !isWhole(price["high"]) || price["low"] > price["high"]) return null;
    }
    if (!Array.isArray(item["options"]) || item["options"].some((option) => typeof option !== "string")) return null;
    if (typeof item["perPerson"] !== "boolean") return null;
    if (item["status"] !== "live" && item["status"] !== "draft") return null;
  }
  return data as unknown as CatalogData;
}
