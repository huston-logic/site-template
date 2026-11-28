import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYMENTS_OFF_MESSAGE } from "../../src/gift-cards/schema.ts";
import { makeTestEditor, seedSite } from "./test-support.ts";
import { aiApp, type Called } from "./uploads-test-support.ts";

/**
 * The owner sayings of the payments run (spec: docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md, R13), each
 * played as the owner's AI app calling propose_change on `{ settings: "gift-cards" }`, then published, with the file the
 * publish commits checked. The seeded site is a live shop with payments set up and gift cards on sale; the one test about a
 * site without payments uses the template's own state (payments null, selling off).
 */

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const FILE = "src/content/gift-cards.json";

const selling = {
  selling: true,
  amounts: [{ amount: 25 }, { amount: 50, label: "Most given" }, { amount: 100 }],
  custom: null,
  redeemWording: "Show the certificate when you book.",
  termsLine: "Not redeemable for cash.",
  validForMonths: null,
};

type Settings = typeof selling;
const site = (settings: unknown = selling, paymentsOn = true) => makeTestEditor({ github: seedSite({ [FILE]: json(settings) }), deps: { paymentsOn } });
type Site = ReturnType<typeof site>;

const proposalId = (called: Called) => String(called.data.proposal_id);
const setOn = (pointer: string, value: unknown) => ({ op: "set", settings: "gift-cards", pointer, value });

async function propose(ai: ReturnType<typeof aiApp>, summary: string, operations: unknown[]): Promise<Called> {
  const proposed = await ai("propose_change", { summary, operations });
  assert.equal(proposed.isError, false, proposed.text);
  return proposed;
}

async function refused(ai: ReturnType<typeof aiApp>, operations: unknown[]): Promise<string> {
  const proposed = await ai("propose_change", { summary: "A change", operations });
  assert.equal(proposed.isError, true, proposed.text);
  assert.match(proposed.text, /Nothing was changed\./);
  return proposed.text;
}

/** Publishes the proposal as the owner would, and returns the settings file the pull request committed. */
async function publish(t: Site, ai: ReturnType<typeof aiApp>, id: string): Promise<Settings> {
  const published = await ai("publish_change", { proposal_id: id, owner_confirmation: "Yes, publish it." });
  assert.equal(published.isError, false, published.text);
  const pull = t.github.pulls[t.github.pulls.length - 1];
  const committed = t.github.filesOn(pull.headRef);
  assert.deepEqual(Object.keys(committed).filter((path) => committed[path] !== t.github.filesOn("main")[path]), [FILE], "only the gift card settings change");
  return JSON.parse(committed[FILE]) as Settings;
}

// ---- the owner's sayings ----

test('"Add a $500 gift card": the amount joins the list, in order, and nothing else changes', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Add a $500 gift card", [{ op: "insert_item", settings: "gift-cards", pointer: "/amounts", at: 4, value: { amount: 500 } }]);
  assert.match(proposed.text, /Gift card settings:/);
  assert.ok(proposed.text.includes("500"), proposed.text);
  assert.equal(t.github.pulls.length, 0, "proposing opens nothing");

  const after = await publish(t, ai, proposalId(proposed));
  assert.deepEqual(after.amounts, [{ amount: 25 }, { amount: 50, label: "Most given" }, { amount: 100 }, { amount: 500 }]);
  assert.deepEqual({ ...after, amounts: selling.amounts }, selling, "every other setting is untouched");
});

test('"Let people pick any amount from $50 to $1,000": the other amount is switched on with that range', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Let people pick any amount from $50 to $1,000", [setOn("/custom", { min: 50, max: 1000 })]);
  assert.match(proposed.text, /Other amount/);

  const after = await publish(t, ai, proposalId(proposed));
  assert.deepEqual(after.custom, { min: 50, max: 1000 });
  assert.equal(after.selling, true);
});

