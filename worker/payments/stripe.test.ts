import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createCheckoutSession, encodeForm, getSession, markPayment, STRIPE_VERSION } from "./stripe.ts";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let replies: (() => Response | Error)[] = [];
let logs: string[] = [];
const realFetch = globalThis.fetch;
const realLog = console.log;

const reply = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  replies = [];
  logs = [];
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = replies.shift();
    if (!next) throw new Error("no reply queued");
    const result = next();
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

const headers = (call: Call) => call.init.headers as Record<string, string>;
const body = (call: Call) => new URLSearchParams(String(call.init.body));

const PARAMS = {
  currency: "usd" as const,
  amountMinor: 5000,
  productName: "Example gift card",
  customerEmail: "ada@example.org",
  successUrl: "https://example.test/gift-cards/thanks?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://example.test/gift-cards?checkout=cancelled",
  metadata: { kind: "gift_card", code: "ABCD-EFGH-JKMN" },
};

test("encodes nested values and lists in Stripe's bracket syntax", () => {
  assert.equal(encodeForm({ a: { b: [1, 2], c: "x y" }, skip: undefined }).toString(), "a%5Bb%5D%5B0%5D=1&a%5Bb%5D%5B1%5D=2&a%5Bc%5D=x+y");
});

test("creates a payment session with the Worker's amount, the pinned version and an idempotency key", async () => {
  replies.push(reply(200, { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
  const result = await createCheckoutSession("rk_test_key", PARAMS, "gift-checkout-1");
  assert.deepEqual(result, { ok: true, value: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } });
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(call.init.method, "POST");
  assert.equal(headers(call)["authorization"], "Bearer rk_test_key");
  assert.equal(headers(call)["stripe-version"], STRIPE_VERSION);
  assert.equal(headers(call)["idempotency-key"], "gift-checkout-1");
  const form = body(call);
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "5000");
  assert.equal(form.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(form.get("line_items[0][price_data][product_data][name]"), "Example gift card");
  assert.equal(form.get("line_items[0][quantity]"), "1");
  assert.equal(form.get("customer_email"), "ada@example.org");
  assert.equal(form.get("success_url"), PARAMS.successUrl);
  assert.equal(form.get("metadata[code]"), "ABCD-EFGH-JKMN");
  assert.equal(form.get("payment_intent_data[metadata][code]"), "ABCD-EFGH-JKMN");
  assert.equal(form.get("payment_method_types[0]"), null);
});

test("retries once on a server error or a network failure, then gives a typed failure that holds no secret", async () => {
  replies.push(reply(500, { error: { code: "api_error", message: "rk_test_key leaked here" } }), () => new Error("boom"));
  const failed = await createCheckoutSession("rk_test_key", PARAMS, "k");
  assert.deepEqual(failed, { ok: false, status: 0, code: null });
  assert.equal(calls.length, 2);
  assert.equal(headers(calls[1]!)["idempotency-key"], "k");

  replies.push(reply(503, {}), reply(200, { id: "cs_test_2", url: "https://checkout.stripe.com/x" }));
  assert.ok((await createCheckoutSession("rk_test_key", PARAMS, "k2")).ok);
  for (const line of logs) assert.ok(!line.includes("rk_test_key") && !line.includes("ada@example.org"), line);
});

test("does not retry a refusal, and reports Stripe's fixed code", async () => {
  replies.push(reply(403, { error: { code: "secret_key_required", message: "x" } }));
  assert.deepEqual(await createCheckoutSession("rk_test_key", PARAMS, "k"), { ok: false, status: 403, code: "secret_key_required" });
  assert.equal(calls.length, 1);
});

test("reads a session with its payment and the time the money was taken", async () => {
  replies.push(
    reply(200, {
      id: "cs_test_1",
      status: "complete",
      payment_status: "paid",
      amount_total: 5000,
      currency: "usd",
      created: 1_800_000_000,
      metadata: { kind: "gift_card", n: 5 },
      payment_intent: { id: "pi_1", metadata: { hl_buyer: "sent" }, latest_charge: { created: 1_800_000_030 } },
    }),
  );
  const result = await getSession("rk_test_key", "cs_test_1");
  assert.deepEqual(result, {
    ok: true,
    value: { id: "cs_test_1", status: "complete", paymentStatus: "paid", amountTotal: 5000, currency: "usd", created: 1_800_000_000, metadata: { kind: "gift_card" }, payment: { id: "pi_1", metadata: { hl_buyer: "sent" }, paidAt: 1_800_000_030 } },
  });
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(calls[0]?.url, "https://api.stripe.com/v1/checkout/sessions/cs_test_1?expand%5B%5D=payment_intent.latest_charge");
});

test("an unknown session is a successful null; an unpaid one has no payment", async () => {
  replies.push(reply(404, { error: { code: "resource_missing" } }));
  assert.deepEqual(await getSession("rk_test_key", "cs_test_x"), { ok: true, value: null });
  replies.push(reply(200, { id: "cs_test_2", status: "open", payment_status: "unpaid", amount_total: 100, currency: "usd", created: 1, metadata: {}, payment_intent: null }));
  const open = await getSession("rk_test_key", "cs_test_2");
  assert.ok(open.ok && open.value?.payment === null);
});

test("writes marks into the payment's metadata with an idempotency key that names the values", async () => {
  replies.push(reply(200, { id: "pi_1" }));
  assert.equal(await markPayment("rk_test_key", "pi_1", { hl_ledger: "saved" }), true);
  assert.equal(calls[0]?.url, "https://api.stripe.com/v1/payment_intents/pi_1");
  assert.equal(body(calls[0]!).get("metadata[hl_ledger]"), "saved");
  assert.equal(headers(calls[0]!)["idempotency-key"], "pay-pi_1-mark-hl_ledger=saved");
  replies.push(reply(400, { error: { code: "x" } }));
  assert.equal(await markPayment("rk_test_key", "pi_1", { hl_buyer: "sent" }), false);
});
