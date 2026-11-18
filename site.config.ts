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
    name: "[[Business name]]",
    /** Optional. Empty means the business name is used. */
    legalName: "",
    tagline: "[[Tagline]]",
    /** The positioning line. Feeds the JSON-LD description. */
    oneLiner: "[[One-line description of the business]]",
    copyrightYear: 2026,
  },
  owner: {
    name: "[[Owner name]]",
    givenName: "[[Owner first name]]",
    familyName: "[[Owner last name]]",
    role: "[[Owner role]]",
    phone: "[[Phone number]]",
    regionLine: "[[Region]]",
  },
  domain: {
    // CLIENT: replace. A real URL is required so the build can run; check:placeholders fails while it is example.com.
    url: "https://example.com",
    // T4: still the first client's Worker name; the Worker (worker/env.ts) hard-codes it too.
    workerName: "huston-site",
    previewHostSuffix: ".workers.dev",
  },
  contact: {
    // T4 (generic Worker): the five values below are still the first client's. The Worker code and its tests read
    // them, so they stay until T4 makes the Worker generic.
    /** From, notify To and Reply-To. */
    siteEmail: "grant@hustonlogic.com" as string | null,
    /** Display name on the notification email. */
    fromName: "Huston Logic",
    /** Display name on the automatic reply. */
    replyFromName: "Grant Huston",
    schedulerUrl: "https://calendar.app.google/ZEcZAf9NdPn59i579" as string | null,
    bookingFallbackPath: "/contact#book",
    // CLIENT: replace. null means not chosen yet; check:placeholders fails while it is null.
    linkedInUrl: null as string | null,
    /** Cloudflare Turnstile site key for the contact form. Public by design: it ships in the page. */
    turnstileSiteKey: null as string | null,
    sheetTabs: { production: "Submissions", preview: "Preview" },
    rateLimit: {
      limit: 5,
      periodSeconds: 60,
      /** Must be unique per Cloudflare account. */
      namespaceIds: { production: "1001", preview: "1002" },
    },
  },
  theme: {
    // CLIENT: replace. A neutral grey and blue palette; every pair keeps WCAG AA contrast.
    colors: {
      silver: "#f5f5f4",
      silver2: "#e7e5e4",
      white: "#ffffff",
      ink: "#1c1917",
      ink2: "#44403c",
      green: "#1e4fa3",
      greenDeep: "#173b7a",
      greenEdge: "#5b85c9",
      tint: "#e8eefa",
      glow: "#c3d4f0",
      mint: "#d5e1f5",
      rust: "#9a3412",
      line: "#d6d3d1",
    },
    // CLIENT: replace. next/font/google families. `weights: "variable"` loads the one variable file. The OG fonts in
    // src/assets/og must match the display family.
    fonts: {
      display: { family: "Outfit", weights: "variable" },
      body: { family: "Inter", weights: "variable" },
      accent: { family: "Newsreader", style: "italic", axes: ["opsz"] },
    },
  },
  /** Published price text. Empty means none is published (not a launch blocker). */
  prices: { website: "" },
  /** Extra origins appended to the CSP in public/_headers. */
  csp: {
    extraScriptSrc: [] as string[],
    extraConnectSrc: [] as string[],
    extraFrameSrc: [] as string[],
  },
  analytics: { cloudflareWebAnalytics: true },
} as const;
