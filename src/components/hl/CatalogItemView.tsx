import type { PricingTable } from "@/catalog/schema";
import { catalogWords } from "@/content/catalog";
import type { CatalogView } from "@/blocks/types";
import { Text } from "@/components/ui/Text";
import { CatalogDraftTag, EstimateTag } from "./CatalogCard";
import { cardPrice, factsOf, type ItemView } from "./catalog-data";
import { Container } from "./Container";
import { Eyebrow } from "./Eyebrow";
import { Glow } from "./Glow";
import { ItemBackLink } from "./ItemBackLink";
import { ItemPhotos } from "./ItemPhotos";
import { QuoteBuilder } from "./QuoteBuilder";
import { TextLink } from "./TextLink";
import { ViewItemTracker } from "./ViewItemTracker";

/** The pricing table with only this piece's exact prices, so the browser is sent no other piece's figures. */
export function pricingFor(pricing: PricingTable, slug: string): PricingTable {
  const own = pricing.exact[slug];
  return { ...pricing, exact: own === undefined ? {} : { [slug]: own } };
}

/**
 * A piece's own page (spec R12): the way back, the photos, the name as the page's one H1, the description, its facts
 * between hairlines and the quote builder. Photos left and details right from 900px up (the details stay in view while
 * the photos are long); stacked on phones. Without JavaScript the details show the default estimate and the contact route.
 */
export function CatalogItemView({ view, catalog }: { view: ItemView; catalog: CatalogView }) {
  const { settings, pricing, pagePath, quote } = catalog;
  const facts = factsOf(view, settings);
  const eyebrow = facts[0]?.labels[0];
  const price = cardPrice(view, pricing);
  return (
    <article className="relative overflow-x-clip pb-16 pt-10 md:pb-24 md:pt-14">
      <Glow variant="green" className="hl-glow-hero" />
      <ViewItemTracker slug={view.slug} name={view.name} />
      <Container className="relative z-10">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {pagePath === null ? null : <ItemBackLink pagePath={pagePath} plural={settings.itemWord.plural} />}
          {view.draft ? <CatalogDraftTag /> : null}
        </nav>
        <div className="mt-6 grid items-start gap-10 split:grid-cols-[7fr_5fr] split:gap-14">
          <ItemPhotos photos={view.photos} />
          <div className="split:sticky split:top-28">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            <h1 className={`${eyebrow ? "mt-4.5 " : ""}font-ui text-page-title font-bold`}>
              <Text>{view.name}</Text>
            </h1>
            <p className="mt-6 max-w-narrow text-body">
              <Text>{view.description}</Text>
            </p>
            {facts.length > 0 ? (
              <dl className="mt-8 border-t border-hairline">
                {facts.map((fact) => (
                  <div key={fact.name} className="grid grid-cols-[7rem_1fr] gap-x-4 border-b border-hairline py-3">
                    <dt className="font-ui text-label font-medium text-ink-2">{fact.name}</dt>
                    <dd className="text-list">{fact.labels.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="mt-10">
              <QuoteBuilder
                pricing={pricingFor(pricing, view.slug)}
                items={[{ slug: view.slug, name: view.name, price: view.price, options: view.options, perPerson: view.perPerson }]}
                initialSlug={view.slug}
                itemWord={settings.itemWord}
                quote={quote}
                headingLevel="h2"
              />
              <noscript>
                <div className="rounded-panel bg-white p-6 shadow-card md:p-9">
                  <p className="font-ui text-label font-medium text-ink-2">{catalogWords.quote.estimateLabel}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="font-ui text-h3 font-bold">{price.text}</p>
                    {price.isEstimate ? <EstimateTag /> : null}
                  </div>
                  <p className="mt-3 max-w-narrow text-small text-ink-2">{pricing.note}</p>
                  <p className="mt-6 text-body">{catalogWords.quote.noScript}</p>
                  <div className="mt-2">
                    <TextLink href="/contact">{catalogWords.contactRoute}</TextLink>
                  </div>
                </div>
              </noscript>
            </div>
          </div>
        </div>
      </Container>
    </article>
  );
}
