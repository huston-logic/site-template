import type { Metadata } from "next";
import { BookingThanks } from "@/components/hl/BookingThanks";
import { PageHero } from "@/components/hl/PageHero";
import { bookingWords } from "@/content/booking";
import { bookingPagePath, ownerGivenName } from "@/lib/booking";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: bookingWords.thanks.page.title,
  description: bookingWords.thanks.page.description,
  path: "/booking/thanks",
  noindex: true,
});

/** Where a booking ends: Stripe sends a paid booking here, and the flow sends a free one. The states are drawn in the browser from the Worker's answer (BookingThanks); without JavaScript the page says what happens anyway. */
export default function BookingThanksPage() {
  return (
    <div className="relative overflow-x-clip">
      <BookingThanks backHref={bookingPagePath() ?? "/"} ownerName={ownerGivenName()} />
      <noscript>
        <PageHero title={bookingWords.thanks.noScript.heading} intro={bookingWords.thanks.noScript.body} />
      </noscript>
    </div>
  );
}
