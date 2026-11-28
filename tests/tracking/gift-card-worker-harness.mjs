// Test support for tests/tracking/gift-card-flow.spec.ts: runs the real Worker code (worker/contact.ts) with payments on,
// in its own Node process, behind a tiny local HTTP server. Stripe is faked here with state (sessions, PaymentIntent
// metadata) and signs its webhooks with the endpoint secret, as Stripe does; Turnstile, the Sheet's Apps Script and Resend
// are answered and recorded. The site's assets serve the real certificate fonts, so the certificate is the real PDF.
// Nothing leaves the machine. Usage: node tests/tracking/gift-card-worker-harness.mjs <port> [certificate-out.pdf]
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { exampleGiftCards } from "../../src/gift-cards/example.ts";
import { formFiles } from "../../src/forms/registry.generated.ts";
import { buildWorkerConfig } from "../../worker/config.ts";
import { createWorker } from "../../worker/contact.ts";
import { signStripePayload } from "../../worker/payments/webhook.ts";

const ORIGIN = "https://example.test";
const port = Number(process.argv[2] ?? "4825");
const certificateOut = process.argv[3] ?? null;
const WHSEC = "whsec_fake_endpoint_secret";

const worker = createWorker(
  buildWorkerConfig({
    business: { name: "Example Studio", tagline: "Plain words for plain work" },
    owner: { name: "Pat Example", role: "Founder" },
    domain: { url: ORIGIN, workerName: "example-site", previewHostSuffix: ".workers.dev" },
    forms: { maxForms: 10, maxFields: 12, maxAnswerChars: 20000, maxBodyBytes: 32768 },
    payments: { provider: "stripe", currency: "usd" },
    contact: {
      siteEmail: "hello@example.test",
      fromName: "Example Studio",
      replyFromName: "Pat Example",
      schedulerUrl: "https://example.test/book",
      sheetWriter: "apps-script",
      sheetTabs: { production: "Submissions", preview: "Preview" },
      emailColors: { green: "#1e4fa3", ink: "#1c1917", ink2: "#44403c", rust: "#9a3412", line: "#d6d3d1" },
    },
  }),
  formFiles,
  true,
  { giftCards: exampleGiftCards },
);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fontFile = (name) => readFileSync(new URL(`../../src/brand/certificate-fonts/${name}`, import.meta.url));
const ASSETS = {
  "/_certificate/display.ttf": fontFile("display-outfit-400.ttf"),
  "/_certificate/display-bold.ttf": fontFile("display-outfit-600.ttf"),
  "/_certificate/accent.ttf": fontFile("accent-newsreader-italic.ttf"),
};

const sent = [];
const sessions = new Map();
let count = 0;

function fromForm(form, prefix) {
  const out = {};
  for (const [key, value] of form) if (key.startsWith(prefix) && key.endsWith("]") && value !== "") out[key.slice(prefix.length, -1)] = value;
  return out;
}

function sessionJson(s) {
  return {
    id: s.id,
    status: s.paid ? "complete" : "open",
    payment_status: s.paid ? "paid" : "unpaid",
    amount_total: s.amount,
    currency: s.currency,
    created: s.created,
    metadata: s.metadata,
    url: `https://checkout.stripe.com/c/pay/${s.id}`,
    payment_intent: { id: s.pi, metadata: { ...s.piMetadata }, latest_charge: s.paidAt === null ? null : { created: s.paidAt } },
  };
}

