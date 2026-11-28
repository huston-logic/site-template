// Tests for the payments routes and gift card fulfilment (docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md,
// "Done when"). `fetch` is mocked by a fake world: a Stripe that keeps sessions and payment metadata in memory, a Resend that
// drops a repeated idempotency key, an Apps Script that skips a code it already holds, and a Turnstile. The certificate maker
// is a fake that returns `%PDF-1.7 fake`. Nothing leaves the process and every value is obviously fake.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { isGiftCode } from "../src/gift-cards/code.ts";
import type { GiftCardSettings } from "../src/gift-cards/schema.ts";
import { buildWorkerConfig, type WorkerSiteConfig } from "./config.ts";
import { createWorker } from "./contact.ts";
import type { ContactEnv } from "./env.ts";
import type { CertificateInput } from "./gift-cards/certificate-types.ts";
import { signStripePayload } from "./payments/webhook.ts";

const ORIGIN = "https://example.test";
const WEBHOOK_URL = "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec";
const PIPELINE_URL = "https://pipeline.example.test";
const WHSEC = "whsec_fake_endpoint_secret";
const LIVE_KEY = "rk_live_fake_key_for_tests";
const TEST_KEY = "rk_test_fake_key_for_tests";
const NAME = "Ada Lovelace";
const EMAIL = "ada@example.org";
const RECIPIENT = "Grace Hopper";
const RECIPIENT_EMAIL = "grace@example.org";
const NOTE = "Happy birthday, with love";
const START = Date.UTC(2026, 10, 27, 12, 0, 0);
const TAGGED_PATH = "/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x";

const BASE: WorkerSiteConfig = {
  business: { name: "Example Co", tagline: "Plain words for plain work" },
  owner: { name: "Pat Example", role: "Founder" },
  domain: { url: ORIGIN, workerName: "example-site", previewHostSuffix: ".workers.dev" },
  payments: { provider: "stripe", currency: "usd" },
  contact: {
    siteEmail: "hello@example.test",
    fromName: "Example Co",
    replyFromName: "Pat Example",
    schedulerUrl: "https://example.test/book",
    sheetWriter: "apps-script",
    sheetTabs: { production: "Submissions", preview: "Preview" },
    emailColors: { green: "#112233", ink: "#223344", ink2: "#334455", rust: "#445566", line: "#556677" },
  },
};

const SETTINGS: GiftCardSettings = {
  selling: true,
  amounts: [{ amount: 25 }, { amount: 50 }, { amount: 100 }],
  custom: { min: 25, max: 500 },
  redeemWording: "Show this certificate when you book.",
  termsLine: "Not redeemable for cash.",
  validForMonths: null,
};

type Session = {
  id: string;
  pi: string;
  idempotencyKey: string;
  unit_amount: number;
  currency: string;
  amount_total: number;
  status: "open" | "complete";
  payment_status: "unpaid" | "paid";
  created: number;
  chargeAt: number | null;
  metadata: Record<string, string>;
  piMetadata: Record<string, string>;
};
type Email = { key: string; to: string; subject: string; text: string; attachments?: { filename: string; content: string }[]; headers?: Record<string, string> };
type Row = { tab: string; row: string[] };

let sessions: Session[] = [];
let emails: Email[] = [];
let attempts: string[] = [];
let rows: Row[] = [];
let intakes: Record<string, unknown>[] = [];
let stripeCalls: string[] = [];
let siteverifyCalls = 0;
let logs: string[] = [];
let clock = START;
let sheetOk = true;
let resendFails: (key: string) => boolean = () => false;
let markFails = false;
let certificateFails = false;
let madeCertificates: CertificateInput[] = [];
let turnstileOk = true;
let seen = 0;
const realFetch = globalThis.fetch;
const realLog = console.log;
const realNow = Date.now;

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pdfBytes = new TextEncoder().encode("%PDF-1.7 fake");

function stripeSessionJson(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    status: s.status,
    payment_status: s.payment_status,
    amount_total: s.amount_total,
    currency: s.currency,
    created: s.created,
    metadata: s.metadata,
    url: `https://checkout.stripe.com/c/pay/${s.id}`,
    payment_intent: { id: s.pi, metadata: { ...s.piMetadata }, latest_charge: s.chargeAt === null ? null : { created: s.chargeAt } },
  };
}

function fromForm(form: URLSearchParams, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Stripe leaves an empty metadata value out, so the fake does too.
  for (const [key, value] of form) if (key.startsWith(prefix) && key.endsWith("]") && value !== "") out[key.slice(prefix.length, -1)] = value;
  return out;
}

