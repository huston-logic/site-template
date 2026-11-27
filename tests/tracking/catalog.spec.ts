import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { exampleCatalog } from "../../src/catalog/example";

// The catalog's three events with the fixture IDs (docs/TRACKING.md): view_item on a piece's page, quote_start on
// "Request this quote", and lead (form_id quote) after the Worker confirms the quote form. Needs a build made with
// TRACKING_FIXTURE=1. The quote post is answered here, and every outside request is answered with an empty body, so
// nothing leaves the machine. The page is the showcase's first example piece (/blocks exists outside production builds).

const TURNSTILE_STUB = `(() => {
  let options = null;
  window.turnstile = {
    render(el, o) { options = o; setTimeout(() => options.callback("test-token"), 0); return "w1"; },
    reset() { setTimeout(() => options.callback("test-token"), 0); },
    remove() {},
  };
})();`;

type Calls = { gtag: unknown[][]; fbq: unknown[][] };

async function stubOutside(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\/(?!localhost)/, (route: Route) => {
    const url = new URL(route.request().url());
    if (url.host === "challenges.cloudflare.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB });
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith(".js") || url.pathname.includes("/gtag/") ? "text/javascript" : "text/plain", body: "" });
  });
}

async function calls(page: Page): Promise<Calls> {
  return page.evaluate(() => {
    const w = window as unknown as { dataLayer?: ArrayLike<unknown>[]; fbq?: { queue?: ArrayLike<unknown>[] } };
    const plain = (a: ArrayLike<unknown>) => Array.from(a).map((v) => (v instanceof Date ? "date" : v));
    return { gtag: (w.dataLayer ?? []).map(plain), fbq: (w.fbq?.queue ?? []).map(plain) };
  });
}

const events = (c: Calls) => c.gtag.filter((a) => a[0] === "event").map((a) => String(a[1]));

async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length > 0, undefined, { timeout: 10_000 });
}

const piece = exampleCatalog.items[0]!;
const pieceName = piece.data["name"] as string;

test("a piece's page fires view_item, Request this quote fires quote_start, and a confirmed quote fires lead with form_id quote", async ({ page, context }) => {
  await stubOutside(context);
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/forms/quote", async (route) => {
    posted.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto(`/blocks/catalog/${piece.slug}`, { waitUntil: "load" });
  await settle(page);
  await expect.poll(async () => events(await calls(page))).toEqual(["page_view", "view_item"]);
  expect((await calls(page)).gtag).toContainEqual(["event", "view_item", { item_id: piece.slug, item_name: pieceName, page_location: expect.any(String), send_to: "G-TEST000000" }]);

  await page.getByRole("button", { name: "Request this quote" }).click();
  await expect.poll(async () => events(await calls(page))).toContain("quote_start");
  expect((await calls(page)).gtag).toContainEqual(["event", "quote_start", { item_id: piece.slug, page_location: expect.any(String), send_to: "G-TEST000000" }]);

  await page.getByLabel("Your name", { exact: true }).fill("Ada Lovelace");
  await page.getByLabel("Email", { exact: true }).fill("ada@example.org");
  await page.getByRole("button", { name: "Send my quote request" }).click();
  await expect.poll(async () => events(await calls(page))).toContain("generate_lead");
  const c = await calls(page);
  expect(c.gtag).toContainEqual(["event", "generate_lead", { form_id: "quote", page_location: expect.any(String), send_to: "G-TEST000000" }]);
  expect(c.gtag).toContainEqual(["event", "conversion", { send_to: "AW-000000000/TestLeadLabel" }]);

  // What the browser sent: the selection beside the answers, never a figure.
  expect(posted).toHaveLength(1);
  const body = posted[0]!;
  expect(body["selection"]).toMatchObject({ item: piece.slug, options: expect.any(Object) });
  for (const key of ["range", "price", "estimate", "low", "high", "total"]) expect(body).not.toHaveProperty(key);
  expect(JSON.stringify(body["selection"])).not.toMatch(/\d{3,}/);
  // And what the tags saw: no answer and no price.
  expect(JSON.stringify(c)).not.toContain("ada@example.org");
  expect(JSON.stringify(c)).not.toMatch(/\$\d/);
});
