import assert from "node:assert/strict";
import { test } from "node:test";
import { seedSite } from "./test-support.ts";
import { isCommittablePath } from "./site-reader.ts";
import { cardKey } from "../uploads/store.ts";
import { aiApp, JPEG, makeUploadsEditor, type Called, type UploadsEditor } from "./uploads-test-support.ts";

/**
 * The owner sayings of the catalog run (spec: docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md, R18 and R19),
 * each played as the owner's AI app calling the MCP endpoint on the fake GitHub, with a real upload store on fake R2. A test
 * checks the proposal's change list, and the files a publish commits; a refusal checks the plain-words reason.
 * The seeded site has a live catalog page, a live quote form and live pieces: the real shape.
 */

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const status = "live";

const catalogSettings = {
  itemWord: { singular: "piece", plural: "pieces" },
  filters: [
    { id: "type", name: "Type", values: [{ id: "ring", label: "Ring" }, { id: "band", label: "Band" }, { id: "pendant", label: "Pendant" }] },
    { id: "metal", name: "Metal", values: [{ id: "gold", label: "Gold" }, { id: "platinum", label: "Platinum" }] },
  ],
};

const pricing = {
  currency: "USD",
  rounding: 5,
  spread: 0,
  note: "Prices are estimates. I confirm the final price after we talk.",
  groups: [
    {
      id: "metal",
      name: "Metal",
      choices: [
        { id: "14k-gold", label: "14k gold", add: 0 },
        { id: "18k-gold", label: "18k gold", multiply: 1.25 },
        { id: "platinum", label: "Platinum", add: 300 },
      ],
    },
  ],
  perPerson: null,
  exact: {
    "oval-halo-ring": { metal: { "18k-gold": 2100 } },
    "plain-band": { metal: { "18k-gold": 900 } },
  },
};

const photo = (name: string) => ({ src: `/images/${name}.webp`, alt: `The ${name.replace(/-/g, " ")} on a white cloth` });
const piece = (name: string, order: number, extra: Record<string, unknown> = {}) => ({
  status,
  name,
  photos: [photo(name.toLowerCase().replace(/ /g, "-"))],
  description: `A ${name.toLowerCase()}, made to order.`,
  filters: { type: ["ring"], metal: ["gold"] },
  price: { low: 1200, high: 1800 },
  options: ["metal"],
  order,
  ...extra,
});

const pieces: Record<string, Record<string, unknown>> = {
  "oval-halo-ring": piece("Oval halo ring", 1),
  "plain-band": piece("Plain band", 2, { price: { low: 400, high: 600 }, filters: { type: ["band"], metal: ["gold"] } }),
  "stacking-ring": piece("Stacking ring", 3, { price: { low: 1000, high: 1200 } }),
  "pearl-studs": piece("Pearl studs", 4, { price: { low: 250, high: 250 }, options: [], filters: { type: ["pendant"] } }),
};

function files(): Record<string, string> {
  const out: Record<string, string> = {
    "src/content/catalog.json": json(catalogSettings),
    "src/content/pricing.json": json(pricing),
  };
  for (const [slug, item] of Object.entries(pieces)) {
    out[`src/content/collections/catalog/${slug}.json`] = json(item);
    for (const { src } of item.photos as { src: string }[]) {
      out[`public${src}`] = "image-bytes";
      out[`public${src.replace(/\.webp$/, "-card.webp")}`] = "card-bytes";
    }
  }
  out["src/content/pages/catalog.json"] = json({
    path: "/catalog",
    title: "Catalog",
    description: "Pieces made to order.",
    status: "live",
    menu: { label: "Catalog", order: 15, places: ["header"] },
    blocks: [{ type: "hero", content: { title: "The catalog" } }, { type: "catalog", content: { heading: "Pieces" } }],
  });
  return out;
}

const site = (): UploadsEditor => makeUploadsEditor({ github: seedSite(files()) });

const proposalId = (called: Called) => String(called.data.proposal_id);
const setOn = (target: Record<string, string>, pointer: string, value: unknown) => ({ op: "set", ...target, pointer, value });
const CARD = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 9, 9]);

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

