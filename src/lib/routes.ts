// The single list of site routes. The sitemap, the accessibility check (tests/a11y) and Lighthouse CI (lighthouserc.cjs)
// all read it, so a page added as a file in src/content/pages is listed for search engines and scanned by CI.
// Plain Node (type stripping) and Playwright load this file: relative imports with .ts, no aliases, no enums.
import { readPageFiles } from "./page-files.ts";

type RoutePage = { path: string; status?: unknown; menu?: { order?: unknown } };

const live = readPageFiles()
  .flatMap(({ data, error }) => (error === undefined && typeof data === "object" && data !== null ? [data as RoutePage] : []))
  .filter((page) => page.status === "live" && typeof page.path === "string");

const orderOf = (page: RoutePage) => (typeof page.menu?.order === "number" ? page.menu.order : Number.MAX_SAFE_INTEGER);

/** Live pages: the home page first, then by menu order, then by path. A page that is archived is left out. */
export const indexableRoutes: string[] = live
  .sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : orderOf(a) - orderOf(b) || (a.path < b.path ? -1 : 1)))
  .map((page) => page.path);

/** Real pages that stay out of the sitemap (noindex). */
export const noindexRoutes = ["/contact/thanks"];