async function stripe(url: string, init: RequestInit): Promise<Response> {
  const path = new URL(url).pathname.replace("/v1", "");
  stripeCalls.push(`${init.method ?? "GET"} ${path}`);
  const headers = init.headers as Record<string, string>;
  assert.match(headers["authorization"] ?? "", /^Bearer rk_(live|test)_/);
  assert.ok(headers["stripe-version"]);
  if (init.method === "POST" && path === "/checkout/sessions") {
    const form = new URLSearchParams(String(init.body));
    const key = headers["idempotency-key"] ?? "";
    const again = sessions.find((s) => s.idempotencyKey === key);
    if (again) return jsonResponse(stripeSessionJson(again));
    const metadata = fromForm(form, "metadata[");
    for (const value of [...Object.values(metadata), ...Object.values(fromForm(form, "payment_intent_data[metadata]["))]) assert.ok(value.length <= 500, "a metadata value is over 500 characters");
    const amount = Number(form.get("line_items[0][price_data][unit_amount]"));
    seen += 1;
    const session: Session = {
      id: `cs_test_session${seen}`,
      pi: `pi_payment${seen}`,
      idempotencyKey: key,
      unit_amount: amount,
      currency: form.get("line_items[0][price_data][currency]") ?? "",
      amount_total: amount,
      status: "open",
      payment_status: "unpaid",
      created: Math.floor(clock / 1000),
      chargeAt: null,
      metadata,
      piMetadata: fromForm(form, "payment_intent_data[metadata]["),
    };
    assert.equal(form.get("mode"), "payment");
    assert.ok((form.get("success_url") ?? "").endsWith("/gift-cards/thanks?session_id={CHECKOUT_SESSION_ID}"));
    sessions.push(session);
    return jsonResponse(stripeSessionJson(session));
  }
  const sessionMatch = /^\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(path);
  if (init.method === undefined || init.method === "GET") {
    const found = sessions.find((s) => s.id === sessionMatch?.[1]);
    return found ? jsonResponse(stripeSessionJson(found)) : jsonResponse({ error: { code: "resource_missing" } }, 404);
  }
  const intentMatch = /^\/payment_intents\/(pi_[A-Za-z0-9_]+)$/.exec(path);
  const owner = sessions.find((s) => s.pi === intentMatch?.[1]);
  if (init.method === "POST" && owner) {
    if (markFails) return jsonResponse({ error: { code: "api_error" } }, 500);
    Object.assign(owner.piMetadata, fromForm(new URLSearchParams(String(init.body)), "metadata["));
    return jsonResponse({ id: owner.pi });
  }
  throw new Error(`Unexpected Stripe call: ${init.method} ${path}`);
}

function resend(init: RequestInit): Response {
  const headers = init.headers as Record<string, string>;
  const key = headers["idempotency-key"] ?? "";
  attempts.push(key);
  if (resendFails(key)) return jsonResponse({ message: "down" }, 500);
  const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string; html?: string; attachments?: Email["attachments"]; headers?: Record<string, string> };
  assert.equal(body.html, undefined, "gift card emails are plain text");
  if (!emails.some((email) => email.key === key)) emails.push({ key, to: body.to[0] ?? "", subject: body.subject, text: body.text, attachments: body.attachments, headers: body.headers });
  return jsonResponse({ id: `email-${emails.length}` });
}

function appsScript(init: RequestInit): Response {
  if (!sheetOk) return jsonResponse({ ok: false });
  const { tab, row } = JSON.parse(String(init.body)) as { tab: string; row: string[] };
  // What docs/apps-script/contact-sheet.gs does for a gift card tab: a code already in column B is saved, not added again.
  if (tab.startsWith("Gift cards") && rows.some((entry) => entry.tab === tab && entry.row[1] === row[1])) return jsonResponse({ ok: true });
  rows.push({ tab, row });
  return jsonResponse({ ok: true });
}

