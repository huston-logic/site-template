// Tests for the quote form's Worker half (spec R14 to R16): the Worker reads the site's own /catalog.json, judges the
// selection, computes the estimate with the shared price function and puts the same lines in the Sheet row, the owner
// email, the Pipeline message and the visitor's estimate email. `fetch` is mocked and the assets are a fake Fetcher;
// nothing leaves the process, and every value is obviously fake.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { buildCatalogData } from "../src/catalog/data.ts";
import { formatRange, priceRange } from "../src/catalog/price.ts";
import type { PricingTable, CatalogData, Selection } from "../src/catalog/schema.ts";
import { catalogWords } from "../src/content/catalog.ts";
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
        { id: "message", type: "long-text", label: "Anything else", required: false, max: 2000 },
      ],
      button: "Send my quote request",
      thanks: "Thanks.",
      reply: { subject: "Your estimate from Example Co", next: "I will reply within two working days with a firm quote." },
    },
  },
];

const pricing: PricingTable = {
  currency: "USD",
  rounding: 10,
  spread: 10,
  note: "Estimates only. I confirm the final price after we talk.",
  groups: [
    { id: "metal", name: "Metal", choices: [{ id: "plain", label: "Plain", add: 0 }, { id: "gilded", label: "Gilded", multiply: 1.25 }] },
    { id: "size", name: "Size", choices: [{ id: "small", label: "Small", multiply: 1 }, { id: "large", label: "Large", multiply: 1.5 }] },
  ],
  perPerson: { label: "Guests", amount: 6, min: 10, max: 300 },
  exact: {},
};

const item = (slug: string, data: Record<string, unknown>) => ({ kind: "catalog" as const, slug, status: "live" as const, data });
const catalog: CatalogData = buildCatalogData({
  items: [
    item("oval-ring", { name: "Oval ring", price: { low: 1200, high: 1800 }, options: ["metal", "size"], perPerson: false }),
    item("dinner-set", { name: "Dinner set", price: { low: 400, high: 600 }, options: ["metal"], perPerson: true }),
    item("custom-piece", { name: "Custom piece", price: "ask", options: ["metal"], perPerson: false }),
  ],
  settings: { itemWord: { singular: "piece", plural: "pieces" }, filters: [] },
  pricing,
  pagePath: "/shop",
});

const ORIGIN = "https://example.test";
const WEBHOOK_URL = "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec";
const PIPELINE_URL = "https://pipeline.example.test";
const DAY = 86_400_000;
const NAME = "Ada Lovelace";
const EMAIL = "ada@example.org";
const TAGGED_PATH = "/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x";

const config = buildWorkerConfig(BASE);
const sheetWorker = createWorker(config, FORMS, true);
const pipelineWorker = createWorker(buildWorkerConfig({ ...BASE, contact: { ...BASE.contact, destination: "pipeline", pipelineUrl: PIPELINE_URL } }), FORMS, true);

