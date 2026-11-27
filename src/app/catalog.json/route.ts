import { getCatalogData } from "@/lib/catalog";

// The one file the contact Worker reads prices from (docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md, R9, R15):
// the pricing table, the item word, the catalog page and every visible piece's name, price, options and per-person flag.
// Written at build time, also for a site with no catalog (no page, no pieces).
export const dynamic = "force-static";

export function GET() {
  return Response.json(getCatalogData());
}
