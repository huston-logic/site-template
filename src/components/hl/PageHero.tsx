import type { ReactNode } from "react";
import { Text } from "@/components/ui/Text";
import { Container } from "./Container";
import { Eyebrow } from "./Eyebrow";
import { Glow } from "./Glow";

type PageHeroProps = {
  eyebrow?: string;
  /** The page's single H1. A string is rendered with `Text`, so [[placeholders]] show as markers. */
  title: ReactNode;
  intro?: ReactNode;
  /** The call to action this page's copy gives it. */
  children?: ReactNode;
};

const asText = (node: ReactNode) => (typeof node === "string" ? <Text>{node}</Text> : node);

/** Top of every page: left-aligned eyebrow, H1, intro and action, with a soft glow in the top-right corner. Static. */
export function PageHero({ eyebrow, title, intro, children }: PageHeroProps) {
  return (
    <section className="relative pb-16 pt-18">
      <Glow variant="green" className="hl-glow-hero" />
      <Container className="relative z-10">
        {eyebrow ? (
          <Eyebrow>
            <Text>{eyebrow}</Text>
          </Eyebrow>
        ) : null}
        <h1 className={`${eyebrow ? "mt-4.5 " : ""}max-w-title font-ui text-page-title font-bold`}>{asText(title)}</h1>
        {intro ? <p className="mt-6 max-w-intro text-body">{asText(intro)}</p> : null}
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </section>
  );
}
