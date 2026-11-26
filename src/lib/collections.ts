// The collection items a build shows. Server only. Drafts show outside production builds; archived items never show.
import { collectionFor } from "../collections/definitions.ts";
import type { CollectionKind, LoadedItem } from "../collections/schema.ts";
import { sortItems, visibleItems } from "../collections/validate.ts";
import { showDrafts } from "./drafts.ts";
import { getSiteContent } from "./site-content.ts";

/** The visible items of one kind in that kind's order. Pure: the loaders pass the content and whether drafts show. */
export function pickItems(all: readonly LoadedItem[], kind: CollectionKind, drafts: boolean): LoadedItem[] {
  const def = collectionFor(kind);
  const ofKind = all.filter((item) => item.kind === kind);
  return def === undefined ? [] : sortItems(def, visibleItems(ofKind, { drafts }));
}

export function getItems(kind: CollectionKind): LoadedItem[] {
  return pickItems(getSiteContent().items, kind, showDrafts());
}

export function getItem(kind: CollectionKind, slug: string): LoadedItem | undefined {
  return getItems(kind).find((item) => item.slug === slug);
}
