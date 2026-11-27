import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlockRenderer } from "@/blocks/BlockRenderer";
import { itemPathFor } from "@/catalog/schema";
import { CatalogItemView } from "@/components/hl/CatalogItemView";
import { itemView } from "@/components/hl/catalog-data";
import { BLOG_PATH } from "@/lib/blog";
import { getCatalog } from "@/lib/catalog";
import { getItem } from "@/lib/collections";
import { getPage, getPages } from "@/lib/pages";
import { pageMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ path: string[] }> };

// Only the live pages in src/content/pages and the visible items of the catalog page are built; any other address is the
// 404. One segment is a page (/blog has its own route, src/app/(site)/blog); two segments are a catalog item, when the
// first is the catalog page. A catch-all always has addresses (the required /contact), which a nested route would not on a
// site without a catalog.
export const dynamicParams = false;

export function generateStaticParams() {
  const pages = getPages()
    .filter((page) => page.path !== "/" && page.path !== BLOG_PATH)
    .map((page) => ({ path: [page.path.slice(1)] }));
  const { pagePath, items } = getCatalog();
  const itemParams = pagePath === null || pagePath === "/" ? [] : items.map((item) => ({ path: [pagePath.slice(1), item.slug] }));
  return [...pages, ...itemParams];
}

type Target = { kind: "page"; path: string } | { kind: "item"; pagePath: string; slug: string };

/** What an address names: a page, an item of the catalog page, or nothing. */
function targetFor(path: string[]): Target | undefined {
  if (path.length === 1) return { kind: "page", path: `/${path[0]}` };
  if (path.length === 2) {
    const { pagePath } = getCatalog();
    if (pagePath !== null && pagePath === `/${path[0]}`) return { kind: "item", pagePath, slug: path[1] as string };
  }
  return undefined;
}

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const target = targetFor((await params).path);
  if (target === undefined) return {};
  if (target.kind === "page") {
    const page = getPage(target.path);
    if (!page) return {};
    return pageMetadata({ title: page.title, description: page.description, path: page.path });
  }
  const item = getItem("catalog", target.slug);
  if (!item) return {};
  const view = itemView(item);
  return pageMetadata({ title: view.name, description: cut(view.description, 170), path: itemPathFor(target.pagePath, view.slug), noindex: view.draft });
}

/** A page (the blocks of its file in src/content/pages) or a catalog item (its own page). */
export default async function PathPage({ params }: Props) {
  const target = targetFor((await params).path);
  if (target === undefined) notFound();
  if (target.kind === "item") {
    const item = getItem("catalog", target.slug);
    if (!item) notFound();
    return <CatalogItemView key={item.slug} view={itemView(item)} catalog={getCatalog()} />;
  }
  const page = getPage(target.path);
  if (!page) notFound();
  // Keyed by path: moving between two pages of this route gives fresh block wrappers, so each page gets its entrance.
  return <BlockRenderer key={page.path} blocks={page.blocks} />;
}
