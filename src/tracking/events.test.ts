import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrackingIds } from "./config.ts";
import { EVENT_NAMES, eventCalls, pageLocation } from "./events.ts";

const ALL: TrackingIds = {
  ga4: "G-TEST000000",
  ads: { id: "AW-000000000", leadLabel: "LeadLabel1", purchaseLabel: "PurchaseLabel1" },
  meta: "000000000000000",
};
const GA = "G-TEST000000";

test("an unknown event name gives no calls", () => {
  assert.deepEqual(eventCalls("nope", {}, ALL), []);
  assert.deepEqual(eventCalls("__proto__", {}, ALL), []);
});

test("no IDs gives no calls for any event", () => {
  for (const name of EVENT_NAMES) assert.deepEqual(eventCalls(name, { form_id: "x", item_id: "y", value: 1, currency: "USD", transaction_id: "t" }, {}), []);
});

test("page_view: GA4 only (no Ads remarketing ping), and PageView for Meta", () => {
  const calls = eventCalls("page_view", { page_path: "/a", page_title: "A" }, ALL);
  assert.deepEqual(calls, [
    { to: "gtag", args: ["event", "page_view", { page_path: "/a", page_title: "A", send_to: GA }] },
    { to: "fbq", args: ["track", "PageView"] },
  ]);
});

test("page_view sends nothing to Google with only the Ads id, and Meta alone gets only PageView", () => {
  assert.deepEqual(eventCalls("page_view", { page_path: "/" }, { ads: { id: "AW-000000000" } }), []);
  assert.deepEqual(eventCalls("page_view", { page_path: "/" }, { meta: "000000000000000" }), [{ to: "fbq", args: ["track", "PageView"] }]);
});

test("form_start: GA4 only", () => {
  assert.deepEqual(eventCalls("form_start", { form_id: "contact" }, ALL), [{ to: "gtag", args: ["event", "form_start", { form_id: "contact", send_to: GA }] }]);
});

test("lead: generate_lead, the Ads conversion and Meta Lead", () => {
  assert.deepEqual(eventCalls("lead", { form_id: "contact" }, ALL), [
    { to: "gtag", args: ["event", "generate_lead", { form_id: "contact", send_to: GA }] },
    { to: "gtag", args: ["event", "conversion", { send_to: "AW-000000000/LeadLabel1" }] },
    { to: "fbq", args: ["track", "Lead"] },
  ]);
});

test("click_call and click_email: GA4 event and Meta Contact, no params", () => {
  for (const name of ["click_call", "click_email"]) {
    assert.deepEqual(eventCalls(name, { href: "tel:+15551234567" }, ALL), [
      { to: "gtag", args: ["event", name, { send_to: GA }] },
      { to: "fbq", args: ["track", "Contact"] },
    ]);
  }
});

test("view_item: GA4 and ViewContent", () => {
  assert.deepEqual(eventCalls("view_item", { item_id: "i1", item_name: "Thing" }, ALL), [
    { to: "gtag", args: ["event", "view_item", { item_id: "i1", item_name: "Thing", send_to: GA }] },
    { to: "fbq", args: ["track", "ViewContent"] },
  ]);
});

test("quote_start: GA4 only", () => {
  assert.deepEqual(eventCalls("quote_start", { item_id: "i1" }, ALL), [{ to: "gtag", args: ["event", "quote_start", { item_id: "i1", send_to: GA }] }]);
});

test("begin_checkout: GA4 and InitiateCheckout with value and currency", () => {
  assert.deepEqual(eventCalls("begin_checkout", { value: 12.5, currency: "USD" }, ALL), [
    { to: "gtag", args: ["event", "begin_checkout", { value: 12.5, currency: "USD", send_to: GA }] },
    { to: "fbq", args: ["track", "InitiateCheckout", { value: 12.5, currency: "USD" }] },
  ]);
});