let calls: Call[] = [];
let logs: string[] = [];
let assetRequests: string[] = [];
let assetResponse: () => Response;
let estimateStatus = 200;
let clock = Date.UTC(2026, 10, 20, 12, 0, 0);
const realFetch = globalThis.fetch;
const realLog = console.log;
const realNow = Date.now;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function kind(url: string, init: RequestInit): string {
  if (url.includes("turnstile/v0/siteverify")) return "siteverify";
  if (url.startsWith("https://script.google.com/")) return "webhook";
  if (url.startsWith(`${PIPELINE_URL}/`)) return "intake";
  if (url === "https://api.resend.com/emails") {
    const key = String((init.headers as Record<string, string>)["idempotency-key"]);
    return key.endsWith("-notify") ? "notify" : key.endsWith("-estimate") ? "estimate" : "other-email";
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

function called(name: string): Call[] {
  return calls.filter((c) => kind(c.url, c.init) === name);
}

function env(overrides: Partial<ContactEnv> = {}): ContactEnv {
  return {
    SITE_ENV: "production",
    RESEND_API_KEY: "re_test",
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    SHEET_WEBHOOK_URL: WEBHOOK_URL,
    SHEET_WEBHOOK_SECRET: "webhook-test-secret",
    INTAKE_SECRET: "intake-test-secret",
    CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
    ASSETS: {
      fetch: async (input: Request | string | URL) => {
        assetRequests.push(input instanceof Request ? input.url : String(input));
        return assetResponse();
      },
    } as unknown as Fetcher,
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  logs = [];
  assetRequests = [];
  estimateStatus = 200;
  clock = Date.UTC(2026, 10, 20, 12, 0, 0);
  Date.now = () => clock;
  assetResponse = () => jsonResponse(catalog);
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
    switch (kind(url, init)) {
      case "siteverify":
        return jsonResponse({ success: true, hostname: "example.test", action: "form" });
      case "webhook":
        return jsonResponse({ ok: true });
      case "intake":
        return jsonResponse({ ok: true }, 201);
      case "estimate":
        return jsonResponse({ id: "email-2" }, estimateStatus);
      default:
        return jsonResponse({ id: "email-1" });
    }
  }) as typeof fetch;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  Date.now = realNow;
  for (const line of logs) {
    for (const secret of [NAME, EMAIL, "203.0.113.9", "re_test", "webhook-test-secret", "intake-test-secret", "EXAMPLE_DEPLOYMENT_ID"]) assert.ok(!line.includes(secret), `log line leaked "${secret}": ${line}`);
  }
});

