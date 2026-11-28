import assert from "node:assert/strict";
import { test } from "node:test";
import { keyMode, paymentProvider, verifyPaymentWebhook } from "./provider.ts";
import { signStripePayload } from "./webhook.ts";

const CONFIG = { provider: "stripe", currency: "usd" } as const;

test("reads the mode a Stripe key names", () => {
  assert.equal(keyMode("rk_test_abc"), "test");
  assert.equal(keyMode("sk_live_abc"), "live");
  assert.equal(keyMode("pk_live_abc"), null);
  assert.equal(keyMode("whsec_abc"), null);
});

test("a test key is for previews only and a live key for production only", () => {
  assert.ok(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "rk_test_a" }, "preview").ok);
  assert.ok(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "sk_test_a" }, "preview").ok);
  assert.ok(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "rk_live_a" }, "production").ok);
  assert.deepEqual(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "rk_test_a" }, "production"), { ok: false, reason: "key_mode" });
  assert.deepEqual(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "rk_live_a" }, "preview"), { ok: false, reason: "key_mode" });
  assert.deepEqual(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "nonsense" }, "production"), { ok: false, reason: "key_mode" });
  assert.deepEqual(paymentProvider(CONFIG, {}, "production"), { ok: false, reason: "no_key" });
});

test("development never gets a provider", () => {
  assert.deepEqual(paymentProvider(CONFIG, { STRIPE_SECRET_KEY: "rk_test_a" }, "development"), { ok: false, reason: "development" });
});

test("the webhook check needs the endpoint secret", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "x", data: { object: {} } });
  const now = 1_800_000_000;
  assert.deepEqual(await verifyPaymentWebhook(CONFIG, {}, body, "t=1,v1=a", now), { ok: false, reason: "unconfigured" });
  const env = { STRIPE_WEBHOOK_SECRET: "whsec_x" };
  assert.ok((await verifyPaymentWebhook(CONFIG, env, body, await signStripePayload(body, "whsec_x", now), now)).ok);
});
