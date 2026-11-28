// Rules for site.config.ts that `npm run check:config` (scripts/sync-config.mjs) enforces, and the Worker secret names
// each form destination needs. Pure functions over a config object, so they have tests (config-rules.test.mjs).
// Names only, never values (docs/SECRETS.md).
import { isHttpsOrigin } from "../worker/pipeline-url.ts"; // the same rule the Worker applies before it sends the secret
import { fontsModule } from "../src/brand/fonts.ts";
import { FONTS_PATH, PALETTE_PATH } from "../src/brand/generated.ts";
import { paletteCss } from "../src/brand/palette.ts";
import { PAYMENT_CURRENCIES } from "../src/payments/config.ts";
import { trackingProblems } from "../src/tracking/config.ts";

const DESTINATIONS = ["sheet", "pipeline"];
const WRITERS = ["apps-script", "service-account"];

// The template's own rate-limit ids (docs/HOSTING.md). A site made from the template must pick its own pair.
const TEMPLATE_IDS = ["1001", "1002"];

const PLACEHOLDER = /\[\[[^\]]*\]\]/;

/**
 * Secret names for `secrets.required` in wrangler.jsonc. Always RESEND_API_KEY and TURNSTILE_SECRET_KEY; then
 * INTAKE_SECRET for the "pipeline" destination, or the Sheet writer's pair for "sheet" (a missing destination is "sheet").
 * A set `payments` (site.config.ts) appends the two Stripe secrets. A set `booking` appends the Google service-account key
 * (the calendar is read and written with it), once, even when the Sheet writer already needs it.
 */
export function secretsFor(contact, payments = null, booking = null) {
  const contactSecrets = contactSecretsFor(contact);
  const names = payments ? [...contactSecrets, "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] : contactSecrets;
  return booking && !names.includes("GOOGLE_SERVICE_ACCOUNT_KEY") ? [...names, "GOOGLE_SERVICE_ACCOUNT_KEY"] : names;
}

function contactSecretsFor(contact) {
  const destination = contact.destination ?? "sheet";
  if (!DESTINATIONS.includes(destination)) {
    throw new Error(`site.config.ts contact.destination must be "sheet" or "pipeline", not ${JSON.stringify(destination)}`);
  }
  const always = ["RESEND_API_KEY", "TURNSTILE_SECRET_KEY"];
  if (destination === "pipeline") return [...always, "INTAKE_SECRET"];
  if (contact.sheetWriter === "apps-script") return [...always, "SHEET_WEBHOOK_URL", "SHEET_WEBHOOK_SECRET"];
  if (contact.sheetWriter === "service-account") return [...always, "GOOGLE_SERVICE_ACCOUNT_KEY", "GOOGLE_SHEET_ID"];
  throw new Error(`site.config.ts contact.sheetWriter must be "apps-script" or "service-account", not ${JSON.stringify(contact.sheetWriter)}`);
}

// The template's own editor rate-limit id (docs/HOSTING.md).
const TEMPLATE_EDITOR_ID = "1003";

/** The paths the owner's editor adds to run_worker_first, only when editor.enabled is true. */
export const EDITOR_PATHS = [
  "/mcp",
  "/owner",
  "/owner/*",
  "/oauth/*",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/*",
];

const blank = (value) => typeof value !== "string" || value.trim() === "" || PLACEHOLDER.test(value);

/** Problems with the `editor` block. Nothing is checked while it is missing or disabled. */
function editorProblems(c) {
  const e = c.editor;
  if (!e || e.enabled !== true) return [];
  const problems = [];
  const need = (path, message) => problems.push(`site.config.ts  editor.${path} ${message}`);

  const emails = Array.isArray(e.ownerEmails) ? e.ownerEmails : [];
  if (emails.length === 0) need("ownerEmails", "needs at least one owner email");
  for (const email of emails) {
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      need("ownerEmails", `has a value that is not an email address: ${JSON.stringify(email)}`);
    }
  }

  const team = e.access?.teamDomain;
  if (typeof team !== "string" || !/^[a-z0-9-]+$/.test(team)) {
    need("access.teamDomain", `must be the Cloudflare Access team name only (lowercase letters, digits and dashes), not ${JSON.stringify(team)}`);
  }
  if (blank(e.access?.aud)) need("access.aud", "must be set to the Access application's AUD tag");

  for (const key of ["owner", "repo", "botLogin"]) {
    if (blank(e.github?.[key])) need(`github.${key}`, "must be set");
  }
  for (const key of ["appId", "installationId"]) {
    const value = e.github?.[key];
    if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
      need(`github.${key}`, `must be a whole number written as a string, not ${JSON.stringify(value)}`);
    }
  }
  if (blank(e.workersSubdomain)) need("workersSubdomain", "must be set to the account's workers.dev subdomain");

  for (const key of ["oauth", "editor"]) {
    const id = e.kv?.[key];
    if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) {
      need(`kv.${key}`, `must be a KV namespace id (32 lowercase hex characters), not ${JSON.stringify(id)}`);
    }
  }
  if (!Number.isInteger(e.dailyChangeLimit) || e.dailyChangeLimit < 1) {
    need("dailyChangeLimit", `must be a whole number of at least 1, not ${JSON.stringify(e.dailyChangeLimit)}`);
  }

  const id = e.rateLimitId;
  if (typeof id !== "string" || !/^[0-9]+$/.test(id)) {
    need("rateLimitId", `must be a whole number written as a string, like "2003", not ${JSON.stringify(id)}`);
  } else {
    const contactIds = [c.contact?.rateLimitIds?.production, c.contact?.rateLimitIds?.preview];
    if (contactIds.includes(id)) {
      need("rateLimitId", `is ${id}, the same as a contact form id. Bindings with the same id share counters, so pick another`);
    }
    const configured = typeof c.domain?.workerName === "string" && !PLACEHOLDER.test(c.domain.workerName);
    if (configured && id === TEMPLATE_EDITOR_ID) {
      need("rateLimitId", `is ${id}, the template's own id. Take a free number from docs/HOSTING.md and add the row there`);
    }
  }
  return problems;
}

