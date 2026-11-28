import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { siteConfig } from "../site.config.ts";
import { copyCertificateFonts, finishBuild } from "./finish-build.mjs";
import { headersText } from "./headers-text.mjs";
import { FIXTURE_TRACKING } from "../src/tracking/config.ts";

function fakeOut() {
  const outDir = mkdtempSync(join(tmpdir(), "finish-build-"));
  writeFileSync(join(outDir, "index.html"), "home");
  writeFileSync(join(outDir, "blocks.html"), "showcase");
  writeFileSync(join(outDir, "blocks.txt"), "showcase");
  mkdirSync(join(outDir, "blocks"));
  writeFileSync(join(outDir, "blocks", "index.txt"), "showcase");
  return outDir;
}
const stamp = (outDir) => JSON.parse(readFileSync(join(outDir, "site-version.json"), "utf8"));

test("the stamp uses WORKERS_CI_COMMIT_SHA first, then GITHUB_SHA, then null", () => {
  const a = fakeOut();
  assert.equal(finishBuild({ outDir: a, env: { WORKERS_CI_COMMIT_SHA: "aaa", GITHUB_SHA: "bbb" }, productionBranch: "main" }).commit, "aaa");
  assert.equal(stamp(a).commit, "aaa");
  const b = fakeOut();
  assert.equal(finishBuild({ outDir: b, env: { GITHUB_SHA: "bbb" }, productionBranch: "main" }).commit, "bbb");
  assert.equal(stamp(b).commit, "bbb");
  const c = fakeOut();
  assert.equal(finishBuild({ outDir: c, env: {}, productionBranch: "main" }).commit, null);
  assert.equal(stamp(c).commit, null);
});

test("the stamp is valid JSON with an ISO build time", () => {
  const outDir = fakeOut();
  finishBuild({ outDir, env: {}, productionBranch: "main" });
  const { builtAt } = stamp(outDir);
  assert.equal(new Date(builtAt).toISOString(), builtAt);
});

test("the showcase is removed only on the production branch", () => {
  const prod = fakeOut();
  assert.equal(finishBuild({ outDir: prod, env: { WORKERS_CI_BRANCH: "main" }, productionBranch: "main" }).showcaseRemoved, true);
  for (const name of ["blocks.html", "blocks.txt", "blocks"]) assert.equal(existsSync(join(prod, name)), false, name);
  assert.equal(existsSync(join(prod, "index.html")), true);

  const preview = fakeOut();
  assert.equal(finishBuild({ outDir: preview, env: { WORKERS_CI_BRANCH: "change/owner-1" }, productionBranch: "main" }).showcaseRemoved, false);
  assert.equal(existsSync(join(preview, "blocks.html")), true);
});

test("a Workers Builds build with no branch is treated as production; with another branch it is not", () => {
  for (const env of [{ WORKERS_CI: "1" }, { WORKERS_CI: "1", WORKERS_CI_BRANCH: "" }]) {
    const outDir = fakeOut();
    assert.equal(finishBuild({ outDir, env, productionBranch: "main" }).showcaseRemoved, true);
    assert.equal(existsSync(join(outDir, "blocks.html")), false);
  }
  const preview = fakeOut();
  assert.equal(finishBuild({ outDir: preview, env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "feat/x" }, productionBranch: "main" }).showcaseRemoved, false);
});

test("nothing is removed when neither variable is set, or when productionBranch is missing", () => {
  const local = fakeOut();
  assert.equal(finishBuild({ outDir: local, env: {}, productionBranch: undefined }).showcaseRemoved, false);
  assert.equal(finishBuild({ outDir: local, env: { WORKERS_CI_BRANCH: undefined }, productionBranch: "" }).showcaseRemoved, false);
  assert.equal(existsSync(join(local, "blocks.html")), true);
  assert.equal(finishBuild({ outDir: local, env: { WORKERS_CI_BRANCH: "" }, productionBranch: "" }).showcaseRemoved, false);
});

