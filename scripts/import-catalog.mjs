// `npm run import:catalog -- <csv> <photos folder> <mapping.json> [--write] [--update] [--add-values] [--root <repo folder>]`
//
// Loads a catalog from a spreadsheet export (spec R20). Run by Huston Logic for a first load; the owner adds pieces by chat
// afterwards. A dry run is the default: it prints what it would do and writes nothing. `--write` writes
//   src/content/collections/catalog/<slug>.json   one file per piece (status draft unless the mapping says live)
//   src/content/pricing.json                      the "exact" prices of the pieces that have them
//   src/content/catalog.json                      filter values that were missing (only with --add-values)
//   public/images/catalog/<slug>-<n>.webp         each photo (1600 px at most, 450 KB at most) and -card.webp (720 by 900)
// It refuses to overwrite a piece that already has a file unless `--update`. Every row is judged by the same validators the
// build uses (validateSite), so a written catalog passes `npm run check:content`. Photos are JPEG, PNG or WebP (HEIC must be
// converted to JPEG first). Alt text is never invented: a photo without alt text skips its row.
//
// The mapping file is JSON naming the CSV column for each field (a column name is the header text of the CSV):
//   {
//     "name": "Name",                         required: the piece's name
//     "slug": "Slug",                         optional: else made from the name (a second piece with the same name gets -2, -3)
//     "description": "Description",           required: plain text, up to 600 characters
//     "order": "Order",                       optional: a whole number; else the row's place in the file
//     "status": "Status",                     optional column holding draft, live or archived
//     "defaultStatus": "draft",               optional: "draft" (the default) or "live", used when the column is missing or blank
//     "price": { "low": "Low", "high": "High" },   or { "column": "Price" } (one figure, low = high); a blank low, or the
//                                                  ask word ("ask" unless "askWord" says otherwise), means "price on request"
//     "askWord": "ask",
//     "perPerson": "Per person",              optional column: yes/no (also true/false, 1/0, y/n)
//     "filters": { "type": "Type", "glaze": "Glaze" },   filter id -> column; values split on ";" and matched to the value's
//                                                  id or label, ignoring capitals. An unknown value skips the row, unless --add-values
//     "options": "Options",                   optional column of option group ids (or names) split on ";"
//     "exact": { "metal/18k-gold": "Price 18k" },   "<group>/<choice>" -> column holding a whole price (blank = none)
//     "photos": { "column": "Photos", "alt": "Alt text", "focus": "Focus" }   file names split on ";" (the first is the cover);
//                                                  alt texts split on ";" in the same order; "focus" is optional (center, top, bottom, left, right) for the cover
//   }
// A sample is scripts/fixtures/catalog-mapping.example.json.
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registry } from "../src/blocks/definitions.ts";
import { validateSite } from "../src/collections/site-validate.ts";
import { SLUG_RE } from "../src/collections/schema.ts";
import { formFiles } from "../src/forms/registry.generated.ts";
import { readFormFiles, readItemFiles, readSettingsFiles } from "../src/lib/content-files.ts";
import { readPageFiles } from "../src/lib/page-files.ts";
import { thanksPageLinks } from "../src/lib/thanks-links.ts";
import { thanks } from "../src/content/contact.ts";
import { siteConfig } from "../site.config.ts";
import { CATALOG_SETTINGS_PATH, FILTER_LABEL_MAX, ID_RE, MAX_FILTER_VALUES, PRICE_MAX, PRICING_PATH, cardPathFor } from "../src/catalog/schema.ts";
import { parseCsvTable } from "./catalog-csv.mjs";
import { unsupportedReason } from "./catalog-images.mjs";

const ITEM_STATUSES = ["draft", "live", "archived"];
const FOCUS = ["center", "top", "bottom", "left", "right"];
const MAPPING_KEYS = ["name", "slug", "description", "order", "status", "defaultStatus", "price", "askWord", "perPerson", "filters", "options", "exact", "photos"];
const itemPath = (slug) => `src/content/collections/catalog/${slug}.json`;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const norm = (text) => String(text).trim().toLowerCase();
const splitList = (text) => String(text).split(";").map((part) => part.trim()).filter((part) => part !== "");

