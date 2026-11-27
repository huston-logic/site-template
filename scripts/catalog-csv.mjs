// A small RFC 4180 CSV reader for the catalog import: quoted fields, doubled quotes, commas and line breaks inside quotes,
// CRLF or LF line ends and a leading byte-order mark. No dependency.

/**
 * Parses CSV text into rows of strings. Each row is { line, cells }, where `line` is the 1-based line number of the row's
 * first character in the file (a row with line breaks inside quotes spans several lines). Completely empty lines are skipped.
 * Throws an Error with a plain sentence when a quote is never closed.
 */
export function parseCsv(text) {
  const source = String(text).replace(/^﻿/, "");
  const rows = [];
  let cells = [];
  let cell = "";
  let inQuotes = false;
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
    quoted = false;
  };
  const endRow = () => {
    endCell();
    if (!(cells.length === 1 && cells[0] === "")) rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "" && !quoted) {
      inQuotes = true;
      quoted = true;
    } else if (ch === ",") endCell();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else cell += ch;
  }
  if (inQuotes) throw new Error(`the CSV has a quote that is never closed (the row starting on line ${rowLine})`);
  if (cell !== "" || cells.length > 0 || quoted) endRow();
  return rows;
}

/** Parses CSV with a header row: returns { headers, rows: [{ line, values: { [header]: string } }] }. */
export function parseCsvTable(text) {
  const all = parseCsv(text);
  if (all.length === 0) throw new Error("the CSV is empty; it needs a header row");
  const headers = all[0].cells.map((header) => header.trim());
  const rows = all.slice(1).map(({ line, cells }) => ({ line, values: Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])) }));
  return { headers, rows };
}