beforeEach(() => {
  sessions = [];
  emails = [];
  attempts = [];
  rows = [];
  intakes = [];
  stripeCalls = [];
  siteverifyCalls = 0;
  logs = [];
  clock = START;
  sheetOk = true;
  resendFails = () => false;
  markFails = false;
  certificateFails = false;
  madeCertificates = [];
  turnstileOk = true;
  seen = 0;
  Date.now = () => clock;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.stripe.com/")) return stripe(url, init);
    if (url === "https://api.resend.com/emails") return resend(init);
    if (url.startsWith("https://script.google.com/")) return appsScript(init);
    if (url.startsWith(`${PIPELINE_URL}/`)) {
      intakes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({ ok: true }, 201);
    }
    if (url.includes("turnstile/v0/siteverify")) {
      siteverifyCalls += 1;
      return jsonResponse({ success: turnstileOk, hostname: "example.test", action: "gift_card" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  Date.now = realNow;
  const codes = sessions.map((s) => s.metadata["code"] ?? "");
  for (const line of logs) {
    for (const secret of [NAME, EMAIL, RECIPIENT, RECIPIENT_EMAIL, NOTE, "203.0.113.9", "re_test", WHSEC, LIVE_KEY, TEST_KEY, "webhook-test-secret", "EXAMPLE_DEPLOYMENT_ID", "turnstile-test-secret", ...codes]) {
      if (secret) assert.ok(!line.includes(secret), `log line leaked "${secret}": ${line}`);
    }
  }
});

const makeCertificate = async (input: CertificateInput): Promise<Uint8Array> => {
  madeCertificates.push(input);
  if (certificateFails) throw new Error("no certificate");
  return pdfBytes;
};

function worker(site: WorkerSiteConfig = BASE, settings: GiftCardSettings = SETTINGS) {
  return createWorker(buildWorkerConfig(site), [], false, { giftCards: settings, makeCertificate, now: () => clock });
}

function env(overrides: Partial<ContactEnv> = {}): ContactEnv {
  return {
    SITE_ENV: "production",
    RESEND_API_KEY: "re_test",
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    SHEET_WEBHOOK_URL: WEBHOOK_URL,
    SHEET_WEBHOOK_SECRET: "webhook-test-secret",
    INTAKE_SECRET: "intake-test-secret",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_WEBHOOK_SECRET: WHSEC,
    CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

const valid = {
  choice: { kind: "preset", amount: 50 },
  buyerName: NAME,
  buyerEmail: EMAIL,
  recipientName: RECIPIENT,
  recipientEmail: RECIPIENT_EMAIL,
  message: NOTE,
  returnPath: "/gift-cards",
  turnstileToken: "token-abc",
  company_fax: "",
};

function checkoutRequest(body: unknown, { origin = ORIGIN, contentType = "application/json", cookie, raw, base = ORIGIN }: { origin?: string; contentType?: string; cookie?: string; raw?: string; base?: string } = {}): Request {
  return new Request(`${base}/api/gift-cards/checkout`, {
    method: "POST",
    headers: { origin, "content-type": contentType, "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9", ...(cookie ? { cookie } : {}) },
    body: raw ?? JSON.stringify(body),
  });
}

async function webhookRequest(type: string, sessionId: string, { at = Math.floor(clock / 1000), secret = WHSEC, tamper = false }: { at?: number; secret?: string; tamper?: boolean } = {}): Promise<Request> {
  const raw = JSON.stringify({ id: `evt_${type}_${sessionId}`, type, data: { object: { id: sessionId } } });
  const signature = await signStripePayload(raw, secret, at);
  return new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: tamper ? `${raw} ` : raw });
}

function confirmRequest(sessionId: string, { sameSite = true }: { sameSite?: boolean } = {}): Request {
  return new Request(`${ORIGIN}/api/gift-cards/confirm?session_id=${sessionId}`, { headers: { ...(sameSite ? { "sec-fetch-site": "same-origin" } : { "sec-fetch-site": "cross-site" }), "cf-connecting-ip": "203.0.113.9" } });
}

/** The visitor's first-party source cookie, set the way the site does it. */
async function sourceCookie(w: ReturnType<typeof worker>): Promise<string> {
  const response = await w.fetch(
    new Request(`${ORIGIN}/api/visit`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ path: TAGGED_PATH, referrer: "https://www.google.com/" }) }),
    env(),
  );
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** Starts a checkout and returns the session the fake Stripe holds for it. */
async function buy(w: ReturnType<typeof worker>, overrides: Record<string, unknown> = {}, environment: ContactEnv = env(), cookie?: string): Promise<Session> {
  const response = await w.fetch(checkoutRequest({ ...valid, ...overrides }, { cookie }), environment);
  assert.equal(response.status, 200, await response.clone().text());
  const session = sessions.at(-1);
  assert.ok(session);
  return session;
}

function pay(session: Session, at = clock): void {
  session.status = "complete";
  session.payment_status = "paid";
  session.chargeAt = Math.floor(at / 1000);
}

const kindOf = (email: Email): string => email.key.split("-").at(-1) ?? "";
const emailsOf = (kind: string): Email[] => emails.filter((email) => kindOf(email) === kind);
const decode = (content: string): string => Buffer.from(content, "base64").toString("utf8");

async function deliver(w: ReturnType<typeof worker>, session: Session, type = "checkout.session.completed", environment: ContactEnv = env()): Promise<Response> {
  return w.fetch(await webhookRequest(type, session.id), environment);
}

describe("the walk: checkout, payment, one signed webhook", () => {
  test("the session carries the Worker's amount, and one webhook gives one of everything with the same code, amount and source", async () => {
    const w = worker();
    const cookie = await sourceCookie(w);
    const response = await w.fetch(checkoutRequest(valid, { cookie }), env());
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; url: string };
    assert.deepEqual(body, { ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_session1" });
    assert.equal(response.headers.get("cache-control"), "no-store");

    const [session] = sessions;
    assert.ok(session);
    assert.equal(session.unit_amount, 5000, "the amount is the Worker's, in minor units");
    assert.equal(session.currency, "usd");
    const code = session.metadata["code"];
    assert.ok(isGiftCode(code), `not a gift card code: ${code}`);
    assert.equal(session.metadata["kind"], "gift_card");
    assert.equal(session.metadata["site_mode"], "production");
    assert.equal(session.metadata["site"], "example-site", "the sale is bound to this site's Worker name");
    assert.deepEqual(session.piMetadata, session.metadata, "the payment carries the same details, where the marks live");
    assert.equal(emails.length, 0, "nothing is sent before payment");
    assert.equal(rows.length, 0);

    pay(session);
    const hook = await deliver(w, session);
    assert.equal(hook.status, 200);

    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("recipient").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(emailsOf("alert").length, 0);
    assert.equal(rows.length, 1);

    const [buyer] = emailsOf("buyer");
    assert.equal(buyer?.to, EMAIL);
    assert.equal(buyer?.subject, "Your Example Co gift card");
    assert.ok(buyer?.text.includes("Hi Ada,"));
    assert.ok(buyer?.text.includes(code ?? "?"));
    assert.ok(buyer?.text.includes("$50.00"));
    assert.ok(buyer?.text.includes("Show this certificate when you book."));
    assert.equal(buyer?.attachments?.length, 1);
    assert.equal(buyer?.attachments?.[0]?.filename, `gift-card-${code}.pdf`);
    assert.equal(decode(buyer?.attachments?.[0]?.content ?? ""), "%PDF-1.7 fake");

    const [recipient] = emailsOf("recipient");
    assert.equal(recipient?.to, RECIPIENT_EMAIL);
    assert.ok(recipient?.text.includes(NOTE));
    assert.ok(recipient?.text.includes(code ?? "?"));
    assert.equal(decode(recipient?.attachments?.[0]?.content ?? ""), "%PDF-1.7 fake");

    const [owner] = emailsOf("owner");
    assert.equal(owner?.to, "hello@example.test");
    assert.equal(owner?.subject, `New gift card sold: $50.00 from ${NAME}`);
    assert.ok(owner?.text.includes(`Code: ${code}`));
    assert.ok(owner?.text.includes("Amount: $50.00"));
    assert.ok(owner?.text.includes("Came from: google / cpc, campaign spring-sale, first visit 2026-11-27"));
    assert.ok(owner?.text.includes("Sheet: saved"));
    assert.ok(owner?.text.includes(`Payment: ${session.pi}`));
    assert.ok(!owner?.text.includes("delivered late"));

    const [row] = rows;
    assert.equal(row?.tab, "Gift cards");
    assert.equal(row?.row.length, 16);
    assert.deepEqual(row?.row.slice(0, 8), ["2026-11-27T12:00:00.000Z", code, "$50.00", NAME, EMAIL, `${RECIPIENT} <${RECIPIENT_EMAIL}>`, NOTE, session.pi]);
    assert.equal(row?.row[8], "google / cpc", "the lead source is the visit's, kept from checkout time");
    assert.equal(row?.row[9], "spring-sale");
    assert.deepEqual(row?.row.slice(13), ["", "", ""]);

    assert.deepEqual(
      Object.keys(session.piMetadata).filter((key) => key.startsWith("hl_")).sort(),
      ["hl_buyer", "hl_ledger", "hl_owner", "hl_recipient"],
    );
    assert.equal(session.piMetadata["hl_ledger"], "saved");

    assert.equal(madeCertificates.length, 1, "one certificate serves the buyer and the recipient");
    assert.deepEqual(madeCertificates[0], {
      businessName: "Example Co",
      siteHost: "example.test",
      amountText: "$50",
      code,
      to: RECIPIENT,
      from: NAME,
      message: NOTE,
      redeemWording: SETTINGS.redeemWording,
      termsLine: SETTINGS.termsLine,
      issuedOn: "November 27, 2026",
      validUntil: null,
      colors: BASE.contact.emailColors,
    });
  });

  test("an expiry and no recipient email: the buyer is told to give the card themselves", async () => {
    const w = worker(BASE, { ...SETTINGS, validForMonths: 60 });
    const session = await buy(w, { recipientEmail: "" });
    pay(session);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("recipient").length, 0);
    assert.equal(madeCertificates[0]?.validUntil, "November 27, 2031");
    const [buyer] = emailsOf("buyer");
    assert.ok(buyer?.text.includes("Use it by November 27, 2031."));
    assert.ok(buyer?.text.includes("print the certificate or forward this email"));
    assert.ok(emailsOf("owner")[0]?.text.includes("Certificate to the recipient: none (no email given)"));
  });

  test("a custom amount inside the range is charged as sent; the code is new every time", async () => {
    const w = worker();
    const first = await buy(w, { choice: { kind: "custom", amount: 75 } });
    const second = await buy(w, { choice: { kind: "preset", amount: 25 } });
    assert.equal(first.unit_amount, 7500);
    assert.equal(second.unit_amount, 2500);
    assert.notEqual(first.metadata["code"], second.metadata["code"]);
  });
});

describe("repeats and out-of-order events", () => {
  test("the same webhook three times gives one of each", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    for (let i = 0; i < 3; i++) assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("recipient").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
    assert.equal(madeCertificates.length, 1, "later deliveries skip every marked step, even the certificate");
  });

  test("async_payment_succeeded before completed, then a duplicate, still gives one of each", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    assert.equal((await deliver(w, session, "checkout.session.async_payment_succeeded")).status, 200);
    assert.equal((await deliver(w, session, "checkout.session.completed")).status, 200);
    assert.equal((await deliver(w, session, "checkout.session.async_payment_succeeded")).status, 200);
    assert.equal(emails.length, 3);
    assert.equal(rows.length, 1);
  });

  test("a completed event for a payment that has not cleared does nothing; the later success does everything once", async () => {
    const w = worker();
    const session = await buy(w);
    session.status = "complete";
    assert.equal((await deliver(w, session, "checkout.session.completed")).status, 200);
    assert.equal(emails.length, 0);
    assert.equal(rows.length, 0);
    pay(session);
    assert.equal((await deliver(w, session, "checkout.session.async_payment_succeeded")).status, 200);
    assert.equal(emails.length, 3);
    assert.equal(rows.length, 1);
  });

  test("two deliveries at the same moment, before any mark is written, still send each email once", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    const [a, b] = await Promise.all([deliver(w, session), deliver(w, session)]);
    assert.equal(a?.status, 200);
    assert.equal(b?.status, 200);
    assert.equal(emailsOf("buyer").length, 1, "Resend drops the repeated idempotency key");
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1, "the Apps Script skips a code it already holds");
  });

  test("other events and other sessions are answered 200 and change nothing", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    assert.equal((await deliver(w, session, "payment_intent.created")).status, 200);
    assert.equal((await deliver(w, session, "checkout.session.async_payment_failed")).status, 200);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", "cs_test_unknown"), env())).status, 200);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", "not-a-session"), env())).status, 200);
    session.metadata["kind"] = "booking";
    assert.equal((await deliver(w, session)).status, 200);
    // A paid session of this site that says it is a booking, on a site with booking off, is told to the owner (never a certificate, never a row).
    assert.equal(emails.length, 1);
    assert.ok(emails[0]?.subject.startsWith("ACTION NEEDED"));
    assert.equal(rows.length, 0);
  });
});

