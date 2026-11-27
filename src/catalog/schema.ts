// The catalog: types, limits and the few paths every part of it shares (docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md,
// R1 to R6). Import-free, so the build, the browser, Node scripts and the Worker all load it.

export const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const ROUNDING_STEPS = [1, 5, 10, 25, 50, 100, 500, 1000] as const;
export type RoundingStep = (typeof ROUNDING_STEPS)[number];

/** Item fields (R2). */
export const MAX_PHOTOS = 6;
export const MAX_ITEM_OPTIONS = 4;
export const MAX_ITEM_FILTER_VALUES = 6;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 600;
export const ORDER_MAX = 9999;
export const PRICE_MAX = 10_000_000;

/** Catalog settings (R3). */
export const MAX_FILTERS = 7;
export const MAX_FILTER_VALUES = 24;
export const FILTER_NAME_MAX = 30;
export const FILTER_LABEL_MAX = 40;
export const ITEM_WORD_MAX = 24;
export const ID_MAX = 40;

/** Pricing table (R4). */
export const MAX_GROUPS = 6;
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 12;
export const GROUP_NAME_MAX = 30;
export const CHOICE_LABEL_MAX = 40;
export const SPREAD_MAX = 50;
export const NOTE_MAX = 160;
export const ADD_MIN = -100_000;
export const ADD_MAX = 1_000_000;
export const MULTIPLY_MIN = 0.1;
export const MULTIPLY_MAX = 10;
export const MULTIPLY_DECIMALS = 4;
export const PER_PERSON_LABEL_MAX = 24;
export const PER_PERSON_AMOUNT_MAX = 10_000;
export const PER_PERSON_LIMIT_MAX = 1000;

/** An id (filter, value, group, choice) is a slug of 1 to 40 characters. */
export const ID_RE = /^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const QUOTE_FORM_ID = "quote";
/** The static route the Worker reads prices from. */
export const CATALOG_DATA_PATH = "/catalog.json";
/** The key beside a quote form's answers that carries the visitor's selection (never an owner field). */
export const SELECTION_KEY = "selection";
export const CATALOG_SETTINGS_PATH = "src/content/catalog.json";
export const PRICING_PATH = "src/content/pricing.json";
/** The block type of the gallery. */
export const CATALOG_BLOCK = "catalog";
/** Pages that may never hold the gallery. */
export const CATALOG_FORBIDDEN_PATHS = ["/", "/blog", "/contact"] as const;

export type CatalogFilter = { id: string; name: string; values: { id: string; label: string }[] };
export type CatalogSettings = { itemWord: { singular: string; plural: string }; filters: CatalogFilter[] };

export type Choice = { id: string; label: string } & ({ add: number } | { multiply: number });
export type OptionGroup = { id: string; name: string; choices: Choice[] };
export type PerPerson = { label: string; amount: number; min: number; max: number };
export type PricingTable = {
  currency: Currency;
  rounding: RoundingStep;
  spread: number;
  note: string;
  groups: OptionGroup[];
  perPerson: PerPerson | null;
  /** Item slug to group id to choice id to a whole amount. */
  exact: Record<string, Record<string, Record<string, number>>>;
};

export type CatalogItem = {
  name: string;
  photos: { src: string; alt: string; focus?: "center" | "top" | "bottom" | "left" | "right" }[];
  description: string;
  /** Filter id to value ids. */
  filters?: Record<string, string[]>;
  price: { low: number; high: number } | "ask";
  options?: string[];
  perPerson?: boolean;
  order: number;
};

/** What the price function needs of an item (the page data and `/catalog.json` both fit). */
export type PriceItem = { price: { low: number; high: number } | "ask"; options?: readonly string[]; perPerson?: boolean };

/** A visitor's selection: option group id to choice id, and the number of people. */
export type Selection = { options?: Record<string, string>; people?: number };

export type PriceResult = { kind: "range"; low: number; high: number } | { kind: "ask" };

export type CatalogData = {
  version: 1;
  pagePath: string | null;
  itemWord: { singular: string; plural: string };
  pricing: PricingTable;
  /** Visible items only (live, and drafts outside production). */
  items: Record<string, { name: string; price: { low: number; high: number } | "ask"; options: string[]; perPerson: boolean; status: "live" | "draft" }>;
};

/** The card file beside a photo: `/images/a/b.jpg` has `/images/a/b-card.webp`. */
export function cardPathFor(src: string): string {
  return /\.(?:jpe?g|png|webp)$/i.test(src) ? src.replace(/\.(?:jpe?g|png|webp)$/i, "-card.webp") : `${src}-card.webp`;
}

/** The address of an item: the catalog page's path and the slug. */
export function itemPathFor(pagePath: string, slug: string): string {
  return `${pagePath === "/" ? "" : pagePath}/${slug}`;
}
