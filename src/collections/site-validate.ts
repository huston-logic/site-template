// One check for the whole site: pages, collection items, the three settings files and the rules that join them. The build,
// `check:content` and the site editor Worker all call this, so a change is judged the same way everywhere. Import-free
// apart from other shared modules.
import { CATALOG_BLOCK, CATALOG_FORBIDDEN_PATHS, QUOTE_FORM_ID, cardPathFor } from "../catalog/schema.ts";
import type { CatalogSettings, PricingTable } from "../catalog/schema.ts";
import { validateCatalogLinks, validateCatalogSettings, validatePricing } from "../catalog/validate.ts";
import { BOOKING_BLOCK, BOOKING_FORM_ANSWER_CHARS, BOOKING_FORM_ID } from "../booking/schema.ts";
import { validateBooking } from "../booking/validate.ts";
import { buildPageIndex, validatePages } from "../blocks/validate.ts";
import type { Context, PageFile, Repo } from "../blocks/validate.ts";
import type { AnyBlockDefinition } from "../blocks/schema.ts";
import { DEFAULT_FORM_SETTINGS } from "../forms/schema.ts";
import type { FormFile, FormSettings, FormStatus } from "../forms/schema.ts";
import { formAnswerChars, formWarnings, validateForms } from "../forms/validate.ts";
import { GIFT_CARD_BLOCK } from "../gift-cards/schema.ts";
import { validateGiftCards } from "../gift-cards/validate.ts";
import { validateBrand } from "../settings/brand.ts";
import { validateBusiness } from "../settings/business.ts";
import { validateNotice } from "../settings/notice.ts";
import type { ItemFile, ItemStatus, LoadedItem } from "./schema.ts";
import { BLOG_PATH } from "../lib/blog.ts";
import { collectionFor } from "./definitions.ts";
import { validateItems } from "./validate.ts";

import { SETTINGS_NAMES, settingsPath, type SettingsName } from "../settings/names.ts";

export { SETTINGS_NAMES, settingsPath };
export type { SettingsName };

export const POST_INDEX_BLOCK = "post-index";

export type SiteInput = {
  pages: readonly PageFile[];
  items: readonly ItemFile[];
  /** The form files (src/content/forms/<id>.json). Callers with none pass []. */
  forms: readonly FormFile[];
  /** A settings file's parsed JSON. `undefined` means the file is missing. */
  business: unknown;
  brand: unknown;
  notice: unknown;
  catalog: unknown;
  pricing: unknown;
  "gift-cards": unknown;
  booking: unknown;
  /** Why a settings file could not be read (bad JSON), by name. */
  settingsErrors?: Partial<Record<SettingsName, string>>;
};

export type SiteExtra = {
  links?: readonly { where: string; href: string }[];
  uploadNames?: ReadonlyMap<string, string>;
  /** The site's form caps (`forms` in site.config.ts). Missing means the defaults. */
  formSettings?: FormSettings;
  /** The ids the generated registry lists; when given, it must match the form files exactly. */
  registryIds?: readonly string[];
  /** Whether site.config.ts has `payments` set. Missing means off: gift card sales cannot be on and no gift-card block may be live. */
  paymentsOn?: boolean;
  /** Whether site.config.ts has `booking` set (the calendar is connected). Missing means off: booking cannot be turned on, no service can be offered and no booking block may be live. */
  calendarOn?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function hasLivePost(items: readonly ItemFile[]): boolean {
  return items.some((item) => item.kind === "posts" && item.error === undefined && isRecord(item.data) && item.data["status"] === "live");
}

function blogHasPostIndex(pages: readonly PageFile[]): boolean {
  return pages.some(({ data, error }) => {
    if (error !== undefined || !isRecord(data) || data["path"] !== BLOG_PATH || data["status"] !== "live" || !Array.isArray(data["blocks"])) return false;
    return data["blocks"].some((block) => isRecord(block) && block["type"] === POST_INDEX_BLOCK);
  });
}

/** Each readable form file's id and status, for the `form` block field. */
function formStatuses(files: readonly FormFile[]): Map<string, FormStatus> {
  const out = new Map<string, FormStatus>();
  for (const { id, data, error } of files) {
    if (error !== undefined || !isRecord(data)) continue;
    out.set(id, data["status"] === "archived" ? "archived" : "live");
  }
  return out;
}

const withoutStatus = (data: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== "status"));
};

/** The pages that hold a gallery: [path, live]. */
function catalogPages(pages: readonly PageFile[]): { file: string; path: string; live: boolean }[] {
  return pages.flatMap(({ file, data, error }) => {
    if (error !== undefined || !isRecord(data) || !Array.isArray(data["blocks"])) return [];
    if (!data["blocks"].some((block) => isRecord(block) && block["type"] === CATALOG_BLOCK)) return [];
    return [{ file: `src/content/pages/${file}`, path: String(data["path"]), live: data["status"] === "live" }];
  });
}

