import { Container } from "@/components/hl/Container";
import { GiftCardForm } from "@/components/hl/GiftCardForm";
import { TextLink } from "@/components/hl/TextLink";
import { Text } from "@/components/ui/Text";
import { giftCardWords } from "@/content/gift-cards";
import { providers } from "@/content/providers";
import type { BlockProps } from "@/blocks/types";
import type { ContentOf } from "@/blocks/schema";
import type { giftCardDefinition } from "./definition";

/**
 * The gift card form in a panel with its heading, the owner's redeem wording and terms line beside or under it. Settings come
 * from the renderer (the site's gift-cards.json, or the example on the showcase). While selling is off the block shows only
 * the closed note.
 */
export function GiftCardBlock({ content, variant, anchor, headingId, giftCards }: BlockProps<ContentOf<typeof giftCardDefinition.fields>>) {
  if (giftCards === undefined) return null;
  const { settings, currency } = giftCards;
  const beside = variant === "beside";
  if (!settings.selling) {
    return (
      <section id={anchor} aria-labelledby={headingId} className="scroll-mt-24">
        <Container>
          <div className="mx-auto max-w-faq rounded-panel bg-white p-6 shadow-card md:p-9">
            <h2 id={headingId} className="font-ui text-card-title font-bold">
              {giftCardWords.closedHeading}
            </h2>
            <p className="mt-3 max-w-narrow text-body">{giftCardWords.closedBody}</p>
            <div className="mt-2">
              <TextLink href="/contact">{giftCardWords.contactLink}</TextLink>
            </div>
          </div>
        </Container>
      </section>
    );
  }
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
  const terms = (
    <div className="space-y-2 text-small text-ink-2">
      <p>
        <Text>{settings.redeemWording}</Text>
      </p>
      <p>
        <Text>{settings.termsLine}</Text>
        {settings.validForMonths === null ? null : ` ${giftCardWords.validFor(settings.validForMonths)}`}
      </p>
    </div>
  );
  const form = (
    <>
      <GiftCardForm settings={settings} currency={currency} />
      <noscript>
        <div className="rounded-panel bg-white p-6 shadow-card md:p-9">
          <p className="text-body">
            {providers.email ? (
              <>
                {giftCardWords.noScript} <a href={`mailto:${providers.email}`} className="underline">{providers.email}</a>.
              </>
            ) : (
              giftCardWords.noScriptNoEmail
            )}
          </p>
        </div>
      </noscript>
    </>
  );
  return (
    <section id={anchor} aria-labelledby={headingId} className="scroll-mt-24">
      <Container>
        {beside ? (
          <div className="grid items-start gap-10 split:grid-cols-[5fr_7fr] split:gap-14">
            <div>
              {text}
              <div className="mt-6">{terms}</div>
            </div>
            <div>{form}</div>
          </div>
        ) : (
          <div className="mx-auto max-w-faq">
            <div className="mb-8">{text}</div>
            {form}
            <div className="mt-6">{terms}</div>
          </div>
        )}
      </Container>
    </section>
  );
}
