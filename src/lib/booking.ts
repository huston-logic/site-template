// The booking a build shows: the settings (live services), the details form, the currency and the ways to reach the owner. Server only.
import { siteConfig } from "../../site.config.ts";
import bookingFile from "../content/booking.json";
import { bookingForBuild } from "../booking/config.ts";
import { exampleBooking } from "../booking/example.ts";
import { BOOKING_BLOCK, BOOKING_FORM_ID } from "../booking/schema.ts";
import type { BookingSettings } from "../booking/schema.ts";
import { liveServices } from "../booking/validate.ts";
import type { BookingView } from "../blocks/types.ts";
import { providers } from "../content/providers.ts";
import { paymentsForBuild } from "../payments/config.ts";
import { telHref } from "../settings/business.ts";
import { formById, viewProps } from "./forms.ts";
import { getPages } from "./pages";
import { getSiteContent } from "./site-content";

const PLACEHOLDER = /\[\[[^\]]+\]\]/;
const usable = (text: string | null | undefined): string | null => (typeof text === "string" && text.trim() !== "" && !PLACEHOLDER.test(text) ? text : null);

const withLiveServices = (settings: BookingSettings): BookingSettings => ({ ...settings, services: liveServices(settings) });

/** The booking details form (src/content/forms/booking.json) as the browser may see it, or null while it is archived or unreadable. */
function bookingForm(): BookingView["form"] | null {
  const definition = formById(BOOKING_FORM_ID);
  return definition === null ? null : viewProps(BOOKING_FORM_ID, definition).form;
}

function contactFor(business: { email: string; phone: string }): BookingView["contact"] {
  return { href: "/contact", email: usable(providers.email) ?? usable(business.email), phone: telHref(business.phone) === null ? null : usable(business.phone) };
}

/** The currency this build charges in, or null while payments are off. */
const currencyForBuild = () => paymentsForBuild(siteConfig, process.env)?.currency ?? null;

/** The site's booking settings (src/content/booking.json, live services only), or null while the details form is missing. */
export function getBooking(): BookingView | null {
  const form = bookingForm();
  if (form === null) return null;
  const { giftCards, business } = getSiteContent();
  const settings = withLiveServices(bookingFile as unknown as BookingSettings);
  const currency = currencyForBuild();
  const line = usable(settings.giftCardLine);
  return {
    settings,
    currency,
    timeZone: siteConfig.business.timeZone,
    form,
    giftCardLine: giftCards.selling && currency !== null ? line : null,
    contact: contactFor(business),
  };
}

/** The example settings the block showcase shows (src/booking/example.ts): booking on, selling the two example services. */
export function getShowcaseBooking(): BookingView | null {
  const form = bookingForm();
  if (form === null) return null;
  return {
    settings: withLiveServices(exampleBooking),
    currency: "usd",
    timeZone: "America/Chicago",
    form,
    giftCardLine: exampleBooking.giftCardLine,
    contact: contactFor(getSiteContent().business),
  };
}

/** The owner's first name for the thank-you page ("Ada will contact you"), or null while it is still a placeholder. */
export function ownerGivenName(): string | null {
  return usable(siteConfig.owner.givenName);
}

/** The path of the one live page that holds the booking block, or null when there is none. */
export function bookingPagePath(): string | null {
  return getPages().find((page) => page.blocks.some((block) => block.type === BOOKING_BLOCK))?.path ?? null;
}

/** "Book a time" for a catalog piece: the booking page with the piece in the address, only while this build books, visitors can book and a live page holds the block. */
export function bookingItemHref(slug: string): string | null {
  if (bookingForBuild(siteConfig, process.env) === null) return null;
  const settings = bookingFile as unknown as BookingSettings;
  if (!settings.taking || liveServices(settings).length === 0) return null;
  const path = bookingPagePath();
  return path === null ? null : `${path}?item=${encodeURIComponent(slug)}`;
}