/** The rules that join the gallery page, the pieces and the quote form (spec R21). */
function catalogPageProblems(input: SiteInput, items: readonly { slug: string; status: string; data: Record<string, unknown> }[], forms: ReadonlyMap<string, FormStatus>, repo: Repo): string[] {
  const out: string[] = [];
  const holders = catalogPages(input.pages);
  const live = holders.filter((page) => page.live);
  for (const page of live) {
    if ((CATALOG_FORBIDDEN_PATHS as readonly string[]).includes(page.path)) out.push(`${page.file}: the catalog block cannot be on ${page.path}; put the catalog on a page of its own, like /catalog.`);
  }
  if (live.length > 1) out.push(`${live.map((page) => page.file).join(" and ")} both hold a catalog block; a site has one catalog page, so archive one of them.`);
  const liveItems = items.filter((item) => item.status === "live");
  if (liveItems.length > 0 && live.length === 0) out.push(`${liveItems.length === 1 ? "A catalog piece is" : `${liveItems.length} catalog pieces are`} live, so a live page with a "${CATALOG_BLOCK}" block must show them; add one, or set the pieces to draft.`);
  if (live.length > 0 && forms.get(QUOTE_FORM_ID) !== "live") out.push(`The catalog page needs a live quote form (src/content/forms/${QUOTE_FORM_ID}.json); ${forms.has(QUOTE_FORM_ID) ? "it is archived" : "it is missing"}.`);
  for (const item of liveItems) {
    const photos = Array.isArray(item.data["photos"]) ? item.data["photos"] : [];
    photos.forEach((photo, index) => {
      const src = isRecord(photo) ? photo["src"] : undefined;
      if (typeof src !== "string") return;
      const card = cardPathFor(src);
      if (!repo.imageExists(card)) out.push(`src/content/collections/catalog/${item.slug}.json: photo ${index + 1} has no card file; a live piece needs ${card} beside it for the gallery.`);
    });
  }
  return out;
}

/** A live page cannot sell gift cards while the site has no payments (R1): the block would take orders that cannot be paid. */
function giftCardPageProblems(pages: readonly PageFile[], paymentsOn: boolean): string[] {
  if (paymentsOn) return [];
  return pages.flatMap(({ file, data, error }) => {
    if (error !== undefined || !isRecord(data) || data["status"] !== "live" || !Array.isArray(data["blocks"])) return [];
    if (!data["blocks"].some((block) => isRecord(block) && block["type"] === GIFT_CARD_BLOCK)) return [];
    return [`src/content/pages/${file}: this page has a gift card block, but payments are not set up on this site, so gift cards cannot be sold. Take the block off, or archive the page, until Huston Logic sets payments up (docs/PAYMENTS.md).`];
  });
}

/** The rules that join the booking block, the booking form and the calendar (design R1, R3): one live page, a form that can carry a booking. */
function bookingPageProblems(input: SiteInput, forms: ReadonlyMap<string, FormStatus>, calendarOn: boolean): string[] {
  const holders = input.pages.flatMap(({ file, data, error }) => {
    if (error !== undefined || !isRecord(data) || data["status"] !== "live" || !Array.isArray(data["blocks"])) return [];
    return data["blocks"].some((block) => isRecord(block) && block["type"] === BOOKING_BLOCK) ? [`src/content/pages/${file}`] : [];
  });
  if (holders.length === 0) return [];
  const out: string[] = [];
  if (!calendarOn) {
    for (const where of holders) out.push(`${where}: this page has a booking block, but the calendar is not connected on this site, so nobody could book. Take the block off, or archive the page.`);
  }
  if (holders.length > 1) out.push(`${holders.join(" and ")} both hold a booking block; a site has one booking page, so archive one of them.`);
  const where = `src/content/forms/${BOOKING_FORM_ID}.json`;
  const status = forms.get(BOOKING_FORM_ID);
  if (status !== "live") {
    out.push(`The booking page needs a live booking form (${where}); ${status === undefined ? "it is missing" : "it is archived"}.`);
    return out;
  }
  const file = input.forms.find((form) => form.id === BOOKING_FORM_ID);
  const fields = file !== undefined && isRecord(file.data) && Array.isArray(file.data["fields"]) ? file.data["fields"].filter(isRecord) : [];
  if (!fields.some((field) => field["type"] === "short-text" && field["purpose"] === "name")) out.push(`${where} needs a short-text field whose purpose is "name", so the booking has a name to put on the calendar.`);
  const emails = fields.filter((field) => field["type"] === "email").length;
  if (emails !== 1) out.push(`${where} needs exactly one email field so the confirmation can be sent; it has ${emails}.`);
  const chars = formAnswerChars(file?.data);
  if (chars > BOOKING_FORM_ANSWER_CHARS) out.push(`${where}: its fields allow ${chars} characters of answers in all; the booking form takes at most ${BOOKING_FORM_ANSWER_CHARS}, because the answers travel with the payment. Shorten some limits or remove a field.`);
  return out;
}

