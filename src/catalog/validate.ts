// The content check for the two catalog settings files and the rules that join them to the items (spec R3 to R5, R21).
// Problems are plain sentences naming the file. Import-free apart from sibling shared modules.
import { textProblem } from "../blocks/validate.ts";
import {
  ADD_MAX,
  ADD_MIN,
  CATALOG_SETTINGS_PATH,
  CHOICE_LABEL_MAX,
  CURRENCIES,
  FILTER_LABEL_MAX,
  FILTER_NAME_MAX,
  GROUP_NAME_MAX,
  ID_RE,
  ITEM_WORD_MAX,
  MAX_CHOICES,
  MAX_FILTERS,
  MAX_FILTER_VALUES,
  MAX_GROUPS,
  MIN_CHOICES,
  MULTIPLY_DECIMALS,
  MULTIPLY_MAX,
  MULTIPLY_MIN,
  NOTE_MAX,
  PER_PERSON_AMOUNT_MAX,
  PER_PERSON_LABEL_MAX,
  PER_PERSON_LIMIT_MAX,
  PRICE_MAX,
  PRICING_PATH,
  ROUNDING_STEPS,
  SPREAD_MAX,
} from "./schema.ts";
import type { CatalogSettings, PricingTable } from "./schema.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const SLUG = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Checks a text value: plain, with a length from `min` to `max`. */
function checkText(value: unknown, min: number, max: number, what: string, where: string, out: string[]): void {
  if (typeof value !== "string") return void out.push(`${where}: ${what} must be text.`);
  if (value.trim().length < min) return void out.push(`${where}: ${what} is empty; it needs some text.`);
  if (value.length > max) return void out.push(`${where}: ${what} is ${value.length} characters; it takes at most ${max}.`);
  const bad = textProblem(value);
  if (bad) out.push(`${where}: ${what} ${bad}.`);
}

function checkKeys(data: Record<string, unknown>, allowed: readonly string[], what: string, where: string, out: string[]): void {
  for (const key of Object.keys(data)) if (!allowed.includes(key)) out.push(`${where}: "${key}" is not ${what} setting. It accepts: ${allowed.join(", ")}.`);
}

function checkId(value: unknown, what: string, where: string, seen: Set<string>, out: string[]): void {
  if (typeof value !== "string" || !ID_RE.test(value)) return void out.push(`${where}: ${what} id must be lowercase words and digits joined by hyphens, 1 to 40 characters.`);
  if (seen.has(value)) out.push(`${where}: the id "${value}" is used twice; every ${what.replace(/^an? /, "")} needs its own id.`);
  seen.add(value);
}