const UPLOAD_TYPES = ["jpeg", "png", "webp", "heic", "pdf"];
const MAX_PHOTO_BYTES = 20_000_000; // the Images binding's input limit
const MAX_PDF_BYTES = 10_000_000; // the scope check's PDF cap (scripts/change-scope-rules.mjs)
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * Problems with `editor.uploads` (the owner's photo and PDF inbox). Nothing is checked while the block is missing. The
 * numbers are checked whether or not uploads are on; the bucket and the editor only matter once they are.
 */
function uploadsProblems(c) {
  const u = c.editor?.uploads;
  if (u === undefined || u === null) return [];
  const problems = [];
  const need = (path, message) => problems.push(`site.config.ts  editor.uploads.${path} ${message}`);
  const whole = (value) => Number.isInteger(value) && value >= 1;
  const names = UPLOAD_TYPES.map((t) => `"${t}"`).join(", ");

  for (const [key, cap] of [["maxPhotoBytes", MAX_PHOTO_BYTES], ["maxPdfBytes", MAX_PDF_BYTES], ["maxTotalBytes", null], ["maxPerDay", null]]) {
    if (!whole(u[key])) need(key, `must be a whole number of at least 1, not ${JSON.stringify(u[key])}`);
    else if (cap !== null && u[key] > cap) need(key, `is over the ${cap}-byte limit (${JSON.stringify(u[key])})`);
  }
  if (!whole(u.expireDays) || u.expireDays > 90) need("expireDays", `must be a whole number from 1 to 90, not ${JSON.stringify(u.expireDays)}`);

  if (!Array.isArray(u.types) || u.types.length === 0) {
    need("types", `needs at least one of ${names}`);
  } else {
    const seen = new Set();
    for (const type of u.types) {
      if (!UPLOAD_TYPES.includes(type)) need("types", `has ${JSON.stringify(type)}, which is not one of ${names}`);
      else if (seen.has(type)) need("types", `lists ${JSON.stringify(type)} more than once`);
      seen.add(type);
    }
  }

  if (u.enabled === true) {
    if (c.editor?.enabled !== true) need("enabled", "is true, but editor.enabled is not. Uploads exist only for the owner's editor, so turn the editor on first");
    if (typeof u.bucket !== "string" || !BUCKET_NAME.test(u.bucket)) {
      need("bucket", `must be an R2 bucket name (3 to 63 lowercase letters, digits and dashes, starting and ending with a letter or digit), not ${JSON.stringify(u.bucket)}`);
    }
  }
  return problems;
}

const FORM_SETTING_KEYS = ["maxForms", "maxFields", "maxAnswerChars", "maxBodyBytes"];

/** Problems with the `forms` block (the caps on forms owners add). Nothing is checked while it is missing. */
function formsProblems(c) {
  const f = c.forms;
  if (f === undefined || f === null) return [];
  const problems = [];
  for (const key of FORM_SETTING_KEYS) {
    if (!Number.isInteger(f[key]) || f[key] < 1) problems.push(`site.config.ts  forms.${key} must be a whole number of at least 1, not ${JSON.stringify(f[key])}`);
  }
  for (const key of Object.keys(f)) {
    if (!FORM_SETTING_KEYS.includes(key)) problems.push(`site.config.ts  forms.${key} is not a form setting. The settings are: ${FORM_SETTING_KEYS.join(", ")}`);
  }
  return problems;
}

/** The text of wrangler.jsonc, generated from site.config.ts. Editor bindings appear only when editor.enabled is true. */
export function wranglerText(c) {
  const { limit, periodSeconds } = c.contact.rateLimit;
  const ids = c.contact.rateLimitIds;
  const editor = c.editor?.enabled === true ? c.editor : null;
  const uploads = editor && editor.uploads?.enabled === true ? editor.uploads : null;
  const payments = c.payments ? c.payments : null;
  const booking = c.booking ? c.booking : null;
  const secrets = [...secretsFor(c.contact, payments, booking), ...(editor ? ["GITHUB_APP_PRIVATE_KEY"] : [])];
  const rate = (name, id, lim, period) => `{ "name": "${name}", "namespace_id": "${id}", "simple": { "limit": ${lim}, "period": ${period} } }`;
  const contactRate = (id) => rate("CONTACT_RATE_LIMIT", id, limit, periodSeconds);
  const paths = ["/api/*", ...(editor ? EDITOR_PATHS : [])].map((p) => `"${p}"`).join(", ");
  const kv = editor
    ? `  // The owner's chat tools: OAuth tokens, and drafts with change times (docs/SECRETS.md).
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "${editor.kv.oauth}" },
    { "binding": "EDITOR_KV", "id": "${editor.kv.editor}" }
  ],
`
    : "";
  const uploadBindings = uploads
    ? `  // The owner's photo and PDF inbox: a private R2 bucket (docs/EDITING.md).
  "r2_buckets": [{ "binding": "UPLOADS", "bucket_name": "${uploads.bucket}" }],
  // Resizes and converts uploaded photos to WebP.
  "images": { "binding": "IMAGES" },
`
    : "";
  // Uploads already add the Images binding; payments need it only to turn the logo into a PNG for the certificate.
  const paymentsImages =
    payments && !uploads
      ? `  // Turns the uploaded logo into a PNG for the gift card certificate (docs/PAYMENTS.md).
  "images": { "binding": "IMAGES" },
`
      : "";
  // The booking lock is a Durable Object. A class that has shipped cannot be dropped without a "deleted_classes" migration
  // (which erases its data), so the migration below is kept even if booking is later turned off (docs/BOOKING.md).
  const bookingBindings = booking
    ? `  // Serialises booking checkouts per calendar so two visitors cannot take one time (docs/BOOKING.md).
  "durable_objects": { "bindings": [{ "name": "BOOKING_LOCK", "class_name": "BookingLock" }] },
  // Once deployed, this class cannot be removed without a delete migration, which erases its data.
  "migrations": [{ "tag": "booking-lock-v1", "new_sqlite_classes": ["BookingLock"] }],
  // Every 15 minutes: releases the holds of checkouts that were never paid and finishes bookings whose webhook was missed.
  "triggers": { "crons": ["*/15 * * * *"] },
`
    : "";
  const previewBooking = booking ? `,\n    "durable_objects": { "bindings": [{ "name": "BOOKING_LOCK", "class_name": "BookingLock" }] }` : "";
  const ratelimits = editor
    ? `[
    ${contactRate(ids.production)},
    ${rate("EDITOR_RATE_LIMIT", editor.rateLimitId, 30, 60)}
  ]`
    : `[${contactRate(ids.production)}]`;
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "${c.domain.workerName}",
  // The Worker entry: the contact form on /api/*${editor ? " and the owner's chat tools" : ""}. Every page and file is served from ./out.
  "main": "./worker/index.ts",
  "compatibility_date": "2026-11-11",
  "assets": {
    "directory": "./out",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "run_worker_first": [${paths}]
  },
  "vars": { "SITE_ENV": "production" },
  // Names only. Values are set with \`wrangler secret put\` (README, "Contact form").
  "secrets": {
    "required": [${secrets.map((name) => `"${name}"`).join(", ")}]
  },
${kv}${uploadBindings}${paymentsImages}${bookingBindings}  "ratelimits": ${ratelimits},
  // Invocation logs would store request metadata; the Worker's own log lines hold no personal data.
  "observability": { "enabled": true, "logs": { "invocation_logs": false } },
  // Worker Previews (branch previews) do not inherit the settings above, so they are repeated here.
  // Preview secrets are separate: \`wrangler preview base-config secret put\`. The editor never runs on a preview.
  "previews": {
    "vars": { "SITE_ENV": "preview" },
    "ratelimits": [${contactRate(ids.preview)}]${previewBooking}
  }
}
`;
}

/** Problems with the `payments` setting. null or missing means payments are off. */
function paymentsProblems(c) {
  const p = c.payments;
  if (p === undefined || p === null) return [];
  const need = (path, message) => `site.config.ts  payments${path} ${message}`;
  if (typeof p !== "object" || Array.isArray(p)) return [need("", `must be null or { provider: "stripe", currency }, not ${JSON.stringify(p)}`)];
  const problems = [];
  if (p.provider !== "stripe") problems.push(need(".provider", `must be "stripe", not ${JSON.stringify(p.provider)}`));
  if (!PAYMENT_CURRENCIES.includes(p.currency)) {
    problems.push(need(".currency", `must be one of ${PAYMENT_CURRENCIES.join(", ")} (lowercase, two-decimal currencies only), not ${JSON.stringify(p.currency)}`));
  }
  for (const key of Object.keys(p)) if (key !== "provider" && key !== "currency") problems.push(need(`.${key}`, "is not a payments setting. The settings are: provider, currency"));
  return problems;
}

const BOOKING_KEYS = ["calendarId", "busyCalendarIds", "previewCalendarId"];
const MAX_BUSY_CALENDARS = 10;
const CALENDAR_ID_MAX = 254;

/** A Google Calendar id: text, no spaces, at most 254 characters. Returns the reason it is not one, or null. */
function calendarIdProblem(value) {
  if (typeof value !== "string" || value === "") return "must be a calendar id (text)";
  if (/\s/.test(value)) return "must not contain spaces";
  if (value.length > CALENDAR_ID_MAX) return `must be at most ${CALENDAR_ID_MAX} characters`;
  return null;
}

/** A real zone name the runtime knows, and not "UTC" (a default nobody chose). */
function zoneIsUsable(zone) {
  if (typeof zone !== "string" || zone === "" || zone.toUpperCase() === "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Problems with the `booking` setting (the calendar). null or missing means booking is off. */
function bookingProblems(c) {
  const b = c.booking;
  if (b === undefined || b === null) return [];
  const need = (path, message) => `site.config.ts  booking${path} ${message}`;
  if (typeof b !== "object" || Array.isArray(b)) return [need("", `must be null or { calendarId, busyCalendarIds, previewCalendarId }, not ${JSON.stringify(b)}`)];
  const problems = [];
  const idProblem = calendarIdProblem(b.calendarId);
  if (idProblem) problems.push(need(".calendarId", `${idProblem}, not ${JSON.stringify(b.calendarId)}`));
  if (!Array.isArray(b.busyCalendarIds)) problems.push(need(".busyCalendarIds", `must be a list of calendar ids (it can be empty), not ${JSON.stringify(b.busyCalendarIds)}`));
  else {
    if (b.busyCalendarIds.length > MAX_BUSY_CALENDARS) problems.push(need(".busyCalendarIds", `lists ${b.busyCalendarIds.length} calendars; at most ${MAX_BUSY_CALENDARS}`));
    b.busyCalendarIds.forEach((id, index) => {
      const bad = calendarIdProblem(id);
      if (bad) problems.push(need(`.busyCalendarIds[${index}]`, `${bad}, not ${JSON.stringify(id)}`));
      else if (id === b.calendarId) problems.push(need(`.busyCalendarIds[${index}]`, "is the booking calendar itself; list only other calendars to read busy time from"));
    });
  }
  const preview = b.previewCalendarId;
  if (preview === undefined) problems.push(need(".previewCalendarId", "is missing; set a test calendar's id, or null so a preview shows times but refuses to book"));
  else if (preview !== null) {
    const bad = calendarIdProblem(preview);
    if (bad) problems.push(need(".previewCalendarId", `${bad} (or null), not ${JSON.stringify(preview)}`));
    else if (preview === b.calendarId) problems.push(need(".previewCalendarId", "is the same as calendarId. A preview must write to a test calendar, never the real one"));
  }
  for (const key of Object.keys(b)) if (!BOOKING_KEYS.includes(key)) problems.push(need(`.${key}`, `is not a booking setting. The settings are: ${BOOKING_KEYS.join(", ")}`));
  if (!zoneIsUsable(c.business?.timeZone)) problems.push(`site.config.ts  business.timeZone is ${JSON.stringify(c.business?.timeZone)}. Booking needs the business's own time zone, like "America/Chicago": every opening time, booking and email uses it.`);
  return problems;
}

