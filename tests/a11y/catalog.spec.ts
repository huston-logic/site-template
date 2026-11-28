import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { matchingPositions, selectedOf, type CardValues } from "../../src/blocks/catalog-filtering";
import { exampleCatalog } from "../../src/catalog/example";
import { cardPathFor } from "../../src/catalog/schema";
import { catalogWords } from "../../src/content/catalog";
import { exampleItemRoute, showcaseItemRoutes } from "../../src/lib/routes";

// The catalog blocks on the block showcase (/blocks, which shows both variants with the 60 example pieces) and a piece's
// own page. Nothing here needs the Worker: the quote post is not made.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const BLOCK = "#showcase-catalog-grid";
const total = exampleCatalog.items.length;
const cards: CardValues[] = exampleCatalog.items.map((item) => (item.data["filters"] ?? {}) as CardValues);
const countFor = (query: Record<string, string[]>) => matchingPositions(cards, selectedOf(Object.entries(query).flatMap(([filter, values]) => values.map((value) => ({ filter, value }))))).length;

async function expectClean(page: Page, label: string, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const results = await builder.analyze();
  expect(results.violations, `Accessibility violations on ${label}: ${results.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("; ")}`).toEqual([]);
}

async function open(page: Page) {
  await page.goto("/blocks", { waitUntil: "networkidle" });
  return page.locator(BLOCK);
}

