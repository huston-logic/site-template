import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, parseCsvTable } from "./catalog-csv.mjs";

const cells = (text) => parseCsv(text).map((row) => row.cells);

test("plain rows, LF and CRLF, with or without a final line break", () => {
  assert.deepEqual(cells("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(cells("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("quotes, doubled quotes, commas and line breaks inside quotes", () => {
  assert.deepEqual(cells('name,note\n"Ring, gold","She said ""hi"""\n"two\nlines",x'), [["name", "note"], ["Ring, gold", 'She said "hi"'], ["two\nlines", "x"]]);
});

test("a byte-order mark is dropped and empty fields stay", () => {
  assert.deepEqual(cells("﻿a,b,c\n,,\n"), [["a", "b", "c"], ["", "", ""]]);
});

test("completely empty lines are skipped, and line numbers follow the file", () => {
  const rows = parseCsv('a\n\n"x\ny"\nz\n');
  assert.deepEqual(rows.map((r) => [r.line, r.cells[0]]), [[1, "a"], [3, "x\ny"], [5, "z"]]);
});

test("an unclosed quote is a plain error", () => {
  assert.throws(() => parseCsv('a,b\n"oops,2\n'), /never closed/);
});

test("a quoted empty last field still counts as a row", () => {
  assert.deepEqual(cells('a,b\n1,""'), [["a", "b"], ["1", ""]]);
});

test("parseCsvTable keys values by header, trims, and fills short rows with empty text", () => {
  const { headers, rows } = parseCsvTable("Name , Price\n Ring ,100\nBand\n");
  assert.deepEqual(headers, ["Name", "Price"]);
  assert.deepEqual(rows, [
    { line: 2, values: { Name: "Ring", Price: "100" } },
    { line: 3, values: { Name: "Band", Price: "" } },
  ]);
  assert.throws(() => parseCsvTable(""), /header row/);
});
