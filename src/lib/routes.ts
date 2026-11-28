// The single list of site routes. The sitemap, the accessibility check (tests/a11y) and Lighthouse CI (lighthouserc.cjs)
// all read it, so a page added as a file in src/content/pages is listed for search engines and scanned by CI.
// Plain Node (type stripping) and Playwright load this file: relative imports with .ts, no aliases, no enums.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { exampleCatalog } from "../catalog/example.ts";
import { CATALOG_BLOCK, itemPathFor } from "../catalog/schema.ts";
import { pickItems } from "../collections/pick.ts";
import type { LoadedItem } from "../collections/schema.ts";
import { extraPageNumbers, indexPath, postPath } from "./blog.ts";
import { readItemFiles } from "./content-files.ts";
import { showDrafts } from "./drafts.ts";
import { readPageFiles } from "./page-files.ts";

type RoutePage = { path: string; status?: unknown; blocks?: unknown; menu?: { order?: unknown; places?: unknown } };

const live = readPageFiles()
  .flatMap(({ data, error }) => (error === undefined && typeof data === "object" && data !== null ? [data as RoutePage] : []))
  .filter((page) => page.status === "live" && typeof page.path === "string");

const orderOf = (page: RoutePage) => (typeof page.menu?.order === "number" ? page.menu.order : Number.MAX_SAFE_INTEGER);
const inMenu = (page: RoutePage, place: string) => {
  const places = page.menu?.places;
  return Array.isArray(places) && places.includes(place);
};

// 0: the home page; 1: header or footer menu pages; 2: pages only in the legal menu; 3: the rest.
const groupOf = (page: RoutePage) => (page.path === "/" ? 0 : inMenu(page, "header") || inMenu(page, "footer") ? 1 : inMenu(page, "legal") ? 2 : 3);

/** Live pages: the home page, then the header and footer menu pages by order, then the legal ones by order, then the rest by path. An archived page is left out. */
export const pageRoutes: string[] = live
  .sort((a, b) => groupOf(a) - groupOf(b) || (groupOf(a) < 3 ? orderOf(a) - orderOf(b) : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  .map((page) => page.path);

/**
 * The blog's routes from post slugs, newest first. `live` are the live posts (indexed, in the sitemap); `visible` are the
 * posts this build shows (live, plus drafts outside production). Draft post pages are built but never indexed.
 */
export function blogRoutes(live: readonly string[], visible: readonly string[]): { posts: string[]; indexPages: string[]; draftPosts: string[] } {
  return {
    posts: live.map(postPath),
    indexPages: extraPageNumbers(visible.length).map(indexPath),
    draftPosts: visible.filter((slug) => !live.includes(slug)).map(postPath),
  };
}

const postItems: LoadedItem[] = readItemFiles()
  .flatMap(({ kind, slug, data, error }) =>
    kind === "posts" && error === undefined && typeof data === "object" && data !== null && !Array.isArray(data)
      ? [{ kind, slug, status: (data as { status?: unknown }).status, data } as unknown as LoadedItem]
      : [],
  );
/** The post slugs a build shows, in the order the blog lists them (the same `pickItems` the pages use). */
export const postSlugs = (items: readonly LoadedItem[], drafts: boolean): string[] => pickItems(items, "posts", drafts).map((item) => item.slug);
const blog = blogRoutes(postSlugs(postItems, false), postSlugs(postItems, showDrafts()));

/** The path of the one live page that holds the catalog block, or null. */
const catalogPagePath: string | null =
  live.find((page) => Array.isArray(page.blocks) && page.blocks.some((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === CATALOG_BLOCK))?.path ?? null;

/** The routes of catalog items under the catalog page: `live` are indexed, `drafts` are built outside production and never indexed. Nothing without a catalog page. */
export function catalogRoutes(pagePath: string | null, liveSlugs: readonly string[], visible: readonly string[]): { live: string[]; drafts: string[] } {
  if (pagePath === null) return { live: [], drafts: [] };
  return { live: liveSlugs.map((slug) => itemPathFor(pagePath, slug)), drafts: visible.filter((slug) => !liveSlugs.includes(slug)).map((slug) => itemPathFor(pagePath, slug)) };
}

const catalogItems: LoadedItem[] = readItemFiles().flatMap(({ kind, slug, data, error }) =>
  kind === "catalog" && error === undefined && typeof data === "object" && data !== null && !Array.isArray(data)
    ? [{ kind, slug, status: (data as { status?: unknown }).status, data } as unknown as LoadedItem]
    : [],
);
const catalogSlugs = (drafts: boolean): string[] => pickItems(catalogItems, "catalog", drafts).map((item) => item.slug);
const catalogItemRoutes = catalogRoutes(catalogPagePath, catalogSlugs(false), catalogSlugs(showDrafts()));

/** Every indexable route: the live pages, the blog's extra index pages, every live post and every live catalog item. This is the sitemap. */
export const indexableRoutes: string[] = [...pageRoutes, ...blog.indexPages, ...blog.posts, ...catalogItemRoutes.live];

/** What CI audits (Lighthouse, the accessibility scan): the pages, plus the newest live post, /blog/page/2 when it exists and the first live catalog item. One of each kind of page. */
export const auditRoutes: string[] = [...pageRoutes, ...blog.posts.slice(0, 1), ...blog.indexPages.slice(0, 1), ...catalogItemRoutes.live.slice(0, 1)];

/** The block showcase: every block and variant with its example content. Built, scanned and audited, never indexed. */
export const showcaseRoute = "/blocks";

/** Every example piece of the showcase has a page at /blocks/catalog/<slug> (built outside production, like /blocks). */
export const showcaseItemRoutes: string[] = exampleCatalog.items.map((item) => `${showcaseRoute}/catalog/${item.slug}`);
/** The one example item page the accessibility scan covers (the others are the same design with other data). */
export const exampleItemRoute: string = showcaseItemRoutes[0] ?? `${showcaseRoute}/catalog`;

/** The gift card thank-you page is built only while payments are on (finish-build removes it otherwise), so it is listed only when the build in `out/` has it. */
const giftCardThanks = ["/gift-cards/thanks"].filter(() => existsSync(join(process.cwd(), "out", "gift-cards", "thanks.html")));

/** The booking thank-you page is built only while booking is on (finish-build removes it otherwise), so it is listed only when the build in `out/` has it. */
const bookingThanks = ["/booking/thanks"].filter(() => existsSync(join(process.cwd(), "out", "booking", "thanks.html")));

/** Real pages that stay out of the sitemap (noindex): the thanks page, the showcase, one example item page, draft posts and draft catalog items. The other example item pages are `showcaseItemRoutes`. */
export const noindexRoutes = ["/contact/thanks", ...giftCardThanks, ...bookingThanks, showcaseRoute, exampleItemRoute, ...blog.draftPosts, ...catalogItemRoutes.drafts];
