// The one price function (spec R6), used by the browser and the Worker. Import-free apart from the schema types. Every
// figure comes from the item's base price, the pricing table and the exact prices the owner entered; a selection that does
// not fit is refused with a fixed sentence, never guessed at and never echoed back.
import type { Choice, Currency, OptionGroup, PriceItem, PriceResult, PricingTable, Selection } from "./schema.ts";

export type Resolved = { ok: true; choices: { group: OptionGroup; choice: Choice }[]; people: number | null } | { ok: false; problem: string };
export type Priced = { ok: true; result: PriceResult } | { ok: false; problem: string };
export type RangeWords = { about: string; to: string; onRequest: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const fail = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

/**
 * Takes the visitor's choices: each of the item's groups gets the visitor's choice, else its first choice; people get the
 * visitor's number, else the table's minimum. A group the table lacks or the item does not use, an unknown choice, people
 * outside min..max or not whole, or people given for an item with no per-person fee are all refused.
 */
export function resolveSelection(item: PriceItem, pricing: PricingTable, selection: Selection): Resolved {
  const itemGroups = item.options ?? [];
  const given = selection.options ?? {};
  if (!isRecord(given)) return fail("The options are not in a form I can read.");
  for (const groupId of Object.keys(given)) {
    if (!pricing.groups.some((group) => group.id === groupId)) return fail("One of the options is not one I offer.");
    if (!itemGroups.includes(groupId)) return fail("One of the options does not apply to this piece.");
  }
  const choices: { group: OptionGroup; choice: Choice }[] = [];
  for (const groupId of itemGroups) {
    const group = pricing.groups.find((candidate) => candidate.id === groupId);
    if (group === undefined) return fail("This piece uses an option that is not set up.");
    const wanted = Object.hasOwn(given, groupId) ? given[groupId] : undefined;
    const choice = wanted === undefined ? group.choices[0] : group.choices.find((candidate) => candidate.id === wanted);
    if (choice === undefined) return fail("One of the choices is not one I offer.");
    choices.push({ group, choice });
  }
  const fee = item.perPerson === true ? pricing.perPerson : null;
  if (fee === null) {
    if (selection.people !== undefined) return fail("This piece does not take a number of people.");
    return { ok: true, choices, people: null };
  }
  const people = selection.people === undefined ? fee.min : selection.people;
  if (typeof people !== "number" || !Number.isInteger(people)) return fail("The number of people must be a whole number.");
  if (people < fee.min || people > fee.max) return fail("The number of people is outside what I take.");
  return { ok: true, choices, people };
}

function floorTo(value: number, step: number): number {
  return Math.floor(Math.round((round2(value) / step) * 1e6) / 1e6) * step;
}
function ceilTo(value: number, step: number): number {
  return Math.ceil(Math.round((round2(value) / step) * 1e6) / 1e6) * step;
}

/**
 * The estimate for a selection. The exact price a choice has (pricing.exact[slug][group][choice]) replaces the base price
 * and that group adds no rule; then subtotal = base x every multiply + every add; the per-person fee joins the total only
 * for an item with perPerson true; then the spread and the rounding step (low rounds down, high rounds up, never below 0).
 */
export function priceRange(item: PriceItem, pricing: PricingTable, selection: Selection, slug: string): Priced {
  const resolved = resolveSelection(item, pricing, selection);
  if (!resolved.ok) return resolved;
  if (item.price === "ask") return { ok: true, result: { kind: "ask" } };

  // Own keys only: a slug or id such as "constructor" must never reach a prototype's value.
  const exacts: Record<string, Record<string, number>> = Object.hasOwn(pricing.exact, slug) ? (pricing.exact[slug] ?? {}) : {};
  const exactGroups = resolved.choices.filter(({ group }) => Object.hasOwn(exacts, group.id));
  if (exactGroups.length > 1) return fail("This piece has exact prices for more than one option group.");
  let low = item.price.low;
  let high = item.price.high;
  let skip: string | null = null;
  const hit = exactGroups[0];
  if (hit !== undefined) {
    const row = exacts[hit.group.id] ?? {};
    const amount = Object.hasOwn(row, hit.choice.id) ? row[hit.choice.id] : undefined;
    if (amount !== undefined) {
      low = amount;
      high = amount;
      skip = hit.group.id;
    }
  }
  const apply = (start: number): number => {
    let value = start;
    for (const { group, choice } of resolved.choices) {
      if (group.id !== skip && "multiply" in choice) value = round2(value * choice.multiply);
    }
    for (const { group, choice } of resolved.choices) {
      if (group.id !== skip && "add" in choice) value = round2(value + choice.add);
    }
    if (resolved.people !== null && pricing.perPerson !== null) value = round2(value + pricing.perPerson.amount * resolved.people);
    return value;
  };
  const factor = pricing.spread / 100;
  const shownLow = Math.max(0, floorTo(apply(low) * (1 - factor), pricing.rounding));
  const shownHigh = Math.max(0, ceilTo(apply(high) * (1 + factor), pricing.rounding));
  return { ok: true, result: { kind: "range", low: shownLow, high: Math.max(shownLow, shownHigh) } };
}

/** The range for the first choices and the smallest party (what a card shows). A refusal reads as "ask". */
export function defaultRange(item: PriceItem, pricing: PricingTable, slug: string): PriceResult {
  const priced = priceRange(item, pricing, {}, slug);
  return priced.ok ? priced.result : { kind: "ask" };
}

/** Whole currency units with no cents, like $2,100. */
export function formatMoney(n: number, currency: Currency | string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n);
}

/** "About $2,100" when both ends match, "$1,200 to $1,800" otherwise, and the on-request words for a price to ask about. */
export function formatRange(result: PriceResult, currency: Currency | string, words: RangeWords): string {
  if (result.kind === "ask") return words.onRequest;
  if (result.low === result.high) return `${words.about} ${formatMoney(result.low, currency)}`;
  return `${formatMoney(result.low, currency)} ${words.to} ${formatMoney(result.high, currency)}`;
}
