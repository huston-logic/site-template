// The whole lead-source path, end to end through the Worker: a tagged visit sets the cookie, a later untagged visit does
// not, then the contact form and an owner-made form are posted with that cookie, and the Sheet row (Apps Script body),
// the notification email and the Pipeline post all carry the original source. Also forged and oversized cookies: the
// submission still succeeds and the values are cleaned or absent. `fetch` is mocked; nothing leaves the process.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { COOKIE_NAME, encodeState } from "./attribution.ts";
import { buildWorkerConfig, type WorkerSiteConfig } from "./config.ts";
import { createWorker } from "./contact.ts";
import type { ContactEnv } from "./env.ts";

type Call = { url: string; init: RequestInit; json: Record<string, unknown> | null };

const BASE: WorkerSiteConfig = {
  business: { name: "Example Co", tagline: "Plain words for plain work" },
  owner: { name: "Pat Example", role: "Founder" },
  domain: { url: "https://example.test", workerName: "example-site", previewHostSuffix: ".workers.dev" },
  forms: { maxForms: 10, maxFields: 12, maxAnswerChars: 20000, maxBodyBytes: 32768 },
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
const FORMS = [
  {
    id: "quote",
    data: {
      name: "Quote request",
      status: "live",
      fields: [
        { id: "name", type: "short-text", label: "Your name", purpose: "name", required: true },
        { id: "email", type: "email", label: "Email", required: true },
        { id: "message", type: "long-text", label: "Tell me about the project", required: true, max: 5000 },
      ],
      button: "Send my request",
      thanks: "Thanks.",
    },
  },
];

const ORIGIN = "https://example.test";
const WEBHOOK_URL = "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec";
const PIPELINE_URL = "https://pipeline.example.test";
const TAGGED_PATH = "/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x";
const DAY = 86_400_000;

const sheetWorker = createWorker(buildWorkerConfig(BASE), FORMS);
const pipelineWorker = createWorker(buildWorkerConfig({ ...BASE, contact: { ...BASE.contact, destination: "pipeline", pipelineUrl: PIPELINE_URL } }), FORMS);

let calls: Call[] = [];
let action = "contact";
const realFetch = globalThis.fetch;
const realLog = console.log;
const realNow = Date.now;
let clock = Date.UTC(2026, 10, 20, 12, 0, 0);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function kind(url: string): string {
  if (url.includes("turnstile/v0/siteverify")) return "siteverify";
  if (url.startsWith("https://script.google.com/")) return "webhook";
  if (url.startsWith(`${PIPELINE_URL}/`)) return "intake";
  if (url === "https://api.resend.com/emails") return "email";
  throw new Error(`Unexpected fetch: ${url}`);
}

function env(): ContactEnv {
  return {
    SITE_ENV: "production",
    RESEND_API_KEY: "re_test",
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    SHEET_WEBHOOK_URL: WEBHOOK_URL,
    SHEET_WEBHOOK_SECRET: "webhook-test-secret",
    INTAKE_SECRET: "intake-test-secret",
    CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
}

function called(name: string): Call[] {
  return calls.filter((c) => kind(c.url) === name);
}

function emailText(): string {
  const notify = called("email").find((c) => String((c.init.headers as Record<string, string>)["idempotency-key"]).endsWith("-notify"));
  assert.ok(notify, "no notification email");
  return String(notify.json?.text);
}

beforeEach(() => {
  calls = [];
  action = "contact";
  clock = Date.UTC(2026, 10, 20, 12, 0, 0);
  Date.now = () => clock;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    let json: Record<string, unknown> | null = null;
    if (typeof init.body === "string") {
      try {
        json = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        json = null;
      }
    }
    calls.push({ url, init, json });
    switch (kind(url)) {
      case "siteverify":
        return jsonResponse({ success: true, hostname: "example.test", action });
      case "webhook":
        return jsonResponse({ ok: true });
      case "intake":
        return jsonResponse({ ok: true }, 201);
      default:
        return jsonResponse({ id: "email-1" });
    }
  }) as typeof fetch;
  console.log = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  Date.now = realNow;
});

