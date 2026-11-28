import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { registry } from "../../src/blocks/definitions.ts";
import { SETTINGS_NAMES } from "../../src/settings/names.ts";
import { makeCtx } from "./change-list.ts";
import { documentSections } from "./change-list-documents.ts";
import { checkArguments, schemas } from "./tool-schemas.ts";
import giftCards from "../../src/content/gift-cards.json" with { type: "json" };

const change = (now: Record<string, unknown>) => ({
  before: { items: new Map(), settings: new Map<string, unknown>([["gift-cards", giftCards]]) },
  after: { items: new Map(), settings: new Map<string, unknown>([["gift-cards", now]]) },
  touchedItems: [],
  touchedSettings: ["gift-cards"],
  touchedPages: [],
  pages: new Map(),
  today: "2026-11-27",
});

describe("gift-cards settings in the editor", () => {
  test("is one of the settings names, and the tool schemas accept it", () => {
    assert.ok((SETTINGS_NAMES as readonly string[]).includes("gift-cards"));
    assert.deepEqual(checkArguments(schemas.getSettings, { name: "gift-cards" }), []);
    assert.notDeepEqual(checkArguments(schemas.getSettings, { name: "gift-card" }), []);
  });

  test("the change list says what changes, in the owner's words", () => {
    const sections = documentSections(change({ ...giftCards, selling: true, amounts: [{ amount: 25 }, { amount: 60, label: "Popular" }] }), makeCtx(), registry);
    const out = sections.join("\n");
    assert.match(out, /^Gift card settings:/);
    assert.match(out, /Selling gift cards/);
    assert.match(out, /Gift cards go on sale on the live site when this is published\./);
    assert.match(out, /Popular/);
  });
});