describe("refused with nothing created or sent", () => {
  test("a wrong, missing or malformed signature", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    stripeCalls = [];
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", session.id, { secret: "whsec_someone_else" }), env())).status, 400);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", session.id, { tamper: true }), env())).status, 400);
    const bare = new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", body: "{}" });
    assert.equal((await w.fetch(bare, env())).status, 400);
    const junk = new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", headers: { "stripe-signature": "nonsense" }, body: "{}" });
    assert.equal((await w.fetch(junk, env())).status, 400);
    assert.equal(emails.length, 0);
    assert.equal(rows.length, 0);
    assert.equal(stripeCalls.length, 0, "an unsigned body never makes Stripe calls");
  });

  test("a stale timestamp (over 300 seconds) is refused; 300 is accepted", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    const now = Math.floor(clock / 1000);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", session.id, { at: now - 301 }), env())).status, 400);
    assert.equal(emails.length, 0);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", session.id, { at: now - 300 }), env())).status, 200);
    assert.equal(emails.length, 3);
  });

  test("a forged amount: no code, one alert to the owner naming the payment and amount, never repeated", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    session.amount_total = 100;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emails.length, 1);
    const [alert] = emailsOf("mismatch");
    assert.equal(alert?.key, `gift-${session.pi}-mismatch`);
    assert.equal(alert?.to, "hello@example.test");
    assert.ok(alert?.text.includes(session.pi));
    assert.ok(alert?.text.includes("$1.00"));
    assert.ok(alert?.text.includes("no certificate was issued") && alert.text.includes("refund"));
    assert.ok(!alert?.text.includes(session.metadata["code"] ?? "?"), "no code is ever given out for a mismatch");
    assert.equal(alert?.attachments, undefined);
    assert.equal(rows.length, 0);
    assert.deepEqual(Object.keys(session.piMetadata).filter((key) => key.startsWith("hl_")), ["hl_mismatch"]);
    assert.ok(logs.some((line) => line.includes("payment_mismatch")));
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("mismatch").length, 1, "the mark stops a second alert");
    session.amount_total = 5000;
    session.currency = "eur";
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emails.length, 1, "a different currency is a mismatch too, and the alert is still once");
    assert.equal(madeCertificates.length, 0);
  });

  test("a mismatch alert that cannot be sent is a 500 so Stripe tries again", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    session.amount_total = 100;
    resendFails = () => true;
    assert.equal((await deliver(w, session)).status, 500);
    resendFails = () => false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("mismatch").length, 1);
  });

  test("a sale bound to another site, or to none, is ignored in silence", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    session.metadata["site"] = "other-site";
    assert.equal((await deliver(w, session)).status, 200);
    session.amount_total = 100;
    assert.equal((await deliver(w, session)).status, 200);
    delete session.metadata["site"];
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emails.length, 0, "not even a mismatch alert");
    assert.equal(rows.length, 0);
    assert.equal((await w.fetch(confirmRequest(session.id), env())).status, 404);
  });

  test("an amount outside the custom range, a custom amount with the range off, an amount nobody offered", async () => {
    const w = worker();
    for (const choice of [{ kind: "custom", amount: 24 }, { kind: "custom", amount: 501 }, { kind: "preset", amount: 75 }, { kind: "custom", amount: 50.5 }, { kind: "custom", amount: "50" }, { kind: "preset", amount: 50, extra: 1 }, { kind: "other", amount: 50 }, null]) {
      const response = await w.fetch(checkoutRequest({ ...valid, choice }), env());
      assert.equal(response.status, 400, JSON.stringify(choice));
      assert.deepEqual(await response.json(), { ok: false, error: "rejected" });
    }
    const noRange = worker(BASE, { ...SETTINGS, custom: null });
    assert.equal((await noRange.fetch(checkoutRequest({ ...valid, choice: { kind: "custom", amount: 50 } }), env())).status, 400);
    assert.equal(sessions.length, 0);
    assert.equal(stripeCalls.length, 0);
  });

  test("selling off", async () => {
    const w = worker(BASE, { ...SETTINGS, selling: false });
    const response = await w.fetch(checkoutRequest(valid), env());
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, error: "closed" });
    assert.equal(sessions.length, 0);
    assert.equal(stripeCalls.length, 0);
  });

  test("a paid session of another kind or another mode is ignored", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    session.metadata["site_mode"] = "preview";
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emails.length, 0);
  });
});