async function publishAndMerge(t: UploadsEditor, ai: ReturnType<typeof aiApp>, id: string): Promise<{ branch: string; files: Record<string, string> }> {
  const published = await ai("publish_change", { proposal_id: id, owner_confirmation: "Yes, publish it." });
  assert.equal(published.isError, false, published.text);
  const pull = t.github.pulls[t.github.pulls.length - 1];
  const committed = t.github.filesOn(pull.headRef);
  t.github.merge(pull.number);
  return { branch: pull.headRef, files: committed };
}

async function upload(t: UploadsEditor, name: string, card: Uint8Array | null = CARD): Promise<string> {
  const result = await t.store.add(JPEG, name);
  assert.ok(result.ok, result.ok ? "" : result.message);
  // Uploads now make their own card; null stands for a photo uploaded before cards existed.
  if (card) await t.r2.bucket.put(cardKey(result.upload.id), card);
  else await t.r2.bucket.delete(cardKey(result.upload.id));
  return result.upload.id;
}

// ---- (a) a new piece with the photo just uploaded ----

test('"Add this piece with the photo I just uploaded": the photo and its card are committed with the piece', async () => {
  const t = site();
  const ai = aiApp(t);
  const id = await upload(t, "Pendant.jpg");
  const newPiece = {
    status: "draft",
    name: "Emerald pendant",
    photos: [{ src: `upload:${id}`, alt: "A pendant with a green stone on a velvet tray" }],
    description: "A pendant with an emerald, set in gold.",
    filters: { type: ["pendant"], metal: ["gold"] },
    price: { low: 800, high: 1000 },
    options: ["metal"],
    order: 5,
  };
  const proposed = await propose(ai, "Add the emerald pendant", [{ op: "add_item", collection: "catalog", slug: "emerald-pendant", item: newPiece }]);

  assert.match(proposed.text, /New piece "Emerald pendant" \(catalog\/emerald-pendant\)\./);
  assert.match(proposed.text, /Status: save as a draft\. It is not on the live site until the owner says to publish it\./);
  assert.ok(proposed.text.includes(`Photo: "Pendant" (upload ${id}), description: "A pendant with a green stone on a velvet tray"`), proposed.text);
  assert.match(proposed.text, /Estimate for the usual choices: \$800 to \$1,000/);
  assert.equal(t.github.pulls.length, 0, "proposing opens nothing");

  const { branch, files: committed } = await publishAndMerge(t, ai, proposalId(proposed));
  const item = JSON.parse(committed["src/content/collections/catalog/emerald-pendant.json"]) as { status: string; photos: { src: string }[] };
  assert.equal(item.status, "draft");
  assert.deepEqual(item.photos.map((p) => p.src), [`/images/uploads/${id}.webp`], "no upload reference is left");
  assert.deepEqual(t.github.bytesOn(branch, `public/images/uploads/${id}.webp`), await t.store.file(id), "the photo is the upload's file");
  assert.deepEqual(t.github.bytesOn(branch, `public/images/uploads/${id}-card.webp`), CARD, "the card is the upload's card");
});

test("an upload used as a piece's second photo gets its card committed too", async () => {
  const t = site();
  const ai = aiApp(t);
  const first = await upload(t, "Front.jpg");
  const second = await upload(t, "Back.jpg");
  const newPiece = {
    status: "draft",
    name: "Two-photo pendant",
    photos: [
      { src: `upload:${first}`, alt: "A pendant seen from the front" },
      { src: `upload:${second}`, alt: "The same pendant seen from the back" },
    ],
    description: "A pendant with an emerald, set in gold.",
    filters: { type: ["pendant"], metal: ["gold"] },
    price: { low: 800, high: 1000 },
    options: ["metal"],
    order: 6,
  };
  const proposed = await propose(ai, "Add the two-photo pendant", [{ op: "add_item", collection: "catalog", slug: "two-photo-pendant", item: newPiece }]);
  const { branch } = await publishAndMerge(t, ai, proposalId(proposed));
  assert.deepEqual(t.github.bytesOn(branch, `public/images/uploads/${second}-card.webp`), CARD, "photo 2 has its card");
  assert.deepEqual(t.github.bytesOn(branch, `public/images/uploads/${first}-card.webp`), CARD, "photo 1 has its card");
});

