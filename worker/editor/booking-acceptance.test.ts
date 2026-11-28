import assert from "node:assert/strict";
import { test } from "node:test";
import { CALENDAR_OFF_MESSAGE, PAID_NEEDS_PAYMENTS_MESSAGE, type BookingSettings } from "../../src/booking/schema.ts";
import { exampleBooking } from "../../src/booking/example.ts";
import { makeTestEditor, seedSite } from "./test-support.ts";
import { aiApp, type Called } from "./uploads-test-support.ts";

/**
 * The owner sayings of the booking run (spec: docs/superpowers/specs/2026-11-27-booking-design.md, R3 and R12), each played as
 * the owner's AI app calling propose_change on `{ settings: "booking" }`, then published, with the file the publish commits
 * checked. The seeded site has the calendar and payments set up, a one-hour consultation and a two-session workshop.
 */

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const FILE = "src/content/booking.json";

const seeded = structuredClone(exampleBooking);
const WORKSHOP = 1;
const free = { ...structuredClone(seeded), services: [structuredClone(seeded.services[0])] };

type Flags = { calendarOn?: boolean; paymentsOn?: boolean };
const site = (settings: unknown = seeded, flags: Flags = {}) =>
  makeTestEditor({ github: seedSite({ [FILE]: json(settings) }), deps: { calendarOn: flags.calendarOn ?? true, paymentsOn: flags.paymentsOn ?? true } });
type Site = ReturnType<typeof site>;

const proposalId = (called: Called) => String(called.data.proposal_id);
const setOn = (pointer: string, value: unknown) => ({ op: "set", settings: "booking", pointer, value });

async function propose(ai: ReturnType<typeof aiApp>, summary: string, operations: unknown[]): Promise<Called> {
  const proposed = await ai("propose_change", { summary, operations });
  assert.equal(proposed.isError, false, proposed.text);
  assert.match(proposed.text, /Booking settings:/);
  return proposed;
}

async function refused(ai: ReturnType<typeof aiApp>, operations: unknown[]): Promise<string> {
  const proposed = await ai("propose_change", { summary: "A change", operations });
  assert.equal(proposed.isError, true, proposed.text);
  assert.match(proposed.text, /Nothing was changed\./);
  return proposed.text;
}

/** Publishes the proposal as the owner would, and returns the settings file the pull request committed. */
async function publish(t: Site, ai: ReturnType<typeof aiApp>, id: string): Promise<BookingSettings> {
  const published = await ai("publish_change", { proposal_id: id, owner_confirmation: "Yes, publish it." });
  assert.equal(published.isError, false, published.text);
  const pull = t.github.pulls[t.github.pulls.length - 1];
  const committed = t.github.filesOn(pull.headRef);
  assert.deepEqual(Object.keys(committed).filter((path) => committed[path] !== t.github.filesOn("main")[path]), [FILE], "only the booking settings change");
  return JSON.parse(committed[FILE]) as BookingSettings;
}

// ---- the owner's sayings ----

test('"Workshops need 14 days\' notice": the workshop gets its own notice of 336 hours and nothing else changes', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Workshops need 14 days' notice", [setOn("/services/1/hours", { noticeHours: 336 })]);
  assert.ok(proposed.text.includes("336 hours (14 days)"), proposed.text);
  assert.equal(t.github.pulls.length, 0, "proposing opens nothing");

  const after = await publish(t, ai, proposalId(proposed));
  assert.deepEqual(after.services[WORKSHOP].hours, { noticeHours: 336 });
  assert.deepEqual(after.hours, seeded.hours, "the site's own notice is unchanged");
  assert.deepEqual(after.services[0], seeded.services[0]);
});

test('"Close December 24 to January 2": the site-wide closed dates gain that range', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Close December 24 to January 2", [{ op: "insert_item", settings: "booking", pointer: "/hours/closed", at: 1, value: { from: "2026-12-24", to: "2027-01-02" } }]);
  assert.ok(proposed.text.includes("Closed: 2026-12-24 to 2027-01-02"), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.deepEqual(after.hours.closed, [{ from: "2026-12-24", to: "2027-01-02" }]);
  assert.deepEqual({ ...after.hours, closed: [] }, seeded.hours);
});

test('"Add a free one-hour consultation, weekdays 10 to 4": a new live service with its own weekday hours', async () => {
  const t = site();
  const ai = aiApp(t);
  const weekday = [["10:00", "16:00"]];
  const service = {
    id: "free-consultation",
    name: "Free consultation",
    description: "A free one-hour conversation about what you need.",
    status: "live",
    sessions: [{ minutes: 60 }],
    between: null,
    party: { min: 1, max: 1 },
    price: null,
    payment: { kind: "free" },
    hours: { weekly: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [], sun: [] } },
  };
  const proposed = await propose(ai, "Add a free one-hour consultation, weekdays 10 to 4", [{ op: "insert_item", settings: "booking", pointer: "/services", at: 3, value: service }]);
  assert.ok(proposed.text.includes('New service "Free consultation" (free-consultation):'), proposed.text);
  assert.ok(proposed.text.includes("Monday: 10:00 to 16:00"), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.equal(after.services.length, 3);
  assert.deepEqual(after.services[2], service);
});

