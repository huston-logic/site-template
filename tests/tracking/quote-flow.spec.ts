import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type Page, type Route } from "@playwright/test";
import { exampleCatalog } from "../../src/catalog/example";
import { formatRange, priceRange } from "../../src/catalog/price";
import { catalogWords } from "../../src/content/catalog";

// The brief's acceptance walk (docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md): a visitor lands from an
// ad, filters by two filters, opens a piece, picks options and requests a quote. The browser's posts to /api/visit and
// /api/forms/quote go to the real Worker code, run by tests/tracking/quote-worker-harness.mjs in its own Node process
// (Node loads the Worker's TypeScript and JSON natively), with fakes for Turnstile, the Sheet's Apps Script and Resend,
// and the site's assets serving the showcase's catalog data. The test then checks that the Sheet row, the owner email
// and the visitor email carry the same Worker-computed estimate and the visit's source. Needs the fixture build
// (`TRACKING_FIXTURE=1 npm run build`), like every spec in this folder.

const HARNESS_PORT = 4824;
const HARNESS = `http://127.0.0.1:${HARNESS_PORT}`;

const TURNSTILE_STUB = `(() => {
  let options = null;
  window.turnstile = {
    render(el, o) { options = o; setTimeout(() => options.callback("test-token"), 0); return "w1"; },
    reset() { setTimeout(() => options.callback("test-token"), 0); },
    remove() {},
  };
})();`;

type Sent = { url: string; json: Record<string, unknown> };

let harness: ChildProcess | null = null;

test.beforeAll(async () => {
  harness = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "tests/tracking/quote-worker-harness.mjs", String(HARNESS_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The Worker harness did not start.")), 15_000);
    harness?.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[worker] ${chunk.toString()}`);
      if (chunk.toString().includes("ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

test.afterAll(() => {
  harness?.kill();
});

/** Hands one browser request to the Worker as if it reached the live site, and gives the browser the Worker's answer. */
async function viaWorker(route: Route, page: Page) {
  const request = route.request();
  const url = new URL(request.url());
  const headers = await request.allHeaders();
  const forwarded = {
    method: request.method(),
    path: `${url.pathname}${url.search}`,
    headers: { "content-type": headers["content-type"] ?? "application/json", ...(headers.cookie ? { cookie: headers.cookie } : {}) },
    body: request.postData(),
  };
  const answer = (await (await fetch(`${HARNESS}/worker`, { method: "POST", body: JSON.stringify(forwarded) })).json()) as { status: number; cookies: string[]; body: string };
  // The cookie is set for example.test; the browser is on localhost, so it is copied across by name and value.
  for (const line of answer.cookies) {
    const [pair = ""] = line.split(";");
    const at = pair.indexOf("=");
    await page.context().addCookies([{ name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" }]);
  }
  await route.fulfill({ status: answer.status, contentType: "application/json", body: answer.body });
}

test("filter, open a piece, choose, request: the Sheet, the owner and the visitor get the same Worker estimate and the source", async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!localhost)/, (route) => {
    const host = new URL(route.request().url()).host;
    if (host === "challenges.cloudflare.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB });
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await context.route("**/api/visit", (route) => viaWorker(route, page));
  let posted: Record<string, unknown> = {};
  await context.route("**/api/forms/quote", (route) => {
    posted = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    return viaWorker(route, page);
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
  // What the page shows is the shared function's figure (the live region reads "Estimate: <range>").
  await expect(page.getByText(`${catalogWords.email.estimate} ${estimate}`, { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: catalogWords.quote.requestQuote }).click();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.org");
  await page.getByRole("button", { name: "Send my quote request" }).click();
  await expect(page.getByText(/Thanks\. I have your request/)).toBeVisible();

  // The browser sent ids and a number, never a figure.
  expect(posted["selection"]).toEqual({ item: "everyday-dinner-set-ash-glaze", options: { "glaze-colour": "cobalt" }, people: 6 });
  expect(Object.keys(posted).filter((key) => /price|range|estimate|total/i.test(key))).toEqual([]);

  const sent = (await (await fetch(`${HARNESS}/sent`)).json()) as Sent[];
  const line = `${catalogWords.email.estimate} ${estimate}`;
  const sheet = sent.find((call) => call.url.startsWith("https://script.google.com/"));
  const emails = sent.filter((call) => call.url === "https://api.resend.com/emails").map((call) => call.json);
  const owner = emails.find((email) => [email["to"]].flat().includes("hello@example.test"));
  const visitor = emails.find((email) => [email["to"]].flat().includes("ada@example.org"));
  const row = (sheet?.json["row"] ?? []) as string[];
  expect(row.some((cell) => cell.includes(line))).toBe(true);
  expect(String(owner?.["text"])).toContain(line);
  expect(String(visitor?.["text"])).toContain(line);
  // The visit's source: the Sheet's source cells and the owner email's "Came from" line.
  expect(row.join(" ")).toContain("google");
  expect(row.join(" ")).toContain("spring-sale");
  expect(String(owner?.["text"])).toMatch(/Came from: .*google/);
});