test("a photo uploaded before cards existed cannot be a catalog photo, and the sentence says so", async () => {
  const t = site();
  const ai = aiApp(t);
  const id = await upload(t, "Old photo.jpg", null);
  const text = await refused(ai, [
    { op: "add_item", collection: "catalog", slug: "old-photo-piece", item: { status: "draft", name: "Old photo piece", photos: [{ src: `upload:${id}`, alt: "A ring on a white cloth" }], description: "A ring.", price: { low: 100, high: 200 }, order: 9 } },
  ]);
  assert.ok(text.includes("This photo was uploaded before catalog photos had cards; upload it again."), text);
  assert.equal(t.github.pulls.length, 0);
});

test("the same upload used on an ordinary page needs no card", async () => {
  const t = site();
  const ai = aiApp(t);
  const id = await upload(t, "Plain.jpg", null);
  const proposed = await propose(ai, "A new photo on the hours page", [
    { op: "insert_block", page: "/hours", at: 2, block: { type: "gallery", content: { heading: "Around", photos: [{ image: { src: `upload:${id}`, alt: "Customers browsing the shelves" } }, { image: { src: "/images/team.png", alt: "The team outside the shop" } }] } } },
  ]);
  const { branch } = await publishAndMerge(t, ai, proposalId(proposed));
  assert.equal(t.github.bytesOn(branch, `public/images/uploads/${id}-card.webp`), null);
});

test("the editor may commit a card beside an upload, and nothing else like it", () => {
  assert.equal(isCommittablePath("public/images/uploads/ab12cd34-card.webp"), true);
  assert.equal(isCommittablePath("public/images/uploads/ab12cd34.webp"), true);
  for (const path of ["public/images/uploads/ab12cd34-thumb.webp", "public/images/uploads/ab12cd3-card.webp", "public/images/catalog/ring-1-card.webp", "public/images/uploads/ab12cd34-card.png"]) {
    assert.equal(isCommittablePath(path), false, path);
  }
});

// ---- (b) raise 18k gold by 5 percent ----

test('"Raise 18k gold by 5 percent": one operation, every exact price, and the pieces it moves', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Raise 18k gold by 5 percent", [{ op: "scale_price", group: "metal", choice: "18k-gold", percent: 5 }]);

  assert.match(proposed.text, /Pricing table:/);
  assert.match(proposed.text, /Multiplies by:\s+was: 1\.25\s+now: 1\.3125/);
  assert.ok(proposed.text.includes("This changes the price of 3 pieces."), proposed.text);
  assert.ok(proposed.text.includes("Oval halo ring, with 18k gold: About $2,100 → About $2,205"), proposed.text);
  assert.ok(proposed.text.includes("Plain band, with 18k gold: About $900 → About $945"), proposed.text);
  assert.ok(proposed.text.includes("Stacking ring, with 18k gold: $1,250 to $1,500 → $1,310 to $1,575"), proposed.text);
  assert.ok(!proposed.text.includes("Pearl studs"), "a piece with no metal option does not move");
  const list = String(proposed.data.change_list).trimEnd();
  assert.ok(list.endsWith("→ $1,310 to $1,575"), "the impact lines end the change list");
  assert.ok(proposed.text.indexOf("This changes the price of 3 pieces.") > proposed.text.indexOf("Pricing table:"));

  const { files: committed } = await publishAndMerge(t, ai, proposalId(proposed));
  const table = JSON.parse(committed["src/content/pricing.json"]) as typeof pricing;
  assert.deepEqual(table.groups[0].choices[1], { id: "18k-gold", label: "18k gold", multiply: 1.3125 });
  assert.deepEqual(table.groups[0].choices[0], { id: "14k-gold", label: "14k gold", add: 0 }, "other choices are untouched");
  assert.deepEqual(table.exact, { "oval-halo-ring": { metal: { "18k-gold": 2205 } }, "plain-band": { metal: { "18k-gold": 945 } } });
  assert.equal(committed["src/content/collections/catalog/oval-halo-ring.json"], t.github.filesOn("main")["src/content/collections/catalog/oval-halo-ring.json"], "no item file changes");
});

