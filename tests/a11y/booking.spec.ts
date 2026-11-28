import { existsSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FREE_SUMMARY_KEY, RESUME_KEY, type BookingSummary, type CheckoutRequest, type ConfirmAnswer, type TimesAnswer } from "../../src/booking/api";
import { addDays, formatTime, localParts, zonedToUtc } from "../../src/booking/zone";
import { bookingWords } from "../../src/content/booking";

// The booking block on the block showcase (/blocks, example settings: a free consultation and a two-session workshop with a
// deposit) and the thank-you page. The Worker isn't running here: times, checkout, release and confirmation are answered by
// page.route, Turnstile by a stub that hands back a token, and Stripe's page by a stand-in. Nothing leaves the machine.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const PANEL = "#showcase-booking-panel";
const STRIPE = "https://checkout.stripe.test/c/pay/cs_test_abc123";
const ZONE = "America/Chicago";
const words = bookingWords;

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

const today = () => localParts(Date.now(), ZONE).date;

/** Weekdays only, 9:00 to 11:30 every 30 minutes, from tomorrow; a later session only inside the rule (2 to 10 days after the one before). */
function timesAnswer(url: URL): TimesAnswer {
  const index = Number(url.searchParams.get("index"));
  const from = url.searchParams.get("from") ?? today();
  const days = Number(url.searchParams.get("days") ?? "7");
  const chosen = (url.searchParams.get("chosen") ?? "").split(",").filter(Boolean).map(Number);
  const previous = chosen[index - 1];
  const first = index === 0 || previous === undefined ? addDays(today(), 1) : addDays(localParts(previous, ZONE).date, 2);
  const last = index === 0 || previous === undefined ? addDays(today(), 60) : addDays(localParts(previous, ZONE).date, 10);
  const out: TimesAnswer = { ok: true, zone: ZONE, zoneName: "Central Standard Time", days: [], window: { first, last } };
  for (let step = 0; step < days; step += 1) {
    const date = addDays(from, step);
    const weekday = localParts(zonedToUtc(date, "12:00", ZONE) ?? 0, ZONE).weekday;
    if (date < first || date > last || weekday === "sat" || weekday === "sun") continue;
    const times = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"].map((clock) => {
      const start = zonedToUtc(date, clock, ZONE) ?? 0;
      return { start, label: formatTime(start, ZONE) };
    });
    out.days.push({ date, times });
  }
  return out;
}

function summaryFor(request: CheckoutRequest): BookingSummary {
  return {
    reference: "bk_test_1",
    service: request.service === "workshop" ? "Workshop" : "Consultation",
    party: request.party,
    sessions: request.starts.map((start) => ({ start, end: start + 3_600_000, label: `Tuesday, December 1, 2026, ${formatTime(start, ZONE)}` })),
    zoneName: "Central Standard Time",
    paidText: request.service === "workshop" ? "$112.50" : "",
    dueLaterText: request.service === "workshop" ? "$337.50 due later" : "",
    item: null,
  };
}

type Setup = { checkout?: { status: number; body: unknown }; confirm?: unknown };

