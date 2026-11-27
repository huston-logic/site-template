import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { noteForm } from "../../src/content/contact";
import { needOptions } from "../../src/content/contact-fields";
import { showcaseForm } from "../../src/forms/showcase";
import { FIXTURE_TRACKING, trackingCspOrigins } from "../../src/tracking/config";

// The tags with the fixture IDs (docs/TRACKING.md, "How to test"). Needs a build made with TRACKING_FIXTURE=1. Every
// request to a host other than the local preview server is answered here with an empty body, so nothing leaves the
// machine; the test records which hosts the page asked for.

const TURNSTILE_STUB = `(() => {
  let options = null;
  window.turnstile = {
    render(el, o) { options = o; setTimeout(() => options.callback("test-token"), 0); return "w1"; },
    reset() { setTimeout(() => options.callback("test-token"), 0); },
    remove() {},
  };
})();`;

type Calls = { gtag: unknown[][]; fbq: unknown[][] };

async function stubOutside(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route(/^https?:\/\/(?!localhost)/, (route: Route) => {
    const url = new URL(route.request().url());
    asked.push(`${url.host}${url.pathname}`);
    if (url.host === "challenges.cloudflare.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB });
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith(".js") || url.pathname.includes("/gtag/") ? "text/javascript" : "text/plain", body: "" });
  });
  await context.addInitScript(() => {
    (window as unknown as { cspViolations: string[] }).cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { cspViolations: string[] }).cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return asked;
}

async function calls(page: Page): Promise<Calls> {
  return page.evaluate(() => {
    const w = window as unknown as { dataLayer?: ArrayLike<unknown>[]; fbq?: { queue?: ArrayLike<unknown>[] } };
    const plain = (a: ArrayLike<unknown>) => Array.from(a).map((v) => (v instanceof Date ? "date" : v));
    return { gtag: (w.dataLayer ?? []).map(plain), fbq: (w.fbq?.queue ?? []).map(plain) };
  });
}

const events = (c: Calls) => c.gtag.filter((a) => a[0] === "event").map((a) => String(a[1]));
const meta = (c: Calls) => c.fbq.filter((a) => a[0] === "track").map((a) => String(a[1]));

async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length > 0, undefined, { timeout: 10_000 });
}

test("the tags load after the page, the CSP allows exactly the fixture origins, and page_view fires once per path", async ({ page, context }) => {
  const asked = await stubOutside(context);
  const response = await page.goto("/", { waitUntil: "load" });
  await settle(page);
  const csp = response?.headers()["content-security-policy"] ?? "";
  const origins = trackingCspOrigins(FIXTURE_TRACKING);
  for (const origin of [...origins.script]) expect(csp).toMatch(new RegExp(`script-src [^;]*${origin.replace(/[.*]/g, "\\$&")}`));
  for (const origin of [...origins.connect]) expect(csp).toMatch(new RegExp(`connect-src [^;]*${origin.replace(/[.*]/g, "\\$&")}`));
  for (const origin of [...origins.img]) expect(csp).toMatch(new RegExp(`img-src [^;]*${origin.replace(/[.*]/g, "\\$&")}`));

  expect(asked).toContain("www.googletagmanager.com/gtag/js");
  expect(asked).toContain("connect.facebook.net/en_US/fbevents.js");
  const first = await calls(page);
  expect(first.gtag).toContainEqual(["config", "G-TEST000000", { send_page_view: false, allow_google_signals: false }]);
  expect(first.gtag).toContainEqual(["config", "AW-000000000", { send_page_view: false }]);
  expect(first.fbq).toContainEqual(["set", "autoConfig", false, "000000000000000"]);
  expect(first.fbq).toContainEqual(["init", "000000000000000"]);
  expect(events(first)).toEqual(["page_view"]);
  expect(meta(first)).toEqual(["PageView"]);

  await page.getByRole("navigation").first().getByRole("link").nth(1).click();
  await page.waitForFunction(() => location.pathname !== "/");
  await expect.poll(async () => events(await calls(page))).toEqual(["page_view", "page_view"]);
  expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
});

test("phone and email links fire click_call and click_email anywhere on the site", async ({ page, context }) => {
  await stubOutside(context);
  await page.goto("/about", { waitUntil: "load" });
  await settle(page);
  await page.evaluate(() => {
    for (const href of ["tel:+15555550100", "mailto:someone@example.org"]) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = href;
      a.addEventListener("click", (e) => e.preventDefault());
      document.querySelector("main")?.append(a);
    }
  });
  await page.getByText("tel:+15555550100").click();
  await page.getByText("mailto:someone@example.org").click();
  const c = await calls(page);
  expect(events(c)).toEqual(["page_view", "click_call", "click_email"]);
  expect(meta(c)).toEqual(["PageView", "Contact", "Contact"]);
  expect(JSON.stringify(c)).not.toContain("5555550100");
  expect(JSON.stringify(c)).not.toContain("someone@example.org");
});

