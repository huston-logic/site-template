import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// The tag check (docs/TRACKING.md, "Test the tags locally"): the exported site built with the fixture IDs
// (`TRACKING_FIXTURE=1 npm run build`), served by scripts/preview.mjs with the fixture CSP. Not part of CI or
// `npm run check`; every outside request is answered inside the test, so nothing leaves the machine.
if (!existsSync("out/_headers") || !readFileSync("out/_headers", "utf8").includes("googletagmanager")) {
  throw new Error("No fixture build found. Run `TRACKING_FIXTURE=1 npm run build` before `npm run test:tracking`.");
}

const baseURL = "http://localhost:4823";

export default defineConfig({
  testDir: "tests/tracking",
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, reducedMotion: "reduce" },
  projects: [{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: "node scripts/preview.mjs",
    env: { PORT: "4823" },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    stderr: "pipe",
  },
});
