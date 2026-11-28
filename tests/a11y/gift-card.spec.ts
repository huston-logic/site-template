import { existsSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { giftCardWords } from "../../src/content/gift-cards";
import { exampleGiftCards } from "../../src/gift-cards/example";

// The gift card block on the block showcase (/blocks, both variants, example settings, selling on) and the thank-you page. The
// Worker isn't running here: the checkout and the confirmation are answered by page.route, Turnstile by a stub that hands back
// a token, and Stripe's page by a stand-in. Nothing leaves the machine.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const PANEL = "#showcase-gift-card-panel";
const BESIDE = "#showcase-gift-card-beside";
const STRIPE = "https://checkout.stripe.test/c/pay/cs_test_abc123";

const TURNSTILE_STUB = `(() => {
  let options = null;
  let count = 0;
  const issue = () => setTimeout(() => options.callback("test-token-" + ++count), 0);
  window.turnstile = {
    render(el, o) { options = o; issue(); return "w1"; },
    reset() { issue(); },
    remove() {},
  };
})();`;

async function expectClean(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const results = await builder.analyze();
  expect(results.violations, `Accessibility violations on ${label}: ${results.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("; ")}`).toEqual([]);
}

async function setUp(page: Page, answer: { status: number; body: unknown } = { status: 200, body: { url: STRIPE } }) {
  const sent: Record<string, unknown>[] = [];
  await page.route("https://challenges.cloudflare.com/**", (route: Route) => route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }));
  await page.route("**/api/gift-cards/checkout", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("https://checkout.stripe.test/**", (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Stripe stand-in</title><p>Pay</p>" }));
  await page.goto("/blocks", { waitUntil: "networkidle" });
  return sent;
}

/** Records what the page reports to analytics. An exposed function lives on in Node, so it keeps the record across the move to Stripe's page. */
async function recordEvents(page: Page): Promise<unknown[][]> {
  const events: unknown[][] = [];
  await page.exposeFunction("__record", (name: string, params: unknown) => void events.push([name, params]));
  await page.addInitScript(() => {
    window.hlTrack = (name: string, params?: unknown) => void (window as unknown as { __record: (n: string, p: unknown) => void }).__record(name, params);
  });
  return events;
}

const block = (page: Page, selector = PANEL) => page.locator(selector);
const send = (form: Locator) => form.getByRole("button", { name: giftCardWords.button });

async function fillDetails(form: Locator, extra: { message?: string; theirEmail?: string } = {}) {
  await form.getByLabel(giftCardWords.buyerNameLabel, { exact: true }).fill("Ada Lovelace");
  await form.getByLabel(giftCardWords.buyerEmailLabel, { exact: true }).fill("ada@example.org");
  await form.getByLabel(giftCardWords.recipientNameLabel, { exact: true }).fill("Grace Hopper");
  if (extra.message) await form.getByLabel(giftCardWords.messageLabel, { exact: true }).fill(extra.message);
  if (extra.theirEmail) await form.getByLabel(giftCardWords.recipientEmailLabel, { exact: true }).fill(extra.theirEmail);
}

test.describe("the block on the showcase", () => {
  test("an empty send announces the problems, marks each field and focuses the amount", async ({ page }) => {
    const sent = await setUp(page);
    const form = block(page);
    await send(form).click();

    await expect(form.getByText(giftCardWords.fieldErrors.amount)).toBeVisible();
    await expect(form.getByText(giftCardWords.fieldErrors.buyerName)).toBeVisible();
    await expect(form.getByText(giftCardWords.fieldErrors.buyerEmail)).toBeVisible();
    // The optional fields are not faulted when empty.
    await expect(form.getByLabel(giftCardWords.recipientNameLabel, { exact: true })).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.getByLabel(giftCardWords.recipientEmailLabel, { exact: true })).not.toHaveAttribute("aria-invalid", "true");

    for (const [label, error] of [
      [giftCardWords.buyerNameLabel, giftCardWords.fieldErrors.buyerName],
      [giftCardWords.buyerEmailLabel, giftCardWords.fieldErrors.buyerEmail],
    ] as const) {
      const control = form.getByLabel(label, { exact: true });
      await expect(control).toHaveAttribute("aria-invalid", "true");
      const described = (await control.getAttribute("aria-describedby")) ?? "";
      const texts = await control.evaluate((el, ids) => ids.split(" ").map((id) => el.ownerDocument.getElementById(id)?.textContent ?? ""), described);
      expect(texts.some((text) => text.includes(error)), `${label}: aria-describedby "${described}" reaches "${error}"`).toBe(true);
    }

    // The amount is a group of radios; the group is invalid and each radio reaches the error line, and focus is on the first.
    const group = form.getByRole("radiogroup", { name: giftCardWords.amountLegend });
    await expect(group).toHaveAttribute("aria-invalid", "true");
    for (const radio of await group.getByRole("radio").all()) {
      const described = (await radio.getAttribute("aria-describedby")) ?? "";
      const texts = await radio.evaluate((el, ids) => ids.split(" ").map((id) => el.ownerDocument.getElementById(id)?.textContent ?? ""), described);
      expect(texts.some((text) => text.includes(giftCardWords.fieldErrors.amount))).toBe(true);
    }
    await expect(group.getByRole("radio").first()).toBeFocused();
    expect(sent).toHaveLength(0);
    await expectClean(page, "/blocks (gift card errors)", PANEL);
  });

  test("the amounts are cards in one radio group, with an Other amount card when the range is on", async ({ page }) => {
    await setUp(page);
    const group = block(page).getByRole("radiogroup", { name: giftCardWords.amountLegend });
    const radios = group.getByRole("radio");
    await expect(radios).toHaveCount(exampleGiftCards.amounts.length + 1);
    await expect(group.getByText(exampleGiftCards.amounts[1]!.label!, { exact: true })).toBeVisible();
    await expect(radios.last()).toHaveAccessibleName(giftCardWords.otherAmount);
    await radios.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(radios.nth(1)).toBeChecked();
    // Every card is at least 44 px tall and wide.
    for (const box of await group.locator("label > span").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { width: number; height: number }))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("Other amount opens a box with the range, and a figure outside it is refused on that box", async ({ page }) => {
    const sent = await setUp(page);
    const form = block(page);
    const range = exampleGiftCards.custom!;
    await form.getByLabel(giftCardWords.otherAmount, { exact: true }).check({ force: true });
    const box = form.getByLabel(giftCardWords.otherAmountLabel, { exact: true });
    await expect(box).toBeVisible();
    await expect(form.getByText(giftCardWords.otherAmountHint(`$${range.min}`, `$${range.max}`))).toBeVisible();
    await fillDetails(form);
    await box.fill(String(range.max + 1));
    await send(form).click();
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText(giftCardWords.fieldErrors.customAmount(`$${range.min}`, `$${range.max}`))).toBeVisible();
    await expect(box).toBeFocused();
    expect(sent).toHaveLength(0);
    await expectClean(page, "/blocks (gift card other amount error)", PANEL);
  });

  test("the message counts its characters and stops at 300", async ({ page }) => {
    await setUp(page);
    const form = block(page);
    const message = form.getByLabel(giftCardWords.messageLabel, { exact: true });
    await expect(form.getByText(giftCardWords.messageCount(0, 300))).toBeVisible();
    await message.fill("Happy birthday");
    await expect(form.getByText(giftCardWords.messageCount(14, 300))).toBeVisible();
    await message.fill("x".repeat(300));
    await message.press("y");
    await expect(form.getByText(giftCardWords.messageCount(300, 300))).toBeVisible();
    const described = (await message.getAttribute("aria-describedby")) ?? "";
    expect(described.split(" ").length).toBeGreaterThanOrEqual(2);
  });

  test("a good form posts the Worker's checkout request, reports begin_checkout and leaves for Stripe with no answer in the address", async ({ page }) => {
    const events = await recordEvents(page);
    const sent = await setUp(page);
    const form = block(page);
    await form.getByRole("radio", { name: /^\$50/ }).check({ force: true });
    await fillDetails(form, { message: "Happy birthday", theirEmail: "grace@example.org" });
    await send(form).click();

    await expect(page).toHaveURL(STRIPE);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      choice: { kind: "preset", amount: 50 },
      buyerName: "Ada Lovelace",
      buyerEmail: "ada@example.org",
      recipientName: "Grace Hopper",
      message: "Happy birthday",
      recipientEmail: "grace@example.org",
      returnPath: "/blocks",
      company_fax: "",
      turnstileToken: "test-token-1",
    });
    expect(page.url()).not.toMatch(/Ada|Grace|Happy|ada@|grace@/);
    expect(events).toEqual([["begin_checkout", { value: 50, currency: "USD" }]]);
  });

  test("the fields are saved for a cancel, the token is not, and an Other amount is sent as custom", async ({ page }) => {
    const events = await recordEvents(page);
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        original.call(this, key, value);
        (window as unknown as { __record: (n: string, p: unknown) => void }).__record("stored", { key, value });
      };
    });
    const sent = await setUp(page, { status: 200, body: { url: "https://checkout.stripe.test/c/pay/cs_test_other" } });
    const form = block(page);
    await form.getByLabel(giftCardWords.otherAmount, { exact: true }).check({ force: true });
    await form.getByLabel(giftCardWords.otherAmountLabel, { exact: true }).fill("120");
    await fillDetails(form);
    await send(form).click();
    await expect(page).toHaveURL(/cs_test_other$/);
    expect(sent[0]).toMatchObject({ choice: { kind: "custom", amount: 120 } });
    const stored = events.filter((event) => event[0] === "stored").map((event) => event[1] as { key: string; value: string });
    const saved = stored.find((entry) => entry.key === "hl-gift-card-fields");
    expect(saved?.value).toContain("Ada Lovelace");
    expect(saved?.value).not.toContain("test-token");
    expect(events.some((event) => event[0] === "begin_checkout" && JSON.stringify(event[1]) === JSON.stringify({ value: 120, currency: "USD" }))).toBe(true);
  });

  test("a refused checkout shows the field the Worker names, and a failed one a single plain message", async ({ page }) => {
    await setUp(page, { status: 400, body: { ok: false, error: "invalid", fields: ["buyerEmail"] } });
    const form = block(page);
    await form.getByRole("radio", { name: /^\$25/ }).check({ force: true });
    await fillDetails(form);
    await send(form).click();
    await expect(form.getByText(giftCardWords.fieldErrors.buyerEmail)).toBeVisible();
    await expect(form.getByLabel(giftCardWords.buyerEmailLabel, { exact: true })).toBeFocused();
    await expect(form.getByLabel(giftCardWords.buyerNameLabel, { exact: true })).toHaveValue("Ada Lovelace");

    await page.unroute("**/api/gift-cards/checkout");
    await page.route("**/api/gift-cards/checkout", (route: Route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: "payments_unavailable" }) }));
    await send(form).click();
    await expect(form.getByRole("status").getByText(giftCardWords.errors.unavailable)).toBeVisible();
    await expect(page).toHaveURL(/\/blocks$/);
  });

  test("coming back from Stripe without paying restores the choices and says nothing was charged", async ({ page }) => {
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem("hl-gift-card-fields")) {
        window.sessionStorage.setItem(
          "hl-gift-card-fields",
          JSON.stringify({ choice: "50", custom: "", buyerName: "Ada Lovelace", buyerEmail: "ada@example.org", recipientName: "Grace Hopper", message: "Happy birthday", recipientEmail: "" }),
        );
      }
    });
    await page.route("https://challenges.cloudflare.com/**", (route: Route) => route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }));
    await page.goto("/blocks?checkout=cancelled", { waitUntil: "networkidle" });
    const form = block(page);
    await expect(form.getByText(giftCardWords.cancelled)).toBeVisible();
    await expect(form.getByLabel(giftCardWords.buyerNameLabel, { exact: true })).toHaveValue("Ada Lovelace");
    await expect(form.getByLabel(giftCardWords.messageLabel, { exact: true })).toHaveValue("Happy birthday");
    await expect(form.getByRole("radio", { name: /^\$50/ })).toBeChecked();
    // The note sits in a polite live region.
    await expect(form.locator("[role=status][aria-live=polite]").first()).toContainText(giftCardWords.cancelled);
    await expectClean(page, "/blocks (gift card, back from Stripe)", PANEL);
  });

  test("both variants are clean, and the beside layout keeps the same form", async ({ page }) => {
    await setUp(page);
    await expectClean(page, "/blocks (gift card panel)", PANEL);
    await expectClean(page, "/blocks (gift card beside)", BESIDE);
    await expect(block(page, BESIDE).getByRole("button", { name: giftCardWords.button })).toBeVisible();
  });

  test("the static HTML has the form, the no-JavaScript note and no payment script", async ({ page }) => {
    const html = await (await page.request.get("/blocks")).text();
    expect(html).toContain(giftCardWords.button);
    expect(html).toContain(giftCardWords.noScriptNoEmail.split(" ").slice(0, 5).join(" "));
    expect(html).not.toContain("js.stripe.com");
  });
});

