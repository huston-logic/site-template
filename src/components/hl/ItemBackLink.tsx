"use client";

import { useEffect, useState } from "react";
import { catalogWords } from "@/content/catalog";
import { RETURN_KEY } from "@/blocks/catalog-filtering";
import { HlLink } from "./HlLink";

/**
 * The way back to the gallery. Without JavaScript it is a plain link to the catalog page; with it, when the visitor came
 * from a filtered view, it returns to that view (the island saved the address's query in sessionStorage).
 */
export function ItemBackLink({ pagePath, plural }: { pagePath: string; plural: string }) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(RETURN_KEY) ?? "";
      // Only an address this gallery wrote: a query of filter ids, never anything else.
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after mount. */
      setSearch(/^\?[a-z0-9=,&-]+$/.test(saved) ? saved : "");
    } catch {
      // Storage can be blocked; the plain link still works.
    }
  }, []);
  return (
    <HlLink href={`${pagePath}${search}`} className="inline-flex min-h-11 items-center font-ui font-medium text-green">
      <span className="hl-u">{search === "" ? catalogWords.backToCatalog(plural) : catalogWords.backToFiltered}</span>
    </HlLink>
  );
}