test('"Take a $100 deposit instead of full payment": the workshop\'s payment becomes a whole-dollar deposit', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Take a $100 deposit instead of full payment", [setOn("/services/1/payment", { kind: "deposit", amount: 100 })]);
  assert.ok(proposed.text.includes("pays a $100 deposit online, the rest later"), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.deepEqual(after.services[WORKSHOP].payment, { kind: "deposit", amount: 100 });
  assert.deepEqual(after.services[WORKSHOP].price, seeded.services[WORKSHOP].price);
});

test('"The second session must be 2 to 10 days after the first": the workshop\'s between is set', async () => {
  const seed = structuredClone(seeded);
  seed.services[WORKSHOP].between = { minDays: 1, maxDays: 14 };
  const t = site(seed);
  const ai = aiApp(t);
  const proposed = await propose(ai, "The second session must be 2 to 10 days after the first", [setOn("/services/1/between", { minDays: 2, maxDays: 10 })]);
  assert.ok(proposed.text.includes("each session 2 to 10 days after the one before"), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.deepEqual(after.services[WORKSHOP].between, { minDays: 2, maxDays: 10 });
});

test('"Make the consultation free of any price": a price set to null keeps its key', async () => {
  const seed = structuredClone(seeded);
  seed.services[0].price = { amount: 40, per: "booking" };
  const t = site(seed);
  const ai = aiApp(t);
  const proposed = await propose(ai, "No price on the consultation", [setOn("/services/0/price", null)]);
  const after = await publish(t, ai, proposalId(proposed));
  assert.equal(after.services[0].price, null);
  assert.ok("price" in after.services[0]);
});

// ---- turning booking on and off ----

test('"Turn booking on" on a site with the calendar is accepted and says what it does', async () => {
  const t = site({ ...seeded, taking: false });
  const ai = aiApp(t);
  const proposed = await propose(ai, "Turn booking on", [setOn("/taking", true)]);
  assert.ok(proposed.text.includes("Visitors can book on the live site when this is published."), proposed.text);
  assert.equal((await publish(t, ai, proposalId(proposed))).taking, true);
});

test('"Turn booking on" on a site without the calendar is refused with the plain reason, and nothing is opened', async () => {
  const t = site({ ...free, taking: false }, { calendarOn: false });
  const ai = aiApp(t);
  const text = await refused(ai, [setOn("/taking", true)]);
  assert.ok(text.includes(CALENDAR_OFF_MESSAGE), text);
  assert.equal(t.github.pulls.length, 0);
});

test('"Stop taking bookings" works, and the change list says bookings already made stay on the calendar', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Stop taking bookings", [setOn("/taking", false)]);
  assert.ok(proposed.text.includes("Booking stops on the live site when this is published. Bookings already made stay on your calendar."), proposed.text);
  const after = await publish(t, ai, proposalId(proposed));
  assert.equal(after.taking, false);
  assert.deepEqual(after.services, seeded.services, "the services stay for when booking starts again");
});

// ---- a paid service needs payments ----

test('"Add a paid service" on a site without payments is refused with the plain reason', async () => {
  const t = site(free, { paymentsOn: false });
  const ai = aiApp(t);
  const paid = { ...structuredClone(seeded.services[WORKSHOP]), id: "class", name: "Class" };
  const text = await refused(ai, [{ op: "insert_item", settings: "booking", pointer: "/services", at: 2, value: paid }]);
  assert.ok(text.includes(PAID_NEEDS_PAYMENTS_MESSAGE), text);
  assert.equal(t.github.pulls.length, 0);
});

test("a service that is free but has a price (paid on the day) is accepted without payments", async () => {
  const t = site(free, { paymentsOn: false });
  const ai = aiApp(t);
  const proposed = await propose(ai, "A paid-on-the-day consultation", [setOn("/services/0/price", { amount: 40, per: "booking" })]);
  assert.equal((await publish(t, ai, proposalId(proposed))).services[0].price?.amount, 40);
});

// ---- archiving ----

test('"Archive the workshop": the service is kept, marked archived, and the change list says nothing is deleted', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Archive the workshop", [setOn("/services/1/status", "archived")]);
  assert.ok(proposed.text.includes("Status: archive. It leaves the site and nobody can book it. Nothing is deleted"), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.equal(after.services.length, 2, "the file keeps the service");
  assert.equal(after.services[WORKSHOP].status, "archived");
  assert.equal(after.services[WORKSHOP].id, "workshop");
});

test("archiving the only live service while booking is on is refused", async () => {
  const t = site(free);
  const ai = aiApp(t);
  assert.match(await refused(ai, [setOn("/services/0/status", "archived")]), /no service is live/);
});

test("a forged change is refused: a notice that is not a whole number, and a service id used twice", async () => {
  const t = site();
  const ai = aiApp(t);
  assert.match(await refused(ai, [setOn("/hours/noticeHours", 36.5)]), /notice/i);
  const again = { ...structuredClone(seeded.services[0]) };
  assert.match(await refused(ai, [{ op: "insert_item", settings: "booking", pointer: "/services", at: 3, value: again }]), /consultation/);
  assert.equal(t.github.pulls.length, 0);
});