test("the contact form fires form_start on first focus and lead on success, to GA4, the Ads lead label and Meta", async ({ page, context }) => {
  await stubOutside(context);
  await page.route("**/api/contact", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, autoReply: true }) }));
  await page.goto("/contact", { waitUntil: "load" });
  await settle(page);
  await page.getByText(needOptions.find((option) => option.value === "website")!.label, { exact: true }).click();
  await page.getByLabel(noteForm.name.label).fill("Ada Lovelace");
  await page.getByLabel(noteForm.email.label).fill("ada@example.org");
  await page.getByLabel(noteForm.message.label).fill("Inquiries get lost between three inboxes.");
  await page.getByRole("button", { name: noteForm.submitLabel }).click();
  await page.waitForURL("**/contact/thanks");
  await expect.poll(async () => events(await calls(page))).toEqual(["page_view", "form_start", "generate_lead", "conversion", "page_view"]);
  const c = await calls(page);
  expect(c.gtag).toContainEqual(["event", "generate_lead", { form_id: "contact", send_to: "G-TEST000000" }]);
  expect(c.gtag).toContainEqual(["event", "conversion", { send_to: "AW-000000000/TestLeadLabel" }]);
  expect(meta(c)).toEqual(["PageView", "Lead", "PageView"]);
  expect(JSON.stringify(c)).not.toContain("ada@example.org");
});

// The form block on /blocks (the showcase form), or, with TRACKING_FORM_PAGE and TRACKING_FORM_ID, a page and form made by
// the site editor's own operations (docs/TRACKING.md, "Test the tags locally").
test("a form block fires form_start and lead on success", async ({ page, context }) => {
  await stubOutside(context);
  await page.route("**/api/forms/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  const path = process.env.TRACKING_FORM_PAGE ?? "/blocks";
  const formId = process.env.TRACKING_FORM_ID ?? "showcase-example";
  await page.goto(path, { waitUntil: "load" });
  await settle(page);
  if (formId === "showcase-example") {
    const form = page.getByRole("region", { name: "A short heading that says what the form is for", exact: true });
    await form.getByLabel(showcaseForm.fields[0]!.label, { exact: true }).fill("Ada Lovelace");
    await form.getByLabel(showcaseForm.fields[1]!.label, { exact: true }).fill("ada@example.org");
    await form.getByText("A website", { exact: true }).click();
    await form.getByLabel(showcaseForm.fields[4]!.label, { exact: true }).fill("Hello.");
    await form.getByRole("button", { name: showcaseForm.button }).click();
  } else {
    await page.getByLabel("Your name", { exact: true }).fill("Ada Lovelace");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.org");
    await page.getByRole("button", { name: "Send my request" }).click();
  }
  await expect.poll(async () => events(await calls(page))).toContain("generate_lead");
  const c = await calls(page);
  expect(events(c)[0]).toBe("page_view");
  expect(c.gtag).toContainEqual(["event", "form_start", { form_id: formId, send_to: "G-TEST000000" }]);
  expect(c.gtag).toContainEqual(["event", "generate_lead", { form_id: formId, send_to: "G-TEST000000" }]);
  expect(c.gtag).toContainEqual(["event", "conversion", { send_to: "AW-000000000/TestLeadLabel" }]);
  expect(meta(c)).toEqual(["PageView", "Lead"]);
  expect(JSON.stringify(c)).not.toContain("ada@example.org");
});

test("with Global Privacy Control on, no tag is requested and nothing is queued", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const asked = await stubOutside(context);
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  expect(asked.filter((host) => !host.startsWith("challenges.cloudflare.com"))).toEqual([]);
  expect(await page.evaluate(() => typeof (window as unknown as { hlTrack?: unknown }).hlTrack)).toBe("undefined");
  await context.close();
});

test("source capture posts only for a tagged landing or another site's referrer", async ({ page }) => {
  const posts: unknown[] = [];
  await page.route("**/api/visit", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto("/", { waitUntil: "load" });
  await page.goto("/about", { waitUntil: "load" });
  expect(posts).toEqual([]);
  await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x", { waitUntil: "load" });
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ path: "/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x", referrer: expect.any(String) });
});
