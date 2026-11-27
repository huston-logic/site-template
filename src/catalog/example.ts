// The example catalog of the block showcase (spec R22): about sixty ceramics pieces built in code, never files, so it
// counts toward nothing on a site. Deterministic: the same call always gives the same pieces. Names and descriptions are
// generic; there are no business facts. Import-free apart from siblings.
import type { LoadedItem } from "../collections/schema.ts";
import { cardPathFor } from "./schema.ts";
import type { CatalogSettings, PricingTable } from "./schema.ts";

const PHOTOS = [
  { src: "/images/examples/vase-and-pears.jpg", alt: "A pale blue vase beside a blue pear and a rust-red pear on a table" },
  { src: "/images/examples/bowl-and-lemons.jpg", alt: "A shallow bowl holding three blue fruits beside one rust-red fruit" },
  { src: "/images/examples/jug-and-cups.jpg", alt: "A tall blue jug beside two small cups on a table" },
  { src: "/images/examples/stacked-books.jpg", alt: "Abstract still life: a stack of books with a round glass paperweight on top" },
  { src: "/images/examples/candle-and-plate.jpg", alt: "A lit pale candle beside a blue egg-shaped object on a white plate" },
  { src: "/images/examples/window-light.jpg", alt: "Soft light falling through a window onto a wooden table" },
] as const;

/** The card files the example photos need (the cover and every other photo have one). */
export const exampleCardPaths: readonly string[] = PHOTOS.map((photo) => cardPathFor(photo.src));

const settings: CatalogSettings = {
  itemWord: { singular: "piece", plural: "pieces" },
  filters: [
    {
      id: "type",
      name: "Type",
      values: [
        { id: "jug", label: "Jugs" },
        { id: "vase", label: "Vases" },
        { id: "bowl", label: "Bowls" },
        { id: "mug", label: "Mugs" },
        { id: "plate", label: "Plates" },
        { id: "dinner-set", label: "Dinner sets" },
      ],
    },
    {
      id: "glaze",
      name: "Glaze",
      values: [
        { id: "ash", label: "Ash" },
        { id: "celadon", label: "Celadon" },
        { id: "cobalt", label: "Cobalt" },
        { id: "rust", label: "Rust" },
        { id: "white", label: "White" },
      ],
    },
    {
      id: "size",
      name: "Size",
      values: [
        { id: "small", label: "Small" },
        { id: "medium", label: "Medium" },
        { id: "large", label: "Large" },
      ],
    },
    {
      id: "finish",
      name: "Finish",
      values: [
        { id: "glossy", label: "Glossy" },
        { id: "matte", label: "Matte" },
      ],
    },
    {
      id: "collection",
      name: "Collection",
      values: [
        { id: "everyday", label: "Everyday" },
        { id: "garden", label: "Garden" },
        { id: "studio", label: "Studio" },
      ],
    },
    {
      id: "made",
      name: "Made",
      values: [
        { id: "to-order", label: "Made to order" },
        { id: "ready-to-ship", label: "Ready to ship" },
      ],
    },
  ],
};

const pricing: PricingTable = {
  currency: "USD",
  rounding: 5,
  spread: 0,
  note: "Prices are estimates. I confirm the final price after we talk.",
  groups: [
    {
      id: "glaze-colour",
      name: "Glaze colour",
      choices: [
        { id: "ash", label: "Ash", add: 0 },
        { id: "celadon", label: "Celadon", add: 20 },
        { id: "cobalt", label: "Cobalt", add: 35 },
        { id: "rust", label: "Rust", add: 25 },
      ],
    },
    {
      id: "size",
      name: "Size",
      choices: [
        { id: "small", label: "Small", multiply: 1 },
        { id: "medium", label: "Medium", multiply: 1.25 },
        { id: "large", label: "Large", multiply: 1.5 },
      ],
    },
  ],
  perPerson: { label: "Place settings", amount: 45, min: 2, max: 12 },
  exact: {
    "tall-jug-ash-glaze": { "glaze-colour": { celadon: 95, cobalt: 110 } },
    "bud-vase-celadon-glaze": { "glaze-colour": { cobalt: 120 } },
    "dinner-plate-white-glaze": { "glaze-colour": { rust: 48, cobalt: 52 } },
  },
};