describe("the checkout route's layers", () => {
  test("cross-origin, content type, unknown keys, honeypot, bad JSON, size", async () => {
    const w = worker();
    assert.equal((await w.fetch(checkoutRequest(valid, { origin: "https://evil.example" }), env())).status, 403);
    assert.equal((await w.fetch(checkoutRequest(valid, { contentType: "text/plain" }), env())).status, 415);
    assert.equal((await w.fetch(checkoutRequest({ ...valid, amount: 5 }), env())).status, 400);
    assert.equal((await w.fetch(checkoutRequest({ ...valid, company_fax: "x" }), env())).status, 400);
    assert.equal((await w.fetch(checkoutRequest(null, { raw: "{not json" }), env())).status, 400);
    assert.equal((await w.fetch(checkoutRequest(null, { raw: JSON.stringify({ ...valid, message: "x".repeat(9000) }) }), env())).status, 413);
    assert.equal((await w.fetch(new Request(`${ORIGIN}/api/gift-cards/checkout`, { method: "GET" }), env())).status, 405);
    assert.equal(siteverifyCalls, 0, "the cheap checks come before Turnstile");
    assert.equal(sessions.length, 0);
  });

  test("a rate-limited visitor", async () => {
    const response = await worker().fetch(checkoutRequest(valid), env({ CONTACT_RATE_LIMIT: { limit: async () => ({ success: false }) } }));
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { ok: false, error: "rate_limited" });
    assert.equal(siteverifyCalls, 0);
  });

  test("field errors name the fields; a bad return path or a non-text value is malformed", async () => {
    const w = worker();
    const bad = await w.fetch(checkoutRequest({ ...valid, buyerName: "", buyerEmail: "nope", recipientEmail: "also nope", message: "x".repeat(301) }), env());
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { ok: false, error: "invalid", fields: ["buyerName", "buyerEmail", "recipientEmail", "message"] });
    for (const overrides of [{ returnPath: "https://evil.example/" }, { returnPath: "//evil.example" }, { returnPath: "/Gift?x=1" }, { buyerName: 5 }, { returnPath: undefined }]) {
      const response = await w.fetch(checkoutRequest({ ...valid, ...overrides }), env());
      assert.equal(response.status, 400, JSON.stringify(overrides));
      assert.deepEqual(await response.json(), { ok: false, error: "rejected" });
    }
    assert.equal(sessions.length, 0);
  });

  test("the recipient is optional; names and the message are cleaned to one line", async () => {
    const session = await buy(worker(), { recipientName: "", recipientEmail: "", message: "", buyerName: "  Ada \n Lovelace " });
    assert.equal(session.metadata["buyer_name"], "Ada Lovelace");
    assert.equal(session.metadata["recipient_email"], undefined);
  });

  test("Turnstile: a failed check, a wrong action and a missing token are refused", async () => {
    const w = worker();
    turnstileOk = false;
    assert.equal((await w.fetch(checkoutRequest(valid), env())).status, 403);
    turnstileOk = true;
    assert.equal((await w.fetch(checkoutRequest({ ...valid, turnstileToken: "" }), env())).status, 403);
    assert.equal((await w.fetch(checkoutRequest(valid), env({ TURNSTILE_SECRET_KEY: undefined }))).status, 502);
    assert.equal(sessions.length, 0);
  });

  test("the thank-you and cancel addresses are the site's own, and the cancel one returns to the page the block is on", async () => {
    let form = new URLSearchParams();
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).startsWith("https://api.stripe.com/v1/checkout/sessions") && init.method === "POST") form = new URLSearchParams(String(init.body));
      return inner(input, init);
    }) as typeof fetch;
    await buy(worker(), { returnPath: "/shop/gift-cards" });
    assert.equal(form.get("success_url"), `${ORIGIN}/gift-cards/thanks?session_id={CHECKOUT_SESSION_ID}`);
    assert.equal(form.get("cancel_url"), `${ORIGIN}/shop/gift-cards?checkout=cancelled`);
    assert.equal(form.get("customer_email"), EMAIL);
    assert.equal(form.get("line_items[0][price_data][product_data][name]"), "Example Co gift card ($50.00)");
  });

  test("the lead source rides in the payment's metadata, each value within 500 characters", async () => {
    const w = worker();
    const session = await buy(w, {}, env(), await sourceCookie(w));
    const keys = Object.keys(session.metadata);
    assert.ok(keys.includes("src_cells") && keys.includes("src_line") && keys.includes("src_pipe0"));
    assert.ok(session.metadata["src_line"]?.startsWith("Came from: google / cpc"));
  });
});

