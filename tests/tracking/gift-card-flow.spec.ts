import { spawn, type ChildProcess } from "node:child_process";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { giftCardWords } from "../../src/content/gift-cards";

// The gift card walk (docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md, "Done when"): a visitor lands
// from a tagged link, picks an amount and pays. The browser's posts go to the real Worker code, run with payments on by
// tests/tracking/gift-card-worker-harness.mjs; Stripe is a fake there that keeps sessions and signs its webhooks. The test
// checks begin_checkout fires as the visitor leaves for Stripe, purchase fires once on the thank-you page (and not again
// on a reload), and the webhook delivered three times gives one certificate email, one ledger row and one owner email
// with the same code, amount and source. Needs `PAYMENTS_FIXTURE=1 TRACKING_FIXTURE=1 npm run build`.

const HARNESS_PORT = 4825;
const HARNESS = `http://127.0.0.1:${HARNESS_PORT}`;
const CERTIFICATE_OUT = process.env["GIFT_CERTIFICATE_OUT"] ?? "";

const TURNSTILE_STUB = `(() => {
  let options = null;
  window.turnstile = {
    render(el, o) { options = o; setTimeout(() => options.callback("test-token"), 0); return "w1"; },
    reset() { setTimeout(() => options.callback("test-token"), 0); },
    remove() {},
  };
})();`;

// Every gtag call is also handed to the test, so the events survive the page leaving for Stripe and coming back.
const RECORD_EVENTS = `(() => {
  const layer = [];
  layer.push = function (entry) {
    try { const a = Array.from(entry); if (a[0] === "event") window.__recordEvent(String(a[1]), JSON.stringify(a[2] ?? {})); } catch {}
    return Array.prototype.push.call(this, entry);
  };
  window.dataLayer = layer;
})();`;

type Sent = { url: string; json: Record<string, unknown> };
type Recorded = { name: string; params: Record<string, unknown> };

let harness: ChildProcess | null = null;

