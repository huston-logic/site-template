import { expect, test, type Page, type Route } from "@playwright/test";
import { exampleCatalog } from "../../src/catalog/example";
import { buildCatalogData } from "../../src/catalog/data";
import { formatRange, priceRange } from "../../src/catalog/price";
import { catalogWords } from "../../src/content/catalog";
import { formFiles } from "../../src/forms/registry.generated";

// The brief's acceptance walk (docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md): a visitor lands from an
// ad, filters by two filters, opens a piece, picks options and requests a quote. The browser's posts to /api/visit and
// /api/forms/quote are handed to the real Worker code in this process (createWorker), with fakes for Turnstile, the
// Sheet's Apps Script and Resend, and the site's assets serving the showcase's catalog data. The test then checks that
// the Sheet row, the owner email and the visitor email carry the same Worker-computed estimate and the visit's source.
// Needs the fixture build (`TRACKING_FIXTURE=1 npm run build`), like every spec in this folder.

const ORIGIN = "https://example.test";
// The Worker is loaded at run time: its types need the Workers runtime types, which the site's type check does not load.
type Env = Record<string, unknown>;
type WorkerModule = { fetch(request: Request, env: Env): Promise<Response> };
const WORKER_DIR = "../../worker/";
async function loadWorker(): Promise<WorkerModule> {
  const { buildWorkerConfig } = (await import(`${WORKER_DIR}config.ts`)) as { buildWorkerConfig(site: unknown): unknown };
  const { createWorker } = (await import(`${WORKER_DIR}contact.ts`)) as { createWorker(config: unknown, forms: unknown, quoteExtras: boolean): WorkerModule };
  return createWorker(buildWorkerConfig(SITE), formFiles, true);
}
const SITE = {
  business: { name: "Example Co", tagline: "Plain words for plain work" },
  owner: { name: "Pat Example", role: "Founder" },
  domain: { url: ORIGIN, workerName: "example-site", previewHostSuffix: ".workers.dev" },
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
const catalogData = buildCatalogData({ items: exampleCatalog.items, settings: exampleCatalog.settings, pricing: exampleCatalog.pricing, pagePath: "/blocks/catalog" });

const TURNSTILE_STUB = `(() => {
  let options = null;
  window.turnstile = {
    render(el, o) { options = o; setTimeout(() => options.callback("test-token"), 0); return "w1"; },
    reset() { setTimeout(() => options.callback("test-token"), 0); },
    remove() {},
  };
})();`;

type Sent = { url: string; json: Record<string, unknown> };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The Worker's outside calls, answered here: Turnstile passes, the Sheet saves, every email sends. */
function fakeOutside(sent: Sent[]): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    sent.push({ url, json: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    if (url.includes("turnstile/v0/siteverify")) return json({ success: true, hostname: "example.test", action: "form" });
    if (url.startsWith("https://script.google.com/")) return json({ ok: true });
    if (url === "https://api.resend.com/emails") return json({ id: "email-1" });
    throw new Error(`Unexpected outside call: ${url}`);
  }) as typeof fetch;
}

const env: Env = {
  SITE_ENV: "production",
  RESEND_API_KEY: "re_test",
  TURNSTILE_SECRET_KEY: "turnstile-test-secret",
  SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec",
  SHEET_WEBHOOK_SECRET: "webhook-test-secret",
  CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => json(catalogData) },
};

