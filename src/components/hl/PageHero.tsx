import type { ReactNode } from "react";
import { Text } from "@/components/ui/Text";
import { Container } from "./Container";
import { Eyebrow } from "./Eyebrow";
import { Glow } from "./Glow";

type HeroContentProps = {
  /** A string is rendered with `Text`; a node (for example a date in a `time`) is used as given. */
  eyebrow?: ReactNode;
  /** The page's single H1. A string is rendered with `Text`, so [[placeholders]] show as markers. */
  title: ReactNode;
  intro?: ReactNode;
  /** The call to action this page's copy gives it. */
  children?: ReactNode;
  /** H1 for a page's own hero; the block showcase shows further heroes as H2. */
  headingLevel?: "h1" | "h2";
  headingId?: string;
};

const asText = (node: ReactNode) => (typeof node === "string" ? <Text>{node}</Text> : node);

/** The words of a page's top: left-aligned eyebrow, heading, intro and action. No section, padding or glow: the caller adds those. */
export function HeroContent({ eyebrow, title, intro, children, headingLevel = "h1", headingId }: HeroContentProps) {
  const Heading = headingLevel;
  return (
    <Container className="relative z-10">
      {eyebrow ? (
        <Eyebrow>
          {asText(eyebrow)}
        </Eyebrow>
      ) : null}
      <Heading id={headingId} className={`${eyebrow ? "mt-4.5 " : ""}max-w-title font-ui text-page-title font-bold`}>
        {asText(title)}
      </Heading>
      {intro ? <p className="mt-6 max-w-intro text-body">{asText(intro)}</p> : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </Container>
  );
}

type PageHeroProps = Omit<HeroContentProps, "headingLevel" | "headingId">;

/** Top of a code page (thanks, 404): the hero words with their own spacing and a soft glow in the top-right corner. Static. */
export function PageHero(props: PageHeroProps) {
  return (
    <section className="relative pb-16 pt-18">
      <Glow variant="green" className="hl-glow-hero" />
      <HeroContent {...props} />
    </section>
  );
}