test("a CI build (GITHUB_SHA, no Workers Builds branch) keeps the showcase", () => {
  const outDir = fakeOut();
  const result = finishBuild({ outDir, env: { GITHUB_SHA: "ccc" }, productionBranch: "main" });
  assert.deepEqual(result, { commit: "ccc", showcaseRemoved: false, drafts: true, giftCardsRemoved: true });
  assert.equal(existsSync(join(outDir, "blocks", "index.txt")), true);
});

test("a production build still succeeds when the showcase files are already absent", () => {
  const outDir = mkdtempSync(join(tmpdir(), "finish-build-"));
  assert.equal(finishBuild({ outDir, env: { WORKERS_CI_BRANCH: "main" }, productionBranch: "main" }).showcaseRemoved, true);
});

test("the stamp says whether drafts were built: yes off production, no on a production build", () => {
  const preview = fakeOut();
  const result = finishBuild({ outDir: preview, env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "change/owner-abc12345" }, productionBranch: "main" });
  assert.equal(result.drafts, true);
  assert.equal(stamp(preview).drafts, true);
  const production = fakeOut();
  assert.equal(finishBuild({ outDir: production, env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }, productionBranch: "main" }).drafts, false);
  assert.equal(stamp(production).drafts, false);
  const unnamed = fakeOut();
  assert.equal(finishBuild({ outDir: unnamed, env: { WORKERS_CI: "1" }, productionBranch: "main" }).drafts, false);
  assert.equal(stamp(unnamed).drafts, false);
});

test("TRACKING_FIXTURE=1 rewrites out/_headers with the CSP the fixture IDs need", () => {
  const outDir = fakeOut();
  writeFileSync(join(outDir, "_headers"), "committed headers");
  finishBuild({ outDir, env: { TRACKING_FIXTURE: "1" }, productionBranch: "main", siteConfig });
  const written = readFileSync(join(outDir, "_headers"), "utf8");
  assert.equal(written, headersText({ ...siteConfig, tracking: FIXTURE_TRACKING }));
  assert.match(written, /script-src [^;]*https:\/\/www\.googletagmanager\.com/);
  assert.match(written, /connect-src [^;]*https:\/\/connect\.facebook\.net/);
});

test("without TRACKING_FIXTURE=1 out/_headers is left alone", () => {
  for (const env of [{}, { TRACKING_FIXTURE: "0" }, { TRACKING_FIXTURE: "true" }, { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }]) {
    const outDir = fakeOut();
    writeFileSync(join(outDir, "_headers"), "committed headers");
    finishBuild({ outDir, env, productionBranch: "main", siteConfig });
    assert.equal(readFileSync(join(outDir, "_headers"), "utf8"), "committed headers", JSON.stringify(env));
  }
});

test("TRACKING_FIXTURE=1 on a production build throws and leaves _headers alone", () => {
  const outDir = fakeOut();
  writeFileSync(join(outDir, "_headers"), "committed headers");
  assert.throws(() => finishBuild({ outDir, env: { TRACKING_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }, productionBranch: "main", siteConfig }), /local test builds only/);
  assert.equal(readFileSync(join(outDir, "_headers"), "utf8"), "committed headers");
});

function withGiftCards(outDir) {
  mkdirSync(join(outDir, "gift-cards"));
  writeFileSync(join(outDir, "gift-cards", "thanks.html"), "thanks");
  writeFileSync(join(outDir, "gift-cards.html"), "keep: not the thank-you folder");
  return outDir;
}

test("with payments off (the template), out/gift-cards is removed and nothing else is", () => {
  const outDir = withGiftCards(fakeOut());
  const result = finishBuild({ outDir, env: {}, productionBranch: "main", siteConfig });
  assert.equal(result.giftCardsRemoved, true);
  assert.equal(existsSync(join(outDir, "gift-cards")), false);
  assert.equal(existsSync(join(outDir, "gift-cards.html")), true);
  assert.equal(existsSync(join(outDir, "index.html")), true);
  assert.equal(existsSync(join(outDir, "blocks.html")), true);
});