type Kind = { filter: string; singular: string; base: number; names: readonly string[]; options: readonly string[]; blurb: string };
const KINDS: readonly Kind[] = [
  { filter: "jug", singular: "jug", base: 60, options: ["glaze-colour", "size"], blurb: "A thrown jug with a comfortable handle.", names: ["Tall jug", "Round jug", "Small jug", "Pouring jug", "Milk jug", "Lidded jug", "Wide jug", "Slim jug", "Handled jug", "Footed jug"] },
  { filter: "vase", singular: "vase", base: 80, options: ["glaze-colour", "size"], blurb: "A hand-finished vase for stems or for standing on its own.", names: ["Bud vase", "Tall vase", "Round vase", "Bottle vase", "Wide vase", "Narrow vase", "Footed vase", "Pinched vase", "Twin vase", "Moon vase"] },
  { filter: "bowl", singular: "bowl", base: 35, options: ["glaze-colour", "size"], blurb: "A bowl made for the table, deep enough to hold a full serving.", names: ["Serving bowl", "Cereal bowl", "Fruit bowl", "Soup bowl", "Wide bowl", "Deep bowl", "Footed bowl", "Nesting bowl", "Mixing bowl", "Salad bowl"] },
  { filter: "mug", singular: "mug", base: 25, options: ["glaze-colour"], blurb: "A mug that sits well in the hand and goes in the dishwasher.", names: ["Everyday mug", "Tall mug", "Small mug", "Handled mug", "Wide mug", "Stacking mug", "Footed mug", "Coffee mug", "Tea mug", "Straight mug"] },
  { filter: "plate", singular: "plate", base: 30, options: ["glaze-colour"], blurb: "A flat plate with a clean edge, made to stack.", names: ["Dinner plate", "Side plate", "Serving plate", "Wide plate", "Dessert plate", "Rimmed plate", "Flat plate", "Round plate", "Oval plate", "Pasta plate"] },
  { filter: "dinner-set", singular: "set", base: 280, options: ["glaze-colour"], blurb: "A matching set of plates and bowls, priced by the number of place settings.", names: ["Everyday dinner set", "Garden dinner set", "Studio dinner set", "Classic dinner set", "Small dinner set", "Large dinner set", "Plain dinner set", "Banded dinner set", "Speckled dinner set", "Simple dinner set"] },
];

const slugify = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const GLAZES = settings.filters[1]?.values ?? [];
const SIZES = ["small", "medium", "large"] as const;
const FINISHES = ["glossy", "matte"] as const;
const COLLECTIONS = ["everyday", "garden", "studio"] as const;
const MADE = ["to-order", "ready-to-ship"] as const;
/** A few pieces whose price is left to ask about. */
const ASK = new Set(["moon-vase-ash-glaze", "twin-vase-white-glaze"]);

function build(): LoadedItem[] {
  const items: LoadedItem[] = [];
  let n = 0;
  KINDS.forEach((kind, k) => {
    kind.names.forEach((base, v) => {
      const glaze = GLAZES[(v + k) % GLAZES.length] as { id: string; label: string };
      const name = `${base}, ${glaze.label.toLowerCase()} glaze`;
      const slug = slugify(name);
      const photoCount = 1 + (n % 4);
      const photos = Array.from({ length: photoCount }, (_, p) => PHOTOS[(n + p) % PHOTOS.length] as (typeof PHOTOS)[number]).map((photo) => ({ ...photo }));
      const low = kind.base + v * 5;
      const set = kind.filter === "dinner-set";
      const data: Record<string, unknown> = {
        name,
        photos,
        description: `${kind.blurb} Finished in ${glaze.label.toLowerCase()} glaze.`,
        filters: {
          type: [kind.filter],
          glaze: [glaze.id],
          size: [SIZES[(n + k) % SIZES.length]],
          finish: [FINISHES[n % FINISHES.length]],
          collection: [COLLECTIONS[(n + v) % COLLECTIONS.length]],
          made: [MADE[(n + k) % MADE.length]],
        },
        price: ASK.has(slug) ? "ask" : { low, high: low + Math.round(low / 4 / 5) * 5 },
        options: [...kind.options],
        order: n + 1,
      };
      if (set) data["perPerson"] = true;
      items.push({ kind: "catalog", slug, status: "live", data });
      n += 1;
    });
  });
  return items;
}

export const exampleCatalog: { settings: CatalogSettings; pricing: PricingTable; items: LoadedItem[] } = { settings, pricing, items: build() };
