// Runs after `next build` (see package.json `build`): stamps ./out with the commit it was built from
// (out/site-version.json, with whether drafts were built) and, on a Workers Builds production build, removes the /blocks showcase from ./out.
// While payments are off it also removes the gift card thank-you page (out/gift-cards).
// CI and preview builds keep /blocks so the accessibility and Lighthouse checks still scan it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProductionBuild } from "../src/lib/build-target.ts";
import { paymentsForBuild } from "../src/payments/config.ts";
import { FIXTURE_ENV, FIXTURE_TRACKING } from "../src/tracking/config.ts";
import { headersText } from "./headers-text.mjs";

const CERTIFICATE_FONTS_DIR = fileURLToPath(new URL("../src/brand/certificate-fonts/", import.meta.url));

/**
 * While payments are on, copies the gift certificate's fonts for the site's brand into <outDir>/_certificate/, under the
 * fixed names the Worker reads (worker/gift-cards/certificate-assets.ts; design R10). Throws when a file is missing, so
 * a site that sells gift cards never deploys without them. `sourceDir` is for tests.
 */
export function copyCertificateFonts(outDir, brandFonts, sourceDir = CERTIFICATE_FONTS_DIR) {
  if (!brandFonts?.display || !brandFonts?.accent) throw new Error("brand.json has no display or accent font");
  const files = {
    "display.ttf": `display-${brandFonts.display}-400.ttf`,
    "display-bold.ttf": `display-${brandFonts.display}-600.ttf`,
    "accent.ttf": `accent-${brandFonts.accent}-italic.ttf`,
  };
  const target = join(outDir, "_certificate");
  mkdirSync(target, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    const from = join(sourceDir, source);
    if (!existsSync(from)) throw new Error(`Missing certificate font ${source}; run node scripts/fetch-certificate-fonts.mjs`);
    copyFileSync(from, join(target, name));
  }
}

/**
 * Writes <outDir>/site-version.json and, when env.WORKERS_CI_BRANCH is the production branch, removes the showcase.
 * With TRACKING_FIXTURE=1 (local test builds) and a `siteConfig`, <outDir>/_headers is rewritten with the CSP the fixture
 * IDs need, so the page can load the fake tags in a browser; the committed public/_headers is never touched.
 * While payments (`siteConfig.payments`, or PAYMENTS_FIXTURE=1) are off, removes <outDir>/gift-cards, the gift card thank-you page.
 */
export function finishBuild({ outDir, env, productionBranch, siteConfig, brandFonts }) {
  const commit = env.WORKERS_CI_COMMIT_SHA || env.GITHUB_SHA || null;
  const showcaseRemoved = isProductionBuild(env, productionBranch);
  // Drafts are built everywhere except production (src/lib/drafts.ts uses the same rule), so a build that says drafts: true is not a production build.
  const drafts = !showcaseRemoved;
  writeFileSync(join(outDir, "site-version.json"), `${JSON.stringify({ commit, builtAt: new Date().toISOString(), drafts })}\n`);
  if (env[FIXTURE_ENV] === "1") {
    if (showcaseRemoved || env.WORKERS_CI) throw new Error(`${FIXTURE_ENV}=1 is for local test builds only and must not be set on a Workers Builds build.`);
    if (siteConfig) writeFileSync(join(outDir, "_headers"), headersText({ ...siteConfig, tracking: FIXTURE_TRACKING }));
  }
  if (showcaseRemoved) {
    for (const name of ["blocks.html", "blocks.txt", "blocks"]) rmSync(join(outDir, name), { recursive: true, force: true });
  }
  // With payments off the gift card thank-you page does not ship (design R1). `siteConfig` is optional so old callers and tests still work; without it payments count as off.
  const payments = paymentsForBuild({ payments: siteConfig?.payments ?? null, domain: { productionBranch } }, env);
  const giftCardsRemoved = payments === null;
  if (giftCardsRemoved) rmSync(join(outDir, "gift-cards"), { recursive: true, force: true });
  else copyCertificateFonts(outDir, brandFonts);
  return { commit, showcaseRemoved, drafts, giftCardsRemoved };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { siteConfig } = await import(pathToFileURL(join(root, "site.config.ts")).href);
  const { fonts: brandFonts } = JSON.parse(readFileSync(join(root, "src/content/brand.json"), "utf8"));
  const result = finishBuild({ outDir: join(root, "out"), env: process.env, productionBranch: siteConfig.domain.productionBranch, siteConfig, brandFonts });
  console.log(`Build stamp: ${result.commit ?? "no commit known"}${result.showcaseRemoved ? "; /blocks removed (production build)" : ""}${result.giftCardsRemoved ? "; gift cards not shipped (payments off)" : ""}`);
  if (result.drafts) console.log("Drafts included (not a production build)");
}