/** A slug from words: lowercase, accents dropped, anything else becomes a hyphen. "" when nothing is left. */
export function slugify(text, max = 60) {
  const base = String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, max).replace(/-+$/g, "");
}

/** "oval-halo-ring" taken: "oval-halo-ring-2", then -3 ... (kept within 60 characters). */
export function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 60 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The mapping's own mistakes, as plain sentences. `headers` is the CSV's header row. */
export function mappingProblems(mapping, headers, settings, pricing) {
  if (!isRecord(mapping)) return ["the mapping file must be a JSON object."];
  const out = [];
  for (const key of Object.keys(mapping)) if (!MAPPING_KEYS.includes(key)) out.push(`the mapping has "${key}", which is not a setting. It accepts: ${MAPPING_KEYS.join(", ")}.`);
  const column = (value, what) => {
    if (typeof value !== "string" || value === "") return void out.push(`the mapping's ${what} must be the name of a CSV column, written as text.`);
    if (!headers.includes(value)) out.push(`the mapping's ${what} is the column "${value}", which the CSV does not have. Its columns are: ${headers.join(", ")}.`);
  };
  for (const key of ["name", "description"]) {
    if (mapping[key] === undefined) out.push(`the mapping needs "${key}": the CSV column that holds it.`);
    else column(mapping[key], `"${key}"`);
  }
  for (const key of ["slug", "order", "status", "perPerson", "options"]) if (mapping[key] !== undefined) column(mapping[key], `"${key}"`);
  if (mapping.defaultStatus !== undefined && !["draft", "live"].includes(mapping.defaultStatus)) out.push('the mapping\'s "defaultStatus" must be "draft" or "live".');
  if (mapping.askWord !== undefined && (typeof mapping.askWord !== "string" || mapping.askWord.trim() === "")) out.push('the mapping\'s "askWord" must be a word, such as "ask".');
  const price = mapping.price;
  if (price === undefined) out.push('the mapping needs "price": { "low": ..., "high": ... } or { "column": ... }.');
  else if (!isRecord(price)) out.push('the mapping\'s "price" must be { "low", "high" } or { "column" }.');
  else if (price.column !== undefined) {
    if (price.low !== undefined || price.high !== undefined) out.push('the mapping\'s "price" takes either "column" or "low" and "high", not both.');
    column(price.column, '"price" "column"');
  } else {
    column(price.low, '"price" "low"');
    column(price.high, '"price" "high"');
  }
  if (mapping.filters !== undefined) {
    if (!isRecord(mapping.filters)) out.push('the mapping\'s "filters" must map a filter id to a column.');
    else {
      for (const [id, col] of Object.entries(mapping.filters)) {
        if (!settings.filters.some((filter) => filter.id === id)) out.push(`the mapping's "filters" names "${id}", which is not a filter in ${CATALOG_SETTINGS_PATH}. Add the filter there first.`);
        column(col, `filter "${id}" column`);
      }
    }
  }
  if (mapping.exact !== undefined) {
    if (!isRecord(mapping.exact)) out.push('the mapping\'s "exact" must map "<group>/<choice>" to a column.');
    else {
      for (const [key, col] of Object.entries(mapping.exact)) {
        const [groupId, choiceId, ...rest] = key.split("/");
        const group = pricing.groups.find((g) => g.id === groupId);
        if (rest.length > 0 || group === undefined || !group.choices.some((c) => c.id === choiceId)) out.push(`the mapping's "exact" key "${key}" must be a group and choice in ${PRICING_PATH}, written group/choice.`);
        column(col, `"exact" "${key}" column`);
      }
    }
  }
  const photos = mapping.photos;
  if (photos === undefined) out.push('the mapping needs "photos": { "column", "alt" }.');
  else if (!isRecord(photos)) out.push('the mapping\'s "photos" must be { "column", "alt", "focus" }.');
  else {
    for (const col of Array.isArray(photos.column) ? photos.column : [photos.column]) column(col, '"photos" "column"');
    column(photos.alt, '"photos" "alt"');
    if (photos.focus !== undefined) column(photos.focus, '"photos" "focus"');
  }
  return out;
}

