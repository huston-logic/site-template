import assert from "node:assert/strict";
import { test } from "node:test";
import { facetCounts, fits, matchingPositions, parseSearch, selectedOf, toggle, toSearch, type CardValues, type FilterDef } from "./catalog-filtering.ts";

const filters: FilterDef[] = [
  { id: "type", name: "Type", values: [{ id: "jug", label: "Jugs" }, { id: "vase", label: "Vases" }, { id: "bowl", label: "Bowls" }] },
  { id: "glaze", name: "Glaze", values: [{ id: "ash", label: "Ash" }, { id: "rust", label: "Rust" }] },
];
const cards: CardValues[] = [
  { type: ["jug"], glaze: ["ash"] },
  { type: ["jug"], glaze: ["rust"] },
  { type: ["vase"], glaze: ["ash"] },
  { type: ["bowl"] },
];

test("the address is read with unknown filters and values dropped", () => {
  assert.deepEqual(parseSearch("?type=jug,vase&glaze=ash", filters), [
    { filter: "type", value: "jug" },
    { filter: "type", value: "vase" },
    { filter: "glaze", value: "ash" },
  ]);
  assert.deepEqual(parseSearch("?type=mug,jug&size=large&glaze=", filters), [{ filter: "type", value: "jug" }]);
  assert.deepEqual(parseSearch("?type=jug,jug", filters), [{ filter: "type", value: "jug" }]);
  assert.deepEqual(parseSearch("", filters), []);
});

test("the address is written in the site's filter order", () => {
  const picks = parseSearch("?glaze=ash&type=vase,jug", filters);
  assert.equal(toSearch(picks, filters), "?type=jug,vase&glaze=ash");
  assert.equal(toSearch([], filters), "");
});

test("values inside a filter are OR, filters are AND", () => {
  const selected = selectedOf(parseSearch("?type=jug,vase&glaze=ash", filters));
  assert.deepEqual(matchingPositions(cards, selected), [0, 2]);
  assert.deepEqual(matchingPositions(cards, selectedOf(parseSearch("?type=jug,vase", filters))), [0, 1, 2]);
  assert.deepEqual(matchingPositions(cards, {}), [0, 1, 2, 3]);
  assert.equal(fits({ type: ["jug"] }, { glaze: ["ash"] }), false);
});

test("facet counts leave out a filter's own choice and respect the others", () => {
  const counts = facetCounts(cards, filters, selectedOf(parseSearch("?type=jug&glaze=ash", filters)));
  assert.deepEqual(counts["type"], { jug: 1, vase: 1, bowl: 0 });
  assert.deepEqual(counts["glaze"], { ash: 1, rust: 1 });
  const none = facetCounts(cards, filters, {});
  assert.deepEqual(none["type"], { jug: 2, vase: 1, bowl: 1 });
});

test("toggle adds, then removes", () => {
  const added = toggle([], { filter: "type", value: "jug" });
  assert.equal(added.length, 1);
  assert.deepEqual(toggle(added, { filter: "type", value: "jug" }), []);
});