/** One plain line per problem; an empty array means the config passes. */
export function configProblems(c) {
  return [...siteProblems(c), ...paymentsProblems(c), ...bookingProblems(c), ...trackingProblems(c.tracking)];
}

function siteProblems(c) {
  const problems = [];
  const { contact, domain } = c;

  const destination = contact.destination ?? "sheet";
  if (!DESTINATIONS.includes(destination)) {
    problems.push(`site.config.ts  contact.destination must be "sheet" or "pipeline", not ${JSON.stringify(contact.destination)}`);
  }
  if (!WRITERS.includes(contact.sheetWriter)) {
    problems.push(`site.config.ts  contact.sheetWriter must be "apps-script" or "service-account", not ${JSON.stringify(contact.sheetWriter)}`);
  }
  if (destination === "pipeline" && !isHttpsOrigin(contact.pipelineUrl)) {
    problems.push(
      `site.config.ts  contact.pipelineUrl must be the Pipeline app copy's https origin, like "https://pipeline.example.com" (lowercase, no path, no trailing slash, no ":443"), not ${JSON.stringify(contact.pipelineUrl)}`,
    );
  }

  // A preview must never write into the production tab: each production tab and its preview tab need different names.
  const tabs = contact.sheetTabs;
  if (tabs && typeof tabs === "object") {
    for (const [live, preview] of [["production", "preview"], ["forms", "formsPreview"], ["giftCards", "giftCardsPreview"], ["bookings", "bookingsPreview"]]) {
      if (typeof tabs[live] === "string" && tabs[live] !== "" && tabs[live] === tabs[preview]) {
        problems.push(`site.config.ts  contact.sheetTabs.${live} and .${preview} are both ${JSON.stringify(tabs[live])}. Give them different names, or a preview would write into the production tab`);
      }
    }
  }

  const ids = contact.rateLimitIds;
  if (!ids || typeof ids !== "object") {
    problems.push("site.config.ts  contact.rateLimitIds is missing. Set { production, preview } to two whole numbers from docs/HOSTING.md");
    return [...problems, ...formsProblems(c), ...editorProblems(c), ...uploadsProblems(c)];
  }
  let numeric = true;
  for (const key of ["production", "preview"]) {
    if (typeof ids[key] !== "string" || !/^[0-9]+$/.test(ids[key])) {
      numeric = false;
      problems.push(`site.config.ts  contact.rateLimitIds.${key} must be a whole number written as a string, like "2001", not ${JSON.stringify(ids[key])}`);
    }
  }
  if (numeric) {
    if (ids.production === ids.preview) {
      problems.push("site.config.ts  contact.rateLimitIds.production and .preview must be different numbers");
    }
    // The template keeps 1001 and 1002; a site is "configured" once its Worker name is no longer a placeholder.
    const configured = typeof domain?.workerName === "string" && !PLACEHOLDER.test(domain.workerName);
    if (configured) {
      for (const key of ["production", "preview"]) {
        if (TEMPLATE_IDS.includes(ids[key])) {
          problems.push(
            `site.config.ts  contact.rateLimitIds.${key} is ${ids[key]}, the template's own id. Take a free pair from docs/HOSTING.md (new sites start at 2001) and add the row there`,
          );
        }
      }
    }
  }
  return [...problems, ...formsProblems(c), ...editorProblems(c), ...uploadsProblems(c)];
}

/**
 * The two files generated from src/content/brand.json: the palette and the fonts module. A brand that does not pass the
 * generators (a color that is not #rrggbb, a font that is not curated) throws a plain error; the full judgement of
 * brand.json (contrast, logo) is `npm run check:content`.
 */
export function brandFiles(brand) {
  return { [PALETTE_PATH]: paletteCss(brand.colors), [FONTS_PATH]: fontsModule(brand.fonts) };
}

/** First differing lines of two texts, for a drift report. */
export function diffLines(expected, actual) {
  const a = actual.split("\n");
  const e = expected.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, e.length) && out.length < 12; i++) {
    if (a[i] !== e[i]) {
      out.push(`    line ${i + 1}`, `      committed: ${a[i] ?? "(missing)"}`, `      generated: ${e[i] ?? "(missing)"}`);
    }
  }
  return out.join("\n");
}

/** One entry per generated file whose committed text (`read(path)`, or null when missing) differs from what is generated. */
export function driftedFiles(generated, read) {
  const drifted = [];
  for (const [path, expected] of Object.entries(generated)) {
    const actual = read(path) ?? "";
    if (actual !== expected) drifted.push(`  - ${path}\n${diffLines(expected, actual)}`);
  }
  return drifted;
}