test("scale_price scales an add choice to a whole number, and may lower a price", async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Lower platinum by 10 percent", [{ op: "scale_price", group: "metal", choice: "platinum", percent: -10 }]);
  const { files: committed } = await publishAndMerge(t, ai, proposalId(proposed));
  assert.deepEqual((JSON.parse(committed["src/content/pricing.json"]) as typeof pricing).groups[0].choices[2], { id: "platinum", label: "Platinum", add: 270 });
  assert.ok(proposed.text.includes("Oval halo ring, with Platinum: $1,500 to $2,100 → $1,470 to $2,070"), proposed.text);
});

test("a pricing change that moves nothing says so in the owner's word", async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Change the note", [setOn({ settings: "pricing" }, "/note", "Prices are estimates; I confirm each one after we talk.")]);
  assert.ok(proposed.text.includes("No piece's price changes."), proposed.text);
  assert.ok(!proposed.text.includes("This changes the price of"));
});

test("a change that does not touch the pricing table prints no price lines", async () => {
  const t = site();
  const proposed = await propose(aiApp(t), "Rename a piece", [setOn({ item: "catalog/plain-band" }, "/name", "Simple band")]);
  assert.ok(!proposed.text.includes("This changes the price of"));
  assert.ok(!proposed.text.includes("No piece's price changes."));
});

test("scale_price refuses an unknown group, an unknown choice, and a percent that is out of range", async () => {
  const t = site();
  const ai = aiApp(t);
  assert.match(await refused(ai, [{ op: "scale_price", group: "metal", choice: "silver", percent: 5 }]), /there is no choice "silver" in the group metal; its choices are: 14k-gold, 18k-gold, platinum\./);
  assert.match(await refused(ai, [{ op: "scale_price", group: "stone", choice: "18k-gold", percent: 5 }]), /there is no option group "stone" in the pricing table; the groups are: metal\./);
  assert.match(await refused(ai, [{ op: "scale_price", group: "metal", choice: "18k-gold", percent: 150 }]), /from -50 to 100/);
  assert.match(await refused(ai, [{ op: "scale_price", group: "metal", choice: "18k-gold", percent: 2.555 }]), /at most two decimals/);
  assert.match(await refused(ai, [{ op: "scale_price", group: "metal", choice: "18k-gold", percent: 0 }]), /0 percent changes nothing/);
  assert.match(await refused(ai, [{ op: "scale_price", group: "metal", choice: "18k-gold", percent: 5, extra: 1 }]), /"extra" is not a field of scale_price/);
});

// ---- (c) a new filter ----

test('"Add a filter called Style with Vintage and Modern": ids are made from the words', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Add a Style filter", [
    { op: "insert_item", settings: "catalog", pointer: "/filters", at: 3, value: { id: "style", name: "Style", values: [{ id: "vintage", label: "Vintage" }, { id: "modern", label: "Modern" }] } },
  ]);
  assert.match(proposed.text, /Catalog settings/);
  assert.ok(proposed.text.includes('adds:'), proposed.text);
  assert.ok(proposed.text.includes('Name: "Style"') && proposed.text.includes('Label: "Vintage"') && proposed.text.includes('Label: "Modern"'), proposed.text);
  assert.ok(!proposed.text.includes("This changes the price of"), "a filter is not a price change");

  const { files: committed } = await publishAndMerge(t, ai, proposalId(proposed));
  const settings = JSON.parse(committed["src/content/catalog.json"]) as typeof catalogSettings;
  assert.deepEqual(settings.filters.map((filter) => filter.id), ["type", "metal", "style"]);
  assert.deepEqual(settings.filters[2].values.map((value) => value.id), ["vintage", "modern"]);
  assert.deepEqual(settings.filters[0], catalogSettings.filters[0], "the other filters are untouched");
});

