// Runs after `next build` (see package.json `build`): stamps ./out with the commit it was built from
// (out/site-version.json, with whether drafts were built) and, on a Workers Builds production build, removes the /blocks showcase from ./out.
// CI and preview builds keep /blocks so the accessibility and Lighthouse checks still scan it.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProductionBuild } from "../src/lib/build-target.ts";
import { FIXTURE_ENV, FIXTURE_TRACKING } from "../src/tracking/config.ts";
import { headersText } from "./headers-text.mjs";

/**
 * Writes <outDir>/site-version.json and, when env.WORKERS_CI_BRANCH is the production branch, removes the showcase.
 * With TRACKING_FIXTURE=1 (local test builds) and a `siteConfig`, <outDir>/_headers is rewritten with the CSP the fixture
 * IDs need, so the page can load the fake tags in a browser; the committed public/_headers is never touched.
 */
export function finishBuild({ outDir, env, productionBranch, siteConfig }) {
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
  return { commit, showcaseRemoved, drafts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { siteConfig } = await import(pathToFileURL(join(root, "site.config.ts")).href);
  const result = finishBuild({ outDir: join(root, "out"), env: process.env, productionBranch: siteConfig.domain.productionBranch, siteConfig });
  console.log(`Build stamp: ${result.commit ?? "no commit known"}${result.showcaseRemoved ? "; /blocks removed (production build)" : ""}`);
  if (result.drafts) console.log("Drafts included (not a production build)");
}
