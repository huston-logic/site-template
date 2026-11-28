import { Container } from "@/components/hl/Container";
import { TextLink } from "@/components/hl/TextLink";
import { Text } from "@/components/ui/Text";
import { bookingWords } from "@/content/booking";
import { lengthText, priceParts } from "@/lib/booking-flow";
import type { BlockProps, BookingView } from "@/blocks/types";
import type { ContentOf } from "@/blocks/schema";
import type { bookingDefinition } from "./definition";
import { BookingFlowSlot } from "@/blocks/library/booking/flow-slot";

const panelClass = "rounded-panel bg-white p-6 shadow-card md:p-9";

/** How to reach the owner, for a visitor who cannot use the flow. */
function GetInTouch({ contact }: { contact: BookingView["contact"] }) {
  const words = bookingWords.noScript;
  return (
    <div className="mt-6">
      <TextLink href={contact.href}>{bookingWords.contactLink}</TextLink>
      {contact.email || contact.phone ? (
        <dl className="mt-2 space-y-1 text-list">
          {contact.email ? (
            <div className="flex gap-3">
              <dt className="font-ui font-medium text-ink-2">{words.emailLabel}</dt>
              <dd>
                <a href={`mailto:${contact.email}`} className="underline">
                  {contact.email}
                </a>
              </dd>
            </div>
          ) : null}
          {contact.phone ? (
            <div className="flex gap-3">
              <dt className="font-ui font-medium text-ink-2">{words.phoneLabel}</dt>
              <dd>{contact.phone}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * The booking flow in a panel under its heading. Settings come from the renderer (the site's booking.json, or the example on
 * the showcase). Without JavaScript the panel lists the live services and says how to get in touch; with it the flow takes
 * the panel over. While visitors cannot book it shows only the closed note.
 */
export function BookingBlock({ content, anchor, headingId, booking }: BlockProps<ContentOf<typeof bookingDefinition.fields>>) {
  if (booking === undefined) return null;
  const { settings, currency, contact } = booking;
  const open = settings.taking && settings.services.length > 0;
  return (
    <section id={anchor} aria-labelledby={headingId} className="scroll-mt-24">
      <Container>
        <div className="mx-auto max-w-faq">
          {open ? (
            <>
              <h2 id={headingId} className="font-ui text-h2 font-bold">
                <Text>{content.heading}</Text>
              </h2>
              {content.intro ? (
                <p className="mt-4 max-w-narrow text-body">
                  <Text>{content.intro}</Text>
                </p>
              ) : null}
              <div className="mt-8">
                <BookingFlowSlot view={booking} service={content.service} />
                <noscript>
                  <div className={panelClass}>
                    <h3 className="font-ui text-card-title font-bold">{bookingWords.noScript.heading}</h3>
                    <p className="mt-3 max-w-narrow text-body">{bookingWords.noScript.body}</p>
                    <ul className="mt-6 divide-y divide-hairline border-y border-hairline">
                      {settings.services.map((service) => {
                        const price = priceParts(service, currency ?? "usd");
                        return (
                          <li key={service.id} className="py-4">
                            <p className="font-ui text-item font-bold">
                              <Text>{service.name}</Text>
                            </p>
                            <p className="mt-1 text-list">
                              <Text>{service.description}</Text>
                            </p>
                            <p className="mt-1 text-small text-ink-2">
                              {lengthText(service)}. {price.price}
                              {price.terms ? `, ${price.terms}` : ""}.
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                    <GetInTouch contact={contact} />
                  </div>
                </noscript>
              </div>
            </>
          ) : (
            <div className={panelClass}>
              <h2 id={headingId} className="font-ui text-card-title font-bold">
                {bookingWords.closed.heading}
              </h2>
              <p className="mt-3 max-w-narrow text-body">{bookingWords.closed.body}</p>
              <GetInTouch contact={contact} />
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