test("renaming a filter value's label keeps its id, and a piece that uses the id stays valid", async () => {
  const t = site();
  const proposed = await propose(aiApp(t), "Rename Band", [setOn({ settings: "catalog" }, "/filters/0/values/1/label", "Wedding band")]);
  const { files: committed } = await publishAndMerge(t, aiApp(t), proposalId(proposed));
  const settings = JSON.parse(committed["src/content/catalog.json"]) as typeof catalogSettings;
  assert.deepEqual(settings.filters[0].values[1], { id: "band", label: "Wedding band" });
});

test("removing a filter value a piece uses is refused in the site check's words", async () => {
  const t = site();
  const text = await refused(aiApp(t), [{ op: "remove_item", settings: "catalog", pointer: "/filters/0/values", at: 2 }]);
  assert.match(text, /names the value "band", which is not in src\/content\/catalog\.json\. Add it there first; a value a piece uses cannot be removed\./);
  assert.match(text, /src\/content\/collections\/catalog\/plain-band\.json/);
  assert.equal(t.github.pulls.length, 0);
});

// ---- (d) hide the price ----

test('"Hide the price on this piece": the price becomes "ask" and the change list shows the range going away', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Hide the price on the oval halo ring", [setOn({ item: "catalog/oval-halo-ring" }, "/price", "ask")]);
  assert.ok(proposed.text.includes("Estimate for the usual choices: $1,200 to $1,800 → Price on request"), proposed.text);
  assert.ok(!proposed.text.includes("This changes the price of"), "an item's own price is not a pricing-table change");

  const { files: committed } = await publishAndMerge(t, ai, proposalId(proposed));
  const item = JSON.parse(committed["src/content/collections/catalog/oval-halo-ring.json"]) as { price: unknown; status: string };
  assert.equal(item.price, "ask");
  assert.equal(item.status, status, "the status is untouched");
});

test("a new price range for a piece shows the old and the new estimate", async () => {
  const t = site();
  const proposed = await propose(aiApp(t), "Reprice the pearl studs", [setOn({ item: "catalog/pearl-studs" }, "/price", { low: 300, high: 340 })]);
  assert.ok(proposed.text.includes("Estimate for the usual choices: About $250 → $300 to $340"), proposed.text);
});

// ---- (e) archive ----

test('"Archive this piece": set_item_status archived, nothing deleted', async () => {
  const t = site();
  const ai = aiApp(t);
  const proposed = await propose(ai, "Archive the plain band", [{ op: "set_item_status", item: "catalog/plain-band", status: "archived" }]);
  assert.match(proposed.text, /Piece "Plain band" \(catalog\/plain-band\):/);
  assert.match(proposed.text, /Status: archive\. It leaves the site \(it was in the catalog gallery and on its own page\)\. Nothing is deleted; it can be brought back\./);
  const { files: committed } = await publishAndMerge(t, ai, proposalId(proposed));
  assert.equal((JSON.parse(committed["src/content/collections/catalog/plain-band.json"]) as { status: string }).status, "archived");
  assert.equal(Object.hasOwn(committed, "src/content/collections/catalog/oval-halo-ring.json"), true, "the other pieces stay");
  assert.equal(committed["src/content/pricing.json"], t.github.filesOn("main")["src/content/pricing.json"], "archiving keeps the piece's exact prices");
});

// ---- reading ----

test("get_item shows a piece's exact prices beside it, and get_settings reads pricing and catalog in words", async () => {
  const t = site();
  const ai = aiApp(t);
  const item = await ai("get_item", { collection: "catalog", slug: "oval-halo-ring" });
  assert.equal(item.isError, false, item.text);
  assert.ok(item.text.includes("Exact prices:"), item.text);
  assert.ok(item.text.includes("Metal, 18k gold: $2,100 (set in the pricing table, not in the item)"), item.text);
  assert.ok(item.text.includes("Estimate for the usual choices: $1,200 to $1,800"), item.text);

  const table = await ai("get_settings", { name: "pricing" });
  assert.equal(table.isError, false, table.text);
  assert.ok(table.text.includes("14k gold (id 14k-gold): no change, the default"), table.text);
  assert.ok(table.text.includes("18k gold (id 18k-gold): multiplies by 1.25"), table.text);
  assert.ok(table.text.includes("Platinum (id platinum): adds $300"), table.text);
  assert.ok(table.text.includes("Exact prices: 2 pieces have them"), table.text);

  const filters = await ai("get_settings", { name: "catalog" });
  assert.equal(filters.isError, false, filters.text);
  assert.ok(filters.text.includes("Type (id type): Ring (id ring), Band (id band), Pendant (id pendant)"), filters.text);
  assert.ok(filters.text.includes('The word for a piece: "piece" (plural "pieces").'), filters.text);
});