test.beforeAll(async () => {
  const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "tests/tracking/gift-card-worker-harness.mjs", String(HARNESS_PORT), ...(CERTIFICATE_OUT ? [CERTIFICATE_OUT] : [])];
  harness = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The Worker harness did not start.")), 15_000);
    harness?.stdout?.on("data", (chunk: Buffer) => {
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
  for (const line of answer.cookies) {
    const [pair = ""] = line.split(";");
    const at = pair.indexOf("=");
    await page.context().addCookies([{ name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" }]);
  }
  await route.fulfill({ status: answer.status, contentType: "application/json", body: answer.body });
}

async function setUp(context: BrowserContext, page: Page): Promise<Recorded[]> {
  const recorded: Recorded[] = [];
  await context.exposeBinding("__recordEvent", (_source, name: string, params: string) => {
    recorded.push({ name, params: JSON.parse(params) as Record<string, unknown> });
  });
  await context.addInitScript(RECORD_EVENTS);
  await context.route(/^https?:\/\/(?!localhost)/, (route) => {
    const url = new URL(route.request().url());
    if (url.host === "challenges.cloudflare.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB });
    if (url.host === "checkout.stripe.com") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Stripe Checkout (fake)</title><h1>Pay</h1>" });
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  for (const path of ["**/api/visit", "**/api/gift-cards/checkout", "**/api/gift-cards/confirm*"]) await context.route(path, (route) => viaWorker(route, page));
  return recorded;
}

async function fillAndPay(page: Page) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: giftCardWords.button }) }).first();
  await form.getByRole("radio", { name: /\$50/ }).check({ force: true });
  await form.getByLabel(giftCardWords.buyerNameLabel, { exact: true }).fill("Ada Lovelace");
  await form.getByLabel(giftCardWords.buyerEmailLabel, { exact: true }).fill("ada@example.org");
  await form.getByLabel(giftCardWords.recipientNameLabel, { exact: true }).fill("Grace Hopper");
  await form.getByLabel(giftCardWords.messageLabel, { exact: true }).fill("Happy birthday, Grace. Enjoy a quiet afternoon.");
  await form.getByRole("button", { name: giftCardWords.button }).click();
  await page.waitForURL(/checkout\.stripe\.com\/c\/pay\/cs_test_walk\d+/);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

test("pick an amount, pay, land on the thank-you page: begin_checkout once, purchase once, one of each email and row", async ({ page, context }) => {
  const recorded = await setUp(context, page);
  await page.goto("/blocks?utm_source=newsletter&utm_medium=email&utm_campaign=holiday");
  await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === "hl_src")).toBe(true);

  const sessionId = await fillAndPay(page);
  const begins = recorded.filter((event) => event.name === "begin_checkout");
  expect(begins).toHaveLength(1);
  expect(begins[0]?.params).toMatchObject({ value: 50, currency: "USD" });

  // Stripe takes the payment and delivers the same webhook three times.
  const paid = (await (await fetch(`${HARNESS}/pay`, { method: "POST", body: JSON.stringify({ id: sessionId, times: 3 }) })).json()) as { statuses: number[]; successUrl: string; amount: number };
  expect(paid.amount).toBe(5000);
  expect(paid.statuses).toEqual([200, 200, 200]);

  // Back on the site: the thank-you page confirms through the Worker, then fires purchase.
  const thanks = new URL(paid.successUrl.replace("{CHECKOUT_SESSION_ID}", sessionId));
  await page.goto(`${thanks.pathname}${thanks.search}`);
  await expect(page.getByRole("heading", { name: giftCardWords.thanks.paid.heading })).toBeVisible();
  await expect.poll(() => recorded.filter((event) => event.name === "purchase").length).toBe(1);
  expect(page.url(), "the session id is taken out of the address before any tag can send it").not.toContain("session_id");
  const purchase = recorded.find((event) => event.name === "purchase");
  expect(purchase?.params).toMatchObject({ value: 50, currency: "USD" });
  expect(String(purchase?.params["transaction_id"])).toMatch(/^pi_walk\d+$/);

  await page.reload();
  await expect(page.getByRole("heading", { name: giftCardWords.thanks.paid.heading })).toBeVisible();
  await page.waitForTimeout(500);
  expect(recorded.filter((event) => event.name === "purchase")).toHaveLength(1);

  const sent = (await (await fetch(`${HARNESS}/sent`)).json()) as Sent[];
  const emails = sent.filter((call) => call.url === "https://api.resend.com/emails").map((call) => call.json);
  const rows = sent.filter((call) => call.url.startsWith("https://script.google.com/")).map((call) => call.json);
  const buyer = emails.filter((email) => [email["to"]].flat().includes("ada@example.org"));
  const owner = emails.filter((email) => [email["to"]].flat().includes("hello@example.test"));
  expect(buyer).toHaveLength(1);
  expect(owner).toHaveLength(1);
  expect(rows).toHaveLength(1);
  const row = rows[0]?.["row"] as string[];
  expect(rows[0]?.["tab"]).toBe("Gift cards");
  const code = row[1] ?? "";
  expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  expect(row[2]).toBe("$50.00");
  expect(String(buyer[0]?.["text"])).toContain(code);
  expect(String(owner[0]?.["text"])).toContain(code);
  expect(String(owner[0]?.["text"])).toContain("$50.00");
  const attachments = buyer[0]?.["attachments"] as { filename: string; content: string }[];
  expect(attachments).toHaveLength(1);
  expect(Buffer.from(attachments[0]?.content ?? "", "base64").subarray(0, 5).toString()).toBe("%PDF-");
  // The visit's source rides with the payment: the ledger's source cells and the owner's "Came from" line.
  expect(row.join(" ")).toContain("newsletter");
  expect(row.join(" ")).toContain("holiday");
  expect(String(owner[0]?.["text"])).toMatch(/Came from: .*newsletter/);
  // The code never reaches analytics.
  expect(JSON.stringify(recorded)).not.toContain(code);
  expect(JSON.stringify(recorded)).not.toContain(sessionId);
});

test("cancelling at Stripe brings the visitor back with their choices kept and nothing charged", async ({ page, context }) => {
  await setUp(context, page);
  await page.goto("/blocks");
  const sessionId = await fillAndPay(page);
  const session = (await (await fetch(`${HARNESS}/session?id=${sessionId}`)).json()) as { cancelUrl: string };
  const cancel = new URL(session.cancelUrl);
  expect(cancel.search).toBe("?checkout=cancelled");
  await page.goto(`${cancel.pathname}${cancel.search}`);
  // The showcase shows the block twice (its two variants); the first one is the one the visitor used.
  const panel = page.locator("#showcase-gift-card-panel");
  await expect(panel.getByText(giftCardWords.cancelled)).toBeVisible();
  const form = panel.locator("form");
  await expect(form.getByLabel(giftCardWords.buyerNameLabel, { exact: true })).toHaveValue("Ada Lovelace");
  await expect(form.getByLabel(giftCardWords.recipientNameLabel, { exact: true })).toHaveValue("Grace Hopper");
  await expect(form.getByRole("radio", { name: /\$50/ })).toBeChecked();
});