test('"Change the redeem wording": the new sentence is saved as written', async () => {
  const t = site();
  const ai = aiApp(t);
  const wording = "Bring the certificate to the shop, or give the code when you call to book.";
  const proposed = await propose(ai, "Change the redeem wording", [setOn("/redeemWording", wording)]);
  assert.ok(proposed.text.includes(wording), proposed.text);
  assert.ok(proposed.text.includes("How to redeem"), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.equal(after.redeemWording, wording);
  assert.equal(after.termsLine, selling.termsLine);
});

test('"Stop selling gift cards": selling goes off, the change list says cards already bought still work, nothing is deleted', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Stop selling gift cards", [setOn("/selling", false)]);
  assert.ok(proposed.text.includes("Gift cards stop being sold on the live site when this is published. Cards already bought still work."), proposed.text);

  const after = await publish(t, ai, proposalId(proposed));
  assert.equal(after.selling, false);
  assert.deepEqual(after.amounts, selling.amounts, "the amounts stay for when selling starts again");
});

test('"Stop selling gift cards" also works on a site whose payments are switched off', async () => {
  const t = site(selling, false);
  const ai = aiApp(t);
  const proposed = await propose(ai, "Stop selling gift cards", [setOn("/selling", false)]);
  assert.equal((await publish(t, ai, proposalId(proposed))).selling, false);
});

// ---- selling needs payments ----

test("turning selling on while the site has no payments is refused with the plain reason, and nothing is opened", async () => {
  const t = makeTestEditor();
  const ai = aiApp(t);
  const text = await refused(ai, [setOn("/selling", true)]);
  assert.ok(text.includes(PAYMENTS_OFF_MESSAGE), text);
  assert.equal(t.github.pulls.length, 0);
});

test("the same change is accepted once the site has payments", async () => {
  const t = site({ ...selling, selling: false }, true);
  const ai = aiApp(t);
  const proposed = await propose(ai, "Start selling gift cards", [setOn("/selling", true)]);
  assert.ok(proposed.text.includes("Gift cards go on sale on the live site when this is published."), proposed.text);
  assert.equal((await publish(t, ai, proposalId(proposed))).selling, true);
});

// ---- forged changes ----

test("an amount of zero, a negative amount, one above the largest and one below the smallest are refused", async () => {
  const t = site();
  const ai = aiApp(t);
  for (const amount of [0, -50, 50_000, 10_001, 4]) {
    const text = await refused(ai, [{ op: "insert_item", settings: "gift-cards", pointer: "/amounts", at: 4, value: { amount } }]);
    assert.match(text, /must be a whole number from 5 to 10,000/, `${amount}: ${text}`);
  }
  assert.equal(t.github.pulls.length, 0);
});

test("a fractional amount, a number written as text and an amount that is already listed are refused", async () => {
  const t = site();
  const ai = aiApp(t);
  assert.match(await refused(ai, [{ op: "insert_item", settings: "gift-cards", pointer: "/amounts", at: 4, value: { amount: 12.5 } }]), /must be a whole number from 5 to 10,000/);
  assert.match(await refused(ai, [{ op: "insert_item", settings: "gift-cards", pointer: "/amounts", at: 4, value: { amount: "500" } }]), /must be a whole number from 5 to 10,000/);
  assert.match(await refused(ai, [{ op: "insert_item", settings: "gift-cards", pointer: "/amounts", at: 4, value: { amount: 50 } }]), /repeats 50; every amount is listed once\./);
});

test("a range that is backwards, too wide or has a fractional end is refused", async () => {
  const t = site();
  const ai = aiApp(t);
  assert.match(await refused(ai, [setOn("/custom", { min: 500, max: 50 })]), /smallest \(500\) must be less than its largest \(50\)/);
  assert.match(await refused(ai, [setOn("/custom", { min: 50, max: 50_000 })]), /largest must be a whole number from 5 to 10,000/);
  assert.match(await refused(ai, [setOn("/custom", { min: 50.5, max: 100 })]), /smallest must be a whole number from 5 to 10,000/);
});

test("a setting the file does not have, a card that expires too soon and too many amounts are refused", async () => {
  const t = site();
  const ai = aiApp(t);
  assert.match(await refused(ai, [setOn("/discount", 20)]), /"discount" is not a gift card setting/);
  assert.match(await refused(ai, [setOn("/validForMonths", 12)]), /the law does not allow a gift card to expire in under five years/);
  const many = Array.from({ length: 9 }, (_, index) => ({ amount: 10 + index }));
  assert.match(await refused(ai, [setOn("/amounts", many)]), /there are 9 amounts; a site lists 1 to 8/);
  assert.equal(t.github.pulls.length, 0);
});
