// The text of public/_headers, as a pure function of site.config.ts. scripts/sync-config.mjs writes and checks it;
// scripts/finish-build.mjs rewrites out/_headers with it for a TRACKING_FIXTURE build.
import { embedOrigins } from "../src/blocks/embeds.ts";
import { trackingCspOrigins, trackingIds } from "../src/tracking/config.ts";

const unique = (list) => [...new Set(list)];

/** One comment line per set tracking product, naming the origins it adds. Nothing for a product that is not set. */
function trackingComments(tracking) {
  const ids = trackingIds(tracking);
  if (!ids) return "";
  const origins = (t) => {
    const o = trackingCspOrigins(t);
    return unique([...o.script, ...o.img, ...o.connect, ...o.frame]).join(", ");
  };
  const lines = [];
  if (ids.ga4) lines.push(`# ${origins({ ga4MeasurementId: ids.ga4, googleAds: { id: null, leadLabel: null, purchaseLabel: null }, metaPixelId: null })} (script-src, img-src, connect-src): Google Analytics 4 (tracking.ga4MeasurementId).`);
  if (ids.ads) lines.push(`# ${origins({ ga4MeasurementId: null, googleAds: { id: ids.ads.id, leadLabel: null, purchaseLabel: null }, metaPixelId: null })} (script-src, img-src, connect-src, frame-src): Google Ads (tracking.googleAds).`);
  if (ids.meta) lines.push(`# ${origins({ ga4MeasurementId: null, googleAds: { id: null, leadLabel: null, purchaseLabel: null }, metaPixelId: ids.meta })} (script-src, img-src, connect-src): Meta Pixel (tracking.metaPixelId).`);
  return `${lines.join("\n")}\n`;
}

/** The whole _headers file for a config. `c.tracking` may be missing or all null: the text is then the one without tracking. */
export function headersText(c) {
  const insights = c.analytics.cloudflareWebAnalytics;
  const added = trackingCspOrigins(c.tracking);
  const script = unique([
    "'self'",
    "'unsafe-inline'",
    "https://challenges.cloudflare.com",
    ...(insights ? ["https://static.cloudflareinsights.com"] : []),
    ...c.csp.extraScriptSrc,
    ...added.script,
  ]);
  const img = unique(["'self'", "data:", ...added.img]);
  const connect = unique(["'self'", ...(insights ? ["https://cloudflareinsights.com"] : []), ...c.csp.extraConnectSrc, ...added.connect]);
  const frame = unique(["https://challenges.cloudflare.com", ...embedOrigins, ...c.csp.extraFrameSrc, ...added.frame]);
  const autoplay = `autoplay=(${embedOrigins.map((origin) => `"${origin}"`).join(" ")})`;
  const csp = [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${frame.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return `# Cloudflare response headers (Pages and Workers static assets).
# https://developers.cloudflare.com/pages/configuration/headers/
# https://developers.cloudflare.com/workers/static-assets/headers/
# Next.js static export emits inline bootstrap scripts, so script-src needs 'unsafe-inline'.
# Tighten (hashes or nonces) if the hosting setup ever allows it. Update frame-src/script-src/connect-src
# when a scheduler or form provider is added.
# https://challenges.cloudflare.com (script-src, frame-src): Cloudflare Turnstile on the contact form.
# https://static.cloudflareinsights.com (script-src) and https://cloudflareinsights.com (connect-src): Cloudflare Web Analytics.
# ${embedOrigins.join(", ")} (frame-src, and autoplay in Permissions-Policy): the video and audio blocks
# swap in a player from these sites when a visitor presses play; the list is embedOrigins in src/blocks/embeds.ts.
${trackingComments(c.tracking)}# The form posts to the same-origin Worker (/api/contact), so form-action stays 'self'.
# These headers apply to static files only; the Worker sets its own headers on /api/* responses.

/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), ${autoplay}, camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains

# PDFs in public/files/ always download and never run on the site's origin (docs/CHANGE-SCOPE.md, "PDF rules").
/files/*
  Content-Disposition: attachment
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

# Keep Cloudflare preview/production *.pages.dev URLs out of search results.
https://:project.pages.dev/*
  X-Robots-Tag: noindex

# Same for *.workers.dev worker and preview URLs.
https://:version.:subdomain.workers.dev/*
  X-Robots-Tag: noindex
`;
}
