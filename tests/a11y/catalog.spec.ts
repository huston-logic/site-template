import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { matchingPositions, selectedOf, type CardValues } from "../../src/blocks/catalog-filtering";
import { exampleCatalog } from "../../src/catalog/example";
import { catalogWords } from "../../src/content/catalog";
import { exampleItemRoute } from "../../src/lib/routes";

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
    await expect(page).toHaveURL(/\?type=jug$/);
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
