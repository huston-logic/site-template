import type { ReactNode } from "react";
import type { LoadedItem } from "../collections/schema";

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
  /** The visible items of the collection a list block reads (already sorted); empty for other blocks. */
  items: readonly LoadedItem[];
};

/** Any block component. `never` lets each component keep its own content type. */
export type BlockComponent = (props: BlockProps<never>) => ReactNode;
