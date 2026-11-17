// Launch gate: fails while any unresolved placeholder or unset provider setting remains.
// Run with `npm run check:placeholders` (also used by `npm run build:launch`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const srcDir = join(root, "src");
// Copy lives in content modules and route files; components and lib hold no copy.
const scanDirs = [join(srcDir, "content"), join(srcDir, "app")];
const problems = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|md|mdx|json)$/.test(entry)) scan(full);
  }
}

function scan(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const match of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
      problems.push(`${relative(root, file)}:${i + 1}  [[${match[1]}]]`);
    }
  });
}

scanDirs.forEach(walk);

// site.config.ts: no [[placeholder]] anywhere, and every required value filled in.
const { siteConfig: config } = await import(pathToFileURL(join(root, "site.config.ts")).href);

function scanConfig(value, path) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\[\[([^\]]+)\]\]/g)) {
      problems.push(`site.config.ts  ${path} still has the placeholder [[${match[1]}]]`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scanConfig(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) scanConfig(v, path ? `${path}.${k}` : k);
  }
}
scanConfig(config, "");

// Optional on purpose: legalName (falls back to the business name), prices.website (empty means none published),
// the csp.extra* lists and the analytics flag.
const requiredKeys = [
  "business.name", "business.tagline", "business.oneLiner",
  "owner.name", "owner.givenName", "owner.familyName", "owner.role", "owner.phone", "owner.regionLine",
  "owner.vcardPath", "owner.vcardFileName",
  "domain.url", "domain.workerName", "domain.previewHostSuffix",
  "contact.siteEmail", "contact.fromName", "contact.replyFromName", "contact.schedulerUrl", "contact.bookingFallbackPath",
  "contact.linkedInUrl", "contact.turnstileSiteKey", "contact.sheetTabs.production", "contact.sheetTabs.preview",
  "contact.rateLimit.namespaceIds.production", "contact.rateLimit.namespaceIds.preview",
  ...Object.keys(config.theme.colors).map((k) => `theme.colors.${k}`),
  "theme.fonts.display.family", "theme.fonts.body.family", "theme.fonts.accent.family",
  "brand.badge", "brand.wordmark", "brand.full", "brand.headshot",
];
for (const key of requiredKeys) {
  const value = key.split(".").reduce((obj, part) => obj?.[part], config);
  if (value === undefined) problems.push(`site.config.ts  ${key} is missing`);
  else if (value === null) problems.push(`site.config.ts  ${key} is still null (provider/value not chosen)`);
  else if (typeof value === "string" && value.trim() === "") problems.push(`site.config.ts  ${key} is empty`);
}

const site = readFileSync(join(srcDir, "content", "site.ts"), "utf8");

const decisionLabels = {
  lineArtStyle: "line-art style (geometric framework icons by default)",
};
for (const [key, label] of Object.entries(decisionLabels)) {
  if (new RegExp(`${key}:\\s*false`).test(site)) {
    problems.push(`src/content/site.ts  decisionsConfirmed.${key} is false: not yet confirmed by Grant (${label})`);
  }
}

if (problems.length > 0) {
  console.error(`\nLaunch check failed: ${problems.length} unresolved item(s)\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nResolve or remove each item before launch (see README, \"Launch checklist\").\n");
  process.exit(1);
}
console.log("Launch check passed: no unresolved placeholders.");
