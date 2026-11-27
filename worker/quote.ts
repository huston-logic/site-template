import { CATALOG_DATA_PATH, QUOTE_FORM_ID, SELECTION_KEY, itemPathFor, type CatalogData, type PriceResult, type Selection } from "../src/catalog/schema.ts";
import { parseCatalogData } from "../src/catalog/data.ts";
import { formatRange, priceRange, resolveSelection } from "../src/catalog/price.ts";
import { catalogWords } from "../src/content/catalog.ts";
import { formWords } from "../src/content/forms.ts";
import { emailOf, nameOf } from "../src/forms/answers.ts";
import type { FormDefinition } from "../src/forms/schema.ts";
import type { SubmissionValue } from "../src/forms/submission.ts";
import { leadSource } from "./attribution.ts";
import type { WorkerConfig } from "./config.ts";
import { sendEmail } from "./email.ts";
import { log, type ContactEnv, type Mode } from "./env.ts";
import { formNotificationEmail, formPipelineLead, formSheetRow } from "./messages.ts";
import { formSpec, type SubmissionSpec } from "./forms.ts";

/**
 * The quote form's extras (docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md, R14 to R16). `POST
 * /api/forms/quote` runs the forms handler with this spec: it reads the site's own `/catalog.json`, judges the visitor's
 * selection, and computes the estimate with the shared price function. Nothing the browser says about money is read:
 * the only things that survive from the page are the piece's id, option ids and the number of people. The same
 * Worker-computed lines go into the Sheet row, the owner email, the Pipeline message and the visitor's estimate email.
 */

export type QuoteValue = { answers: SubmissionValue; slug: string; selection: Selection };

const REPLY_HEADERS = { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" };
const SELECTION_KEYS = ["item", "options", "people"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The catalog data from the site's own static assets, or null when anything is off (the caller fails closed). */
export async function loadCatalogData(env: ContactEnv, requestUrl: string): Promise<CatalogData | null> {
  if (!env.ASSETS) return null;
  try {
    const response = await env.ASSETS.fetch(new Request(new URL(CATALOG_DATA_PATH, requestUrl)));
    if (response.status !== 200) return null;
    return parseCatalogData(await response.json());
  } catch {
    return null;
  }
}

/** The selection as typed data, or null when no person could have made it through the page. */
function readSelection(raw: unknown, data: CatalogData): { slug: string; selection: Selection } | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !SELECTION_KEYS.includes(key))) return null;
  const slug = raw["item"];
  if (typeof slug !== "string" || !Object.hasOwn(data.items, slug)) return null;
  const selection: Selection = {};
  const options = raw["options"];
  if (options !== undefined) {
    if (!isRecord(options) || Object.values(options).some((choice) => typeof choice !== "string")) return null;
    selection.options = options as Record<string, string>;
  }
  const people = raw["people"];
  if (people !== undefined) {
    if (typeof people !== "number") return null;
    selection.people = people;
  }
  const item = data.items[slug];
  if (!item || !priceRange(item, data.pricing, selection, slug).ok) return null;
  return { slug, selection };
}

type Parts = { piece: string; link: string | null; choices: { group: string; label: string }[]; people: { label: string; count: number } | null; estimate: string };

function quoteParts(data: CatalogData, value: QuoteValue, siteUrl: string): Parts | null {
  const item = data.items[value.slug];
  if (!item) return null;
  const resolved = resolveSelection(item, data.pricing, value.selection);
  const priced = priceRange(item, data.pricing, value.selection, value.slug);
  if (!resolved.ok || !priced.ok) return null;
  const result: PriceResult = priced.result;
  const singular = data.itemWord.singular;
  return {
    piece: `${singular.charAt(0).toUpperCase()}${singular.slice(1)}: ${item.name}`,
    link: data.pagePath === null ? null : `${siteUrl}${itemPathFor(data.pagePath, value.slug)}`,
    choices: resolved.choices.map(({ group, choice }) => ({ group: group.name, label: choice.label })),
    people: resolved.people !== null && data.pricing.perPerson !== null ? { label: data.pricing.perPerson.label, count: resolved.people } : null,
    estimate: formatRange(result, data.pricing.currency, catalogWords),
  };
}

