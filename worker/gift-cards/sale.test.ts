import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attribution, Touch } from "../attribution.ts";
import { parseSale, saleMetadata, type SaleInput } from "./sale.ts";

const INPUT: SaleInput = {
  code: "ABCD-EFGH-JKMN",
  amountMinor: 5000,
  currency: "usd",
  buyerName: "Ada Lovelace",
  buyerEmail: "ada@example.org",
  recipientName: "",
  recipientEmail: "",
  message: "x".repeat(300),
  siteMode: "production",
};
const NOW = Math.floor(Date.UTC(2026, 10, 27) / 1000);

const fat = (): Touch => ({
  at: NOW - 86_400,
  path: "/".padEnd(200, "p"),
  ref: "r".repeat(100),
  utm_source: "s".repeat(100),
  utm_medium: "m".repeat(100),
  utm_campaign: "c".repeat(100),
  utm_content: "n".repeat(100),
  utm_term: "t".repeat(100),
  gclid: "g".repeat(200),
  gbraid: "b".repeat(200),
  wbraid: "w".repeat(200),
  fbclid: "f".repeat(200),
  msclkid: "k".repeat(200),
});

test("a sale round-trips through payment metadata, with each value within 500 characters", () => {
  const attribution: Attribution = { first: fat(), last: fat() };
  const metadata = saleMetadata(INPUT, attribution, new Date(NOW * 1000).toISOString());
  for (const [key, value] of Object.entries(metadata)) assert.ok(value.length <= 500, key);
  assert.ok(Object.keys(metadata).length < 40);
  const sale = parseSale(metadata);
  assert.ok(sale);
  assert.equal(sale.code, INPUT.code);
  assert.equal(sale.amountMinor, 5000);
  assert.equal(sale.currency, "usd");
  assert.equal(sale.message.length, 300);
  assert.equal(sale.cells.length, 5);
  assert.ok(sale.cameFrom.startsWith("Came from: "));
});

test("a small attribution keeps the full Pipeline post; no attribution reads as not known", () => {
  const sale = parseSale(saleMetadata(INPUT, { first: { at: NOW, utm_source: "google", utm_medium: "cpc" } }, new Date(NOW * 1000).toISOString()));
  assert.equal(sale?.lead.source, "google / cpc");
  assert.equal(sale?.lead.attribution?.daysToNote, 0);
  const none = parseSale(saleMetadata(INPUT, null, new Date(NOW * 1000).toISOString()));
  assert.deepEqual(none?.cells, ["Not known", "", "", "", ""]);
  assert.deepEqual(none?.lead, {});
  assert.equal(none?.cameFrom, "Came from: not known");
});

test("metadata that is not a well-formed gift card sale is refused", () => {
  const good = saleMetadata(INPUT, null, new Date(NOW * 1000).toISOString());
  assert.ok(parseSale(good));
  const changes: Record<string, string>[] = [{ kind: "booking" }, { code: "nope" }, { amount_minor: "0" }, { amount_minor: "12.5" }, { currency: "jpy" }, { buyer_email: "" }];
  for (const change of changes) {
    assert.equal(parseSale({ ...good, ...change }), null, JSON.stringify(change));
  }
});
