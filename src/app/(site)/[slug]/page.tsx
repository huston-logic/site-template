import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlockRenderer } from "@/blocks/BlockRenderer";
import { getPage, getPages } from "@/lib/pages";
import { pageMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ slug: string }> };

// Only the live pages in src/content/pages are built; any other address is the 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return getPages()
    .filter((page) => page.path !== "/")
    .map((page) => ({ slug: page.path.slice(1) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getPage(`/${slug}`);
  if (!page) return {};
  return pageMetadata({ title: page.title, description: page.description, path: page.path });
}

/** Every page except the home page: the blocks of its file in src/content/pages. */
export default async function SlugPage({ params }: Props) {
  const { slug } = await params;
  const page = getPage(`/${slug}`);
  if (!page) notFound();
  return <BlockRenderer blocks={page.blocks} />;
}