test("purchase: GA4, the Ads conversion with value and transaction, and Meta Purchase", () => {
  assert.deepEqual(eventCalls("purchase", { value: 50, currency: "USD", transaction_id: "T1" }, ALL), [
    { to: "gtag", args: ["event", "purchase", { value: 50, currency: "USD", transaction_id: "T1", send_to: GA }] },
    { to: "gtag", args: ["event", "conversion", { send_to: "AW-000000000/PurchaseLabel1", value: 50, currency: "USD", transaction_id: "T1" }] },
    { to: "fbq", args: ["track", "Purchase", { value: 50, currency: "USD" }] },
  ]);
});

test("each product missing leaves the others alone", () => {
  const noGa = { ads: ALL.ads, meta: ALL.meta };
  assert.deepEqual(
    eventCalls("lead", { form_id: "c" }, noGa).map((c) => c.args[1]),
    ["conversion", "Lead"],
  );
  const noAds = { ga4: ALL.ga4, meta: ALL.meta };
  assert.deepEqual(
    eventCalls("lead", { form_id: "c" }, noAds).map((c) => c.args[1]),
    ["generate_lead", "Lead"],
  );
  const noMeta = { ga4: ALL.ga4, ads: ALL.ads };
  assert.deepEqual(
    eventCalls("lead", { form_id: "c" }, noMeta).map((c) => c.args[1]),
    ["generate_lead", "conversion"],
  );
});

test("an Ads id without the matching label sends no conversion", () => {
  const ids: TrackingIds = { ga4: GA, ads: { id: "AW-000000000" } };
  assert.deepEqual(eventCalls("lead", { form_id: "c" }, ids).map((c) => c.args[1]), ["generate_lead"]);
  assert.deepEqual(eventCalls("purchase", { value: 1, currency: "USD", transaction_id: "t" }, ids).map((c) => c.args[1]), ["purchase"]);
});

test("a bad value or currency is dropped, the rest stays", () => {
  const calls = eventCalls("purchase", { value: -1, currency: "usd", transaction_id: "T1" }, ALL);
  assert.deepEqual(calls[0].args[2], { transaction_id: "T1", send_to: GA });
  assert.deepEqual(calls[2].args, ["track", "Purchase", {}]);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "5", null]) {
    const out = eventCalls("begin_checkout", { value, currency: "EUR" }, { ga4: GA });
    assert.deepEqual(out[0].args[2], { currency: "EUR", send_to: GA });
  }
  assert.deepEqual(eventCalls("begin_checkout", { value: 0, currency: "EURO" }, { ga4: GA })[0].args[2], { value: 0, send_to: GA });
});

test("no personal or unlisted field passes through", () => {
  const dirty = { form_id: "contact", name: "Ada", email: "a@b.co", phone: "555", message: "hi", href: "tel:555", answers: { a: 1 } };
  for (const name of ["form_start", "lead"]) {
    const text = JSON.stringify(eventCalls(name, dirty, ALL));
    for (const bad of ["Ada", "a@b.co", "555", "hi\"", "href", "answers"]) assert.ok(!text.includes(bad), `${name} leaked ${bad}`);
  }
  assert.deepEqual(eventCalls("form_start", "not an object", ALL)[0].args[2], { send_to: GA });
});

test("page_location keeps only the campaign and click-ID parameters and drops the fragment", () => {
  assert.equal(pageLocation({ origin: "https://example.com", pathname: "/a", search: "?email=a%40b.test&utm_source=google&gclid=x" }), "https://example.com/a?utm_source=google&gclid=x");
  assert.equal(pageLocation({ origin: "https://example.com", pathname: "/", search: "?name=Ada" }), "https://example.com/");
});

test("every GA4 event carries the cleaned page address when there is a location", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://example.com", pathname: "/quote", search: "?email=a%40b.test&gclid=x" } });
  try {
    const [lead] = eventCalls("lead", { form_id: "quote" }, { ga4: GA });
    assert.deepEqual(lead, { to: "gtag", args: ["event", "generate_lead", { form_id: "quote", page_location: "https://example.com/quote?gclid=x", send_to: GA }] });
    const [call] = eventCalls("click_call", undefined, { ga4: GA });
    assert.equal((call.args[2] as { page_location: string }).page_location, "https://example.com/quote?gclid=x");
  } finally {
    if (saved) Object.defineProperty(globalThis, "location", saved);
    else delete (globalThis as { location?: unknown }).location;
  }
});