/** Why `catalog.json` is not acceptable: the item word and the filters. */
export function validateCatalogSettings(data: unknown): string[] {
  const where = CATALOG_SETTINGS_PATH;
  if (!isRecord(data)) return [`${where}: the file must be an object with "itemWord" and "filters".`];
  const out: string[] = [];
  checkKeys(data, ["itemWord", "filters"], "a catalog", where, out);

  const word = data["itemWord"];
  if (word === undefined) out.push(`${where}: "itemWord" is missing.`);
  else if (!isRecord(word)) out.push(`${where}: "itemWord" must be an object with "singular" and "plural".`);
  else {
    checkKeys(word, ["singular", "plural"], "an item word", where, out);
    for (const key of ["singular", "plural"]) {
      if (word[key] === undefined) out.push(`${where}: "itemWord" "${key}" is missing.`);
      else checkText(word[key], 1, ITEM_WORD_MAX, `"itemWord" "${key}"`, where, out);
    }
  }

  const filters = data["filters"];
  if (filters === undefined) out.push(`${where}: "filters" is missing (use an empty list for none).`);
  else if (!Array.isArray(filters)) out.push(`${where}: "filters" must be a list.`);
  else {
    if (filters.length > MAX_FILTERS) out.push(`${where}: "filters" has ${filters.length} filters; a catalog takes at most ${MAX_FILTERS}.`);
    const filterIds = new Set<string>();
    filters.forEach((filter, index) => {
      const here = `filter ${index + 1}`;
      if (!isRecord(filter)) return void out.push(`${where}: ${here} must be an object with "id", "name" and "values".`);
      checkKeys(filter, ["id", "name", "values"], "a filter", where, out);
      checkId(filter["id"], "a filter", where, filterIds, out);
      checkText(filter["name"], 1, FILTER_NAME_MAX, `${here} "name"`, where, out);
      const values = filter["values"];
      if (!Array.isArray(values)) return void out.push(`${where}: ${here} "values" must be a list.`);
      if (values.length < 1 || values.length > MAX_FILTER_VALUES) out.push(`${where}: ${here} has ${values.length} values; a filter takes 1 to ${MAX_FILTER_VALUES}.`);
      const valueIds = new Set<string>();
      values.forEach((value, v) => {
        const at = `${here} value ${v + 1}`;
        if (!isRecord(value)) return void out.push(`${where}: ${at} must be an object with "id" and "label".`);
        checkKeys(value, ["id", "label"], "a filter value", where, out);
        checkId(value["id"], "a value", where, valueIds, out);
        checkText(value["label"], 1, FILTER_LABEL_MAX, `${at} "label"`, where, out);
      });
    });
  }
  return out;
}

