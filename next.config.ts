import type { NextConfig } from "next";
import { siteConfig } from "./site.config";
import { isProductionBuild } from "./src/lib/build-target";
import { paymentsForBuild } from "./src/payments/config";
import { trackingForBuild } from "./src/tracking/config";

// With tags, the layout's tag slot loads the real loader; without, it stays the empty one (src/tracking/tags-slot.tsx).
const tagsAlias: Record<string, string> = trackingForBuild(siteConfig, process.env) ? { "@/tracking/tags-slot": "./src/tracking/tags-slot-on.tsx" } : {};

// The gift card form ships only where it can be used: a build with payments on, or any build that is not production (so
// previews, CI and the showcase keep it). A production build with payments off has no gift card script (design R1).
const giftCardsOn = paymentsForBuild(siteConfig, process.env) !== null || !isProductionBuild(process.env, siteConfig.domain.productionBranch);
const giftCardAlias: Record<string, string> = giftCardsOn ? { "@/blocks/library/gift-card/form-slot": "./src/blocks/library/gift-card/form-slot-on.tsx" } : {};

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    resolveAlias: { ...tagsAlias, ...giftCardAlias },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