test("list_collections and get_collection cover the catalog, with each piece's estimate", async () => {
  const t = site();
  const ai = aiApp(t);
  const listed = await ai("list_collections");
  assert.ok(listed.text.includes(`catalog: Catalog (4 live, 0 draft, 0 archived)`), listed.text);
  assert.ok(listed.text.includes("catalog: 2 filters"), listed.text);
  assert.ok(listed.text.includes("pricing: 1 option group"), listed.text);

  const collection = await ai("get_collection", { collection: "catalog" });
  assert.equal(collection.isError, false, collection.text);
  assert.ok(collection.text.includes(`catalog/oval-halo-ring "Oval halo ring": ${status}, order 1, estimate $1,200 to $1,800`), collection.text);
  assert.ok(collection.text.includes(`catalog/pearl-studs "Pearl studs": ${status}, order 4, estimate About $250`), collection.text);
});

test("the tools' schemas accept the catalog and scale_price", async () => {
  const t = site();
  const ai = aiApp(t);
  assert.equal((await ai("get_item", { collection: "catalog", slug: "plain-band" })).isError, false);
  assert.equal((await ai("get_settings", { name: "pricing" })).isError, false);
  const refusedKind = await ai("get_collection", { collection: "pieces" });
  assert.equal(refusedKind.isError, true);
});

// ---- scale_price limits ----

const siteWithPricing = (table: unknown): UploadsEditor => makeUploadsEditor({ github: seedSite({ ...files(), "src/content/pricing.json": json(table) }) });
const withChoices = (choices: unknown[], exact: unknown = {}) => ({ ...pricing, groups: [{ id: "metal", name: "Metal", choices }], exact });

test("scale_price refuses a scale that leaves a multiplier below its limit, in a plain sentence", async () => {
  const t = siteWithPricing(withChoices([{ id: "14k-gold", label: "14k gold", add: 0 }, { id: "bronze", label: "Bronze", multiply: 0.12 }]));
  const text = await refused(aiApp(t), [{ op: "scale_price", group: "metal", choice: "bronze", percent: -50 }]);
  assert.match(text, /0\.06/);
  assert.match(text, /from 0\.1 to 10/);
  assert.equal(t.github.pulls.length, 0);
});

test("scale_price refuses an add past its limit and an exact price past its limit", async () => {
  const addTable = withChoices([{ id: "14k-gold", label: "14k gold", add: 0 }, { id: "platinum", label: "Platinum", add: 900_000 }]);
  const addText = await refused(aiApp(siteWithPricing(addTable)), [{ op: "scale_price", group: "metal", choice: "platinum", percent: 100 }]);
  assert.match(addText, /1800000/);
  assert.match(addText, /1000000/);

  const exactTable = withChoices([{ id: "14k-gold", label: "14k gold", add: 0 }, { id: "18k-gold", label: "18k gold", multiply: 1.25 }], { "oval-halo-ring": { metal: { "18k-gold": 6_000_000 } } });
  const exactText = await refused(aiApp(siteWithPricing(exactTable)), [{ op: "scale_price", group: "metal", choice: "18k-gold", percent: 100 }]);
  assert.match(exactText, /oval-halo-ring/);
  assert.match(exactText, /12000000/);
});

test("scale_price on a choice that has an add of 0 and no exact prices changes nothing, and says so", async () => {
  const t = site();
  const text = await refused(aiApp(t), [{ op: "scale_price", group: "metal", choice: "14k-gold", percent: 10 }]);
  assert.match(text, /changes nothing/);
  assert.match(text, /14k-gold/);
  assert.equal(t.github.pulls.length, 0);
});