function stripe(url, init) {
  const path = new URL(url).pathname.replace("/v1", "");
  sent.push({ url: `stripe ${init.method ?? "GET"} ${path}`, json: {} });
  if (init.method === "POST" && path === "/checkout/sessions") {
    const form = new URLSearchParams(String(init.body));
    count += 1;
    const session = {
      id: `cs_test_walk${count}`,
      pi: `pi_walk${count}`,
      amount: Number(form.get("line_items[0][price_data][unit_amount]")),
      currency: form.get("line_items[0][price_data][currency]"),
      created: Math.floor(Date.now() / 1000),
      paid: false,
      paidAt: null,
      metadata: fromForm(form, "metadata["),
      piMetadata: fromForm(form, "payment_intent_data[metadata]["),
      successUrl: form.get("success_url"),
      cancelUrl: form.get("cancel_url"),
    };
    sessions.set(session.id, session);
    return json(sessionJson(session));
  }
  const byId = /^\/checkout\/sessions\/(cs_\w+)$/.exec(path);
  if (byId) {
    const found = sessions.get(byId[1]);
    return found ? json(sessionJson(found)) : json({ error: { code: "resource_missing" } }, 404);
  }
  const intent = /^\/payment_intents\/(pi_\w+)$/.exec(path);
  const owner = intent ? [...sessions.values()].find((s) => s.pi === intent[1]) : undefined;
  if (init.method === "POST" && owner) {
    Object.assign(owner.piMetadata, fromForm(new URLSearchParams(String(init.body)), "metadata["));
    return json({ id: owner.pi });
  }
  throw new Error(`Unexpected Stripe call: ${init.method} ${path}`);
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith("https://api.stripe.com/")) return stripe(url, init);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  sent.push({ url, json: body });
  if (url.includes("turnstile/v0/siteverify")) return json({ success: true, hostname: "example.test", action: "gift_card" });
  if (url.startsWith("https://script.google.com/")) return json({ ok: true });
  if (url === "https://api.resend.com/emails") {
    const pdf = body.attachments?.[0]?.content;
    if (pdf && certificateOut) writeFileSync(certificateOut, Buffer.from(pdf, "base64"));
    return json({ id: `email-${sent.length}` });
  }
  throw new Error(`Unexpected outside call: ${url}`);
};

const env = {
  SITE_ENV: "production",
  RESEND_API_KEY: "re_test",
  TURNSTILE_SECRET_KEY: "turnstile-test-secret",
  SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec",
  SHEET_WEBHOOK_SECRET: "webhook-test-secret",
  STRIPE_SECRET_KEY: "rk_live_fake_key_for_the_walk",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  ASSETS: {
    fetch: async (request) => {
      const body = ASSETS[new URL(request.url).pathname];
      return body ? new Response(body) : new Response(null, { status: 404 });
    },
  },
};

const readAll = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

/** Stripe's side of a payment: the session is paid, then its webhook is delivered `times` times, signed. */
async function pay(id, times) {
  const session = sessions.get(id);
  if (!session) return { error: "no such session" };
  session.paid = true;
  session.paidAt = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({ id: `evt_${id}`, type: "checkout.session.completed", data: { object: { id } } });
  const statuses = [];
  for (let i = 0; i < times; i++) {
    const signature = await signStripePayload(raw, WHSEC, Math.floor(Date.now() / 1000));
    const response = await worker.fetch(new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: raw }), env);
    statuses.push(response.status);
  }
  return { statuses, successUrl: session.successUrl, cancelUrl: session.cancelUrl, amount: session.amount };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/sent") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sent));
      return;
    }
    if (req.method === "GET" && url.pathname === "/session") {
      const s = sessions.get(url.searchParams.get("id") ?? "");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(s ? { successUrl: s.successUrl, cancelUrl: s.cancelUrl, amount: s.amount } : null));
      return;
    }
    if (req.method === "POST" && url.pathname === "/pay") {
      const { id, times } = JSON.parse(await readAll(req));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await pay(id, times ?? 1)));
      return;
    }
    // POST /worker: { method, path, headers, body } as the browser sent it; answers { status, cookies, body }.
    const forwarded = JSON.parse(await readAll(req));
    const request = new Request(`${ORIGIN}${forwarded.path}`, {
      method: forwarded.method,
      headers: { ...forwarded.headers, origin: ORIGIN, "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9" },
      body: forwarded.body ?? undefined,
    });
    const response = await worker.fetch(request, env);
    const answer = { status: response.status, cookies: response.headers.getSetCookie(), body: await response.text() };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
  }
}).listen(port, () => console.log(`ready ${port}`));
