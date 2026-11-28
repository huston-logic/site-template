import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingMetadata, newBookingReference, parseBooking, type BookingInput } from "./metadata.ts";

const INPUT: BookingInput = {
  reference: "BK-ABCD2345",
  serviceId: "workshop",
  serviceName: "Workshop",
  party: 3,
  starts: [1_800_000_000_000, 1_800_200_000_000],
  ends: [1_800_007_200_000, 1_800_207_200_000],
  eventIds: ["hl0123456789abcdefghijklm", "hl0123456789abcdefghijkln"],
  totalMinor: 45_000,
  dueNowMinor: 11_250,
  dueLaterMinor: 33_750,
  currency: "usd",
  name: "Ada Lovelace",
  email: "ada@example.org",
  phone: "555 0100",
  answers: [{ label: "Anything I should know?", text: "Allergic to cats" }],
  item: { slug: "vase", name: "Blue vase" },
  siteMode: "production",
  site: "example-site",
};

test("a booking survives its trip through metadata, every value within Stripe's limits", () => {
  const metadata = bookingMetadata(INPUT, null, "2026-11-27T12:00:00.000Z");
  assert.ok(Object.keys(metadata).length <= 50);
  for (const value of Object.values(metadata)) assert.ok(value.length <= 500);
  const parsed = parseBooking(metadata);
  assert.ok(parsed);
  assert.equal(parsed.reference, "BK-ABCD2345");
  assert.deepEqual(parsed.starts, INPUT.starts);
  assert.deepEqual(parsed.eventIds, INPUT.eventIds);
  assert.deepEqual(parsed.answers, INPUT.answers);
  assert.deepEqual(parsed.item, { slug: "vase", name: "Blue vase" });
  assert.equal(parsed.dueLaterMinor, 33_750);
  assert.equal(metadata["cal_preview"], "0");
  assert.deepEqual(parsed.cells, ["Not known", "", "", "", ""]);
});

test("long answers are shortened to fit and still parse", () => {
  const long = { ...INPUT, answers: [{ label: "Notes", text: "x".repeat(3000) }, { label: "More", text: "y".repeat(3000) }] };
  const metadata = bookingMetadata(long, null, "2026-11-27T12:00:00.000Z");
  for (const value of Object.values(metadata)) assert.ok(value.length <= 500);
  assert.equal(parseBooking(metadata)?.answers.length, 2);
});

test("anything malformed is not a booking", () => {
  const good = bookingMetadata(INPUT, null, "2026-11-27T12:00:00.000Z");
  assert.ok(parseBooking(good));
  const broken: Record<string, string>[] = [
    { ...good, kind: "gift_card" },
    { ...good, ref: "BK-0000" },
    { ...good, starts: "1,x" },
    { ...good, ends: "1" },
    { ...good, events: "a,b" },
    { ...good, events: `${INPUT.eventIds[0]},${INPUT.eventIds[0]}` },
    { ...good, due_minor: "1" },
    { ...good, party: "0" },
    { ...good, currency: "xyz" },
    { ...good, email: "" },
  ];
  for (const metadata of broken) assert.equal(parseBooking(metadata), null, JSON.stringify(metadata).slice(0, 80));
});

test("a reference is BK- and eight characters that cannot be confused aloud", () => {
  for (let i = 0; i < 50; i++) assert.match(newBookingReference(), /^BK-[2-9A-HJKMNP-TV-Z]{8}$/);
});
