import { catalogWords } from "@/content/catalog";
import { itemView, pricingForItems } from "@/components/hl/catalog-data";
import { Container } from "@/components/hl/Container";
import { QuoteBuilder } from "@/components/hl/QuoteBuilder";
import { TextLink } from "@/components/hl/TextLink";
import { Text } from "@/components/ui/Text";
import type { BlockProps } from "@/blocks/types";
import type { ContentOf } from "@/blocks/schema";
import type { quoteBuilderDefinition } from "./definition";

/**
 * A panel to choose a piece, its options and see the estimate, then ask for a quote. A named piece is preselected;
 * without one the visitor picks from a list of every visible piece. The renderer leaves the block out while no piece is visible.
 */
export function QuoteBuilderBlock({
  content,
  variant,
  anchor,
  headingId,
  catalog,
}: BlockProps<ContentOf<typeof quoteBuilderDefinition.fields>>) {
  if (catalog === undefined || catalog.items.length === 0) return null;
  const { settings, pricing, quote } = catalog;
  const views = catalog.items.map(itemView);
  const preselected =
    content.item !== undefined &&
    views.some((view) => view.slug === content.item)
      ? content.item
      : null;
  // Only what the panel reads goes to the browser: the preselected piece alone, or each visible piece's own figures.
  const forBrowser =
    preselected === null
      ? views
      : views.filter((view) => view.slug === preselected);
  const beside = variant === "beside";
  const text = (
    <>
      <h2 id={headingId} className="font-ui text-h2 font-bold">
        <Text>{content.heading}</Text>
      </h2>
      {content.intro ? (
        <p className="mt-4 max-w-narrow text-body">
          <Text>{content.intro}</Text>
        </p>
      ) : null}
    </>
  );
  const builder = (
    <>
      <QuoteBuilder
        pricing={pricingForItems(
          pricing,
          forBrowser.map((view) => view.slug),
        )}
        items={forBrowser.map((view) => ({
          slug: view.slug,
          name: view.name,
          price: view.price,
          options: view.options,
          perPerson: view.perPerson,
        }))}
        initialSlug={preselected}
        itemWord={settings.itemWord}
        quote={quote}
        headingLevel="h3"
      />
      <noscript>
        <div className="rounded-panel bg-white p-6 shadow-card md:p-9">
          <p className="text-body">{catalogWords.quote.noScript}</p>
          <div className="mt-2">
            <TextLink href="/contact">{catalogWords.contactRoute}</TextLink>
          </div>
        </div>
      </noscript>
    </>
  );
  return (
    <section id={anchor} aria-labelledby={headingId} className="scroll-mt-24">
      <Container>
        {beside ? (
          <div className="grid items-start gap-10 split:grid-cols-[5fr_7fr] split:gap-14">
            <div>{text}</div>
            <div>{builder}</div>
          </div>
        ) : (
          <div className="mx-auto max-w-faq">
            <div className="mb-8">{text}</div>
            {builder}
          </div>
        )}
      </Container>
    </section>
  );
}
