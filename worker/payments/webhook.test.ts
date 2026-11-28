import assert from "node:assert/strict";
import { test } from "node:test";
import { signStripePayload, verifyStripeSignature } from "./webhook.ts";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_1" } } });
const NOW = 1_800_000_000;

test("a fresh, correctly signed event passes and is parsed", async () => {
  const result = await verifyStripeSignature(BODY, await signStripePayload(BODY, SECRET, NOW), SECRET, NOW);
  assert.ok(result.ok);
  assert.equal(result.event.type, "checkout.session.completed");
  assert.equal(result.event.data.object["id"], "cs_test_1");
});

test("any one matching v1 is enough", async () => {
  const good = (await signStripePayload(BODY, SECRET, NOW)).replace(/^t=\d+,/, "");
  const header = `t=${NOW},v1=${"0".repeat(64)},${good}`;
  assert.ok((await verifyStripeSignature(BODY, header, SECRET, NOW)).ok);
});

test("refuses a missing, malformed, wrong or stale signature", async () => {
  assert.deepEqual(await verifyStripeSignature(BODY, null, SECRET, NOW), { ok: false, reason: "missing" });
  assert.deepEqual(await verifyStripeSignature(BODY, "", SECRET, NOW), { ok: false, reason: "missing" });
  assert.deepEqual(await verifyStripeSignature(BODY, "garbage", SECRET, NOW), { ok: false, reason: "malformed" });
  assert.deepEqual(await verifyStripeSignature(BODY, `t=${NOW}`, SECRET, NOW), { ok: false, reason: "malformed" });
  assert.deepEqual(await verifyStripeSignature(BODY, `v1=${"a".repeat(64)}`, SECRET, NOW), { ok: false, reason: "malformed" });
  assert.deepEqual(await verifyStripeSignature(BODY, `t=${NOW},v1=${"a".repeat(64)}`, SECRET, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(await verifyStripeSignature(BODY, `t=${NOW},v1=short`, SECRET, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(await verifyStripeSignature(BODY, await signStripePayload(BODY, "whsec_other", NOW), SECRET, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(await verifyStripeSignature(`${BODY} `, await signStripePayload(BODY, SECRET, NOW), SECRET, NOW), { ok: false, reason: "mismatch" });
});

test("the tolerance is 300 seconds either way", async () => {
  const header = await signStripePayload(BODY, SECRET, NOW - 300);
  assert.ok((await verifyStripeSignature(BODY, header, SECRET, NOW)).ok);
  assert.deepEqual(await verifyStripeSignature(BODY, await signStripePayload(BODY, SECRET, NOW - 301), SECRET, NOW), { ok: false, reason: "stale" });
  assert.deepEqual(await verifyStripeSignature(BODY, await signStripePayload(BODY, SECRET, NOW + 301), SECRET, NOW), { ok: false, reason: "stale" });
});

test("a signed body that is not an event is malformed, and nothing is parsed before the signature passes", async () => {
  const notJson = "not json";
  assert.deepEqual(await verifyStripeSignature(notJson, await signStripePayload(notJson, SECRET, NOW), SECRET, NOW), { ok: false, reason: "malformed" });
  assert.deepEqual(await verifyStripeSignature(notJson, `t=${NOW},v1=${"b".repeat(64)}`, SECRET, NOW), { ok: false, reason: "mismatch" });
});
