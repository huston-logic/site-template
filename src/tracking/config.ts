// The tracking settings (`tracking` in site.config.ts): the ID formats, the CSP origins each product needs and the build
// decision. Import-free except the shared production-build rule, so the Next build, scripts/sync-config.mjs and
// scripts/finish-build.mjs read one list. Design: docs/superpowers/specs/2026-11-27-ad-tracking-design.md.
import { isProductionBuild } from "../lib/build-target.ts";

export interface TrackingSettings {
  ga4MeasurementId: string | null;
  googleAds: { id: string | null; leadLabel: string | null; purchaseLabel: string | null };
  metaPixelId: string | null;
}

/** The IDs a build hands the tag loader. Only set values; labels only with the Ads id. */
export interface TrackingIds {
  ga4?: string;
  ads?: { id: string; leadLabel?: string; purchaseLabel?: string };
  meta?: string;
}

/** What the root layout renders `TrackingTags` with, or null for nothing. `host` null skips the run-time host check (fixture builds only). */
export interface TrackingBuild {
  ids: TrackingIds;
  host: string | null;
}

export const EMPTY_TRACKING: TrackingSettings = {
  ga4MeasurementId: null,
  googleAds: { id: null, leadLabel: null, purchaseLabel: null },
  metaPixelId: null,
};

export const GA4_ID_RE = /^G-[A-Z0-9]{6,12}$/;
export const ADS_ID_RE = /^AW-[0-9]{9,11}$/;
export const ADS_LABEL_RE = /^[A-Za-z0-9_-]{6,40}$/;
export const META_PIXEL_RE = /^[0-9]{15,17}$/;

/** Obviously fake IDs for a local `TRACKING_FIXTURE=1` build. They match the formats and belong to nobody. */
export const FIXTURE_TRACKING: TrackingSettings = {
  ga4MeasurementId: "G-TEST000000",
  googleAds: { id: "AW-000000000", leadLabel: "TestLeadLabel", purchaseLabel: "TestPurchaseLabel" },
  metaPixelId: "000000000000000",
};

export const FIXTURE_ENV = "TRACKING_FIXTURE";

/** Every problem with the `tracking` group, as `site.config.ts  tracking.<path> ...` lines. A missing group has none. */
export function trackingProblems(t: Partial<TrackingSettings> | undefined | null): string[] {
  if (t === undefined || t === null) return [];
  const problems: string[] = [];
  const need = (path: string, message: string) => problems.push(`site.config.ts  tracking.${path} ${message}`);
  const check = (path: string, value: unknown, re: RegExp, shape: string) => {
    if (value === null || value === undefined) return;
    if (typeof value !== "string" || !re.test(value)) need(path, `must be null or ${shape}, not ${JSON.stringify(value)}`);
  };
  check("ga4MeasurementId", t.ga4MeasurementId, GA4_ID_RE, `a GA4 measurement ID like "G-ABC123DEF4"`);
  const ads = t.googleAds;
  if (ads !== undefined && ads !== null) {
    check("googleAds.id", ads.id, ADS_ID_RE, `a Google Ads ID like "AW-123456789"`);
    check("googleAds.leadLabel", ads.leadLabel, ADS_LABEL_RE, "a conversion label (6 to 40 letters, digits, _ or -)");
    check("googleAds.purchaseLabel", ads.purchaseLabel, ADS_LABEL_RE, "a conversion label (6 to 40 letters, digits, _ or -)");
    if ((ads.leadLabel || ads.purchaseLabel) && !ads.id) need("googleAds.id", "must be set when a conversion label is set");
  }
  check("metaPixelId", t.metaPixelId, META_PIXEL_RE, "a Meta Pixel ID (15 to 17 digits)");
  return problems;
}