/** Hands one browser request to the Worker as if it reached the live site, and gives the browser the Worker's answer. */
async function viaWorker(worker: WorkerModule, route: Route, page: Page) {
  const request = route.request();
  const url = new URL(request.url());
  const headers = await request.allHeaders();
  const forwarded = new Request(`${ORIGIN}${url.pathname}${url.search}`, {
    method: request.method(),
    headers: {
      "content-type": headers["content-type"] ?? "application/json",
      ...(headers.cookie ? { cookie: headers.cookie } : {}),
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "cf-connecting-ip": "203.0.113.9",
    },
    body: request.postData() ?? undefined,
  });
  const response = await worker.fetch(forwarded, env);
  // The cookie is set for example.test; the browser is on localhost, so it is copied across by name and value.
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    await page.context().addCookies([{ name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" }]);
  }
  await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
}

test("filter, open a piece, choose, request: the Sheet, the owner and the visitor get the same Worker estimate and the source", async ({ page, context }) => {
  const sent: Sent[] = [];
  const worker = await loadWorker();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeOutside(sent);
  try {
    await context.route(/^https?:\/\/(?!localhost)/, (route) => {
      const host = new URL(route.request().url()).host;
      if (host === "challenges.cloudflare.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB });
      return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
    });
    await context.route("**/api/visit", (route) => viaWorker(worker, route, page));
    let posted: Record<string, unknown> = {};
    await context.route("**/api/forms/quote", (route) => {
      posted = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      return viaWorker(worker, route, page);
    });

    // An ad click: the capture script records the source before the gallery's filters touch the address.
    await page.goto("/blocks?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x&type=dinner-set&glaze=ash");
    await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === "hl_src")).toBe(true);
    const grid = page.locator("#showcase-catalog-grid");
    const piece = exampleCatalog.items.find((item) => item.slug === "everyday-dinner-set-ash-glaze");
    expect(piece).toBeDefined();
    await grid.getByRole("link", { name: String(piece?.data["name"]) }).click();
    await expect(page).toHaveURL(/\/blocks\/catalog\/everyday-dinner-set-ash-glaze/);

    await page.getByRole("radio", { name: "Cobalt" }).check({ force: true });
    await page.getByLabel(exampleCatalog.pricing.perPerson?.label ?? "", { exact: true }).fill("6");
    await page.getByLabel(exampleCatalog.pricing.perPerson?.label ?? "", { exact: true }).blur();

    const shared = priceRange(
      { price: piece?.data["price"] as { low: number; high: number }, options: piece?.data["options"] as string[], perPerson: true },
      exampleCatalog.pricing,
      { options: { "glaze-colour": "cobalt" }, people: 6 },
      "everyday-dinner-set-ash-glaze",
    );
    expect(shared.ok).toBe(true);
    const estimate = shared.ok ? formatRange(shared.result, exampleCatalog.pricing.currency, catalogWords) : "";
    await expect(page.getByText(estimate, { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: catalogWords.quote.requestQuote }).click();
    await page.getByLabel("Your name").fill("Ada Lovelace");
    await page.getByLabel("Email").fill("ada@example.org");
    await page.getByRole("button", { name: "Send my quote request" }).click();
    await expect(page.getByText(/Thanks\. I have your request/)).toBeVisible();

    // The browser sent ids and a number, never a figure.
    expect(posted["selection"]).toEqual({ item: "everyday-dinner-set-ash-glaze", options: { "glaze-colour": "cobalt" }, people: 6 });
    expect(Object.keys(posted).filter((key) => /price|range|estimate|total/i.test(key))).toEqual([]);

    const line = `${catalogWords.email.estimate} ${estimate}`;
    const sheet = sent.find((call) => call.url.startsWith("https://script.google.com/"));
    const emails = sent.filter((call) => call.url === "https://api.resend.com/emails").map((call) => call.json);
    const owner = emails.find((email) => email["to"] === "hello@example.test");
    const visitor = emails.find((email) => email["to"] === "ada@example.org");
    const row = (sheet?.json["row"] ?? []) as string[];
    expect(row.some((cell) => cell.includes(line))).toBe(true);
    expect(String(owner?.["text"])).toContain(line);
    expect(String(visitor?.["text"])).toContain(line);
    // The visit's source: the Sheet's source cells and the owner email's "Came from" line.
    expect(row.join(" ")).toContain("google");
    expect(row.join(" ")).toContain("spring-sale");
    expect(String(owner?.["text"])).toMatch(/Came from: .*google/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