function visit(body: { path: string; referrer: string }, cookie?: string): Request {
  return new Request(`${ORIGIN}/api/visit`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const contactBody = { need: "website", topic: "", name: "Ada Lovelace", email: "ada@example.org", business: "", message: "Please call me.", tools: "", website: "", source: "", company_fax: "", turnstileToken: "token-abc" };
const quoteBody = { name: "Ada Lovelace", email: "ada@example.org", message: "Please quote the kitchen.", company_fax: "", turnstileToken: "token-abc" };

function submit(path: "/api/contact" | "/api/forms/quote", body: unknown, cookie: string | null): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Day 0 tagged visit (cookie set), day 3 untagged visit (no Set-Cookie); returns the cookie header the browser would send on day 7. */
async function browserCookie(): Promise<string> {
  const landing = await sheetWorker.fetch(visit({ path: TAGGED_PATH, referrer: "https://www.google.com/" }), env());
  assert.equal(landing.status, 204);
  const setCookie = landing.headers.get("set-cookie");
  assert.ok(setCookie, "the tagged visit must set the cookie");
  const cookie = (setCookie.split(";")[0] ?? "").trim();
  assert.ok(cookie.startsWith(`${COOKIE_NAME}=`));

  clock += 3 * DAY;
  const back = await sheetWorker.fetch(visit({ path: "/about", referrer: "" }, cookie), env());
  assert.equal(back.status, 204);
  assert.equal(back.headers.get("set-cookie"), null, "an untagged return visit must not touch the cookie");

  clock += 4 * DAY;
  return cookie;
}

describe("a tagged visit, an untagged return, then a submission", () => {
  test("the contact form: Sheet row, email line", async () => {
    const cookie = await browserCookie();
    const response = await sheetWorker.fetch(submit("/api/contact", contactBody, `theme=dark; ${cookie}; other=1`), env());
    assert.equal(response.status, 200);
    const row = called("webhook")[0]?.json?.row as string[];
    assert.equal(row.length, 16);
    assert.deepEqual(row.slice(11), ["google / cpc", "spring-sale", "gclid: Abc_123-x", "2026-11-20", "7"]);
    const lines = emailText().split("\n");
    const cameFrom = "Came from: google / cpc, campaign spring-sale, first visit 2026-11-20 (7 days before this note)";
    assert.ok(lines.includes(cameFrom), emailText());
    assert.equal(lines[lines.indexOf(cameFrom) + 1], "Received: 2026-11-27T12:00:00.000Z");
  });

  test("an owner-made form: Sheet row, email line", async () => {
    const cookie = await browserCookie();
    action = "form";
    const response = await sheetWorker.fetch(submit("/api/forms/quote", quoteBody, cookie), env());
    assert.equal(response.status, 200);
    const row = called("webhook")[0]?.json?.row as string[];
    assert.equal(row.length, 11);
    assert.deepEqual(row.slice(6), ["google / cpc", "spring-sale", "gclid: Abc_123-x", "2026-11-20", "7"]);
    assert.ok(emailText().split("\n").includes("Came from: google / cpc, campaign spring-sale, first visit 2026-11-20 (7 days before this note)"));
  });

  test("the Pipeline post carries source and the original campaign and gclid, for both kinds of form", async () => {
    const cookie = await browserCookie();
    await pipelineWorker.fetch(submit("/api/contact", contactBody, cookie), env());
    action = "form";
    await pipelineWorker.fetch(submit("/api/forms/quote", quoteBody, cookie), env());
    const posts = called("intake");
    assert.equal(posts.length, 2);
    for (const post of posts) {
      assert.equal(post.json?.source, "google / cpc");
      const attribution = post.json?.attribution as { first: Record<string, string>; last?: Record<string, string>; daysToNote: number };
      assert.equal(attribution.daysToNote, 7);
      assert.equal(attribution.first.utm_campaign, "spring-sale");
      assert.equal(attribution.first.gclid, "Abc_123-x");
      assert.equal(attribution.first.at, "2026-11-20T12:00:00.000Z");
      assert.equal(attribution.first.referrer_host, "www.google.com");
    }
    assert.ok(emailText().includes("Pipeline app: saved"));
  });

  test("with no cookie: Not known, no Pipeline source", async () => {
    const response = await sheetWorker.fetch(submit("/api/contact", contactBody, null), env());
    assert.equal(response.status, 200);
    assert.deepEqual((called("webhook")[0]?.json?.row as string[]).slice(11), ["Not known", "", "", "", ""]);
    assert.ok(emailText().split("\n").includes("Came from: not known"));

    calls = [];
    await pipelineWorker.fetch(submit("/api/contact", contactBody, null), env());
    const post = called("intake")[0];
    assert.ok(post);
    assert.equal("source" in (post.json ?? {}), false);
    assert.equal("attribution" in (post.json ?? {}), false);
  });
});

describe("forged and oversized cookies never fail a submission", () => {
  const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  const now = Date.UTC(2026, 10, 20, 12, 0, 0) / 1000;

  const forged: [string, string][] = [
    ["bad base64", `${COOKIE_NAME}=%%%not base64%%%`],
    ["bad JSON", `${COOKIE_NAME}=${b64("{nope")}`],
    ["a 10 KB value", `${COOKIE_NAME}=${"A".repeat(10_240)}`],
    ["a 10 KB cookie header", `junk=${"x".repeat(10_240)}; ${COOKIE_NAME}=${encodeState({ f: { at: now, utm_source: "google" } })}`],
    ["wrong types", `${COOKIE_NAME}=${b64({ f: { a: now, us: { x: 1 }, um: 5, g: ["x"] } })}`],
    ["a time in the future", `${COOKIE_NAME}=${b64({ f: { a: now + 10 * 86_400, us: "google" } })}`],
    ["a time 91 days old", `${COOKIE_NAME}=${b64({ f: { a: now - 91 * 86_400, us: "google" } })}`],
  ];
  for (const [label, cookie] of forged) {
    test(label, async () => {
      for (const [path, body, form] of [["/api/contact", contactBody, "contact"], ["/api/forms/quote", quoteBody, "form"]] as const) {
        calls = [];
        action = form;
        const response = await sheetWorker.fetch(submit(path, body, cookie), env());
        assert.equal(response.status, 200, `${label} ${path}`);
        const row = called("webhook")[0]?.json?.row as string[];
        assert.equal(row.length, form === "contact" ? 16 : 11);
        assert.equal(emailText().split("\n").filter((line) => line.startsWith("Came from:")).length, 1);
      }
    });
  }

  test("formula text and line breaks become one plain line and a guarded cell", async () => {
    const evil = { f: { a: now - DAY / 1000, us: '=HYPERLINK("http://evil.test","x")', um: "cpc\r\nBcc: e@x.test", uc: "+SUM(1)\nsecond line", g: "=bad" } };
    const response = await sheetWorker.fetch(submit("/api/contact", contactBody, `${COOKIE_NAME}=${b64(evil)}`), env());
    assert.equal(response.status, 200);
    const row = called("webhook")[0]?.json?.row as string[];
    assert.equal(row[11], "'=HYPERLINK(\"http://evil.test\",\"x\") / cpcBcc: e@x.test");
    assert.equal(row[12], "'+SUM(1)second line");
    assert.equal(row[13], "");
    const text = emailText();
    const cameFrom = text.split("\n").filter((line) => line.startsWith("Came from:"));
    assert.equal(cameFrom.length, 1);
    assert.ok(!text.includes("\nBcc:"));
  });
});
