import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { siteConfig } from "../../site.config.ts";
import { PAYMENT_CURRENCIES, paymentsForBuild } from "./config.ts";

const site = (payments: { provider: "stripe"; currency: "usd" | "gbp" } | null) => ({ payments, domain: { url: "https://example.com", productionBranch: "main" } });

describe("paymentsForBuild", () => {
  test("null stays null on every build", () => {
    assert.equal(paymentsForBuild(site(null), {}), null);
    assert.equal(paymentsForBuild(site(null), { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), null);
  });

  test("a configured value is returned as it is", () => {
    const set = { provider: "stripe", currency: "gbp" } as const;
    assert.deepEqual(paymentsForBuild(site(set), {}), set);
    assert.deepEqual(paymentsForBuild(site(set), { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), set);
  });

  test("PAYMENTS_FIXTURE=1 gives stripe and usd on a local build, over any configured value", () => {
    assert.deepEqual(paymentsForBuild(site(null), { PAYMENTS_FIXTURE: "1" }), { provider: "stripe", currency: "usd" });
    assert.deepEqual(paymentsForBuild(site({ provider: "stripe", currency: "gbp" }), { PAYMENTS_FIXTURE: "1" }), { provider: "stripe", currency: "usd" });
  });

  test("PAYMENTS_FIXTURE=1 throws on a production build and on any Workers Builds build", () => {
    assert.throws(() => paymentsForBuild(site(null), { PAYMENTS_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" }), /PAYMENTS_FIXTURE/);
    assert.throws(() => paymentsForBuild(site(null), { PAYMENTS_FIXTURE: "1", WORKERS_CI: "1" }), /PAYMENTS_FIXTURE/);
    assert.throws(() => paymentsForBuild(site(null), { PAYMENTS_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "feat/x" }), /PAYMENTS_FIXTURE/);
  });

  test("any other value of PAYMENTS_FIXTURE is ignored", () => {
    assert.equal(paymentsForBuild(site(null), { PAYMENTS_FIXTURE: "0" }), null);
  });
});

describe("currencies", () => {
  test("the list is the two-decimal currencies of the design", () => {
    assert.deepEqual([...PAYMENT_CURRENCIES], ["usd", "cad", "gbp", "eur", "aud", "nzd"]);
  });

  test("site.config.ts's inline currency union matches the list", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../../site.config.ts", import.meta.url), "utf8");
    const match = /payments:[^\n]*currency: ([^}]+)\}/.exec(text);
    assert.ok(match, "payments type not found in site.config.ts");
    const union = [...(match[1] ?? "").matchAll(/"([a-z]{3})"/g)].map((m) => m[1]);
    assert.deepEqual(union, [...PAYMENT_CURRENCIES]);
  });

  test("the template ships with payments off", () => {
    assert.equal(siteConfig.payments, null);
  });
});