/** The lines every place shows, in order: the piece, its link, each choice, the party size, the estimate. */
export function quoteLines(data: CatalogData, value: QuoteValue, siteUrl: string): string[] {
  const parts = quoteParts(data, value, siteUrl);
  if (!parts) return [];
  return [
    parts.piece,
    ...(parts.link ? [`${catalogWords.email.link} ${parts.link}`] : []),
    ...parts.choices.map(({ group, label }) => `${group}: ${label}`),
    ...(parts.people ? [`${parts.people.label}: ${parts.people.count}`] : []),
    `${catalogWords.email.estimate} ${parts.estimate}`,
  ];
}

/** The visitor's estimate email: fixed words, the owner's reply words and the Worker's own figures. No visitor input. */
function estimateEmail(config: WorkerConfig, def: FormDefinition, data: CatalogData, value: QuoteValue, mode: Mode, visitor: string) {
  const text = [
    catalogWords.email.intro,
    quoteLines(data, value, config.editor.siteUrl).join("\n"),
    `${catalogWords.email.disclaimer} ${data.pricing.note}`,
    ...(def.reply ? [def.reply.next] : []),
    config.businessName,
  ].join("\n\n");
  const base = def.reply?.subject ?? formWords.quoteSubject;
  return { subject: mode === "production" ? base : `[Preview → would go to ${visitor}] ${base}`, text };
}

export function quoteSpec(config: WorkerConfig, def: FormDefinition, data: CatalogData): SubmissionSpec<QuoteValue> {
  const base = formSpec(config, def, QUOTE_FORM_ID);
  const siteUrl = config.editor.siteUrl;
  const lines = (value: QuoteValue) => quoteLines(data, value, siteUrl);
  return {
    ...base,
    keys: new Set<string>([...base.keys, SELECTION_KEY]),
    validate(fields) {
      const { [SELECTION_KEY]: rawSelection, ...rest } = fields;
      const picked = readSelection(rawSelection, data);
      if (!picked) return { ok: false, malformed: true, fields: [] };
      const answers = base.validate(rest);
      if (!answers.ok) return answers;
      return { ok: true, value: { answers: answers.value, ...picked } };
    },
    dryRun() {
      log("dry_run", { form: true, quote: true });
      return { ok: true };
    },
    delivery: (value, mode, receivedAt, attribution) => ({
      tabs: { production: config.sheetTabs.forms, preview: config.sheetTabs.formsPreview },
      row: formSheetRow(def, value.answers, mode, receivedAt, attribution, lines(value)),
      lead: { ...formPipelineLead(def, value.answers, lines(value)), ...leadSource(attribution, receivedAt) },
    }),
    notification(value, mode, receivedAt, status, attribution) {
      const who = nameOf(def, value.answers) || emailOf(def, value.answers);
      const pieceName = data.items[value.slug]?.name ?? value.slug;
      return {
        ...formNotificationEmail(config, def, value.answers, mode, receivedAt, status, attribution, { lead: lines(value), subject: `New quote request: ${pieceName} from ${who}` }),
        replyTo: emailOf(def, value.answers),
      };
    },
    async finish({ env, siteEmail }, value, mode, submissionId) {
      const visitor = emailOf(def, value.answers);
      const email = estimateEmail(config, def, data, value, mode, visitor);
      const to = mode === "production" ? visitor : siteEmail;
      const sent = await sendEmail(env.RESEND_API_KEY, { from: `${config.replyFromName} <${siteEmail}>`, to, replyTo: siteEmail, headers: REPLY_HEADERS, ...email }, `${submissionId}-estimate`, "estimate");
      if (!sent) log("estimate_email_failed");
      return sent ? { ok: true } : { ok: true, delivered: false };
    },
  };
}
