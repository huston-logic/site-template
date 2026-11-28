import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { siteConfig } from "../site.config.ts";
import { buildWorkerConfig, workerConfig } from "./config.ts";

describe("buildWorkerConfig: payments and the gift card tabs", () => {
  test("the template has payments off and the default tab names", () => {
    assert.equal(workerConfig.payments, null);
    assert.equal(workerConfig.sheetTabs.giftCards, "Gift cards");
    assert.equal(workerConfig.sheetTabs.giftCardsPreview, "Gift cards preview");
  });

  test("a config without the new keys gets the defaults", () => {
    const older = { ...siteConfig, payments: undefined, booking: undefined, contact: { ...siteConfig.contact, sheetTabs: { production: "A", preview: "B" } } };
    const built = buildWorkerConfig(older);
    assert.equal(built.payments, null);
    assert.equal(built.booking, null);
    assert.deepEqual(built.sheetTabs, { production: "A", preview: "B", forms: "Forms", formsPreview: "Forms preview", giftCards: "Gift cards", giftCardsPreview: "Gift cards preview", bookings: "Bookings", bookingsPreview: "Bookings preview" });
  });

  test("a set payments value and custom tab names are carried through", () => {
    const built = buildWorkerConfig({
      ...siteConfig,
      payments: { provider: "stripe", currency: "gbp" },
      contact: { ...siteConfig.contact, sheetTabs: { ...siteConfig.contact.sheetTabs, giftCards: "Cards", giftCardsPreview: "Cards test" } },
    });
    assert.deepEqual(built.payments, { provider: "stripe", currency: "gbp" });
    assert.equal(built.sheetTabs.giftCards, "Cards");
    assert.equal(built.sheetTabs.giftCardsPreview, "Cards test");
  });

  test("booking: the template has it off; a set value is carried through with the business's time zone", () => {
    assert.equal(workerConfig.booking, null);
    const built = buildWorkerConfig({ ...siteConfig, business: { ...siteConfig.business, timeZone: "America/Chicago" }, booking: { calendarId: "cal@example.test", busyCalendarIds: ["busy@example.test"], previewCalendarId: null } });
    assert.deepEqual(built.booking, { calendarId: "cal@example.test", busyCalendarIds: ["busy@example.test"], previewCalendarId: null });
    assert.equal(built.timeZone, "America/Chicago");
  });
});
