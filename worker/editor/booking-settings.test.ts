import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { registry } from "../../src/blocks/definitions.ts";
import { SETTINGS_NAMES } from "../../src/settings/names.ts";
import { makeCtx } from "./change-list.ts";
import { documentSections } from "./change-list-documents.ts";
import { checkArguments, schemas } from "./tool-schemas.ts";
import booking from "../../src/content/booking.json" with { type: "json" };

const change = (now: Record<string, unknown>) => ({
  before: { items: new Map(), settings: new Map<string, unknown>([["booking", booking]]) },
  after: { items: new Map(), settings: new Map<string, unknown>([["booking", now]]) },
  touchedItems: [],
  touchedSettings: ["booking"],
  touchedPages: [],
  pages: new Map(),
  today: "2026-11-27",
});

describe("booking settings in the editor", () => {
  test("is one of the settings names, and the tool schemas accept it", () => {
    assert.ok((SETTINGS_NAMES as readonly string[]).includes("booking"));
    assert.deepEqual(checkArguments(schemas.getSettings, { name: "booking" }), []);
    assert.notDeepEqual(checkArguments(schemas.getSettings, { name: "bookings" }), []);
  });

  test("the change list says what changes, in the owner's words", () => {
    const hours = { ...booking.hours, noticeHours: 72, closed: [{ from: "2026-12-25", to: "2026-12-25" }] };
    const out = documentSections(change({ ...booking, taking: true, hours }), makeCtx(), registry).join("\n");
    assert.match(out, /^Booking settings:/);
    assert.match(out, /Taking bookings: no → yes/);
    assert.match(out, /Notice needed before the first session: 24 hours → 72 hours \(3 days\)/);
    assert.match(out, /Closed: 2026-12-25$/m);
    assert.match(out, /Visitors can book on the live site when this is published\./);
  });

  test("prices and deposits use the site's currency symbol, and a dollar sign only without payments", () => {
    const priced = booking.services.map((service) => ({ ...service, price: { amount: 80, per: "person" }, payment: { kind: "deposit", amount: 20 } }));
    const now = { ...booking, services: priced };
    const pounds = documentSections({ ...change(now), currency: "gbp" as const }, makeCtx(), registry).join("\n");
    assert.match(pounds, /Price: no price shown → £80 per person/);
    assert.match(pounds, /pays a £20 deposit online/);
    assert.ok(!pounds.includes("$"), pounds);
    const euros = documentSections({ ...change(now), currency: "eur" as const }, makeCtx(), registry).join("\n");
    assert.match(euros, /€80 per person/);
    const none = documentSections({ ...change(now), currency: null }, makeCtx(), registry).join("\n");
    assert.match(none, /\$80 per person/);
    assert.match(documentSections(change(now), makeCtx(), registry).join("\n"), /\$80 per person/);
  });

  test("a service that goes archived reads as archived, not as removed", () => {
    const services = booking.services.map((service) => ({ ...service, status: "archived" }));
    const out = documentSections(change({ ...booking, services }), makeCtx(), registry).join("\n");
    assert.match(out, /Service "Consultation" \(consultation\):/);
    assert.match(out, /Status: archive\. It leaves the site and nobody can book it\. Nothing is deleted/);
  });
});