/** A whole price from cell text ("$1,200" -> 1200), or { error }. */
function readAmount(text) {
  const cleaned = String(text).replace(/[$£€\s,]/g, "");
  if (!/^\d+$/.test(cleaned)) return { error: `"${text}" is not a whole number` };
  const n = Number(cleaned);
  return n > PRICE_MAX ? { error: `${n} is above the limit of ${PRICE_MAX}` } : { value: n };
}

const yes = (text) => ["yes", "y", "true", "1", "x"].includes(norm(text));
const no = (text) => ["", "no", "n", "false", "0"].includes(norm(text));

/**
 * Reads one CSV row. Returns { ok: false, reason } or { ok: true, entry }. `state` holds `settings`, `pricing` and the
 * values added so far (`added`: filter id -> [{ id, label }]) so a row's additions count for the next row.
 */
export function readRow({ row, mapping, state, photosDir, addValues, slugTaken, ordinal, fileHead }) {
  const v = row.values;
  const name = v[mapping.name] ?? "";
  if (name === "") return { ok: false, reason: "missing name" };
  const fromColumn = mapping.slug !== undefined ? (v[mapping.slug] ?? "") : "";
  let slug;
  if (fromColumn !== "") {
    slug = fromColumn;
    if (!SLUG_RE.test(slug)) return { ok: false, label: slug, reason: `the slug "${slug}" must be lowercase words and digits joined by hyphens, 1 to 60 characters` };
    if (slugTaken.has(slug)) return { ok: false, label: slug, reason: "duplicate slug" };
  } else {
    const base = slugify(name);
    if (base === "") return { ok: false, label: name, reason: "the name has no letters or digits to make a slug from; add a slug column" };
    slug = uniqueSlug(base, slugTaken);
  }
  const label = slug;
  const fail = (reason) => ({ ok: false, label, reason });

  const price = readPrice(v, mapping);
  if (price.error) return fail(price.error);

  const described = v[mapping.description] ?? "";
  if (described === "") return fail("missing description");

  let status = mapping.defaultStatus ?? "draft";
  if (mapping.status !== undefined && (v[mapping.status] ?? "") !== "") {
    status = norm(v[mapping.status]);
    if (!ITEM_STATUSES.includes(status)) return fail(`the status "${v[mapping.status]}" must be draft, live or archived`);
  }

  let order = ordinal;
  if (mapping.order !== undefined && (v[mapping.order] ?? "") !== "") {
    if (!/^\d+$/.test(v[mapping.order])) return fail(`the order "${v[mapping.order]}" is not a whole number`);
    order = Number(v[mapping.order]);
  }

  let perPerson = false;
  if (mapping.perPerson !== undefined) {
    const cell = v[mapping.perPerson] ?? "";
    if (yes(cell)) perPerson = true;
    else if (!no(cell)) return fail(`the per-person value "${cell}" must be yes or no`);
  }

  const filters = {};
  const addedHere = {};
  for (const [filterId, col] of Object.entries(mapping.filters ?? {})) {
    const filter = state.settings.filters.find((f) => f.id === filterId);
    const known = [...filter.values, ...(state.added[filterId] ?? []), ...(addedHere[filterId] ?? [])];
    const ids = [];
    for (const word of splitList(v[col] ?? "")) {
      let match = known.find((value) => norm(value.id) === norm(word) || norm(value.label) === norm(word));
      if (match === undefined) {
        if (!addValues) return fail(`unknown value "${word}" for the filter "${filterId}" (use --add-values to add it to ${CATALOG_SETTINGS_PATH})`);
        const id = slugify(word, 40);
        if (!ID_RE.test(id)) return fail(`the value "${word}" for the filter "${filterId}" cannot become an id`);
        if (word.length > FILTER_LABEL_MAX) return fail(`the value "${word.slice(0, 20)}..." for the filter "${filterId}" is longer than ${FILTER_LABEL_MAX} characters`);
        if (known.some((value) => value.id === id)) return fail(`the value "${word}" for the filter "${filterId}" makes an id that is already used`);
        if (known.length >= MAX_FILTER_VALUES) return fail(`the filter "${filterId}" would have more than ${MAX_FILTER_VALUES} values`);
        match = { id, label: word };
        (addedHere[filterId] ??= []).push(match);
        known.push(match);
      }
      if (!ids.includes(match.id)) ids.push(match.id);
    }
    if (ids.length > 0) filters[filterId] = ids;
  }

  const options = [];
  for (const word of splitList(mapping.options !== undefined ? (v[mapping.options] ?? "") : "")) {
    const group = state.pricing.groups.find((g) => norm(g.id) === norm(word) || norm(g.name) === norm(word));
    if (group === undefined) return fail(`unknown option "${word}" (it is not an option group in ${PRICING_PATH})`);
    if (!options.includes(group.id)) options.push(group.id);
  }

  const exact = {};
  for (const [key, col] of Object.entries(mapping.exact ?? {})) {
    const cell = v[col] ?? "";
    if (cell === "") continue;
    const amount = readAmount(cell);
    if (amount.error) return fail(`the exact price for ${key} ${amount.error}`);
    const [groupId, choiceId] = key.split("/");
    (exact[groupId] ??= {})[choiceId] = amount.value;
  }
  for (const groupId of Object.keys(exact)) if (!options.includes(groupId)) return fail(`unknown option: it has an exact price for "${groupId}" but does not list that option group`);

  const photoMap = mapping.photos;
  const names = (Array.isArray(photoMap.column) ? photoMap.column : [photoMap.column]).flatMap((col) => splitList(v[col] ?? ""));
  if (names.length === 0) return fail("no photo");
  const alts = splitList(v[photoMap.alt] ?? "");
  const photos = [];
  for (const [index, file] of names.entries()) {
    if (/[\\/]/.test(file) || file === ".." || file === ".") return fail(`photo ${index + 1} ("${file}") must be a plain file name inside the photos folder`);
    const path = join(photosDir, file);
    const head = fileHead(path);
    if (head === null) return fail(`photo not found: "${file}" is not in ${photosDir}`);
    const why = unsupportedReason(head);
    if (why) return fail(`photo "${file}": ${why}`);
    const alt = alts[index];
    if (alt === undefined || alt === "") return fail(`photo "${file}" has no alt text (never invented; add it to the "${photoMap.alt}" column)`);
    photos.push({ file, path, alt });
  }
  let focus;
  if (photoMap.focus !== undefined && (v[photoMap.focus] ?? "") !== "") {
    focus = norm(v[photoMap.focus]);
    if (!FOCUS.includes(focus)) return fail(`the focus "${v[photoMap.focus]}" must be one of ${FOCUS.join(", ")}`);
  }

  return {
    ok: true,
    entry: { line: row.line, slug, name, status, description: described, price: price.value, order, perPerson, filters, options, exact, managesExact: Object.keys(mapping.exact ?? {}).length > 0, photos, focus, added: addedHere },
  };
}