async function setUp(page: Page, options: Setup = {}) {
  const sent: CheckoutRequest[] = [];
  const released: unknown[] = [];
  await page.route("https://challenges.cloudflare.com/**", (route: Route) => route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }));
  await page.route("**/api/booking/times**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timesAnswer(new URL(route.request().url()))) }));
  await page.route("**/api/booking/checkout", async (route: Route) => {
    const request = route.request().postDataJSON() as CheckoutRequest;
    sent.push(request);
    if (options.checkout) return route.fulfill({ status: options.checkout.status, contentType: "application/json", body: JSON.stringify(options.checkout.body) });
    const body =
      request.service === "workshop"
        ? { ok: true, kind: "checkout", url: STRIPE, sessionId: "cs_test_abc123", releaseToken: "rt_test_1", dueNow: 112.5, currency: "usd" }
        : { ok: true, kind: "booked", summary: summaryFor(request) };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/booking/release", async (route: Route) => {
    released.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/booking/confirm**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(options.confirm ?? { status: "error" }) }));
  await page.route("**/catalog.json", (route: Route) => route.fulfill({ status: 404, body: "" }));
  await page.route("https://checkout.stripe.test/**", (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Stripe stand-in</title><p>Pay</p>" }));
  return { sent, released };
}

async function recordEvents(page: Page): Promise<unknown[][]> {
  const events: unknown[][] = [];
  await page.exposeFunction("__record", (name: string, params: unknown) => void events.push([name, params]));
  await page.addInitScript(() => {
    window.hlTrack = (name: string, params?: unknown) => void (window as unknown as { __record: (n: string, p: unknown) => void }).__record(name, params);
  });
  return events;
}

const block = (page: Page) => page.locator(PANEL);
const session = (flow: Locator, n: number, of: number) => flow.getByRole("region", { name: of === 1 ? words.singleSessionHeading : words.sessionHeading(n, of) });

/** Picks the first day with times and the first time on it. */
async function pickTime(section: Locator) {
  const day = section.getByRole("group", { name: words.dayGroupLegend }).locator("button:not([disabled])").first();
  await expect(day).toBeVisible();
  await day.click();
  const first = section.getByRole("radio").first();
  await first.check({ force: true });
  await expect(first).toBeChecked();
}

async function chooseService(flow: Locator, name: string) {
  await flow.getByRole("radio", { name: new RegExp(`^${name}`) }).check({ force: true });
}

async function fillDetails(flow: Locator) {
  await flow.getByLabel("Your name", { exact: true }).fill("Ada Lovelace");
  await flow.getByLabel("Email", { exact: true }).fill("ada@example.org");
  await flow.getByLabel("Phone", { exact: false }).fill("555 0142");
}

async function bookWorkshop(page: Page, flow: Locator) {
  await chooseService(flow, "Workshop");
  await flow.getByRole("button", { name: words.partyIncrease }).click();
  await flow.getByRole("button", { name: words.partyIncrease }).click();
  await expect(flow.locator("output")).toHaveText(words.partyOutput(3));
  await pickTime(session(flow, 1, 2));
  await expect(session(flow, 2, 2)).toBeVisible();
  await pickTime(session(flow, 2, 2));
  await expect(flow.getByRole("button", { name: words.payButton("$112.50") })).toBeVisible();
  void page;
}

test.describe("the block on the showcase", () => {
  test("at rest: two services in one radio group, no sessions yet", async ({ page }) => {
    await setUp(page);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    const group = flow.getByRole("radiogroup", { name: words.serviceLegend });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await expect(flow.getByText("Two sessions of 3 hours, 2 to 10 days apart")).toBeVisible();
    await expect(flow.getByText("$150 per person")).toBeVisible();
    await expect(flow.getByText("25% deposit")).toBeVisible();
    await expect(flow.getByText(words.free, { exact: true })).toBeVisible();
    await expect(flow.getByRole("heading", { level: 3 })).toHaveCount(0);
    await group.getByRole("radio").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(group.getByRole("radio").nth(1)).toBeChecked();
    for (const box of await group.locator("label > span").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { width: number; height: number }))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expectClean(page, "/blocks (booking at rest)", PANEL);
  });

  test("a two-session workshop for three: the second session follows the first, then the details and the summary", async ({ page }) => {
    const { sent } = await setUp(page);
    const events = await recordEvents(page);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    await chooseService(flow, "Workshop");
    await expect(flow.getByRole("button", { name: words.partyIncrease })).toBeVisible();
    await expect(session(flow, 1, 2)).toBeVisible();
    await expect(session(flow, 2, 2)).toHaveCount(0);
    await expect(flow.getByText(words.zone("Central Standard Time")).first()).toBeVisible();
    await expectClean(page, "/blocks (booking, first session)", PANEL);

    await flow.getByRole("button", { name: words.partyIncrease }).click();
    await flow.getByRole("button", { name: words.partyIncrease }).click();
    await expect(flow.locator("output")).toHaveText(words.partyOutput(3));
    // Weekends in the stub have no times: their day buttons are disabled and say so.
    const noTimes = session(flow, 1, 2).getByRole("button", { name: new RegExp(`, ${words.noTimesDay}$`) }).first();
    await expect(noTimes).toBeDisabled();

    await pickTime(session(flow, 1, 2));
    await expect(session(flow, 2, 2)).toBeVisible();
    await expect(session(flow, 2, 2).getByText(/2 to 10 days after the one before/)).toBeVisible();
    await pickTime(session(flow, 2, 2));
    await expect(flow.getByRole("heading", { name: words.detailsHeading })).toBeFocused();
    await fillDetails(flow);
    await expect(flow.getByText("$450")).toBeVisible();
    await expect(flow.getByText("$112.50", { exact: true })).toBeVisible();
    await expect(flow.getByText("$337.50", { exact: true })).toBeVisible();
    await expect(flow.getByText(/not refunded if you cancel/)).toBeVisible();
    await expect(flow.getByText(/Book as usual and show your certificate/)).toBeVisible();
    await expectClean(page, "/blocks (booking, summary)", PANEL);

    await flow.getByRole("button", { name: words.payButton("$112.50") }).click();
    await page.waitForURL(STRIPE);
    expect(sent).toHaveLength(1);
    const request = sent[0]!;
    expect(request.service).toBe("workshop");
    expect(request.party).toBe(3);
    expect(request.starts).toHaveLength(2);
    expect(request.turnstileToken).toMatch(/^test-token-/);
    expect(Object.keys(request).some((key) => /price|amount|total/i.test(key))).toBe(false);
    expect(events).toContainEqual(["begin_checkout", { value: 112.5, currency: "USD" }]);
  });

  test("a time that was just taken sends focus back to that session", async ({ page }) => {
    await setUp(page, { checkout: { status: 409, body: { ok: false, error: "taken", index: 1 } } });
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    await bookWorkshop(page, flow);
    await fillDetails(flow);
    await flow.getByRole("button", { name: words.payButton("$112.50") }).click();
    await expect(flow.getByText(words.taken)).toBeVisible();
    await expect(session(flow, 2, 2).getByRole("heading", { name: words.sessionHeading(2, 2) })).toBeFocused();
    await expect(flow.getByRole("button", { name: words.payButton("$112.50") })).toHaveCount(0);
  });

  test("a free booking goes to the thank-you page and reports a lead", async ({ page }) => {
    test.skip(!existsSync("out/booking/thanks.html"), "this build has no booking thank-you page");
    const { sent } = await setUp(page);
    const events = await recordEvents(page);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    await chooseService(flow, "Consultation");
    await expect(flow.getByRole("button", { name: words.partyIncrease })).toHaveCount(0);
    await pickTime(session(flow, 1, 1));
    await fillDetails(flow);
    await flow.getByRole("button", { name: words.confirmButton }).click();
    await page.waitForURL(/\/booking\/thanks\?booked=1/);
    expect(sent[0]?.service).toBe("consultation");
    await expect(page.getByRole("heading", { name: words.thanks.booked.heading })).toBeVisible();
    await expect(page.getByText("Consultation")).toBeVisible();
    expect(events.filter(([name]) => name === "lead")).toEqual([["lead", { form_id: "booking" }]]);
    await expectClean(page, "/booking/thanks (free booking)");
  });

  test("keyboard only: from the services to the confirm button", async ({ page }) => {
    await setUp(page);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    const group = flow.getByRole("radiogroup", { name: words.serviceLegend });
    await group.getByRole("radio").first().focus();
    await page.keyboard.press("Space");
    await expect(group.getByRole("radio").first()).toBeChecked();

    type Target = "day" | "time" | "name" | "submit";
    async function tabTo(target: Target) {
      for (let step = 0; step < 80; step += 1) {
        await page.keyboard.press("Tab");
        const reached = await page.evaluate((kind) => {
          const el = document.activeElement;
          if (kind === "day") return el instanceof HTMLButtonElement && el.hasAttribute("aria-pressed") && !el.disabled;
          if (kind === "time") return el instanceof HTMLInputElement && el.type === "radio" && el.name.endsWith("-time");
          if (kind === "name") return el instanceof HTMLInputElement && el.autocomplete === "name";
          return el instanceof HTMLButtonElement && el.type === "submit";
        }, target);
        if (reached) return;
      }
      throw new Error(`Tab never reached ${target}`);
    }
    await expect(flow.locator("[aria-pressed]:not([disabled])").first()).toBeVisible();
    await tabTo("day");
    await page.keyboard.press("Enter");
    await expect(flow.getByRole("radiogroup", { name: /^Times on / })).toBeVisible();
    await tabTo("time");
    await page.keyboard.press("Space");
    await tabTo("name");
    await page.keyboard.type("Ada Lovelace");
    await page.keyboard.press("Tab");
    await page.keyboard.type("ada@example.org");
    await page.keyboard.press("Tab");
    await page.keyboard.type("555 0142");
    await tabTo("submit");
    await expect(flow.getByRole("button", { name: words.confirmButton })).toBeFocused();
    await expect(flow.getByRole("heading", { name: words.summaryHeading })).toBeVisible();
  });

  test("the whole flow fits the screen with no sideways scrolling", async ({ page }) => {
    await setUp(page);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    await bookWorkshop(page, flow);
    await fillDetails(flow);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Day buttons and chips keep a 44 px target.
    for (const box of await flow.locator("[aria-pressed], label > span").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { height: number }))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of [390, 360]) {
    test(`day buttons are at least 44 by 44 at ${width} wide, with no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await setUp(page);
      await page.goto("/blocks", { waitUntil: "networkidle" });
      const flow = block(page);
      await chooseService(flow, "Workshop");
      const days = session(flow, 1, 2).getByRole("group", { name: words.dayGroupLegend }).locator("button");
      await expect(days).toHaveCount(7);
      const boxes = await days.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { width: number; height: number }));
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      console.log(`day buttons at ${width}: min ${Math.min(...boxes.map((b) => b.width))} x ${Math.min(...boxes.map((b) => b.height))}`);
      // Each name starts with the weekday, day number and month that are drawn.
      const names = await days.evaluateAll((els) => els.map((el) => ({ name: (el.querySelector(".sr-only")?.textContent ?? "").trim(), visible: Array.from(el.querySelectorAll("[aria-hidden]")).map((s) => s.textContent).join(" ") })));
      for (const { name, visible } of names) expect(name.startsWith(visible)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("back from Stripe: the choices return and the held times are released", async ({ page }) => {
    const { released } = await setUp(page);
    const first = zonedToUtc(addDays(today(), 5), "10:00", ZONE) ?? 0;
    const second = zonedToUtc(addDays(today(), 12), "10:00", ZONE) ?? 0;
    // Both example days must be weekdays for the stub to offer them.
    const weekday = (ms: number) => localParts(ms, ZONE).weekday;
    test.skip(["sat", "sun"].includes(weekday(first)) || ["sat", "sun"].includes(weekday(second)), "the stub offers no weekend times; try again tomorrow");
    await page.addInitScript(
      ([key, resume]) => window.sessionStorage.setItem(key as string, resume as string),
      [RESUME_KEY, JSON.stringify({ service: "workshop", party: 3, starts: [first, second], answers: { name: "Ada Lovelace", email: "ada@example.org", phone: "555 0142", notes: "" }, sessionId: "cs_test_abc123", releaseToken: "rt_test_1", item: null })],
    );
    await page.goto("/blocks?checkout=cancelled", { waitUntil: "networkidle" });
    const flow = block(page);
    await expect(flow.getByText(words.cancelled)).toBeVisible();
    await expect(flow.locator("output")).toHaveText(words.partyOutput(3));
    await expect(flow.getByRole("button", { name: words.payButton("$112.50") })).toBeVisible();
    await expect(flow.getByLabel("Your name", { exact: true })).toHaveValue("Ada Lovelace");
    expect(released).toEqual([{ sessionId: "cs_test_abc123", releaseToken: "rt_test_1" }]);
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), RESUME_KEY)).toBeNull();
  });

  test("a times failure says so and offers the contact link", async ({ page }) => {
    await setUp(page);
    await page.route("**/api/booking/times**", (route: Route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unavailable" }) }));
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const flow = block(page);
    await chooseService(flow, "Consultation");
    await expect(flow.getByText(words.timesFailed)).toBeVisible();
    await expect(flow.getByRole("link", { name: words.contactLink })).toBeVisible();
    await expectClean(page, "/blocks (booking, times failed)", PANEL);
  });
});

test.describe("the thank-you page", () => {
  test.skip(!existsSync("out/booking/thanks.html"), "this build has no booking thank-you page");
  const summary: BookingSummary = {
    reference: "pi_test_1",
    service: "Workshop",
    party: 3,
    sessions: [
      { start: 1, end: 2, label: "Tuesday, December 1, 2026, 9:00 AM" },
      { start: 3, end: 4, label: "Friday, December 4, 2026, 9:00 AM" },
    ],
    zoneName: "Central Standard Time",
    paidText: "$112.50",
    dueLaterText: "$337.50 due later",
    item: null,
  };
  const paid = (booked: "booked" | "clash" | "waiting"): ConfirmAnswer => ({ status: "paid", booked, summary, value: 112.5, currency: "USD", transactionId: "pi_test_1", emailed: true });

  test("booked: the times, the amount paid, what is due later, and one purchase", async ({ page }) => {
    await setUp(page, { confirm: paid("booked") });
    const events = await recordEvents(page);
    await page.goto("/booking/thanks?session_id=cs_test_abc123", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: words.thanks.booked.heading })).toBeFocused();
    await expect(page.getByText(words.thanks.booked.paid("$112.50"))).toBeVisible();
    await expect(page.getByText("$337.50 due later")).toBeVisible();
    await expect(page.getByText("Friday, December 4, 2026, 9:00 AM")).toBeVisible();
    await expect(page.getByText(words.thanks.booked.emailed)).toBeVisible();
    expect(page.url()).not.toContain("session_id");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: words.thanks.booked.heading })).toBeVisible();
    expect(events.filter(([name]) => name === "purchase")).toEqual([["purchase", { value: 112.5, currency: "USD", transaction_id: "pi_test_1" }]]);
    await expectClean(page, "/booking/thanks (booked)");
  });

  test("clash: the owner will be in touch, and no times are promised", async ({ page }) => {
    await setUp(page, { confirm: paid("clash") });
    await page.goto("/booking/thanks?session_id=cs_test_abc123", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: words.thanks.clash.heading })).toBeVisible();
    await expect(page.getByText(/will contact you about your time/)).toBeVisible();
    await expect(page.getByText("Friday, December 4, 2026, 9:00 AM")).toHaveCount(0);
    await expectClean(page, "/booking/thanks (clash)");
  });

  test("waiting, not paid and error each say so", async ({ page }) => {
    for (const [confirm, heading] of [
      [paid("waiting"), words.thanks.waiting.heading],
      [{ status: "unpaid" }, words.thanks.notPaid.heading],
      [{ status: "error" }, words.thanks.error.heading],
    ] as const) {
      await setUp(page, { confirm });
      await page.goto("/booking/thanks?session_id=cs_test_abc123", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectClean(page, `/booking/thanks (${heading})`);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("without a session id the page says nothing was found", async ({ page }) => {
    await setUp(page);
    await page.goto("/booking/thanks", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: words.thanks.notPaid.heading })).toBeVisible();
  });

  test("a free booking without its kept summary still says it is confirmed", async ({ page }) => {
    await setUp(page);
    await page.addInitScript((key) => window.sessionStorage.removeItem(key), FREE_SUMMARY_KEY);
    await page.goto("/booking/thanks?booked=1", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: words.thanks.freeMissing.heading })).toBeVisible();
  });
});
