import type { Metadata } from "next";
import { GiftCardThanks } from "@/components/hl/GiftCardThanks";
import { PageHero } from "@/components/hl/PageHero";
import { giftCardWords } from "@/content/gift-cards";
import { giftCardPagePath } from "@/lib/gift-cards";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: giftCardWords.thanks.page.title,
  description: giftCardWords.thanks.page.description,
  path: "/gift-cards/thanks",
  noindex: true,
});

/** The page Stripe sends the buyer back to after paying. Its states are drawn in the browser from Stripe's own answer (GiftCardThanks); without JavaScript it says what happens anyway. */
export default function GiftCardThanksPage() {
  return (
    <div className="relative overflow-x-clip">
      <GiftCardThanks backHref={giftCardPagePath() ?? "/"} />
      <noscript>
        <PageHero title={giftCardWords.thanks.noScript.heading} intro={giftCardWords.thanks.noScript.body} />
      </noscript>
    </div>
  );
}
