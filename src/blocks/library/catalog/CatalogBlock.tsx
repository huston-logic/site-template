import { itemPathFor } from "@/catalog/schema";
import { CatalogCard } from "@/components/hl/CatalogCard";
import { itemView } from "@/components/hl/catalog-data";
import { Container } from "@/components/hl/Container";
import { TextLink } from "@/components/hl/TextLink";
import { Text } from "@/components/ui/Text";
import { catalogWords } from "@/content/catalog";
import type { BlockProps } from "@/blocks/types";
import type { ContentOf } from "@/blocks/schema";
import { CatalogFilters } from "./CatalogFilters";
import type { catalogDefinition } from "./definition";

const COLUMNS = {
  grid: "grid-cols-2 gap-x-4 gap-y-9 md:gap-x-6 md:gap-y-12 lg:grid-cols-4",
  showcase: "grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3",
} as const;
/** How many cards are in the first row at the widest layout: their photos load at once. */
const FIRST_ROW = { grid: 4, showcase: 3 } as const;

/**
 * Every visible piece as a card, drawn by the server in the owner's order, so without JavaScript the whole catalog lists
 * and every card links to its page. The filter island shows and hides these cards by their `data-` values; with JavaScript
 * the cards after the 24th are hidden by the stylesheet before first paint, so nothing shifts when the island starts.
 * The renderer leaves the block out while no piece is visible.
 */
export function CatalogBlock({ content, variant, anchor, headingId, catalog }: BlockProps<ContentOf<typeof catalogDefinition.fields>>) {
  if (catalog === undefined || catalog.pagePath === null) return null;
  const kind = variant === "showcase" ? "showcase" : "grid";
  const { settings, pricing, pagePath } = catalog;
  const gridId = `${headingId}-grid`;
  const moreId = `${headingId}-more`;
  return (
    <section id={anchor} aria-labelledby={headingId} className="scroll-mt-24">
      <Container>
        <h2 id={headingId} className="font-ui text-h2 font-bold">
          <Text>{content.heading}</Text>
        </h2>
        {content.intro ? (
          <p className="mt-4 max-w-intro text-blurb">
            <Text>{content.intro}</Text>
          </p>
        ) : null}
        <div className="mt-10">
          <CatalogFilters
            filters={settings.filters.map((filter) => ({ id: filter.id, name: filter.name, values: filter.values.map((value) => ({ id: value.id, label: value.label })) }))}
            itemWord={settings.itemWord}
            total={catalog.items.length}
            gridId={gridId}
            moreId={moreId}
          />
          <noscript>
            <p className="mb-6 text-small text-ink-2">{catalogWords.noScript}</p>
          </noscript>
          <ul role="list" id={gridId} data-catalog-grid="" className={`mt-8 grid ${COLUMNS[kind]}`}>
            {catalog.items.map((item, index) => (
              <CatalogCard
                key={item.slug}
                view={itemView(item)}
                href={itemPathFor(pagePath, item.slug)}
                settings={settings}
                pricing={pricing}
                variant={kind}
                index={index}
                eager={index < FIRST_ROW[kind]}
              />
            ))}
          </ul>
          <div id={moreId} className="mt-10 empty:hidden" />
          <div className="mt-14 max-w-narrow border-t border-hairline pt-8">
            <p className="text-body">{catalogWords.askRouteBody}</p>
            <div className="mt-2">
              <TextLink href="/contact">{catalogWords.askRoute(settings.itemWord.singular)}</TextLink>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