function readPrice(v, mapping) {
  const ask = norm(mapping.askWord ?? "ask");
  const spec = mapping.price;
  if (spec.column !== undefined) {
    const cell = v[spec.column] ?? "";
    if (cell === "" || norm(cell) === ask) return { value: "ask" };
    const amount = readAmount(cell);
    return amount.error ? { error: `the price ${amount.error}` } : { value: { low: amount.value, high: amount.value } };
  }
  const low = v[spec.low] ?? "";
  const high = v[spec.high] ?? "";
  if (low === "" || norm(low) === ask) return { value: "ask" };
  const a = readAmount(low);
  if (a.error) return { error: `the low price ${a.error}` };
  const b = high === "" ? a : readAmount(high);
  if (b.error) return { error: `the high price ${b.error}` };
  if (a.value > b.value) return { error: `low above high (${a.value} is more than ${b.value})` };
  return { value: { low: a.value, high: b.value } };
}

/** The file's text for a piece, with a stable key order. */
export function itemFileData(entry) {
  const photos = entry.photos.map((photo, index) => ({
    src: `/images/catalog/${entry.slug}-${index + 1}.webp`,
    alt: photo.alt,
    ...(index === 0 && entry.focus !== undefined && entry.focus !== "center" ? { focus: entry.focus } : {}),
  }));
  return {
    status: entry.status,
    name: entry.name,
    photos,
    description: entry.description,
    ...(Object.keys(entry.filters).length > 0 ? { filters: entry.filters } : {}),
    price: entry.price,
    ...(entry.options.length > 0 ? { options: entry.options } : {}),
    ...(entry.perPerson ? { perPerson: true } : {}),
    order: entry.order,
  };
}