function submit(body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}/api/forms/quote`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const answers = { name: NAME, email: EMAIL, message: "Please quote this.", company_fax: "", turnstileToken: "token-abc" };
const withSelection = (selection: unknown, extra: Record<string, unknown> = {}) => ({ ...answers, selection, ...extra });

/** What the page itself would show for this selection: the shared function, the table's currency and the interface words. */
function estimateFor(slug: string, selection: Selection): string {
  const entry = catalog.items[slug];
  assert.ok(entry);
  const priced = priceRange(entry, pricing, selection, slug);
  assert.ok(priced.ok);
  return formatRange(priced.result, pricing.currency, catalogWords);
}

function rowOf(): string[] {
  const row = called("webhook")[0]?.json?.row;
  assert.ok(Array.isArray(row), "no Sheet row");
  return row as string[];
}

const notifyOf = () => called("notify")[0]?.json as { subject: string; text: string; to: string[] };
const estimateOf = () => called("estimate")[0]?.json as { subject: string; text: string; to: string[]; headers: Record<string, string> };

function visit(cookie?: string): Request {
  return new Request(`${ORIGIN}/api/visit`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ path: TAGGED_PATH, referrer: "https://www.google.com/" }),
  });
}

describe("a quote request", () => {
  test("reads the catalog from the site's own assets and delivers the same lines everywhere", async () => {
    const selection = { item: "oval-ring", options: { metal: "gilded", size: "large" } };
    const response = await sheetWorker.fetch(submit(withSelection(selection)), env());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(assetRequests, [`${ORIGIN}/catalog.json`]);

    const estimate = estimateFor("oval-ring", selection);
    const lines = ["Piece: Oval ring", "Link: https://example.test/shop/oval-ring", "Metal: Gilded", "Size: Large", `Estimate: ${estimate}`];
    const cell = rowOf()[4] ?? "";
    assert.ok(cell.startsWith(`${lines.join("\n")}\n`), cell);
    assert.ok(cell.includes("Your name: Ada Lovelace"));
    assert.equal(called("webhook")[0]?.json?.tab, "Forms");

    assert.equal(notifyOf().subject, `New quote request: Oval ring from ${NAME}`);
    assert.ok(notifyOf().text.includes(lines.join("\n")));

    assert.deepEqual(estimateOf().to, [EMAIL]);
    assert.equal(estimateOf().subject, "Your estimate from Example Co");
    assert.equal(estimateOf().headers["Auto-Submitted"], "auto-replied");
    assert.ok(estimateOf().text.includes(lines.join("\n")));
    assert.ok(estimateOf().text.includes(pricing.note));
    assert.ok(estimateOf().text.includes("I will reply within two working days"));
    assert.ok(estimateOf().text.trimEnd().endsWith("Example Co"));
  });

  test("the visitor email holds no visitor input at all", async () => {
    await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" }, { message: "SECRET-NOTE-FROM-VISITOR" })), env());
    const text = estimateOf().text;
    for (const input of [NAME, "SECRET-NOTE-FROM-VISITOR", "Ada"]) assert.ok(!text.includes(input), input);
    assert.ok(!text.includes(EMAIL));
  });

  test("a per-person item carries the party size", async () => {
    const selection = { item: "dinner-set", people: 40 };
    const response = await sheetWorker.fetch(submit(withSelection(selection)), env());
    assert.equal(response.status, 200);
    const cell = rowOf()[4] ?? "";
    assert.ok(cell.includes("Metal: Plain\nGuests: 40\nEstimate: "), cell);
    assert.ok(cell.includes(`Estimate: ${estimateFor("dinner-set", selection)}`));
  });

  test("an item whose price is on request reads Price on request everywhere", async () => {
    const response = await sheetWorker.fetch(submit(withSelection({ item: "custom-piece" })), env());
    assert.equal(response.status, 200);
    for (const text of [rowOf()[4] ?? "", notifyOf().text, estimateOf().text]) assert.ok(text.includes("Estimate: Price on request"), text);
  });

  test("a preview sends the estimate to the site's own address, named in the subject", async () => {
    const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" })), env({ SITE_ENV: "preview" }));
    assert.equal(response.status, 200);
    assert.deepEqual(estimateOf().to, ["hello@example.test"]);
    assert.equal(estimateOf().subject, `[Preview → would go to ${EMAIL}] Your estimate from Example Co`);
    assert.ok(notifyOf().subject.startsWith("[Preview] New quote request: Oval ring"));
    assert.equal(called("webhook")[0]?.json?.tab, "Forms preview");
  });

  test("an estimate email that does not send still answers ok, with delivered false", async () => {
    estimateStatus = 400;
    const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" })), env());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, delivered: false });
    assert.equal(called("notify").length, 1);
  });
});

describe("what the browser may not say", () => {
  for (const key of ["range", "price", "estimate", "total", "low"]) {
    test(`a posted "${key}" is refused and nothing is saved or sent`, async () => {
      const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" }, { [key]: "$1" })), env());
      assert.equal(response.status, 400);
      assert.equal(calls.length, 0);
    });
  }

  test("a price inside the selection is refused", async () => {
    const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring", range: { low: 1, high: 2 } })), env());
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });

  const malformed: [string, unknown][] = [
    ["no selection", undefined],
    ["a selection that is not an object", "oval-ring"],
    ["a selection that is a list", ["oval-ring"]],
    ["no item", { options: {} }],
    ["an item that is not text", { item: 4 }],
    ["a choice that is not text", { item: "oval-ring", options: { metal: 1 } }],
    ["options that are a list", { item: "oval-ring", options: ["metal"] }],
    ["people as text", { item: "dinner-set", people: "20" }],
    ["an extra key inside the selection", { item: "oval-ring", extra: 1 }],
  ];
  for (const [label, selection] of malformed) {
    test(`${label} is a 400 and nothing is saved or sent`, async () => {
      const response = await sheetWorker.fetch(submit(selection === undefined ? answers : withSelection(selection)), env());
      assert.equal(response.status, 400);
      assert.equal(calls.length, 0);
    });
  }

  // Well formed, but no longer prices against today's data: the page the visitor used is out of date.
  const changed: [string, unknown][] = [
    ["a piece that is not in the data", { item: "nope" }],
    ["an inherited key as the piece", { item: "constructor" }],
    ["an option group that no longer exists", { item: "oval-ring", options: { stone: "ruby" } }],
    ["a choice that no longer exists", { item: "oval-ring", options: { metal: "diamond" } }],
    ["a group the piece does not use", { item: "dinner-set", options: { size: "large" } }],
    ["people for a piece with no per-person fee", { item: "oval-ring", people: 20 }],
    ["people below the minimum", { item: "dinner-set", people: 2 }],
    ["people above the maximum", { item: "dinner-set", people: 301 }],
    ["people that are not whole", { item: "dinner-set", people: 20.5 }],
  ];
  for (const [label, selection] of changed) {
    test(`${label} is a 409 "changed" and nothing is saved or sent`, async () => {
      const response = await sheetWorker.fetch(submit(withSelection(selection)), env());
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { ok: false, error: "changed" });
      assert.equal(called("webhook").length + called("notify").length + called("estimate").length + called("intake").length, 0);
    });
  }

  test("answers that need fixing still list their fields", async () => {
    const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" }, { email: "nope" })), env());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid", fields: ["email"] });
  });
});

describe("fail closed when the price source is not there", () => {
  const broken: [string, Partial<ContactEnv>, (() => Response) | null][] = [
    ["no assets binding", { ASSETS: undefined }, null],
    ["a missing file", {}, () => new Response("not found", { status: 404 })],
    ["a file that is not JSON", {}, () => new Response("<html>", { status: 200 })],
    ["a file that fails the shared check", {}, () => jsonResponse({ ...catalog, version: 2 })],
    ["a file with an unknown key", {}, () => jsonResponse({ ...catalog, extra: 1 })],
  ];
  for (const [label, overrides, responder] of broken) {
    test(`${label} is a 502 with a fixed log, and nothing is sent`, async () => {
      if (responder) assetResponse = responder;
      const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" })), env(overrides));
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { ok: false, error: "failed" });
      assert.ok(logs.some((line) => line.includes("catalog_data_unavailable")));
      assert.equal(calls.length, 0);
    });
  }

  test("an asset read that throws is a 502", async () => {
    const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" })), env({ ASSETS: { fetch: async () => Promise.reject(new Error("down")) } as unknown as Fetcher }));
    assert.equal(response.status, 502);
    assert.equal(calls.length, 0);
  });

  test("a cross-origin post never reads the assets", async () => {
    const request = new Request(`${ORIGIN}/api/forms/quote`, { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify(withSelection({ item: "oval-ring" })) });
    const response = await sheetWorker.fetch(request, env());
    assert.equal(response.status, 403);
    assert.equal(assetRequests.length, 0);
  });

  test("a wrong content type, an oversized body and a honeypot never read the assets", async () => {
    const wrongType = new Request(`${ORIGIN}/api/forms/quote`, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "x" });
    assert.equal((await sheetWorker.fetch(wrongType, env())).status, 415);
    const big = new Request(`${ORIGIN}/api/forms/quote`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(withSelection({ item: "oval-ring" }, { message: "x".repeat(40_000) })) });
    assert.equal((await sheetWorker.fetch(big, env())).status, 413);
    const trapped = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" }, { company_fax: "x" })), env());
    assert.equal(trapped.status, 400);
    assert.equal(assetRequests.length, 0);
  });

  test("a rate-limited post never reads the assets", async () => {
    const response = await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" })), env({ CONTACT_RATE_LIMIT: { limit: async () => ({ success: false }) } }));
    assert.equal(response.status, 429);
    assert.equal(assetRequests.length, 0);
  });

  test("a wrong method is a 405 before the assets are read", async () => {
    const response = await sheetWorker.fetch(new Request(`${ORIGIN}/api/forms/quote`), env());
    assert.equal(response.status, 405);
    assert.equal(assetRequests.length, 0);
  });
});

describe("one estimate, everywhere, with the lead source", () => {
  async function cookieAfterTaggedVisit(): Promise<string> {
    const landing = await sheetWorker.fetch(visit(), env());
    const setCookie = landing.headers.get("set-cookie");
    assert.ok(setCookie);
    clock += 7 * DAY;
    return (setCookie.split(";")[0] ?? "").trim();
  }

  test("the Sheet row, the owner email and the visitor email carry the same Estimate line, and the source", async () => {
    const cookie = await cookieAfterTaggedVisit();
    const selection = { item: "oval-ring", options: { metal: "gilded" } };
    const response = await sheetWorker.fetch(submit(withSelection(selection), `theme=dark; ${cookie}`), env());
    assert.equal(response.status, 200);

    const expected = `Estimate: ${estimateFor("oval-ring", selection)}`;
    const row = rowOf();
    assert.ok((row[4] ?? "").split("\n").includes(expected));
    assert.ok(notifyOf().text.split("\n").includes(expected));
    assert.ok(estimateOf().text.split("\n").includes(expected));

    assert.deepEqual(row.slice(6), ["google / cpc", "spring-sale", "gclid: Abc_123-x", "2026-11-20", "7"]);
    assert.ok(notifyOf().text.split("\n").includes("Came from: google / cpc, campaign spring-sale, first visit 2026-11-20 (7 days before this note)"));
  });

  test("the Pipeline destination gets the lines before the answers, and the source", async () => {
    const cookie = await cookieAfterTaggedVisit();
    const selection = { item: "dinner-set", options: { metal: "gilded" }, people: 25 };
    const response = await pipelineWorker.fetch(submit(withSelection(selection), cookie), env());
    assert.equal(response.status, 200);
    assert.equal(called("webhook").length, 0);

    const expected = `Estimate: ${estimateFor("dinner-set", selection)}`;
    const posted = called("intake")[0]?.json as { message: string; source?: string; attribution?: Record<string, unknown> };
    assert.ok(posted.message.startsWith("Form: Quote request\n\nPiece: Dinner set\nLink: https://example.test/shop/dinner-set\nMetal: Gilded\nGuests: 25\n"), posted.message);
    assert.ok(posted.message.split("\n").includes(expected));
    assert.ok(posted.message.indexOf(expected) < posted.message.indexOf("Your name:"));
    assert.equal(posted.source, "google / cpc");
    assert.ok(notifyOf().text.split("\n").includes(expected));
    assert.ok(estimateOf().text.split("\n").includes(expected));
  });

  test("a site with no catalog page leaves the Link line out", async () => {
    assetResponse = () => jsonResponse({ ...catalog, pagePath: null });
    await sheetWorker.fetch(submit(withSelection({ item: "oval-ring" })), env());
    assert.ok(!(rowOf()[4] ?? "").includes("Link:"));
  });
});

describe("drafts on a preview", () => {
  const withDraft = buildCatalogData({
    items: [
      item("oval-ring", { name: "Oval ring", price: { low: 1200, high: 1800 }, options: ["metal"], perPerson: false }),
      { ...item("secret-draft", { name: "Secret draft", price: { low: 500, high: 700 }, options: ["metal"], perPerson: false }), status: "draft" as const },
    ],
    settings: { itemWord: { singular: "piece", plural: "pieces" }, filters: [] },
    pricing: { ...pricing, exact: { "secret-draft": { metal: { gilded: 999 } } } },
    pagePath: "/shop",
  });

  test("a preview's catalog data can hold a draft piece, and a quote for it is accepted (emails go only to the site's own address)", async () => {
    assetResponse = () => jsonResponse(withDraft);
    const response = await sheetWorker.fetch(submit(withSelection({ item: "secret-draft", options: { metal: "gilded" } })), env({ SITE_ENV: "preview" }));
    assert.equal(response.status, 200);
    assert.deepEqual(estimateOf().to, ["hello@example.test"]);
    assert.ok((rowOf()[4] ?? "").includes("Piece: Secret draft"));
  });

  test("production data is built from visible items only, so it never holds a draft and its quote is a 409", async () => {
    const productionData = buildCatalogData({
      items: [item("oval-ring", { name: "Oval ring", price: { low: 1200, high: 1800 }, options: ["metal"], perPerson: false })],
      settings: { itemWord: { singular: "piece", plural: "pieces" }, filters: [] },
      pricing: { ...pricing, exact: { "secret-draft": { metal: { gilded: 999 } } } },
      pagePath: "/shop",
    });
    assert.ok(!JSON.stringify(productionData).includes("secret-draft"));
    assetResponse = () => jsonResponse(productionData);
    const response = await sheetWorker.fetch(submit(withSelection({ item: "secret-draft" })), env());
    assert.equal(response.status, 409);
    assert.equal(calls.length, 0);
  });
});
