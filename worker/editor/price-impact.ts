// What a change to the pricing table does to each piece's estimate, in the words of the change list (spec R18). Pure: it
// prices every piece with the one price function under the old table and the new one, and reports the first selection of
// each piece whose shown range differs. Never reads the network or the files.
import { catalogWords } from "../../src/content/catalog.ts";
import { formatRange, priceRange } from "../../src/catalog/price.ts";
import type { PriceItem, PricingTable, Selection } from "../../src/catalog/schema.ts";

/** The lines a change list shows before it says "and M more". */
export const IMPACT_LINES = 12;

export interface ImpactItem {
  slug: string;
  name: string;
  order: number;
  item: PriceItem;
}

export interface ImpactLine {
  name: string;
  /** The choice label the range is for ("14k gold", or "no options" for a piece with none). */
  choice: string;
  was: string;
  now: string;
}

export interface Impact {
  /** How many pieces have at least one selection whose range changes. */
  total: number;
  lines: ImpactLine[];
  /** Pieces beyond the lines shown. */
  more: number;
}

const WORDS = { about: catalogWords.about, to: catalogWords.to, onRequest: catalogWords.onRequest };

/** The range a selection shows under a table: "$1,200 to $1,800", "About $2,100" or "Price on request". */
export function rangeText(item: PriceItem, pricing: PricingTable, selection: Selection, slug: string): string {
  const priced = priceRange(item, pricing, selection, slug);
  return formatRange(priced.ok ? priced.result : { kind: "ask" }, pricing.currency, WORDS);
}

/** The default selection first, then each choice of each group alone with the others at their defaults. */
function selections(item: PriceItem, pricing: PricingTable): { selection: Selection; label: string }[] {
  const groups = (item.options ?? []).flatMap((id) => pricing.groups.filter((group) => group.id === id));
  const defaults = groups.map((group) => group.choices[0]?.label).filter((label): label is string => label !== undefined);
  const out: { selection: Selection; label: string }[] = [{ selection: {}, label: defaults.length > 0 ? defaults.join(", ") : "no options" }];
  for (const group of groups) {
    for (const choice of group.choices) out.push({ selection: { options: { [group.id]: choice.id } }, label: choice.label });
  }
  return out;
}

/** Which pieces change price between two tables, and the first selection of each that shows it. */
export function priceImpact(before: PricingTable, after: PricingTable, items: readonly ImpactItem[]): Impact {
  const sorted = [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const lines: ImpactLine[] = [];
  for (const { slug, name, item } of sorted) {
    for (const { selection, label } of selections(item, after)) {
      const was = rangeText(item, before, selection, slug);
      const now = rangeText(item, after, selection, slug);
      if (was !== now) {
        lines.push({ name, choice: label, was, now });
        break;
      }
    }
  }
  return { total: lines.length, lines: lines.slice(0, IMPACT_LINES), more: Math.max(0, lines.length - IMPACT_LINES) };
}

/** The change list's closing lines for an impact. */
export function impactLines(impact: Impact, itemWord: { singular: string; plural: string }): string[] {
  if (impact.total === 0) return [`No ${itemWord.singular}'s price changes.`];
  const word = impact.total === 1 ? itemWord.singular : itemWord.plural;
  return [
    `This changes the price of ${impact.total} ${word}.`,
    ...impact.lines.map((line) => `${line.name}, with ${line.choice}: ${line.was} → ${line.now}`),
    ...(impact.more > 0 ? [`and ${impact.more} more.`] : []),
  ];
}
