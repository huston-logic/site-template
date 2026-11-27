// Generates the files that cannot import TypeScript:
//   from site.config.ts: wrangler.jsonc, public/_headers;
//   from src/content/brand.json: the palette src/app/palette.css and the fonts module src/lib/fonts.ts;
//   from src/content/forms/*.json: the registry the Worker bundles, src/forms/registry.generated.ts.
// `node scripts/sync-config.mjs` writes them; `--check` regenerates in memory and exits 1 with a diff if a committed
// file differs. It never writes anywhere else (never .claude/ or .github/).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brandFiles, configProblems, driftedFiles, wranglerText } from "./config-rules.mjs";
import { headersText } from "./headers-text.mjs";

const root = new URL("..", import.meta.url).pathname;
const { siteConfig: c } = await import(pathToFileURL(join(root, "site.config.ts")).href);

const { registrySource, REGISTRY_PATH } = await import(pathToFileURL(join(root, "src/forms/registry.ts")).href);

// The checks on site.config.ts and the secret names (by destination, docs/SECRETS.md) live in config-rules.mjs.
const problems = configProblems(c);
if (problems.length > 0) {
  console.error(`\nConfig check failed: site.config.ts has ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

const wrangler = () => wranglerText(c);

let brand;
try {
  brand = JSON.parse(readFileSync(join(root, "src/content/brand.json"), "utf8"));
} catch (error) {
  console.error(`\nConfig check failed: src/content/brand.json cannot be read: ${error.message}\n`);
  process.exit(1);
}
let fromBrand;
try {
  fromBrand = brandFiles(brand);
} catch (error) {
  console.error(`\nConfig check failed: src/content/brand.json: ${error.message}\n`);
  process.exit(1);
}

// One registry entry per form file, archived forms included (the Worker refuses them by status).
const formsDir = join(root, "src/content/forms");
const formIds = existsSync(formsDir) ? readdirSync(formsDir).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length)) : [];

const generated = {
  "wrangler.jsonc": wrangler(),
  "public/_headers": headersText(c),
  ...fromBrand,
  [REGISTRY_PATH]: registrySource(formIds),
};

if (process.argv.includes("--check")) {
  const drifted = driftedFiles(generated, (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null));
  if (drifted.length > 0) {
    console.error(`\nConfig check failed: ${drifted.length} generated file(s) differ from site.config.ts, src/content/brand.json or src/content/forms/\n`);
    console.error(drifted.join("\n\n"));
    console.error("\nRun `npm run sync:config` and commit the result.\n");
    process.exit(1);
  }
  console.log("Config check passed: generated files match site.config.ts, src/content/brand.json and src/content/forms/.");
} else {
  for (const [path, content] of Object.entries(generated)) {
    const file = join(root, path);
    if (!existsSync(file) || readFileSync(file, "utf8") !== content) {
      writeFileSync(file, content);
      console.log(`wrote ${path}`);
    } else {
      console.log(`unchanged ${path}`);
    }
  }
}
