import type { Metadata } from "next";
import { Button } from "@/components/hl/Button";
import { ClosingCta } from "@/components/hl/ClosingCta";
import { PageHero } from "@/components/hl/PageHero";
import { ReasonList } from "@/components/hl/ReasonList";
import { bookCallHref } from "@/components/ui/BookCallButton";
import { closingCta, hero, highlights, homeMeta } from "@/content/home";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({ ...homeMeta, path: "/" });

/** Home: one H1 (the hero), then a highlights list and the closing call to action. */
export default function HomePage() {
  return (
    <div className="relative overflow-x-clip">
      <PageHero eyebrow={hero.eyebrow} title={hero.title} intro={hero.intro}>
        <Button href={bookCallHref()}>{hero.cta}</Button>
      </PageHero>
      <ReasonList id="highlights" heading={highlights.heading} items={highlights.items} />
      <ClosingCta heading={closingCta.heading} body={closingCta.body} note={closingCta.note}>
        <Button href={bookCallHref()}>{closingCta.cta}</Button>
      </ClosingCta>
    </div>
  );
}