test.describe("with JavaScript", () => {
  test("a filter panel opens from the keyboard and Escape closes it and returns focus", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The row of filter buttons is the desktop layout.");
    const block = await open(page);
    const type = block.getByRole("button", { name: /^Type/ });
    await type.focus();
    await page.keyboard.press("Enter");
    await expect(type).toHaveAttribute("aria-expanded", "true");
    await expect(block.getByRole("checkbox", { name: /^Jugs/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(type).toHaveAttribute("aria-expanded", "false");
    await expect(type).toBeFocused();
  });

  test("choosing two filters updates the count and the address, and the page is clean with a panel open", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The row of filter buttons is the desktop layout.");
    const block = await open(page);
    await block.getByRole("button", { name: /^Type/ }).click();
    await block.getByRole("checkbox", { name: /^Jugs/ }).check();
    await block.getByRole("button", { name: /^Glaze/ }).click();
    await block.getByRole("checkbox", { name: /^Ash/ }).check();
    const expected = countFor({ type: ["jug"], glaze: ["ash"] });
    await expect(block.getByText(catalogWords.count(expected, total, expected === 1 ? "piece" : "pieces"), { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\?type=jug&glaze=ash$/);
    await expect(block.locator("[data-card]:not([hidden])")).toHaveCount(Math.min(24, expected));
    await expectClean(page, "/blocks with a filter panel open", BLOCK);
  });

  test("an address with filters lands on the filtered view, dropping ids the site does not have", async ({ page }) => {
    await page.goto("/blocks?type=jug,teapot&nonsense=1", { waitUntil: "networkidle" });
    const expected = countFor({ type: ["jug"] });
    await expect(page.locator(BLOCK).getByText(catalogWords.count(expected, total, "pieces"), { exact: true })).toBeVisible();
    // Landing leaves the address as it came, so campaign parameters are never stripped.
    await expect(page).toHaveURL(/\?type=jug,teapot&nonsense=1$/);
  });

  test("changing a filter keeps utm and click ids and rewrites only the filter parameters", async ({ page }) => {
    await page.goto("/blocks?utm_source=ad&gclid=abc&type=jug,teapot", { waitUntil: "networkidle" });
    const block = page.locator(BLOCK);
    await block.getByRole("button", { name: /^Remove filter/ }).first().click();
    await expect(page).toHaveURL(/\?utm_source=ad&gclid=abc$/);
    await expect(block.locator("[data-trigger]:visible").first()).toBeFocused();
  });

  test("the empty state offers Clear filters, which restores every piece", async ({ page }) => {
    // The first pair of values, from two different filters, that no example piece has together.
    const filters = exampleCatalog.settings.filters;
    const pairs = filters.flatMap((a, i) => filters.slice(i + 1).flatMap((b) => a.values.flatMap((x) => b.values.map((y) => ({ a: a.id, x: x.id, b: b.id, y: y.id })))));
    const none = pairs.find((pair) => countFor({ [pair.a]: [pair.x], [pair.b]: [pair.y] }) === 0);
    test.skip(none === undefined, "Every pair of values has a piece.");
    await page.goto(`/blocks?${none!.a}=${none!.x}&${none!.b}=${none!.y}`, { waitUntil: "networkidle" });
    const block = page.locator(BLOCK);
    await expect(block.getByText(catalogWords.emptyHeading("pieces"))).toBeVisible();
    await expect(block.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await block.getByRole("button", { name: catalogWords.clearFilters }).click();
    await expect(block.getByText(catalogWords.count(total, total, "pieces"), { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/\?/);
  });

  test("Show more adds 24 pieces and moves focus to the first new card", async ({ page }) => {
    const block = await open(page);
    await expect(block.locator("[data-card]:not([hidden])")).toHaveCount(24);
    await block.getByRole("button", { name: catalogWords.showMore(24) }).click();
    await expect(block.locator("[data-card]:not([hidden])")).toHaveCount(48);
    await expect(block.locator("[data-card]").nth(24).getByRole("link")).toBeFocused();
  });

  test("on a phone one Filter button opens every group, and Show N pieces closes it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The single Filter button is the phone layout.");
    const block = await open(page);
    const filter = block.getByRole("button", { name: /^Filter/ });
    await filter.click();
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await expect(block.getByRole("group", { name: "Type" })).toBeVisible();
    await expect(block.getByRole("group", { name: "Glaze" })).toBeVisible();
    await block.getByRole("checkbox", { name: /^Jugs/ }).check();
    await expectClean(page, "/blocks with the phone filter panel open", BLOCK);
    await block.getByRole("button", { name: new RegExp(`^Show ${countFor({ type: ["jug"] })} pieces`) }).click();
    await expect(filter).toHaveAttribute("aria-expanded", "false");
    await expect(filter).toBeFocused();
  });

  test("a piece's page has no violations, and its photos and options work", async ({ page }) => {
    await page.goto(exampleItemRoute, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectClean(page, exampleItemRoute);
    const thumbs = page.getByRole("button", { name: /^Photo \d+ of \d+: / });
    if ((await thumbs.count()) > 1) {
      await thumbs.nth(1).click();
      await expect(thumbs.nth(1)).toHaveAttribute("aria-pressed", "true");
      await expect(thumbs.nth(0)).toHaveAttribute("aria-pressed", "false");
    }
    await page.getByRole("button", { name: "Request this quote" }).click();
    await expect(page.getByRole("heading", { name: catalogWords.quote.formHeading })).toBeFocused();
    await expectClean(page, `${exampleItemRoute} with the quote form open`);
  });
});

// Piece 4 in the example catalog has four photos; piece 1 has one.
const MANY = 3;
type Photo = { src: string; alt: string };
const photosOf = (position: number) => (exampleCatalog.items[position]?.data["photos"] ?? []) as Photo[];
const manyPhotos = photosOf(MANY);
const manyRoute = showcaseItemRoutes[MANY] as string;
const manyName = exampleCatalog.items[MANY]?.data["name"] as string;
const manySlug = exampleCatalog.items[MANY]?.slug as string;
const cardOf = (page: Page) => page.locator(BLOCK).locator("[data-card]").filter({ has: page.locator(`a[href$="/catalog/${manySlug}"]`) });
/**
 * Gives every card's second image its own address (`?second=<n>`, the same file) in the page the server sends. The example
 * catalog has six photos and each is some card's cover, so without it a request for a second image cannot be told from the
 * cover's; with it, the network shows exactly when a second image is asked for.
 */
async function markSecondImages(page: Page, requests: string[]) {
  await page.route("**/blocks", async (route) => {
    const response = await route.fetch();
    let n = 0;
    const body = (await response.text()).replace(/<img[^>]*data-card-second[^>]*>/g, (tag) => tag.replace(/ src="([^"]+)"/, (_all, src: string) => ` src="${src}?second=${n++}"`));
    await route.fulfill({ response, body, headers: { ...response.headers(), "content-length": String(Buffer.byteLength(body)) } });
  });
  page.on("request", (request) => {
    if (request.url().includes("?second=")) requests.push(request.url());
  });
}

test.describe("photo views", () => {
  test("a card's second photo is not requested until the card is hovered", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Hover is the desktop behaviour.");
    expect(manyPhotos.length).toBe(4);
    const requests: string[] = [];
    await markSecondImages(page, requests);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const seconds = page.locator(BLOCK).locator("[data-card-second]");
    expect(await seconds.count()).toBeGreaterThan(0);
    expect(requests, "second images requested at load").toEqual([]);
    const card = cardOf(page);
    const second = card.locator("[data-card-second]");
    const src = await second.getAttribute("src");
    expect(src).toContain("?second=");
    await expect(second).toBeHidden();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await expect(second).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toBe(new URL(src as string, page.url()).href);
    expect(requests[0]).toContain(cardPathFor(manyPhotos[1]!.src));
  });

  test("a card's second photo shows, and is requested, when its link has keyboard focus", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Keyboard focus on the cards is checked once.");
    const requests: string[] = [];
    await markSecondImages(page, requests);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const card = cardOf(page);
    const second = card.locator("[data-card-second]");
    await expect(second).toBeHidden();
    expect(requests).toEqual([]);
    await page.keyboard.press("Tab");
    await card.getByRole("link").focus();
    await expect(second).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    await expect(second).toHaveAttribute("aria-hidden", "true");
    await expect(second).toHaveAttribute("alt", "");
  });

  test("on a touch screen no card's second photo is requested", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Touch is the phone behaviour.");
    const requests: string[] = [];
    await markSecondImages(page, requests);
    await page.goto("/blocks", { waitUntil: "networkidle" });
    expect(await page.locator(BLOCK).locator("[data-card-second]").count()).toBeGreaterThan(0);
    await page.locator(BLOCK).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 1500);
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual([]);
  });

  test("only pieces with two or more photos carry a second card image", async ({ page }) => {
    await page.goto("/blocks", { waitUntil: "networkidle" });
    const block = page.locator(BLOCK);
    const withTwo = exampleCatalog.items.filter((item) => ((item.data["photos"] as unknown[]) ?? []).length > 1).length;
    await expect(block.locator("[data-card-second]")).toHaveCount(withTwo);
    const single = block.locator("[data-card]").filter({ has: page.locator(`a[href$="/catalog/${exampleCatalog.items[0]?.slug}"]`) });
    await expect(single).toHaveCount(1);
    await expect(single.locator("[data-card-second]")).toHaveCount(0);
  });

  test("swiping the photos moves the pressed thumbnail, and a thumbnail press moves the photos", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Swiping is the phone behaviour.");
    await page.goto(manyRoute, { waitUntil: "networkidle" });
    const strip = page.locator(".hl-strip");
    const thumbs = page.getByRole("button", { name: /^Photo \d of 4: / });
    await expect(thumbs).toHaveCount(4);
    await expect(thumbs.nth(0)).toHaveAttribute("aria-pressed", "true");
    // Only the first full photo is drawn until the others come into view.
    await expect(strip.locator("img")).toHaveCount(1);
    const box = await strip.boundingBox();
    expect(box).not.toBeNull();
    const cdp = await page.context().newCDPSession(page);
    for (let step = 1; step < 4; step++) {
      await cdp.send("Input.synthesizeScrollGesture", {
        x: box!.x + box!.width / 2,
        y: box!.y + box!.height / 2,
        xDistance: -box!.width * 0.8,
        gestureSourceType: "touch",
        speed: 1200,
      });
      await expect(thumbs.nth(step)).toHaveAttribute("aria-pressed", "true");
      await expect(strip.locator("img")).toHaveCount(step + 1);
      // The browser finishes the snap before the next swipe.
      await expect.poll(() => strip.evaluate((element) => Math.round(element.scrollLeft))).toBe(Math.round(step * box!.width));
    }
    for (const position of [0, 2]) {
      await thumbs.nth(position).click();
      await expect(thumbs.nth(position)).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => strip.evaluate((element) => Math.round(element.scrollLeft)), { message: `strip at photo ${position + 1}` }).toBe(Math.round(position * box!.width));
    }
  });

  test("the larger view opens, steps and closes by button, Escape and a press outside, and returns focus", async ({ page }) => {
    await page.goto(manyRoute, { waitUntil: "networkidle" });
    // Only the photo in view has a live button; the others sit in inert slides.
    const openerFor = (n: number) => page.getByRole("button", { name: catalogWords.openLarge(n, 4, manyPhotos[n - 1]!.alt) });
    const opener = openerFor(1);
    const dialog = page.getByRole("dialog", { name: catalogWords.largeView(manyName) });
    const counter = (n: number) => dialog.getByText(catalogWords.photoCount(n, 4), { exact: true });
    await expect(dialog).toBeHidden();

    // Button: open, step with the buttons and the arrow keys, stay clean, close.
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(counter(1)).toBeVisible();
    await expect(dialog.getByRole("button", { name: catalogWords.previousPhoto })).toHaveAttribute("aria-disabled", "true");
    await dialog.getByRole("button", { name: catalogWords.nextPhoto }).click();
    await expect(counter(2)).toBeVisible();
    await dialog.getByRole("button", { name: catalogWords.previousPhoto }).click();
    await expect(counter(1)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(counter(2)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(counter(3)).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(counter(2)).toBeVisible();
    await expectClean(page, `${manyRoute} with the larger view open`);
    await dialog.getByRole("button", { name: catalogWords.closeLarge }).click();
    await expect(dialog).toBeHidden();
    // The page shows the photo last seen, and focus is on the button that opens it.
    await expect(page.getByRole("button", { name: /^Photo 2 of 4: / })).toHaveAttribute("aria-pressed", "true");
    const second = openerFor(2);
    await expect(second).toBeFocused();

    // Escape.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(counter(2)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(second).toBeFocused();

    // A press outside the photo and the controls.
    await second.click();
    await expect(dialog).toBeVisible();
    await dialog.click({ position: { x: 4, y: 4 } });
    await expect(dialog).toBeHidden();
    await expect(second).toBeFocused();

    // A press on the photo itself keeps it open.
    await second.click();
    await dialog.locator("img").first().click();
    await expect(dialog).toBeVisible();
  });

  test("a piece with one photo has no strip, no larger view and no second card image", async ({ page }) => {
    await page.goto(exampleItemRoute, { waitUntil: "networkidle" });
    await expect(page.locator("main img").first()).toBeVisible();
    await expect(page.locator(".hl-strip")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open photo/ })).toHaveCount(0);
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Photo \d+ of \d+: / })).toHaveCount(0);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every piece is listed and the ask route is a link", async ({ page }) => {
    await page.goto("/blocks", { waitUntil: "load" });
    const block = page.locator(BLOCK);
    await expect(block.locator("[data-card]")).toHaveCount(total);
    await expect(block.locator("[data-card]:visible")).toHaveCount(total);
    await expect(block.getByRole("link", { name: catalogWords.askRoute("piece") })).toHaveAttribute("href", "/contact");
    // Playwright's text matching skips <noscript>, so the words are looked for in the page itself.
    expect(await page.content()).toContain(catalogWords.noScript);
  });

  test("a piece's page shows its default estimate and the contact link", async ({ page }) => {
    await page.goto(exampleItemRoute, { waitUntil: "load" });
    await expect(page.locator('noscript a[href="/contact"]')).toBeVisible();
    expect(await page.content()).toContain(catalogWords.quote.noScript);
  });
});
