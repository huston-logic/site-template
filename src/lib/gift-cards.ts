// The gift card settings a build shows, and the currency it charges in. Server only.
import { siteConfig } from "../../site.config.ts";
import type { GiftCardView } from "../blocks/types.ts";
import { exampleGiftCards } from "../gift-cards/example.ts";
import { GIFT_CARD_BLOCK } from "../gift-cards/schema.ts";
import { paymentsForBuild } from "../payments/config.ts";
import { getPages } from "./pages";
import { getSiteContent } from "./site-content";

/** The currency this build charges in. A build with payments off has none to charge in; the block only appears on the showcase then, so the template's usd stands in. */
const currencyForBuild = () => paymentsForBuild(siteConfig, process.env)?.currency ?? "usd";

/** The site's gift card settings (src/content/gift-cards.json) with the build's currency. */
export function getGiftCards(): GiftCardView {
  return { settings: getSiteContent().giftCards, currency: currencyForBuild() };
}

/** The example settings the block showcase shows (src/gift-cards/example.ts): selling on, so the form is what is seen. */
export function getShowcaseGiftCards(): GiftCardView {
  return { settings: exampleGiftCards, currency: currencyForBuild() };
}

/** The path of the one live page that holds the gift card block, or null when there is none (the thank-you page then links home). */
export function giftCardPagePath(): string | null {
  return getPages().find((page) => page.blocks.some((block) => block.type === GIFT_CARD_BLOCK))?.path ?? null;
}
