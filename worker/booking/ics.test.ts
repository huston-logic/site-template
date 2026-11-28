import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingIcs, escapeText, foldLine, icsTime } from "./ics.ts";

test("text values escape backslash, semicolon, comma and line breaks", () => {
  assert.equal(escapeText("a\\b;c,d\ne\r\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
});

test("times are UTC with a Z", () => {
  assert.equal(icsTime(Date.UTC(2026, 11, 1, 15, 0, 0)), "20261201T150000Z");
});

test("a long line folds at 75 octets, never inside a character, and unfolds to the original", () => {
  const line = `SUMMARY:${"é".repeat(60)}${"x".repeat(40)}`;
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(new TextEncoder().encode(part).length <= 75, part);
  assert.ok(parts.slice(1).every((part) => part.startsWith(" ")));
  assert.equal(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join(""), line);
  assert.equal(foldLine("SHORT:line"), "SHORT:line");
});

test("a calendar has CRLF endings, one event per session and a UID per session", () => {
  const text = bookingIcs({
    site: "example-site",
    host: "example.test",
    reference: "BK-ABCD2345",
    now: Date.UTC(2026, 10, 27, 18, 0, 0),
    sessions: [
      { start: Date.UTC(2026, 11, 1, 15, 0, 0), end: Date.UTC(2026, 11, 1, 17, 0, 0), summary: "Workshop, part 1; with Example Co", description: "Line one\nLine two" },
      { start: Date.UTC(2026, 11, 4, 15, 0, 0), end: Date.UTC(2026, 11, 4, 17, 0, 0), summary: "Workshop part 2", description: "x" },
    ],
  });
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//example-site//Booking//EN\r\n"));
  assert.ok(text.includes("METHOD:PUBLISH\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "no bare line feed");
  assert.equal(text.split("BEGIN:VEVENT").length - 1, 2);
  assert.ok(text.includes("UID:BK-ABCD2345-0@example.test\r\n") && text.includes("UID:BK-ABCD2345-1@example.test\r\n"));
  assert.ok(text.includes("DTSTAMP:20261127T180000Z\r\n"));
  assert.ok(text.includes("SUMMARY:Workshop\\, part 1\\; with Example Co\r\n"));
  assert.ok(text.includes("DESCRIPTION:Line one\\nLine two\r\n"));
});
