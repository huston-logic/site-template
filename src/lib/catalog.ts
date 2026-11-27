// The catalog a build shows: the catalog page, the visible items, the settings and the pricing table. Server only.
import { buildCatalogData } from "../catalog/data";
import { exampleCatalog } from "../catalog/example";
import { CATALOG_BLOCK, QUOTE_FORM_ID } from "../catalog/schema";
import type { CatalogData } from "../catalog/schema";
import type { CatalogView } from "../blocks/types";
import { formById, viewProps } from "./forms";
import { getItems } from "./collections";
import { getPages } from "./pages";
import { getSiteContent } from "./site-content";

/** The path of the one live page that holds the `catalog` block, or null when the site has none. */
export function catalogPagePath(): string | null {
  return getPages().find((page) => page.blocks.some((block) => block.type === CATALOG_BLOCK))?.path ?? null;
}

/** The quote form as the browser may see it, or null while the form is archived or unreadable. */
export function quoteFormView(): { id: string; form: ReturnType<typeof viewProps>["form"] } | null {
  const definition = formById(QUOTE_FORM_ID);
  return definition === null ? null : viewProps(QUOTE_FORM_ID, definition);
}

/** Everything the catalog blocks and item pages read: settings, pricing, the visible items in the owner's order. */
export function getCatalog(): CatalogView {
  const { catalog, pricing } = getSiteContent();
  return { settings: catalog, pricing, items: getItems("catalog"), pagePath: catalogPagePath(), quote: quoteFormView() };
}

/** Where the showcase's example pieces have their pages (outside production builds only, like /blocks). */
export const SHOWCASE_CATALOG_PATH = "/blocks/catalog";

/** The example catalog the block showcase shows (src/catalog/example.ts): 60 generic pieces, never files. */
export function getShowcaseCatalog(): CatalogView {
  return { settings: exampleCatalog.settings, pricing: exampleCatalog.pricing, items: exampleCatalog.items, pagePath: SHOWCASE_CATALOG_PATH, quote: quoteFormView() };
}

/** The data behind `/catalog.json`. */
export function getCatalogData(): CatalogData {
  const view = getCatalog();
  return buildCatalogData({ items: view.items, settings: view.settings, pricing: view.pricing, pagePath: view.pagePath });
}