/** The set IDs, or null when none is set. Assumes `trackingProblems` passed. */
export function trackingIds(t: TrackingSettings | undefined | null): TrackingIds | null {
  if (!t) return null;
  const ids: TrackingIds = {};
  if (t.ga4MeasurementId) ids.ga4 = t.ga4MeasurementId;
  if (t.googleAds?.id) {
    ids.ads = {
      id: t.googleAds.id,
      ...(t.googleAds.leadLabel ? { leadLabel: t.googleAds.leadLabel } : {}),
      ...(t.googleAds.purchaseLabel ? { purchaseLabel: t.googleAds.purchaseLabel } : {}),
    };
  }
  if (t.metaPixelId) ids.meta = t.metaPixelId;
  return ids.ga4 || ids.ads || ids.meta ? ids : null;
}

export interface CspAdditions {
  script: string[];
  img: string[];
  connect: string[];
  frame: string[];
}

// Google's "Use a Content Security Policy" guide for Google tags (fetched 2026-11-27), plus the Ads fallback script on
// googleads.g.doubleclick.net that a fixture Lighthouse run showed blocked; Meta publishes no list, so its two hosts come
// from the Pixel's base code. Rulings 8 to 10 in the design say what is left out on purpose.
const GTM = "https://www.googletagmanager.com";
const GA4_ORIGINS: CspAdditions = {
  script: [GTM],
  img: [GTM, "https://*.google-analytics.com"],
  connect: [GTM, "https://*.google-analytics.com", "https://*.analytics.google.com"],
  frame: [],
};
const ADS_HOSTS = [
  GTM,
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
  "https://pagead2.googlesyndication.com",
  "https://www.google.com",
];
const ADS_ORIGINS: CspAdditions = {
  script: [GTM, "https://www.googleadservices.com", "https://www.google.com", "https://googleads.g.doubleclick.net"],
  img: ADS_HOSTS,
  connect: [...ADS_HOSTS, "https://ad.doubleclick.net"],
  frame: [GTM],
};
const META_ORIGINS: CspAdditions = {
  script: ["https://connect.facebook.net"],
  img: ["https://www.facebook.com"],
  connect: ["https://www.facebook.com", "https://connect.facebook.net"],
  frame: [],
};

/** The CSP origins the set IDs need, de-duplicated, in a fixed order. Empty lists when nothing is set. */
export function trackingCspOrigins(t: TrackingSettings | undefined | null): CspAdditions {
  const ids = trackingIds(t);
  const parts = [ids?.ga4 ? GA4_ORIGINS : null, ids?.ads ? ADS_ORIGINS : null, ids?.meta ? META_ORIGINS : null].filter(
    (part): part is CspAdditions => part !== null,
  );
  const merge = (key: keyof CspAdditions) => [...new Set(parts.flatMap((part) => part[key]))];
  return { script: merge("script"), img: merge("img"), connect: merge("connect"), frame: merge("frame") };
}

interface BuildSiteConfig {
  tracking?: TrackingSettings;
  domain: { url: string; productionBranch: string };
}

/**
 * What the root layout renders the tag loader with, or null. A production build (Workers Builds on the production
 * branch) with at least one ID gets the real IDs and the site's host. `TRACKING_FIXTURE=1` gives the fixture IDs and no
 * host check, for local tests only; on any Workers Builds build (production or preview) it throws, so fake IDs and an
 * unchecked host can never ship.
 */
export function trackingForBuild(config: BuildSiteConfig, env: Record<string, string | undefined>): TrackingBuild | null {
  const production = isProductionBuild(env, config.domain.productionBranch);
  if (env[FIXTURE_ENV] === "1") {
    if (production || env["WORKERS_CI"]) throw new Error(`${FIXTURE_ENV}=1 is for local test builds only and must not be set on a Workers Builds build.`);
    const ids = trackingIds(FIXTURE_TRACKING);
    return ids ? { ids, host: null } : null;
  }
  if (!production) return null;
  const ids = trackingIds(config.tracking);
  if (!ids) return null;
  return { ids, host: new URL(config.domain.url).hostname };
}

/** The run-time host check: the site's own host or its www. twin. */
export function isSiteHost(hostname: string, siteHost: string): boolean {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return bare(hostname) === bare(siteHost);
}
