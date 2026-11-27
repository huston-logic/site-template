/**
 * Every per-client value for the site, in one place. This file imports nothing, so the Next.js site, the contact Worker
 * and plain Node scripts (scripts/sync-config.mjs, scripts/check-placeholders.mjs) can all read it.
 *
 * Four files cannot import TypeScript and are generated: wrangler.jsonc, public/_headers, the :root
 * palette in src/app/palette.css and src/lib/fonts.ts. The first two come from this file; the last two come from
 * src/content/brand.json. After editing a value that feeds one of them, run `npm run sync:config` and commit the
 * result; `npm run check:config` fails if they drift.
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
    // CLIENT: replace (IANA time zone, such as "America/Chicago"). The site notice's last day (src/content/notice.json) is
    // judged in this zone at build time. The business's other details (phone, email, address, hours, socials) are in
    // src/content/business.json.
    timeZone: "UTC",
  },
  owner: {
    name: "[[Owner name]]",
    givenName: "[[Owner first name]]",
    familyName: "[[Owner last name]]",
    role: "[[Owner role]]",
    regionLine: "[[Region]]",
  },
  domain: {
    // CLIENT: replace. A real URL is required so the build can run; check:placeholders fails while it is example.com.
    url: "https://example.com",
    // CLIENT: replace. The Cloudflare Worker's name (wrangler.jsonc `name`). The contact Worker also uses it to tell the
    // production workers.dev host from branch previews.
    workerName: "[[Worker name]]",
    previewHostSuffix: ".workers.dev",
    // The branch Workers Builds deploys to production. scripts/finish-build.mjs drops the /blocks showcase from builds of this branch.
    productionBranch: "main",
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
    /**
     * Colors the automatic reply email uses inline (an email cannot read the site's CSS). Wiring, not brand: they keep
     * their value when src/content/brand.json changes. CLIENT: match the brand's green, ink, ink2, rust and line.
     */
    emailColors: { green: "#1e4fa3", ink: "#1c1917", ink2: "#44403c", rust: "#9a3412", line: "#d6d3d1" },
    /** Cloudflare Turnstile site key for the contact form. Public by design: it ships in the page. */
    turnstileSiteKey: null as string | null,
    /**
     * Which code saves each submission to the Google Sheet. "apps-script" (the default) posts to a Google Apps Script web
     * app (docs/apps-script/contact-sheet.gs); "service-account" signs in as a Google service account. The choice sets
     * which names wrangler.jsonc lists under secrets.required (see docs/SECRETS.md).
     */
    sheetWriter: "apps-script" as "apps-script" | "service-account",
    /** The tab names in the Sheet: the contact form's two, then the two every other form shares. Generic names; the Apps Script reads the same names from its Script Properties. */
    sheetTabs: { production: "Submissions", preview: "Preview", forms: "Forms", formsPreview: "Forms preview" },
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
   * The caps for the forms owners add (docs/superpowers/specs/2026-11-25-forms-and-downloads-design.md, "Settings").
   * Owner-only file: a chat change can never raise them. `maxForms` counts live form files; `maxAnswerChars` is the most
   * characters one form's fields may allow in all; `maxBodyBytes` is the Worker's body limit for a form post (the contact
   * form keeps its own 16 KB).
   */
  forms: { maxForms: 10, maxFields: 12, maxAnswerChars: 8000, maxBodyBytes: 32_768 },
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
    /** Colors of the owner page (/owner), which the Worker draws itself and so cannot read the site's CSS. Wiring, like contact.emailColors. */
    pageColors: {
      white: "#ffffff",
      ink: "#1c1917",
      ink2: "#44403c",
      silver: "#f5f5f4",
      silver2: "#e7e5e4",
      green: "#1e4fa3",
      greenDeep: "#173b7a",
      rust: "#9a3412",
      line: "#d6d3d1",
      tint: "#e8eefa",
    },
    /** A whole number written as a string, unique in the Cloudflare account (docs/HOSTING.md). 1003 is the template's own. */
    rateLimitId: "1003",
    /** KV namespace ids (32 hex characters): OAuth tokens, and drafts with change times. */
    kv: { oauth: null as string | null, editor: null as string | null },
    /** Pull request checks that never count when judging whether a change is stuck. */
    ignoredChecks: ["change-report", "change-scope", "Workers Builds"] as string[],
    /**
     * The owner's upload inbox (photos and PDFs). Settings and their reasons: docs/superpowers/specs/2026-11-25-uploads-and-photos-design.md
     * ("Settings"). Needs a private R2 bucket and the Images binding, so it stays off until that setup is done.
     */
    uploads: {
      enabled: false,
      bucket: null as string | null,
      maxPhotoBytes: 20_000_000,
      maxPdfBytes: 10_000_000,
      maxTotalBytes: 200_000_000,
      maxPerDay: 50,
      expireDays: 30,
      types: ["jpeg", "png", "webp", "heic", "pdf"] as ("jpeg" | "png" | "webp" | "heic" | "pdf")[],
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
  /**
   * Ad and analytics tags (docs/TRACKING.md; design: docs/superpowers/specs/2026-11-27-ad-tracking-design.md). All null
   * means no tag loads and the CSP is unchanged. Tags load only on the production build, on the site's own host, after
   * the page has loaded, and never when the browser sends Global Privacy Control. Owner-only file: no chat tool can set
   * or change an ID. After a change run `npm run sync:config` (it adds only the CSP origins the set IDs need).
   */
  tracking: {
    /** GA4 measurement ID, like "G-ABC123DEF4". */
    ga4MeasurementId: null as string | null,
    /** Google Ads: the account's tag ID ("AW-" and digits) and the conversion labels for a lead and a purchase. */
    googleAds: { id: null as string | null, leadLabel: null as string | null, purchaseLabel: null as string | null },
    /** Meta Pixel ID (15 to 17 digits). */
    metaPixelId: null as string | null,
  },
} as const;
