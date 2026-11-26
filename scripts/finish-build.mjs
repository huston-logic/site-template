// Runs after `next build` (see package.json `build`): stamps ./out with the commit it was built from
// (out/site-version.json) and, on a Workers Builds production build, removes the /blocks showcase from ./out.
// CI and preview builds keep /blocks so the accessibility and Lighthouse checks still scan it.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProductionBuild } from "../src/lib/build-target.ts";

/** Writes <outDir>/site-version.json and, when env.WORKERS_CI_BRANCH is the production branch, removes the showcase. */
export function finishBuild({ outDir, env, productionBranch }) {
  const commit = env.WORKERS_CI_COMMIT_SHA || env.GITHUB_SHA || null;
  writeFileSync(join(outDir, "site-version.json"), `${JSON.stringify({ commit, builtAt: new Date().toISOString() })}\n`);
  const showcaseRemoved = isProductionBuild(env, productionBranch);
  if (showcaseRemoved) {
    for (const name of ["blocks.html", "blocks.txt", "blocks"]) rmSync(join(outDir, name), { recursive: true, force: true });
  }
  return { commit, showcaseRemoved };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { siteConfig } = await import(pathToFileURL(join(root, "site.config.ts")).href);
  const result = finishBuild({ outDir: join(root, "out"), env: process.env, productionBranch: siteConfig.domain.productionBranch });
  console.log(`Build stamp: ${result.commit ?? "no commit known"}${result.showcaseRemoved ? "; /blocks removed (production build)" : ""}`);
}
