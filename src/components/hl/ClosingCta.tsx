import type { ReactNode } from "react";
import { Text } from "@/components/ui/Text";
import { Container } from "./Container";
import { Glow } from "./Glow";

type ClosingCtaProps = {
  /** The heading text. */
  heading: string;
  body?: string;
  /** The action (a Button, optionally followed by a TextLink). */
  children: ReactNode;
  /** The microcopy line under the action. */
  note?: string;
};

/** Closing call to action: not a band; a seam glow blends it into the page. Left-aligned. */
export function ClosingCta({ heading, body, children, note }: ClosingCtaProps) {
  return (
    <section className="relative py-16 md:py-24">
      <Glow variant="seam" className="hl-glow-closing" />
      <Container className="relative z-10">
        <h2 className="max-w-heading font-ui text-h2 font-bold">
          <Text>{heading}</Text>
        </h2>
        {body ? (
          <p className="mt-4 max-w-intro text-blurb">
            <Text>{body}</Text>
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">{children}</div>
        {note ? (
          <p className="mt-6 text-label text-ink-2">
            <Text>{note}</Text>
          </p>
        ) : null}
      </Container>
    </section>
  );
}