describe("key mode, development and payments off", () => {
  test("a test key on production, a live key on a preview, a missing key: 502 payments_misconfigured, nothing created", async () => {
    const w = worker();
    for (const environment of [env({ STRIPE_SECRET_KEY: TEST_KEY }), env({ SITE_ENV: "preview", STRIPE_SECRET_KEY: LIVE_KEY }), env({ STRIPE_SECRET_KEY: undefined })]) {
      const response = await w.fetch(checkoutRequest(valid), environment);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { ok: false, error: "payments_misconfigured" });
    }
    assert.equal(sessions.length, 0);
    assert.equal(stripeCalls.length, 0);
    const confirm = await w.fetch(confirmRequest("cs_test_session1"), env({ STRIPE_SECRET_KEY: TEST_KEY }));
    assert.equal(confirm.status, 502);
    assert.equal(stripeCalls.length, 0);
  });

  test("no webhook secret or no Resend key: 502 payments_misconfigured, nothing created in Stripe", async () => {
    const w = worker();
    for (const environment of [env({ STRIPE_WEBHOOK_SECRET: undefined }), env({ RESEND_API_KEY: undefined })]) {
      const response = await w.fetch(checkoutRequest(valid), environment);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { ok: false, error: "payments_misconfigured" });
    }
    assert.equal(sessions.length, 0);
    assert.equal(stripeCalls.length, 0);
  });

  test("a Stripe failure is a plain 502 and logs only a status", async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => (String(input).startsWith("https://api.stripe.com/") ? jsonResponse({ error: { code: "api_error", message: LIVE_KEY } }, 500) : inner(input, init))) as typeof fetch;
    const response = await worker().fetch(checkoutRequest(valid), env());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, error: "unavailable" });
  });

  test("development never calls Stripe: the block gets its own page back as a cancelled checkout", async () => {
    const base = "http://localhost:8787";
    const response = await worker().fetch(checkoutRequest(valid, { origin: base, base }), env({ SITE_ENV: "development", STRIPE_SECRET_KEY: undefined }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, url: `${base}/gift-cards?checkout=cancelled` });
    assert.equal(stripeCalls.length, 0);
    const hook = await worker().fetch(new Request(`${base}/api/payments/stripe`, { method: "POST", body: "{}" }), env({ SITE_ENV: "development" }));
    assert.equal(hook.status, 404);
  });

  test("with payments off every payments route is a 404, whatever the method", async () => {
    const { payments: _payments, ...withoutPayments } = BASE;
    void _payments;
    const w = worker(withoutPayments);
    for (const [path, method] of [["/api/gift-cards/checkout", "POST"], ["/api/gift-cards/checkout", "GET"], ["/api/gift-cards/confirm?session_id=cs_test_a", "GET"], ["/api/payments/stripe", "POST"]] as const) {
      const response = await w.fetch(new Request(`${ORIGIN}${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) }), env());
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    const nulled = worker({ ...BASE, payments: null });
    assert.equal((await nulled.fetch(checkoutRequest(valid), env())).status, 404);
    assert.equal(stripeCalls.length, 0);
    assert.equal(siteverifyCalls, 0);
  });

  test("the wrong method on a payments route is a 405 with the allowed one", async () => {
    const w = worker();
    const response = await w.fetch(new Request(`${ORIGIN}/api/payments/stripe`), env());
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.equal((await w.fetch(new Request(`${ORIGIN}/api/gift-cards/confirm?session_id=cs_test_a`, { method: "POST" }), env())).headers.get("allow"), "GET");
  });

  test("an oversized webhook body is refused before anything is read", async () => {
    const response = await worker().fetch(new Request(`${ORIGIN}/api/payments/stripe`, { method: "POST", body: "x".repeat(262_145) }), env());
    assert.equal(response.status, 413);
    assert.equal(stripeCalls.length, 0);
  });

  test("a missing webhook secret is a 500, never a pass", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    assert.equal((await w.fetch(await webhookRequest("checkout.session.completed", session.id), env({ STRIPE_WEBHOOK_SECRET: undefined }))).status, 500);
    assert.equal(emails.length, 0);
  });
});

describe("failure after payment", () => {
  test("the Sheet failing: the buyer still gets the certificate and the owner is told the row was NOT saved, with the row", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    sheetOk = false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("buyer")[0]?.attachments?.length, 1);
    assert.equal(rows.length, 0);
    const [owner] = emailsOf("owner");
    const code = session.metadata["code"] ?? "?";
    assert.ok(owner?.text.includes("Sheet: NOT saved - add this row by hand"));
    for (const line of ["  Sold (UTC): 2026-11-27T12:00:00.000Z", `  Code: ${code}`, "  Amount: $50.00", `  Buyer: ${NAME}`, `  Buyer email: ${EMAIL}`, `  Recipient: ${RECIPIENT} <${RECIPIENT_EMAIL}>`, `  Message: ${NOTE}`, `  Stripe payment: ${session.pi}`, "  Came from: Not known"]) {
      assert.ok(owner?.text.includes(line), line);
    }
    assert.equal(session.piMetadata["hl_ledger"], "by-hand");
    sheetOk = true;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(rows.length, 0, "the by-hand mark stops a retry adding the row a second time");
    assert.equal(emailsOf("owner").length, 1);
  });

  test("the buyer's email failing: an alert with the certificate at once, 500, ledger saved, and no owner note yet", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    resendFails = (key) => key.endsWith("-buyer");
    const response = await deliver(w, session);
    assert.equal(response.status, 500);
    assert.equal(emailsOf("buyer").length, 0);
    assert.equal(attempts.filter((key) => key.endsWith("-buyer")).length, 2, "one retry, then give up");
    const [alert] = emailsOf("alert");
    assert.equal(alert?.to, "hello@example.test");
    assert.ok(alert?.subject.startsWith("Action needed: gift card not delivered"));
    assert.ok(alert?.text.includes("Forward it to the buyer if it has not arrived within the hour"));
    assert.ok(alert?.text.includes(session.metadata["code"] ?? "?"));
    assert.ok(alert?.text.includes("Sheet: saved"));
    assert.equal(decode(alert?.attachments?.[0]?.content ?? ""), "%PDF-1.7 fake");
    assert.equal(emailsOf("owner").length, 0);
    assert.equal(emailsOf("recipient").length, 0);
    assert.equal(rows.length, 1, "the sale is on record");
    assert.equal(session.piMetadata["hl_buyer"], undefined);
    assert.equal(session.piMetadata["hl_alert"], "sent");

    // Stripe retries while Resend is still down: no second alert.
    assert.equal((await deliver(w, session)).status, 500);
    assert.equal(emailsOf("alert").length, 1);

    // Resend recovers: the next retry delivers once, tells the owner it was late, and the alert is not repeated.
    resendFails = () => false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("recipient").length, 1);
    assert.equal(emailsOf("alert").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.ok(emailsOf("owner")[0]?.text.includes("delivered late"));
    assert.equal(rows.length, 1);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emails.length, 4);
  });

  test("the certificate failing to build is the same as the buyer's email failing, with no attachment on the alert", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    certificateFails = true;
    assert.equal((await deliver(w, session)).status, 500);
    const [alert] = emailsOf("alert");
    assert.ok(alert);
    assert.equal(alert.attachments, undefined);
    assert.ok(alert.text.includes("could not be made"));
    certificateFails = false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
  });

  test("the owner's note failing: 500, and the retry sends only that", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    resendFails = (key) => key.endsWith("-owner");
    assert.equal((await deliver(w, session)).status, 500);
    assert.equal(emailsOf("buyer").length, 1);
    resendFails = () => false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emails.length, 3);
    assert.equal(rows.length, 1);
  });

  test("the recipient's copy failing is told to the owner, 500, and the retry sends only that", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    resendFails = (key) => key.endsWith("-recipient");
    assert.equal((await deliver(w, session)).status, 500);
    assert.ok(emailsOf("owner")[0]?.text.includes(`NOT sent to ${RECIPIENT_EMAIL}`));
    resendFails = () => false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("recipient").length, 1);
    assert.equal(emailsOf("owner").length, 1);
  });

  test("a mark that cannot be written after a successful step is a 200 (Stripe stops retrying), the owner is told what really happened, nothing goes out twice", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    markFails = true;
    assert.equal((await deliver(w, session)).status, 200);
    assert.ok(logs.some((line) => line.includes("payment_marks_failed")));
    assert.ok(emailsOf("owner")[0]?.text.includes("Sheet: saved"), "the note reports this run's result, not the missing mark");
    markFails = false;
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
  });

  test("a failed step is still a 500 even when marks also fail", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    markFails = true;
    resendFails = (key) => key.endsWith("-owner");
    assert.equal((await deliver(w, session)).status, 500);
  });

  test("the buyer's alert reports the ledger this run saved even when its mark could not be written", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    markFails = true;
    resendFails = (key) => key.endsWith("-buyer");
    assert.equal((await deliver(w, session)).status, 500);
    assert.ok(emailsOf("alert")[0]?.text.includes("Sheet: saved"));
  });
});

describe("previews and the Pipeline destination", () => {
  const previewEnv = () => env({ SITE_ENV: "preview", STRIPE_SECRET_KEY: TEST_KEY });

  test("a preview sends every email to the site's own address and writes the preview tab", async () => {
    const w = worker();
    const session = await buy(w, {}, previewEnv());
    assert.equal(session.metadata["site_mode"], "preview");
    pay(session);
    assert.equal((await deliver(w, session, "checkout.session.completed", previewEnv())).status, 200);
    for (const email of emails) assert.equal(email.to, "hello@example.test", email.key);
    assert.equal(emailsOf("buyer")[0]?.subject, "[Preview → would go to ada@example.org] Your Example Co gift card");
    assert.ok(emailsOf("recipient")[0]?.subject.startsWith("[Preview → would go to grace@example.org]"));
    assert.ok(emailsOf("owner")[0]?.subject.startsWith("[Preview] "));
    assert.ok(emailsOf("owner")[0]?.text.includes("Mode: preview"));
    assert.equal(rows[0]?.tab, "Gift cards preview");
    assert.equal(rows.filter((row) => row.tab === "Gift cards").length, 0);
  });

  test("the Pipeline destination posts one lead with the code, amount and source; a preview posts nothing", async () => {
    const site: WorkerSiteConfig = { ...BASE, contact: { ...BASE.contact, destination: "pipeline", pipelineUrl: PIPELINE_URL } };
    const w = worker(site);
    const cookie = await sourceCookie(w);
    const session = await buy(w, {}, env(), cookie);
    pay(session);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal(rows.length, 0);
    assert.equal(intakes.length, 1);
    const [lead] = intakes;
    assert.equal(lead?.["name"], NAME);
    assert.equal(lead?.["email"], EMAIL);
    assert.equal(lead?.["source"], "google / cpc");
    assert.ok(typeof lead?.["attribution"] === "object");
    assert.ok(String(lead?.["message"]).includes(`Code: ${session.metadata["code"]}`));
    assert.ok(String(lead?.["message"]).includes("Amount: $50.00"));
    assert.ok(emailsOf("owner")[0]?.text.includes("Pipeline app: saved"));

    intakes = [];
    emails = [];
    const preview = await buy(w, {}, previewEnv());
    pay(preview);
    assert.equal((await deliver(w, preview, "checkout.session.completed", previewEnv())).status, 200);
    assert.equal(intakes.length, 0);
    assert.ok(emailsOf("owner")[0]?.text.includes("Pipeline app: not sent (preview)"));
  });
});

describe("the thank-you page's confirm route", () => {
  test("a paid session with no webhook is repaired only after 90 seconds, and the owner is told", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    clock += 30_000;
    const early = await w.fetch(confirmRequest(session.id), env());
    assert.equal(early.status, 200);
    const earlyBody = (await early.json()) as Record<string, unknown>;
    assert.deepEqual(earlyBody, { status: "paid", value: 50, currency: "USD", transactionId: session.pi, delivered: false, amountText: "$50.00", recipientCopy: true });
    assert.equal(emails.length, 0, "within 90 seconds the webhook is given time");

    clock += 60_000;
    assert.equal(clock - START, 90_000);
    const exactly = await w.fetch(confirmRequest(session.id), env());
    assert.equal(((await exactly.json()) as { delivered: boolean }).delivered, false, "90 seconds is not yet more than 90");
    assert.equal(emails.length, 0);

    clock += 1_000;
    const late = await w.fetch(confirmRequest(session.id), env());
    const lateBody = (await late.json()) as Record<string, unknown>;
    assert.equal(lateBody["delivered"], true);
    assert.equal(JSON.stringify(lateBody).includes(session.metadata["code"] ?? "?"), false, "the code never leaves in this answer");
    assert.equal(emailsOf("buyer").length, 1);
    assert.equal(emailsOf("owner").length, 1);
    assert.equal(rows.length, 1);
    assert.ok(emailsOf("owner")[0]?.text.includes("sent by the thank-you page"));

    // The webhook turns up after all, and the page is reloaded: neither does anything more.
    assert.equal((await deliver(w, session)).status, 200);
    assert.equal((await w.fetch(confirmRequest(session.id), env())).status, 200);
    assert.equal(emails.length, 3);
    assert.equal(rows.length, 1);
  });

  test("when the webhook did its work, confirm only reports it", async () => {
    const w = worker();
    const session = await buy(w);
    pay(session);
    await deliver(w, session);
    clock += 600_000;
    const body = (await (await w.fetch(confirmRequest(session.id), env())).json()) as { delivered: boolean };
    assert.equal(body.delivered, true);
    assert.equal(emails.length, 3);
  });

  test("an unpaid, open or slow session, an unknown id, a mismatched amount", async () => {
    const w = worker();
    const session = await buy(w);
    assert.deepEqual(await (await w.fetch(confirmRequest(session.id), env())).json(), { status: "unpaid" });
    session.status = "complete";
    assert.deepEqual(await (await w.fetch(confirmRequest(session.id), env())).json(), { status: "pending" });
    assert.equal((await w.fetch(confirmRequest("cs_test_nothing"), env())).status, 404);
    assert.equal((await w.fetch(confirmRequest("bad id"), env())).status, 404);
    pay(session);
    session.amount_total = 1;
    assert.equal((await w.fetch(confirmRequest(session.id), env())).status, 409);
    assert.equal(emails.length, 0);
  });

  test("only the site's own pages may ask, and a flood is limited", async () => {
    const w = worker();
    const session = await buy(w);
    assert.equal((await w.fetch(confirmRequest(session.id, { sameSite: false }), env())).status, 403);
    assert.equal((await w.fetch(new Request(`${ORIGIN}/api/gift-cards/confirm?session_id=${session.id}`), env())).status, 403);
    assert.equal((await w.fetch(confirmRequest(session.id), env({ CONTACT_RATE_LIMIT: { limit: async () => ({ success: false }) } }))).status, 429);
  });
});