/** The settings and pricing with these entries applied (added filter values, exact prices). Pure: returns new objects. */
export function assemble(entries, settings, pricing) {
  const nextSettings = { ...settings, filters: settings.filters.map((filter) => ({ ...filter, values: [...filter.values] })) };
  const exact = Object.fromEntries(Object.entries(pricing.exact).map(([slug, groups]) => [slug, groups]));
  for (const entry of entries) {
    for (const [filterId, values] of Object.entries(entry.added)) {
      const filter = nextSettings.filters.find((f) => f.id === filterId);
      for (const value of values) if (!filter.values.some((existing) => existing.id === value.id)) filter.values.push(value);
    }
    if (Object.keys(entry.exact).length > 0) exact[entry.slug] = entry.exact;
    // A row whose exact-price cells are now all blank clears that piece's old exact prices (only when the mapping manages them).
    else if (entry.managesExact) delete exact[entry.slug];
  }
  return { settings: nextSettings, pricing: { ...pricing, exact } };
}

function loadSiteParts(root) {
  const settingsFiles = readSettingsFiles(root);
  const settingsErrors = Object.fromEntries(Object.entries(settingsFiles).flatMap(([name, { error }]) => (error === undefined ? [] : [[name, error]])));
  return {
    pages: readPageFiles(root),
    forms: readFormFiles(root),
    items: readItemFiles(root),
    business: settingsFiles.business.data,
    brand: settingsFiles.brand.data,
    notice: settingsFiles.notice.data,
    catalog: settingsFiles.catalog.data,
    pricing: settingsFiles.pricing.data,
    settingsErrors,
  };
}

/**
 * Judges the entries with the site validator and drops each row it names, until nothing names a row. Returns
 * { kept, skipped: [{ line, label, reason }], general: [problem] } (general: problems no single row owns).
 */
export function judgeEntries({ entries, site, root }) {
  const planned = new Set();
  const repo = {
    imageExists: (src) => planned.has(src) || existsSync(join(root, "public", src)),
    fileExists: (href) => existsSync(join(root, "public", href)),
  };
  const skipped = [];
  let kept = [...entries];
  const baseline = new Set();
  for (let pass = 0; pass < 25; pass += 1) {
    planned.clear();
    for (const entry of kept) for (let n = 1; n <= entry.photos.length; n += 1) {
      const src = `/images/catalog/${entry.slug}-${n}.webp`;
      planned.add(src);
      planned.add(cardPathFor(src));
    }
    const { settings, pricing } = assemble(kept, site.catalog, site.pricing);
    const keptSlugs = new Set(kept.map((entry) => entry.slug));
    const items = [
      ...site.items.filter((item) => !(item.kind === "catalog" && keptSlugs.has(item.slug))),
      ...kept.map((entry) => ({ kind: "catalog", slug: entry.slug, data: itemFileData(entry) })),
    ];
    const problems = validateSite({ ...site, items, catalog: settings, pricing }, registry, repo, {
      links: thanksPageLinks(thanks),
      formSettings: siteConfig.forms,
      registryIds: formFiles.map((file) => file.id),
    });
    if (pass === 0) for (const problem of validateSiteBaseline(site, repo)) baseline.add(problem);
    const owned = new Map();
    for (const problem of problems) {
      if (baseline.has(problem)) continue;
      const entry = kept.find((e) => problem.includes(itemPath(e.slug)) || (problem.startsWith(PRICING_PATH) && problem.includes(`"${e.slug}"`)));
      if (entry === undefined) continue;
      (owned.get(entry.slug) ?? owned.set(entry.slug, []).get(entry.slug)).push(problem.replace(`${itemPath(entry.slug)}: `, "").replace(`${PRICING_PATH}: `, ""));
    }
    if (owned.size === 0) {
      const general = problems.filter((problem) => !baseline.has(problem));
      return { kept, skipped, general };
    }
    for (const [slug, reasons] of owned) {
      const entry = kept.find((e) => e.slug === slug);
      skipped.push({ line: entry.line, label: slug, reason: `the content check refuses it: ${reasons.join(" ")}` });
    }
    kept = kept.filter((entry) => !owned.has(entry.slug));
  }
  return { kept, skipped, general: ["the content check kept finding problems after 25 passes; run npm run check:content"] };
}