/** Warnings that do not stop a change: health words in forms. Printed by the content check and shown in the owner's change list. */
export function siteWarnings(input: Pick<SiteInput, "forms">): string[] {
  return input.forms.flatMap(({ id, data, error }) => (error === undefined ? formWarnings(id, data) : []));
}

/**
 * Judges the whole site. Problems come back as plain sentences naming the file, in this order: pages, items, settings,
 * then the rules that join them. An empty list means the site is good.
 */
export function validateSite(input: SiteInput, registry: readonly AnyBlockDefinition[], repo: Repo, extra: SiteExtra = {}): string[] {
  const out: string[] = [];
  const paymentsOn = extra.paymentsOn === true;
  const calendarOn = extra.calendarOn === true;
  const forms = formStatuses(input.forms);
  const catalogProblems = input.catalog === undefined ? [] : validateCatalogSettings(input.catalog);
  const pricingProblems = input.pricing === undefined ? [] : validatePricing(input.pricing);
  const settingsOk = input.catalog !== undefined && catalogProblems.length === 0 ? (input.catalog as CatalogSettings) : null;
  const pricingOk = input.pricing !== undefined && pricingProblems.length === 0 ? (input.pricing as PricingTable) : null;
  const liveSlugs = new Set(input.items.flatMap(({ kind, slug, data, error }) => (kind === "catalog" && error === undefined && isRecord(data) && data["status"] === "live" ? [slug] : [])));
  const catalog = { settings: settingsOk, pricing: pricingOk, items: liveSlugs };
  out.push(...validatePages(input.pages, registry, repo, { ...extra, forms, catalog }));
  const ctx: Context = { repo, pages: buildPageIndex(input.pages, registry), forms, catalog, ...(extra.uploadNames !== undefined ? { uploadNames: extra.uploadNames } : {}) };
  out.push(...validateItems(input.items, ctx));
  const formContext = { fileExists: repo.fileExists, ...(extra.registryIds !== undefined ? { registryIds: extra.registryIds } : {}) };
  out.push(...validateForms(input.forms, formContext, extra.formSettings ?? DEFAULT_FORM_SETTINGS).problems);

  for (const name of SETTINGS_NAMES) {
    const where = settingsPath(name);
    const failed = input.settingsErrors?.[name];
    const data = input[name];
    if (failed !== undefined) out.push(`${where} ${failed}`);
    else if (data === undefined) out.push(`${where} is missing. Every site has this file.`);
    else if (name === "brand") out.push(...validateBrand(data, repo));
    else if (name === "business") out.push(...validateBusiness(data, ctx));
    else if (name === "catalog") out.push(...catalogProblems);
    else if (name === "pricing") out.push(...pricingProblems);
    else if (name === "gift-cards") out.push(...validateGiftCards(data, { paymentsOn }));
    else if (name === "booking") out.push(...validateBooking(data, { calendarOn, paymentsOn }));
    else out.push(...validateNotice(data, ctx));
  }

  const catalogItems = input.items.flatMap(({ kind, slug, data, error }) =>
    kind === "catalog" && error === undefined && isRecord(data) ? [{ slug, status: String(data["status"]), data: withoutStatus(data) }] : [],
  );
  out.push(...validateCatalogLinks({ settings: settingsOk, pricing: pricingOk, items: catalogItems, itemRefs: false }));
  out.push(...catalogPageProblems(input, catalogItems, forms, repo));
  out.push(...giftCardPageProblems(input.pages, paymentsOn));
  out.push(...bookingPageProblems(input, forms, calendarOn));

  if (hasLivePost(input.items) && !blogHasPostIndex(input.pages)) {
    out.push(`A post is live, so ${BLOG_PATH} must be a live page with a "${POST_INDEX_BLOCK}" block (src/content/pages/blog.json); without it the posts have no list.`);
  }
  return out;
}

/** The items that passed the check, with the status split from the fields. Items that cannot be read are left out. */
export function toLoadedItems(items: readonly ItemFile[]): LoadedItem[] {
  const out: LoadedItem[] = [];
  for (const { kind, slug, data, error } of items) {
    const def = collectionFor(kind);
    if (error !== undefined || def === undefined || !isRecord(data)) continue;
    const { status, ...fields } = data;
    out.push({ kind: def.kind, slug, status: status as ItemStatus, data: fields });
  }
  return out;
}
