// The catalog and pricing settings, and a catalog item's prices, in plain words for the read tools. Pure.
import { defaultRange, formatMoney, formatRange } from "../../src/catalog/price.ts";
import type { CatalogSettings, PricingTable } from "../../src/catalog/schema.ts";
import { validateCatalogSettings, validatePricing } from "../../src/catalog/validate.ts";
import { catalogWords } from "../../src/content/catalog.ts";
import { isObject } from "./json.ts";

const WORDS = { about: catalogWords.about, to: catalogWords.to, onRequest: catalogWords.onRequest };

export const pricingFrom = (value: unknown): PricingTable | null => (isObject(value) && validatePricing(value).length === 0 ? (value as unknown as PricingTable) : null);
export const catalogSettingsFrom = (value: unknown): CatalogSettings | null =>
  isObject(value) && validateCatalogSettings(value).length === 0 ? (value as unknown as CatalogSettings) : null;

/** What a choice does to an estimate, in words: "adds $300", "takes off $50", "multiplies by 1.25", "no change". */
export function effectWords(choice: { add?: number; multiply?: number }, currency: string): string {
  if (typeof choice.multiply === "number") return choice.multiply === 1 ? "no change" : `multiplies by ${choice.multiply}`;
  const add = choice.add ?? 0;
  if (add === 0) return "no change";
  return add > 0 ? `adds ${formatMoney(add, currency)}` : `takes off ${formatMoney(-add, currency)}`;
}

/** The catalog settings: the word for a piece and each filter with its value ids and labels. */
export function catalogSettingsLines(data: unknown): string[] {
  const settings = catalogSettingsFrom(data);
  if (settings === null) return [];
  return [
    `The word for a piece: "${settings.itemWord.singular}" (plural "${settings.itemWord.plural}").`,
    settings.filters.length === 0 ? "Filters: none yet." : "Filters (a filter's id and each value's id never change when a label is renamed):",
    ...settings.filters.map((filter) => `  ${filter.name} (id ${filter.id}): ${filter.values.map((value) => `${value.label} (id ${value.id})`).join(", ")}`),
    "Add a filter with insert_item on settings catalog, pointer /filters; add a value with pointer /filters/<index>/values. Give each a lowercase id with hyphens and a label.",
  ];
}

/** The pricing table: currency, rounding, spread, note, each group with what each choice does, the per-person fee and the exact prices. */
export function pricingLines(data: unknown): string[] {
  const pricing = pricingFrom(data);
  if (pricing === null) return [];
  const lines = [
    `Currency ${pricing.currency}. Estimates are rounded to a multiple of ${pricing.rounding}${pricing.spread > 0 ? ` and are widened by ${pricing.spread} percent each way` : ""}.`,
    `Note shown with every estimate: ${JSON.stringify(pricing.note)}`,
    pricing.groups.length === 0 ? "Option groups: none yet." : "Option groups (the first choice of each is the default):",
  ];
  for (const group of pricing.groups) {
    lines.push(`  ${group.name} (id ${group.id}):`);
    group.choices.forEach((choice, index) => {
      lines.push(`    ${choice.label} (id ${choice.id}): ${effectWords(choice, pricing.currency)}${index === 0 ? ", the default" : ""}`);
    });
  }
  lines.push(
    pricing.perPerson === null
      ? "Per-person fee: none."
      : `Per-person fee: ${pricing.perPerson.label}, ${formatMoney(pricing.perPerson.amount, pricing.currency)} each, from ${pricing.perPerson.min} to ${pricing.perPerson.max}.`,
  );
  const exact = Object.keys(pricing.exact).length;
  lines.push(`Exact prices: ${exact === 0 ? "none" : `${exact} ${exact === 1 ? "piece has" : "pieces have"} them (get_item shows a piece's)`}.`);
  lines.push('To raise or lower one choice and its exact prices by a percent, use the scale_price operation (group, choice, percent from -50 to 100). Every price change is shown with the pieces it moves.');
  return lines;
}

/** The range a card shows for a catalog item, or null when the pricing table cannot be read. */
export function itemEstimate(item: Record<string, unknown>, pricing: PricingTable | null, slug: string): string | null {
  if (pricing === null || (item.price !== "ask" && !isObject(item.price))) return null;
  const options = Array.isArray(item.options) ? (item.options as string[]) : [];
  const price = item.price as { low: number; high: number } | "ask";
  return formatRange(defaultRange({ price, options, perPerson: item.perPerson === true }, pricing, slug), pricing.currency, WORDS);
}

/** A catalog item's exact prices from the pricing table, one line per group and choice. */
export function exactLines(slug: string, pricing: PricingTable | null): { lines: string[]; data: Record<string, Record<string, number>> } {
  const groups = pricing?.exact[slug];
  if (pricing === null || groups === undefined) return { lines: [], data: {} };
  const lines: string[] = [];
  for (const [groupId, choices] of Object.entries(groups)) {
    const group = pricing.groups.find((candidate) => candidate.id === groupId);
    for (const [choiceId, amount] of Object.entries(choices)) {
      const label = group?.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId;
      lines.push(`  ${group?.name ?? groupId}, ${label}: ${formatMoney(amount, pricing.currency)} (set in the pricing table, not in the item)`);
    }
  }
  return { lines: lines.length > 0 ? ["Exact prices:", ...lines] : [], data: groups };
}