/** The problems the site already has before any row is added (so they are not blamed on the import). */
function validateSiteBaseline(site, repo) {
  return validateSite({ ...site, items: site.items }, registry, repo, { links: thanksPageLinks(thanks), formSettings: siteConfig.forms, registryIds: formFiles.map((file) => file.id) });
}

export function parseArgs(argv) {
  const args = { write: false, update: false, addValues: false, root: undefined, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") args.write = true;
    else if (arg === "--update") args.update = true;
    else if (arg === "--add-values") args.addValues = true;
    else if (arg === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: "--root needs a folder" };
      args.root = value;
      i += 1;
    } else if (arg.startsWith("-")) return { error: `Unknown option ${arg}. Options: --write, --update, --add-values, --root <folder>` };
    else args.positional.push(arg);
  }
  if (args.positional.length !== 3) return { error: "give the CSV file, the photos folder and the mapping file: npm run import:catalog -- <csv> <photos folder> <mapping.json> [--write]" };
  return args;
}

function headOf(path) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(16);
    const n = readSync(fd, buffer, 0, 16, 0);
    return buffer.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** Photo files of a piece beyond its new photo count (a re-import with fewer photos). They are reported, never deleted. */
export function leftoverPhotoFiles(root, entries) {
  const dir = join(root, "public", "images", "catalog");
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  const out = [];
  for (const entry of entries) {
    const pattern = new RegExp(`^${entry.slug.replace(/[^a-z0-9-]/g, "")}-(\\d+)(-card)?\\.webp$`);
    for (const name of names) {
      const match = pattern.exec(name);
      if (match && Number(match[1]) > entry.photos.length) out.push(`public/images/catalog/${name}`);
    }
  }
  return out.sort();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const writeJson = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

/**
 * Runs the import. `makePhotos(inputPath, { focus })` returns { web, card } Buffers (the browser step); it is only called
 * with --write. Returns the exit code: 0 done, 2 could not run.
 */
export async function main({ argv, makePhotos, out = console.log }) {
  const args = parseArgs(argv);
  if (args.error) {
    out(`Catalog import could not run: ${args.error}`);
    return 2;
  }
  const root = resolve(args.root ?? process.cwd());
  const [csvPath, photosArg, mappingPath] = args.positional;
  const photosDir = resolve(photosArg);
  let table;
  let mapping;
  try {
    table = parseCsvTable(readFileSync(csvPath, "utf8"));
    mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
  } catch (error) {
    out(`Catalog import could not run: ${error instanceof SyntaxError ? `the mapping file is not valid JSON (${error.message})` : error.message}`);
    return 2;
  }
  if (!existsSync(photosDir)) {
    out(`Catalog import could not run: the photos folder ${photosDir} does not exist.`);
    return 2;
  }
  const site = loadSiteParts(root);
  const settingsOk = isRecord(site.catalog) && Array.isArray(site.catalog.filters);
  const pricingOk = isRecord(site.pricing) && Array.isArray(site.pricing.groups) && isRecord(site.pricing.exact);
  if (!settingsOk || !pricingOk) {
    out(`Catalog import could not run: ${CATALOG_SETTINGS_PATH} and ${PRICING_PATH} must exist and be readable in ${root}.`);
    return 2;
  }
  const bad = mappingProblems(mapping, table.headers, site.catalog, site.pricing);
  if (bad.length > 0) {
    out("Catalog import could not run: the mapping has problems.");
    for (const problem of bad) out(`  - ${problem}`);
    return 2;
  }

  const existing = new Set(site.items.filter((item) => item.kind === "catalog").map((item) => item.slug));
  const state = { settings: site.catalog, pricing: site.pricing, added: {} };
  const batchSlugs = new Set();
  const skipped = [];
  const entries = [];
  table.rows.forEach((row, index) => {
    const result = readRow({ row, mapping, state, photosDir, addValues: args.addValues, slugTaken: batchSlugs, ordinal: index + 1, fileHead: headOf });
    if (!result.ok) return void skipped.push({ line: row.line, label: result.label ?? row.values[mapping.name] ?? "", reason: result.reason });
    const { entry } = result;
    if (existing.has(entry.slug) && !args.update) return void skipped.push({ line: row.line, label: entry.slug, reason: "a piece with this slug already has a file (use --update to replace it)" });
    batchSlugs.add(entry.slug);
    for (const [filterId, values] of Object.entries(entry.added)) (state.added[filterId] ??= []).push(...values);
    entries.push(entry);
  });

  const judged = judgeEntries({ entries, site, root });
  skipped.push(...judged.skipped);
  let kept = judged.kept;
  const photoFiles = new Map();

  if (args.write) {
    const survivors = [];
    for (const entry of kept) {
      try {
        const made = [];
        for (const photo of entry.photos) made.push(await makePhotos(photo.path, { focus: made.length === 0 ? (entry.focus ?? "center") : "center" }));
        photoFiles.set(entry.slug, made);
        survivors.push(entry);
      } catch (error) {
        skipped.push({ line: entry.line, label: entry.slug, reason: `a photo could not be made: ${error.message}` });
      }
    }
    kept = survivors;
    const { settings, pricing } = assemble(kept, site.catalog, site.pricing);
    for (const entry of kept) {
      writeJson(join(root, itemPath(entry.slug)), itemFileData(entry));
      photoFiles.get(entry.slug).forEach(({ web, card }, index) => {
        const target = join(root, "public", "images", "catalog", `${entry.slug}-${index + 1}.webp`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, web);
        writeFileSync(join(root, "public", cardPathFor(`/images/catalog/${entry.slug}-${index + 1}.webp`)), card);
      });
    }
    if (JSON.stringify(pricing.exact) !== JSON.stringify(site.pricing.exact)) writeJson(join(root, PRICING_PATH), pricing);
    if (kept.some((entry) => Object.keys(entry.added).length > 0)) writeJson(join(root, CATALOG_SETTINGS_PATH), settings);
  }

  skipped.sort((a, b) => a.line - b.line);
  out(`Catalog import (${args.write ? "write" : "dry run"}): ${csvPath}`);
  for (const { line, label, reason } of skipped) out(`  line ${line}: ${label === "" ? "(no name)" : label}: ${reason}`);
  if (judged.general.length > 0) {
    out("Other problems the content check reports for the site (not from one row):");
    for (const problem of judged.general.slice(0, 20)) out(`  - ${problem}`);
  }
  const photoCount = kept.reduce((sum, entry) => sum + entry.photos.length, 0);
  const addedValues = kept.reduce((sum, entry) => sum + Object.values(entry.added).reduce((n, values) => n + values.length, 0), 0);
  out("");
  out(`Rows read: ${table.rows.length}`);
  out(`${args.write ? "Written" : "Would write"}: ${plural(kept.length, "piece")} (${plural(kept.filter((entry) => existing.has(entry.slug)).length, "update")})`);
  out(`Skipped: ${skipped.length}`);
  out(`Photos: ${photoCount} (each with a 720 by 900 card)`);
  const leftovers = leftoverPhotoFiles(root, kept.filter((entry) => existing.has(entry.slug)));
  if (leftovers.length > 0) {
    out("Leftover photo files (not deleted):");
    for (const path of leftovers) out(`  ${path}`);
  }
  if (addedValues > 0) out(`Filter values added to ${CATALOG_SETTINGS_PATH}: ${addedValues}`);
  if (!args.write) out("Nothing was written. Run again with --write to write the files.");
  else out("Next: npm run strip:images -- --check, then npm run check:content, then commit.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  let browser;
  const makePhotos = async (path, options) => {
    const images = await import("./catalog-images.mjs");
    browser ??= await images.openBrowser();
    return images.makeCatalogPhotos(browser, path, options);
  };
  try {
    process.exitCode = await main({ argv, makePhotos });
  } finally {
    await browser?.close();
  }
}

