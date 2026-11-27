import type { ReactNode } from "react";
import type { CatalogSettings, PricingTable } from "../catalog/schema.ts";
import type { LoadedItem } from "../collections/schema.ts";
import type { PublicForm } from "../forms/schema.ts";
import type { BusinessData } from "../settings/business.ts";

/**
 * What the two catalog blocks need besides their items: the filters and the item word, the pricing table, the page the
 * items hang under (the item pages are `<pagePath>/<slug>`), and the quote form when it is live. The renderer builds it
 * from the site's files; the showcase builds it from the example catalog.
 */
export type CatalogView = {
  settings: CatalogSettings;
  pricing: PricingTable;
  items: readonly LoadedItem[];
  /** The path item pages sit under. `null` only for a site with no catalog page (items then have no address). */
  pagePath: string | null;
  quote: { id: string; form: PublicForm } | null;
};

/** What the renderer hands every block component. `content` is already checked against the block's fields. */
export type BlockProps<C> = {
  content: C;
  /** The chosen variant name (the block's first variant when the page names none). */
  variant: string;
  /** The page-chosen anchor, or the block's fixed one; a block puts it on its section as the id. */
  anchor?: string;
  /** The id for the block's heading, for `aria-labelledby`. */
  headingId: string;
  /** True when this block holds the page's single H1 (the first block). */
  primary: boolean;
  /** The visible items of the block's collection (see `collection` in its definition), in the collection's order. Always passed; empty for a block that lists nothing. */
  items: readonly LoadedItem[];
  /** Business details to show instead of business.json: the /blocks showcase passes example ones. */
  business?: BusinessData;
  /** The catalog the two catalog blocks read. Passed only to blocks whose collection is the catalog. */
  catalog?: CatalogView;
  /** The page of a paged list this view shows (1 and up), for the post index on /blog/page/<n>. */
  page?: number;
};

/** Any block component. `never` lets each component keep its own content type. */
export type BlockComponent = (props: BlockProps<never>) => ReactNode;
