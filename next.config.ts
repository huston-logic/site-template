import type { NextConfig } from "next";
import { siteConfig } from "./site.config";
import { trackingForBuild } from "./src/tracking/config";

// With tags, the layout's tag slot loads the real loader; without, it stays the empty one (src/tracking/tags-slot.tsx).
const tagsAlias: Record<string, string> = trackingForBuild(siteConfig, process.env) ? { "@/tracking/tags-slot": "./src/tracking/tags-slot-on.tsx" } : {};

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    resolveAlias: tagsAlias,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