function decimals(n: number): number {
  const text = String(n);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Why `pricing.json` is not acceptable: the currency, rounding, spread, note, option groups, per-person fee and exact prices. */
export function validatePricing(data: unknown): string[] {
  const where = PRICING_PATH;
  if (!isRecord(data)) return [`${where}: the file must be an object with "currency", "rounding", "spread", "note", "groups", "perPerson" and "exact".`];
  const out: string[] = [];
  checkKeys(data, ["currency", "rounding", "spread", "note", "groups", "perPerson", "exact"], "a pricing", where, out);
  for (const key of ["currency", "rounding", "spread", "note", "groups", "perPerson", "exact"]) if (data[key] === undefined) out.push(`${where}: "${key}" is missing.`);

  if (data["currency"] !== undefined && !(CURRENCIES as readonly unknown[]).includes(data["currency"])) out.push(`${where}: "currency" must be one of ${CURRENCIES.join(", ")}.`);
  if (data["rounding"] !== undefined && !(ROUNDING_STEPS as readonly unknown[]).includes(data["rounding"])) out.push(`${where}: "rounding" must be one of ${ROUNDING_STEPS.join(", ")}.`);
  if (data["spread"] !== undefined && !isWhole(data["spread"], 0, SPREAD_MAX)) out.push(`${where}: "spread" must be a whole percent from 0 to ${SPREAD_MAX}.`);
  if (data["note"] !== undefined) checkText(data["note"], 1, NOTE_MAX, '"note"', where, out);

  const groups = data["groups"];
  if (groups !== undefined) {
    if (!Array.isArray(groups)) out.push(`${where}: "groups" must be a list.`);
    else {
      if (groups.length > MAX_GROUPS) out.push(`${where}: "groups" has ${groups.length} option groups; a pricing table takes at most ${MAX_GROUPS}.`);
      const groupIds = new Set<string>();
      groups.forEach((group, index) => {
        const here = `option group ${index + 1}`;
        if (!isRecord(group)) return void out.push(`${where}: ${here} must be an object with "id", "name" and "choices".`);
        checkKeys(group, ["id", "name", "choices"], "an option group", where, out);
        checkId(group["id"], "a group", where, groupIds, out);
        checkText(group["name"], 1, GROUP_NAME_MAX, `${here} "name"`, where, out);
        const choices = group["choices"];
        if (!Array.isArray(choices)) return void out.push(`${where}: ${here} "choices" must be a list.`);
        if (choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) out.push(`${where}: ${here} has ${choices.length} choices; a group takes ${MIN_CHOICES} to ${MAX_CHOICES}.`);
        const choiceIds = new Set<string>();
        choices.forEach((choice, c) => {
          const at = `${here} choice ${c + 1}`;
          if (!isRecord(choice)) return void out.push(`${where}: ${at} must be an object with "id", "label" and "add" or "multiply".`);
          checkKeys(choice, ["id", "label", "add", "multiply"], "a choice", where, out);
          checkId(choice["id"], "a choice", where, choiceIds, out);
          checkText(choice["label"], 1, CHOICE_LABEL_MAX, `${at} "label"`, where, out);
          const hasAdd = choice["add"] !== undefined;
          const hasMultiply = choice["multiply"] !== undefined;
          if (hasAdd === hasMultiply) return void out.push(`${where}: ${at} needs exactly one of "add" or "multiply".`);
          if (hasAdd && !isWhole(choice["add"], ADD_MIN, ADD_MAX)) out.push(`${where}: ${at} "add" must be a whole number from ${ADD_MIN} to ${ADD_MAX}.`);
          if (hasMultiply) {
            const m = choice["multiply"];
            if (typeof m !== "number" || !Number.isFinite(m) || m < MULTIPLY_MIN || m > MULTIPLY_MAX || decimals(m) > MULTIPLY_DECIMALS) {
              out.push(`${where}: ${at} "multiply" must be a number from ${MULTIPLY_MIN} to ${MULTIPLY_MAX} with at most ${MULTIPLY_DECIMALS} decimals.`);
            }
          }
        });
      });
    }
  }

  const perPerson = data["perPerson"];
  if (perPerson !== undefined && perPerson !== null) {
    if (!isRecord(perPerson)) out.push(`${where}: "perPerson" must be null or an object with "label", "amount", "min" and "max".`);
    else {
      checkKeys(perPerson, ["label", "amount", "min", "max"], "a per-person", where, out);
      checkText(perPerson["label"], 1, PER_PERSON_LABEL_MAX, '"perPerson" "label"', where, out);
      if (!isWhole(perPerson["amount"], 0, PER_PERSON_AMOUNT_MAX)) out.push(`${where}: "perPerson" "amount" must be a whole number from 0 to ${PER_PERSON_AMOUNT_MAX}.`);
      const okMin = isWhole(perPerson["min"], 1, PER_PERSON_LIMIT_MAX);
      const okMax = isWhole(perPerson["max"], 1, PER_PERSON_LIMIT_MAX);
      if (!okMin) out.push(`${where}: "perPerson" "min" must be a whole number from 1 to ${PER_PERSON_LIMIT_MAX}.`);
      if (!okMax) out.push(`${where}: "perPerson" "max" must be a whole number from 1 to ${PER_PERSON_LIMIT_MAX}.`);
      if (okMin && okMax && (perPerson["min"] as number) > (perPerson["max"] as number)) out.push(`${where}: "perPerson" "min" is above "max".`);
    }
  }

  const exact = data["exact"];
  if (exact !== undefined) {
    if (!isRecord(exact)) out.push(`${where}: "exact" must be an object of item slugs.`);
    else {
      for (const [slug, groupsOf] of Object.entries(exact)) {
        if (!SLUG.test(slug)) out.push(`${where}: "exact" has "${slug}", which is not a piece slug (lowercase words and digits joined by hyphens).`);
        if (!isRecord(groupsOf)) {
          out.push(`${where}: "exact" "${slug}" must be an object of option group ids.`);
          continue;
        }
        for (const [groupId, choicesOf] of Object.entries(groupsOf)) {
          if (!isRecord(choicesOf)) {
            out.push(`${where}: "exact" "${slug}" "${groupId}" must be an object of choice ids.`);
            continue;
          }
          for (const [choiceId, amount] of Object.entries(choicesOf)) {
            if (!isWhole(amount, 0, PRICE_MAX)) out.push(`${where}: "exact" "${slug}" "${groupId}" "${choiceId}" must be a whole amount from 0 to ${PRICE_MAX}.`);
          }
        }
      }
    }
  }
  return out;
}

/** The part of an item file the cross-file rules read. */
export type LinkItem = { slug: string; status: string; data: Record<string, unknown> };

const itemFile = (slug: string) => `src/content/collections/catalog/${slug}.json`;

/**
 * The rules that join the files: exact prices name a known item, a group it uses and a known choice, one group per item; a
 * per-person item needs a table fee; and (unless `itemRefs` is false, because the item fields already judged them against
 * the settings) every filter and option an item names exists. Pass settings and pricing only when they passed their own check.
 */
export function validateCatalogLinks(input: { settings: CatalogSettings | null; pricing: PricingTable | null; items: readonly LinkItem[]; itemRefs?: boolean }): string[] {
  const { settings, pricing, items } = input;
  const out: string[] = [];
  const bySlug = new Map(items.map((item) => [item.slug, item]));
  const optionsOf = (item: LinkItem): string[] => (Array.isArray(item.data["options"]) ? (item.data["options"] as unknown[]).filter((o): o is string => typeof o === "string") : []);

  if (input.itemRefs !== false) {
    for (const item of items) {
      const where = itemFile(item.slug);
      const live = item.status === "live" ? " A piece that is live cannot lose them." : "";
      const filters = item.data["filters"];
      if (settings !== null && isRecord(filters)) {
        for (const [filterId, valueIds] of Object.entries(filters)) {
          const filter = settings.filters.find((f) => f.id === filterId);
          if (filter === undefined) {
            out.push(`${where}: the filter "${filterId}" is not in ${CATALOG_SETTINGS_PATH}.${live}`);
            continue;
          }
          for (const valueId of Array.isArray(valueIds) ? valueIds : []) {
            if (!filter.values.some((v) => v.id === valueId)) out.push(`${where}: "${String(valueId)}" is not a value of the filter "${filterId}" in ${CATALOG_SETTINGS_PATH}.${live}`);
          }
        }
      }
      if (pricing !== null) {
        for (const groupId of optionsOf(item)) {
          if (!pricing.groups.some((g) => g.id === groupId)) out.push(`${where}: the option group "${groupId}" is not in ${PRICING_PATH}.${live}`);
        }
      }
    }
  }
  if (pricing === null) return out;

  for (const item of items) {
    if (item.data["perPerson"] === true && pricing.perPerson === null) out.push(`${itemFile(item.slug)}: "perPerson" is true, but ${PRICING_PATH} has no per-person fee.`);
  }
  for (const [slug, groupsOf] of Object.entries(pricing.exact)) {
    const item = bySlug.get(slug);
    if (item === undefined) {
      out.push(`${PRICING_PATH}: "exact" has prices for "${slug}", which is not a piece in the catalog.`);
      continue;
    }
    const used = optionsOf(item);
    const named = Object.keys(groupsOf);
    if (named.length > 1) out.push(`${PRICING_PATH}: "exact" gives "${slug}" prices for ${named.length} option groups; only one group per piece may have exact prices.`);
    for (const [groupId, choicesOf] of Object.entries(groupsOf)) {
      const group = pricing.groups.find((g) => g.id === groupId);
      if (group === undefined) {
        out.push(`${PRICING_PATH}: "exact" "${slug}" names the option group "${groupId}", which is not in the table.`);
        continue;
      }
      if (!used.includes(groupId)) out.push(`${PRICING_PATH}: "exact" "${slug}" names the option group "${groupId}", which ${itemFile(slug)} does not use.`);
      for (const choiceId of Object.keys(choicesOf)) {
        if (!group.choices.some((c) => c.id === choiceId)) out.push(`${PRICING_PATH}: "exact" "${slug}" "${groupId}" names the choice "${choiceId}", which is not in that group.`);
      }
    }
  }
  return out;
}