test("a build without a gift-cards folder and without siteConfig still succeeds with payments off", () => {
  assert.equal(finishBuild({ outDir: fakeOut(), env: {}, productionBranch: "main" }).giftCardsRemoved, true);
});

test("with payments set, or PAYMENTS_FIXTURE=1 on a local build, out/gift-cards stays", () => {
  const set = withGiftCards(fakeOut());
  const fonts = { display: "outfit", body: "inter", accent: "newsreader" };
  const result = finishBuild({ outDir: set, env: {}, productionBranch: "main", siteConfig: { ...siteConfig, payments: { provider: "stripe", currency: "usd" } }, brandFonts: fonts });
  assert.equal(result.giftCardsRemoved, false);
  assert.equal(readFileSync(join(set, "gift-cards", "thanks.html"), "utf8"), "thanks");

  const fixture = withGiftCards(fakeOut());
  assert.equal(finishBuild({ outDir: fixture, env: { PAYMENTS_FIXTURE: "1" }, productionBranch: "main", siteConfig, brandFonts: fonts }).giftCardsRemoved, false);
  assert.equal(existsSync(join(fixture, "gift-cards", "thanks.html")), true);
});

test("PAYMENTS_FIXTURE=1 on a production build throws", () => {
  const outDir = withGiftCards(fakeOut());
  assert.throws(() => finishBuild({ outDir, env: { PAYMENTS_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }, productionBranch: "main", siteConfig }), /PAYMENTS_FIXTURE/);
});

test("a production build with payments set keeps the page and copies the certificate fonts", () => {
  const outDir = withGiftCards(fakeOut());
  const result = finishBuild({ outDir, env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }, productionBranch: "main", siteConfig: { ...siteConfig, payments: { provider: "stripe", currency: "usd" } }, brandFonts: { display: "outfit", body: "inter", accent: "newsreader" } });
  assert.equal(result.giftCardsRemoved, false);
  assert.equal(existsSync(join(outDir, "gift-cards")), true);
  assert.equal(existsSync(join(outDir, "_certificate", "accent.ttf")), true);
});

test("with payments on, the brand's certificate fonts are copied under fixed names, and the thank-you page stays", () => {
  const outDir = fakeOut();
  mkdirSync(join(outDir, "gift-cards"));
  writeFileSync(join(outDir, "gift-cards", "thanks.html"), "thanks");
  const siteConfig = { payments: { provider: "stripe", currency: "usd" } };
  const result = finishBuild({ outDir, env: {}, productionBranch: "main", siteConfig, brandFonts: { display: "sora", body: "inter", accent: "lora" } });
  assert.equal(result.giftCardsRemoved, false);
  assert.equal(existsSync(join(outDir, "gift-cards", "thanks.html")), true);
  const real = (name) => readFileSync(new URL(`../src/brand/certificate-fonts/${name}`, import.meta.url));
  assert.deepEqual(readFileSync(join(outDir, "_certificate", "display.ttf")), real("display-sora-400.ttf"));
  assert.deepEqual(readFileSync(join(outDir, "_certificate", "display-bold.ttf")), real("display-sora-600.ttf"));
  assert.deepEqual(readFileSync(join(outDir, "_certificate", "accent.ttf")), real("accent-lora-italic.ttf"));
});

test("with payments off, no certificate fonts are copied", () => {
  const outDir = fakeOut();
  finishBuild({ outDir, env: {}, productionBranch: "main", siteConfig: { payments: null }, brandFonts: { display: "outfit", accent: "newsreader" } });
  assert.equal(existsSync(join(outDir, "_certificate")), false);
});

test("a missing certificate font stops the build", () => {
  assert.throws(() => copyCertificateFonts(fakeOut(), { display: "nope", accent: "newsreader" }), /Missing certificate font display-nope-400\.ttf/);
});
