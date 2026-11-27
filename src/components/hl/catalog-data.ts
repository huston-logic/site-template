// A catalog item as the pieces of the page read it, and the lines every card and item page shows. Pure (no React), so the
// server blocks, the client builder and the tests share it. The item was checked at build time (lib/site-content.ts).
import { defaultRange, formatRange } from "../../catalog/price.ts";
import type { CatalogSettings, PriceItem, PricingTable } from "../../catalog/schema.ts";
import type { LoadedItem } from "../../collections/schema.ts";
import { catalogWords } from "../../content/catalog.ts";

export type ItemPhoto = { src: string; alt: string; focus?: "center" | "top" | "bottom" | "left" | "right" };
export type ItemView = {
  slug: string;
  name: string;
  description: string;
  photos: ItemPhoto[];
  price: PriceItem["price"];
  options: string[];
  perPerson: boolean;
  filters: Record<string, string[]>;
  draft: boolean;
};

export function itemView(item: LoadedItem): ItemView {
  const data = item.data;
  return {
    slug: item.slug,
    name: data["name"] as string,
    description: data["description"] as string,
    photos: data["photos"] as ItemPhoto[],
    price: data["price"] as PriceItem["price"],
    options: Array.isArray(data["options"]) ? (data["options"] as string[]) : [],
    perPerson: data["perPerson"] === true,
    filters: (data["filters"] as Record<string, string[]> | undefined) ?? {},
    draft: item.status === "draft",
  };
}

/** What the price function needs of an item. */
export const priceItemOf = (view: ItemView): PriceItem => ({ price: view.price, options: view.options, perPerson: view.perPerson });

/** The words of a range: the catalog's own wording for "About", "to" and "Price on request". */
export const rangeWords = { about: catalogWords.about, to: catalogWords.to, onRequest: catalogWords.onRequest } as const;

/** The price a card shows: the first choices and the smallest party, as "About $2,100", "$1,200 to $1,800" or "Price on request". */
export function cardPrice(view: ItemView, pricing: PricingTable): { text: string; isEstimate: boolean } {
  const range = defaultRange(priceItemOf(view), pricing, view.slug);
  return { text: formatRange(range, pricing.currency, rangeWords), isEstimate: range.kind === "range" };
}

/** An item's filter values as names and labels, in the site's filter order, for the facts on its page. */
export function factsOf(view: ItemView, settings: CatalogSettings): { name: string; labels: string[] }[] {
  return settings.filters.flatMap((filter) => {
    const chosen = view.filters[filter.id] ?? [];
    const labels = filter.values.filter((value) => chosen.includes(value.id)).map((value) => value.label);
    return labels.length === 0 ? [] : [{ name: filter.name, labels }];
  });
}

/** The first label of each of the first `count` filters the item has a value for: a quiet line for a showcase card. */
export function quietFacts(view: ItemView, settings: CatalogSettings, count: number): string {
  return factsOf(view, settings)
    .slice(0, count)
    .map((fact) => fact.labels[0] ?? "")
    .join(", ");
}
