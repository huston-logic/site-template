import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exampleCatalog } from "@/catalog/example";
import { CatalogItemView } from "@/components/hl/CatalogItemView";
import { itemView } from "@/components/hl/catalog-data";
import { getShowcaseCatalog, SHOWCASE_CATALOG_PATH } from "@/lib/catalog";
import { pageMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ slug: string }> };

// The showcase's example pieces (src/catalog/example.ts) as item pages, so the item view, the quote builder and the
// catalog blocks' links can be seen and checked without a catalog. Built like /blocks (finish-build removes it from a
// production build) and never indexed.
export const dynamicParams = false;

export function generateStaticParams() {
  return exampleCatalog.items.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = exampleCatalog.items.find((candidate) => candidate.slug === slug);
  if (!item) return {};
  const view = itemView(item);
  return pageMetadata({ title: view.name, description: view.description.slice(0, 170), path: `${SHOWCASE_CATALOG_PATH}/${slug}`, noindex: true });
}

export default async function ShowcaseItemPage({ params }: Props) {
  const { slug } = await params;
  const item = exampleCatalog.items.find((candidate) => candidate.slug === slug);
  if (!item) notFound();
  return <CatalogItemView view={itemView(item)} catalog={getShowcaseCatalog()} />;
}