// The thank-you page is built only while payments are on (finish-build removes it otherwise).
const thanksBuilt = existsSync("out/gift-cards/thanks.html") || existsSync("out/gift-cards/thanks/index.html");

test.describe("the thank-you page", () => {
  test.skip(!thanksBuilt, "The gift card thank-you page is not in this build (payments are off). Build with PAYMENTS_FIXTURE=1.");

  const paid = { status: "paid", value: 50, currency: "USD", transactionId: "pi_test_1", delivered: true, amountText: "$50.00", recipientCopy: false };

  async function open(page: Page, answer: { status?: number; body: unknown; delayMs?: number }, query = "?session_id=cs_test_abc123") {
    const asked: string[] = [];
    const events = await recordEvents(page);
    await page.route("**/api/gift-cards/confirm**", async (route: Route) => {
      asked.push(route.request().url());
      if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
      await route.fulfill({ status: answer.status ?? 200, contentType: "application/json", body: JSON.stringify(answer.body) });
    });
    await page.goto(`/gift-cards/thanks${query}`, { waitUntil: "networkidle" });
    return { asked, events };
  }
  const heading = (page: Page) => page.getByRole("heading", { level: 1 });

  test("paid: says the card is on its way, reports the purchase once, and a reload does not report it again", async ({ page }) => {
    const { asked, events } = await open(page, { body: paid });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.paid.heading);
    await expect(page.getByText(giftCardWords.thanks.paid.body("$50"))).toBeVisible();
    await expect(page.getByText(giftCardWords.thanks.paid.keepIt)).toBeVisible();
    expect(asked[0]).toContain("session_id=cs_test_abc123");
    expect(events).toEqual([["purchase", { value: 50, currency: "USD", transaction_id: "pi_test_1" }]]);
    await expectClean(page, "/gift-cards/thanks (paid)");

    await page.reload({ waitUntil: "networkidle" });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.paid.heading);
    expect(events, "a reload reports nothing more").toHaveLength(1);
  });

  test("paid: a second tab on the same purchase does not report it again", async ({ page, context }) => {
    const { events } = await open(page, { body: paid });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.paid.heading);
    expect(events).toHaveLength(1);
    const second = await context.newPage();
    const secondEvents = await recordEvents(second);
    await second.route("**/api/gift-cards/confirm**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(paid) }));
    await second.goto("/gift-cards/thanks?session_id=cs_test_abc123", { waitUntil: "networkidle" });
    await expect(second.getByRole("heading", { level: 1 })).toHaveText(giftCardWords.thanks.paid.heading);
    expect(secondEvents).toEqual([]);
  });

  test("paid but not yet delivered still says thank you, and asks again at 30 and 100 seconds", async ({ page }) => {
    await page.clock.install();
    const { asked } = await open(page, { body: { ...paid, delivered: false } });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.paid.heading);
    expect(asked).toHaveLength(1);
    await page.clock.fastForward(29_000);
    expect(asked).toHaveLength(1);
    await page.clock.fastForward(2_000);
    await expect.poll(() => asked.length).toBe(2);
    await page.clock.fastForward(60_000);
    expect(asked).toHaveLength(2);
    await page.clock.fastForward(11_000);
    await expect.poll(() => asked.length).toBe(3);
    await page.clock.fastForward(300_000);
    expect(asked, "it stops after the second ask").toHaveLength(3);
  });

  test("a delivered card is not asked about again", async ({ page }) => {
    await page.clock.install();
    const { asked } = await open(page, { body: paid });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.paid.heading);
    await page.clock.fastForward(200_000);
    expect(asked).toHaveLength(1);
  });

  test("still waiting: an open payment says not to pay again", async ({ page }) => {
    const { events } = await open(page, { body: { status: "pending" } });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.stillWaiting.heading);
    await expect(page.getByText(giftCardWords.thanks.stillWaiting.body)).toBeVisible();
    expect(events).toEqual([]);
    await expectClean(page, "/gift-cards/thanks (still waiting)");
  });

  test("not paid: an unpaid checkout says nothing was charged and links back", async ({ page }) => {
    const { events } = await open(page, { body: { status: "unpaid" } });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.notPaid.heading);
    await expect(page.getByRole("link", { name: giftCardWords.thanks.notPaid.back })).toBeVisible();
    expect(events).toEqual([]);
    await expectClean(page, "/gift-cards/thanks (not paid)");
  });

  test("error: an answer the page cannot read says it could not check, and reports nothing", async ({ page }) => {
    const { events } = await open(page, { status: 502, body: { status: "error" } });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.error.heading);
    await expect(page.getByText(giftCardWords.thanks.error.body)).toBeVisible();
    expect(events).toEqual([]);
    await expectClean(page, "/gift-cards/thanks (error)");
  });

  test("checking: while Stripe is asked, the page says so", async ({ page }) => {
    const pending = open(page, { body: paid, delayMs: 1500 });
    await expect(heading(page)).toHaveText(giftCardWords.thanks.checking.heading);
    await expectClean(page, "/gift-cards/thanks (checking)");
    await pending;
    await expect(heading(page)).toHaveText(giftCardWords.thanks.paid.heading);
  });

  test("no session id in the address: nothing is asked, and the page says no payment was taken", async ({ page }) => {
    const { asked } = await open(page, { body: paid }, "");
    await expect(heading(page)).toHaveText(giftCardWords.thanks.notPaid.heading);
    expect(asked).toHaveLength(0);
  });

  test("the page is not indexed and has a plain message before JavaScript", async ({ page }) => {
    const html = await (await page.request.get("/gift-cards/thanks")).text();
    expect(html).toContain('name="robots" content="noindex');
    expect(html).toContain(giftCardWords.thanks.noScript.body);
  });
});
