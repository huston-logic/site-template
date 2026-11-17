/**
 * Every per-client value for the site, in one place. This file imports nothing, so the Next.js site, the contact Worker
 * and plain Node scripts (scripts/sync-config.mjs, scripts/check-placeholders.mjs) can all read it.
 *
 * Four files cannot import TypeScript and are generated from this file: wrangler.jsonc, public/_headers, the :root
 * palette in src/app/hl.css and src/lib/fonts.ts. After editing a value that feeds one of them, run
 * `npm run sync:config` and commit the result; `npm run check:config` fails if they drift.
 *
 * Unknown values are written as [[double-bracket placeholders]]; `npm run build:launch` fails on any left in this file.
 */
export const siteConfig = {
  business: {
    name: "Huston Logic",
    /** Optional. Empty means the business name is used. */
    legalName: "",
    tagline: "Custom websites and workflows, from hello to handled.",
    /** The positioning line (docs/website-plan.md, A1). Feeds the JSON-LD description. */
    oneLiner:
      "Huston Logic builds custom websites and fixes the workflows behind them, for small businesses and solo pros. One person does the work, from the first call to the handoff.",
    copyrightYear: 2026,
  },
  owner: {
    name: "Grant Huston",
    givenName: "Grant",
    familyName: "Huston",
    role: "Founder",
    phone: "+1-949-702-2626",
    regionLine: "Based in Southern California",
    /** The public path of the contact card and the file name phones save it under (public/_headers sets the latter). */
    vcardPath: "/grant.vcf",
    vcardFileName: "Grant-Huston.vcf",
  },
  domain: {
    url: "https://hustonlogic.com",
    workerName: "huston-site",
    previewHostSuffix: ".workers.dev",
  },
  contact: {
    /** From, notify To and Reply-To. */
    siteEmail: "grant@hustonlogic.com" as string | null,
    /** Display name on the notification email. */
    fromName: "Huston Logic",
    /** Display name on the automatic reply. */
    replyFromName: "Grant Huston",
    schedulerUrl: "https://calendar.app.google/ZEcZAf9NdPn59i579" as string | null,
    bookingFallbackPath: "/contact#book",
    linkedInUrl: "https://www.linkedin.com/in/granthuston/" as string | null,
    /** Cloudflare Turnstile site key for the contact form. Public by design: it ships in the page. */
    turnstileSiteKey: "0x4AAAAAAGC2jlwc5dlTN92W" as string | null,
    sheetTabs: { production: "Submissions", preview: "Preview" },
    rateLimit: {
      limit: 5,
      periodSeconds: 60,
      /** Must be unique per Cloudflare account. */
      namespaceIds: { production: "1001", preview: "1002" },
    },
  },
  theme: {
    colors: {
      silver: "#f3f5f4",
      silver2: "#e8eeea",
      white: "#ffffff",
      ink: "#29332d",
      ink2: "#4a5750",
      green: "#2b6455",
      greenDeep: "#1e4a3d",
      greenEdge: "#4e9a7c",
      tint: "#e6f1eb",
      glow: "#b4dec8",
      mint: "#cde6d8",
      rust: "#994d34",
      line: "#d3dad6",
    },
    /** next/font/google families. `weights: "variable"` loads the one variable file. The OG fonts in src/assets/og must match the display family. */
    fonts: {
      display: { family: "Outfit", weights: "variable" },
      body: { family: "Inter", weights: "variable" },
      accent: { family: "Newsreader", style: "italic", axes: ["opsz"] },
    },
  },
  brand: {
    badge: "/brand/huston-logic-badge-black.svg",
    wordmark: "/brand/huston-logic-wordmark-black.svg",
    full: "/brand/huston-logic-full-black.svg",
    headshot: "/brand/grant-huston.webp",
  },
  /** Published price text. Empty means none is published (not a launch blocker). */
  prices: { website: "$750" },
  /** Extra origins appended to the CSP in public/_headers. */
  csp: {
    extraScriptSrc: [] as string[],
    extraConnectSrc: [] as string[],
    extraFrameSrc: [] as string[],
  },
  analytics: { cloudflareWebAnalytics: true },
} as const;
