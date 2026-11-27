import Image from "next/image";
import { cardPathFor } from "@/catalog/schema";
import type { CatalogSettings, PricingTable } from "@/catalog/schema";
import { Text } from "@/components/ui/Text";
import { catalogWords } from "@/content/catalog";
import { cardPrice, quietFacts, type ItemView } from "./catalog-data";
import { HlLink } from "./HlLink";

const SIZES = {
  grid: "(min-width: 1320px) 300px, (min-width: 1024px) 23vw, 50vw",
  showcase: "(min-width: 1320px) 420px, (min-width: 1024px) 30vw, 100vw",
} as const;

const FOCUS = { center: "object-center", top: "object-top", bottom: "object-bottom", left: "object-left", right: "object-right" } as const;

/** The small word beside an estimate, and the tag a draft carries outside production. */
export function EstimateTag() {
  return <span className="rounded-pill border border-ink-2 px-2.5 py-1 font-ui text-tag font-medium text-ink-2">{catalogWords.estimateTag}</span>;
}
export function CatalogDraftTag() {
  return <span className="rounded-pill border border-rust px-2.5 py-1 text-tag font-medium text-rust">{catalogWords.draftTag}</span>;
}

type CardProps = {
  view: ItemView;
  /** The address of the piece's page. */
  href: string;
  settings: CatalogSettings;
  pricing: PricingTable;
  variant: "grid" | "showcase";
  /** Position in the grid, for the order the island keeps. */
  index: number;
  /** True for the first row: its photos load at once, the rest when they near the screen. */
  eager: boolean;
};

/**
 * One piece in the gallery. It is a list item the filter island shows and hides by its `data-` values (`data-f-<filter>`
 * holds the value ids, `data-order` its place), so nothing about a card is drawn again in the browser. The name is the
 * link and stretches over the whole card. Only the cover's card file loads (spec R8).
 */
export function CatalogCard({ view, href, settings, pricing, variant, index, eager }: CardProps) {
  const cover = view.photos[0];
  const price = cardPrice(view, pricing);
  const filterData = Object.fromEntries(settings.filters.map((filter) => [`data-f-${filter.id}`, (view.filters[filter.id] ?? []).join(" ")]));
  const showcase = variant === "showcase";
  const facts = showcase ? quietFacts(view, settings, 2) : "";
  return (
    <li data-card="" data-order={index} {...filterData} className="hl-card relative">
      <div className="hl-card-frame rounded-card">
        {cover ? (
          <Image
            src={cardPathFor(cover.src)}
            alt={cover.alt}
            width={720}
            height={900}
            sizes={SIZES[variant]}
            loading={eager ? "eager" : "lazy"}
            // The first card is usually the page's largest first-screen element, so its photo is asked for first.
            fetchPriority={index === 0 ? "high" : undefined}
            className={`aspect-photo-4-5 w-full rounded-card bg-tint object-cover ${FOCUS[cover.focus ?? "center"]}`}
          />
        ) : null}
      </div>
      <h3 className={`mt-4 font-ui font-semibold ${showcase ? "text-subhead" : "text-item"}`}>
        <HlLink href={href} className="after:absolute after:inset-0">
          <span className="hl-u">
            <Text>{view.name}</Text>
          </span>
        </HlLink>
      </h3>
      {facts ? <p className="mt-1 text-list text-ink-2">{facts}</p> : null}
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-list text-ink-2">
        <span>{price.text}</span>
        {price.isEstimate ? <EstimateTag /> : null}
        {view.draft ? <CatalogDraftTag /> : null}
      </p>
    </li>
  );
}
