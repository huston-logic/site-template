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
    // CLIENT: replace. The Cloudflare Worker's name (wrangler.jsonc `name`). The contact Worker also uses it to tell the
    // production workers.dev host from branch previews.
    workerName: "[[Worker name]]",
    previewHostSuffix: ".workers.dev",
  },
  contact: {
    // CLIENT: replace. From, notify To and Reply-To. null means not set yet: check:placeholders fails, and the contact
    // Worker refuses to send (502) until it is set.
    siteEmail: null as string | null,
    /** Display name on the notification email. */
    fromName: "[[Notification sender name]]",
    /** Display name on the automatic reply. */
    replyFromName: "[[Auto-reply sender name]]",
    // CLIENT: replace. null means not chosen yet: check:placeholders fails, the contact page shows a placeholder, and the
    // contact Worker refuses to send (502) because the automatic reply needs a booking link.
    schedulerUrl: null as string | null,
    bookingFallbackPath: "/contact#book",
    // CLIENT: replace. null means not chosen yet; check:placeholders fails while it is null.
    linkedInUrl: null as string | null,
    /** Cloudflare Turnstile site key for the contact form. Public by design: it ships in the page. */
    turnstileSiteKey: null as string | null,
    /**
     * Which code saves each submission to the Google Sheet. "apps-script" (the default) posts to a Google Apps Script web
     * app (docs/apps-script/contact-sheet.gs); "service-account" signs in as a Google service account. The choice sets
     * which names wrangler.jsonc lists under secrets.required (see docs/SECRETS.md).
     */
    sheetWriter: "apps-script" as "apps-script" | "service-account",
    /** The two tab names in the Sheet. Generic names; the Apps Script reads the same two names from its Script Properties. */
    sheetTabs: { production: "Submissions", preview: "Preview" },
    /**
     * Where each submission is saved. "sheet" (the default) is the Google Sheet above, the fallback. "pipeline" posts it
     * server to server to the client's Pipeline app copy (`pipelineUrl` + "/intake", secret INTAKE_SECRET). The notification
     * email goes to `siteEmail` either way. Which secrets are required follows this setting (`npm run sync:config`).
     * Another tool the client names is not built; its one place in the code is `saveSubmission` in worker/contact.ts.
     */
    destination: "sheet" as "sheet" | "pipeline",
    /** The Pipeline app copy's https origin, such as "https://pipeline.example.com" (no path). Needed when destination is "pipeline". */
    pipelineUrl: null as string | null,
    rateLimit: {
      limit: 5,
      periodSeconds: 60,
    },
    // CLIENT: replace. Two whole numbers written as strings, unique to this site in its Cloudflare account: bindings with
    // the same id share counters, even across Workers. Take the next free pair from docs/HOSTING.md (new sites start at
    // 2001) and add the row there. 1001 and 1002 are the template's own; `npm run check:config` rejects them on a real site.
    rateLimitIds: { production: "1001", preview: "1002" },
  },
  /**
   * The owner's chat tools (docs/superpowers/specs/2026-11-25-owner-chat-tools-design.md). Off by default: while
   * `enabled` is false the Worker answers only /api/* and wrangler.jsonc gets none of the editor bindings. Owner-only
   * file: a chat change can never add an owner.
   */
  editor: {
    enabled: false,
    /** Who may sign in. Lower-cased when compared. Removing someone takes effect at the next deploy. */
    ownerEmails: [] as string[],
    /** Cloudflare Access: the team name only (for <team>.cloudflareaccess.com) and the Access app's AUD tag. Not secrets. */
    access: { teamDomain: null as string | null, aud: null as string | null },
    /** The GitHub App installed on this site's repo only. appId and installationId are digits written as strings. */
    github: {
      owner: null as string | null,
      repo: null as string | null,
      appId: null as string | null,
      installationId: null as string | null,
      botLogin: null as string | null,
    },
    /** The account's workers.dev subdomain, used to compute preview links. */
    workersSubdomain: null as string | null,
    dailyChangeLimit: 10,
    /** A whole number written as a string, unique in the Cloudflare account (docs/HOSTING.md). 1003 is the template's own. */
    rateLimitId: "1003",
    /** KV namespace ids (32 hex characters): OAuth tokens, and drafts with change times. */
    kv: { oauth: null as string | null, editor: null as string | null },
    /** Pull request checks that never count when judging whether a change is stuck. */
    ignoredChecks: ["change-report", "change-scope", "Workers Builds"] as string[],
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
  brand: {
    /** Optional. Site-relative path to the logo image, such as "/brand/logo.png". Empty means none (not a launch blocker). */
    logo: "",
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
