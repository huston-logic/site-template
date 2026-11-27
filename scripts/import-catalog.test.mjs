import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, mappingProblems, slugify, uniqueSlug } from "./import-catalog.mjs";
import { parseCsvTable } from "./catalog-csv.mjs";

const repo = new URL("..", import.meta.url).pathname;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(4)]);

const settings = {
  itemWord: { singular: "piece", plural: "pieces" },
  filters: [
    { id: "type", name: "Type", values: [{ id: "ring", label: "Rings" }, { id: "necklace", label: "Necklaces" }] },
    { id: "glaze", name: "Glaze", values: [{ id: "ash", label: "Ash" }, { id: "celadon", label: "Celadon" }] },
  ],
};
const pricing = {
  currency: "USD",
  rounding: 10,
  spread: 0,
  note: "Prices are estimates. I confirm the final price after we talk.",
  groups: [
    { id: "metal", name: "Metal", choices: [{ id: "14k-gold", label: "14k gold", add: 0 }, { id: "18k-gold", label: "18k gold", multiply: 1.25 }] },
    { id: "size", name: "Size", choices: [{ id: "small", label: "Small", multiply: 1 }, { id: "large", label: "Large", multiply: 1.5 }] },
  ],
  perPerson: { label: "Guests", amount: 6, min: 10, max: 300 },
  exact: {},
};

const mapping = {
  name: "Name",
  slug: "Slug",
  description: "Description",
  order: "Order",
  status: "Status",
  price: { low: "Low", high: "High" },
  perPerson: "Per person",
  filters: { type: "Type", glaze: "Glaze" },
  options: "Options",
  exact: { "metal/18k-gold": "Price 18k" },
  photos: { column: "Photos", alt: "Alt", focus: "Focus" },
};
const HEADER = "Name,Slug,Description,Order,Status,Low,High,Per person,Type,Glaze,Options,Price 18k,Photos,Alt,Focus";

function setup(csvRows) {
  const dir = mkdtempSync(join(tmpdir(), "import-catalog-"));
  const root = join(dir, "site");
  mkdirSync(join(root, "src"), { recursive: true });
  cpSync(join(repo, "src/content"), join(root, "src/content"), { recursive: true });
  cpSync(join(repo, "public"), join(root, "public"), { recursive: true });
  writeFileSync(join(root, "src/content/catalog.json"), `${JSON.stringify(settings, null, 2)}\n`);
  writeFileSync(join(root, "src/content/pricing.json"), `${JSON.stringify(pricing, null, 2)}\n`);
  const photos = join(dir, "photos");
  mkdirSync(photos);
  for (const name of ["ring-1.jpg", "ring-2.jpg", "set.jpg"]) writeFileSync(join(photos, name), JPEG);
  writeFileSync(join(photos, "phone.heic"), HEIC);
  writeFileSync(join(dir, "rows.csv"), `${HEADER}\n${csvRows.join("\n")}\n`);
  writeFileSync(join(dir, "mapping.json"), JSON.stringify(mapping));
  return { dir, root, photos, argv: (...more) => [join(dir, "rows.csv"), photos, join(dir, "mapping.json"), "--root", root, ...more] };
}

const fakePhotos = async () => ({ web: Buffer.from("web"), card: Buffer.from("card") });

async function run(argv, makePhotos = fakePhotos) {
  const lines = [];
  const code = await main({ argv, makePhotos, out: (line) => lines.push(line) });
  return { code, lines, text: lines.join("\n") };
}

test("slugify and uniqueSlug", () => {
  assert.equal(slugify("Oval Halo Ring!"), "oval-halo-ring");
  assert.equal(slugify("Café Crème"), "cafe-creme");
  assert.equal(slugify("***"), "");
  assert.equal(uniqueSlug("ring", new Set()), "ring");
  assert.equal(uniqueSlug("ring", new Set(["ring", "ring-2"])), "ring-3");
  assert.ok(uniqueSlug("a".repeat(60), new Set(["a".repeat(60)])).length <= 60);
});

test("mappingProblems names a missing column, an unknown filter and a bad exact key", () => {
  const headers = HEADER.split(",");
  assert.deepEqual(mappingProblems(mapping, headers, settings, pricing), []);
  const bad = { ...mapping, name: "Title", filters: { colour: "Type" }, exact: { "metal/rose-gold": "Price 18k" }, extra: 1 };
  const problems = mappingProblems(bad, headers, settings, pricing).join("\n");
  assert.match(problems, /"extra", which is not a setting/);
  assert.match(problems, /the column "Title", which the CSV does not have/);
  assert.match(problems, /"colour", which is not a filter/);
  assert.match(problems, /"metal\/rose-gold" must be a group and choice/);
});

test("a dry run reports every skipped row with its line and reason, and writes nothing", async () => {
  const t = setup([
    'Oval ring,oval-ring,"A ring, with a stone",1,live,1200,1800,no,Rings,Ash,metal,2100,ring-1.jpg;ring-2.jpg,A gold ring on a table;A ring seen from above,top',
    ",no-name,Text,2,,100,200,,,,,,ring-1.jpg,Alt,",
    "No photo,no-photo,Text,3,,100,200,,,,,,,,",
    "Missing file,missing-file,Text,4,,100,200,,,,,,gone.jpg,Alt,",
    "Phone,phone,Text,5,,100,200,,,,,,phone.heic,Alt,",
    "No alt,no-alt,Text,6,,100,200,,,,,,ring-1.jpg,,",
    "Backwards,backwards,Text,7,,300,200,,,,,,ring-1.jpg,Alt,",
    "Odd option,odd-option,Text,8,,100,200,,,,engraving,,ring-1.jpg,Alt text here,",
    "Odd value,odd-value,Text,9,,100,200,,Brooches,,,,ring-1.jpg,Alt text here,",
    "Dup,oval-ring,Text,10,,100,200,,,,,,ring-1.jpg,Alt text here,",
    "Ask,ask-piece,Text,11,,ask,,,,,,,ring-1.jpg,A ring on a plain table,",
  ]);
  try {
    const { code, text } = await run(t.argv());
    assert.equal(code, 0);
    assert.match(text, /line 3: \(no name\): missing name/);
    assert.match(text, /line 4: no-photo: no photo/);
    assert.match(text, /line 5: missing-file: photo not found: "gone\.jpg"/);
    assert.match(text, /line 6: phone: photo "phone\.heic": HEIC photos must be converted to JPEG first/);
    assert.match(text, /line 7: no-alt: photo "ring-1\.jpg" has no alt text/);
    assert.match(text, /line 8: backwards: low above high/);
    assert.match(text, /line 9: odd-option: unknown option "engraving"/);
    assert.match(text, /line 10: odd-value: unknown value "Brooches" for the filter "type"/);
    assert.match(text, /line 11: oval-ring: duplicate slug/);
    assert.match(text, /Rows read: 11/);
    assert.match(text, /Would write: 2 pieces/);
    assert.match(text, /Skipped: 9/);
    assert.match(text, /A catalog piece is live, so a live page/);
    assert.match(text, /Photos: 3/);
    assert.match(text, /Nothing was written/);
    assert.equal(existsSync(join(t.root, "src/content/collections/catalog")), false);
    assert.equal(existsSync(join(t.root, "public/images/catalog")), false);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("--write writes the items, exact prices, added values and photos, and the result passes the site check", async () => {
  const t = setup([
    'Oval ring,,A ring with a stone,1,live,1200,1800,,Rings;Opal rings,Ash,metal,2100,ring-1.jpg;ring-2.jpg,A gold ring on a table;A ring from above,top',
    "Dinner set,,A set for a table,2,,ask,,yes,,Celadon,,,set.jpg,A stack of plates on a table,",
    "Oval ring,,A second ring with the same name,3,,500,600,,,,,,ring-1.jpg,Another ring on a table,",
  ]);
  const calls = [];
  const photos = async (path, options) => {
    calls.push([path.split("/").pop(), options.focus]);
    return fakePhotos();
  };
  try {
    const { code, text } = await run(t.argv("--write", "--add-values"), photos);
    assert.equal(code, 0);
    assert.match(text, /Written: 3 pieces/);
    assert.match(text, /Filter values added to src\/content\/catalog\.json: 1/);
    // The cover keeps the row's focus; other photos are centred.
    assert.deepEqual(calls.slice(0, 2), [["ring-1.jpg", "top"], ["ring-2.jpg", "center"]]);
    const item = JSON.parse(readFileSync(join(t.root, "src/content/collections/catalog/oval-ring.json"), "utf8"));
    assert.deepEqual(item.photos, [
      { src: "/images/catalog/oval-ring-1.webp", alt: "A gold ring on a table", focus: "top" },
      { src: "/images/catalog/oval-ring-2.webp", alt: "A ring from above" },
    ]);
    assert.deepEqual(item.filters, { type: ["ring", "opal-rings"], glaze: ["ash"] });
    assert.deepEqual(item.options, ["metal"]);
    assert.equal(item.status, "live");
    assert.deepEqual(item.price, { low: 1200, high: 1800 });
    const second = JSON.parse(readFileSync(join(t.root, "src/content/collections/catalog/oval-ring-2.json"), "utf8"));
    assert.equal(second.status, "draft");
    const set = JSON.parse(readFileSync(join(t.root, "src/content/collections/catalog/dinner-set.json"), "utf8"));
    assert.equal(set.price, "ask");
    assert.equal(set.perPerson, true);
    const table = JSON.parse(readFileSync(join(t.root, "src/content/pricing.json"), "utf8"));
    assert.deepEqual(table.exact, { "oval-ring": { metal: { "18k-gold": 2100 } } });
    const catalog = JSON.parse(readFileSync(join(t.root, "src/content/catalog.json"), "utf8"));
    assert.deepEqual(catalog.filters[0].values.at(-1), { id: "opal-rings", label: "Opal rings" });
    for (const file of ["oval-ring-1.webp", "oval-ring-1-card.webp", "oval-ring-2.webp", "oval-ring-2-card.webp", "dinner-set-1-card.webp"]) {
      assert.ok(existsSync(join(t.root, "public/images/catalog", file)), file);
    }
    // A second run does not overwrite without --update.
    const again = await run(t.argv("--write"));
    assert.match(again.text, /a piece with this slug already has a file \(use --update/);
    assert.match(again.text, /Skipped: 3|Skipped: 1/);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("--update with blank exact-price cells deletes the old exact prices, and reports leftover photo files without deleting them", async () => {
  const t = setup(['Oval ring,oval-ring,A ring,1,live,1200,1800,,Rings,Ash,metal,2100,ring-1.jpg;ring-2.jpg,A gold ring on a table;A ring from above,']);
  try {
    assert.equal((await run(t.argv("--write"))).code, 0);
    const pricingPath = join(t.root, "src/content/pricing.json");
    assert.deepEqual(JSON.parse(readFileSync(pricingPath, "utf8")).exact, { "oval-ring": { metal: { "18k-gold": 2100 } } });

    writeFileSync(join(t.dir, "rows.csv"), `${HEADER}\nOval ring,oval-ring,A ring,1,live,1200,1800,,Rings,Ash,metal,,ring-1.jpg,A gold ring on a table,\n`);
    const dry = await run(t.argv("--update"));
    assert.match(dry.text, /Leftover photo files \(not deleted\):\n  public\/images\/catalog\/oval-ring-2-card\.webp\n  public\/images\/catalog\/oval-ring-2\.webp/);
    assert.deepEqual(JSON.parse(readFileSync(pricingPath, "utf8")).exact, { "oval-ring": { metal: { "18k-gold": 2100 } } }, "a dry run writes nothing");

    const written = await run(t.argv("--update", "--write"));
    assert.equal(written.code, 0);
    assert.deepEqual(JSON.parse(readFileSync(pricingPath, "utf8")).exact, {}, "the old exact price is gone");
    assert.match(written.text, /Leftover photo files \(not deleted\)/);
    assert.ok(existsSync(join(t.root, "public/images/catalog/oval-ring-2.webp")), "the leftover photo stays");
    assert.ok(existsSync(join(t.root, "public/images/catalog/oval-ring-2-card.webp")));
    const item = JSON.parse(readFileSync(join(t.root, "src/content/collections/catalog/oval-ring.json"), "utf8"));
    assert.equal(item.photos.length, 1);

    // The leftovers are never deleted, so a later update reports them again.
    const again = await run(t.argv("--update"));
    assert.match(again.text, /Leftover photo files/, "files from the first import are still there beyond the one photo");
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("a mapping with no exact columns leaves existing exact prices alone", async () => {
  const t = setup(['Oval ring,oval-ring,A ring,1,live,1200,1800,,Rings,Ash,metal,2100,ring-1.jpg,A gold ring on a table,']);
  try {
    assert.equal((await run(t.argv("--write"))).code, 0);
    writeFileSync(join(t.dir, "mapping.json"), JSON.stringify({ ...mapping, exact: undefined }));
    assert.equal((await run(t.argv("--update", "--write"))).code, 0);
    const table = JSON.parse(readFileSync(join(t.root, "src/content/pricing.json"), "utf8"));
    assert.deepEqual(table.exact, { "oval-ring": { metal: { "18k-gold": 2100 } } });
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("a photo the browser step cannot make skips only its row and nothing of it is written", async () => {
  const t = setup([
    "Good,good,Text,1,,100,200,,,,,,ring-1.jpg,A ring on a table,",
    "Bad,bad,Text,2,,100,200,,,,metal,2100,ring-2.jpg,A ring on a table,",
  ]);
  const photos = async (path) => {
    if (path.endsWith("ring-2.jpg")) throw new Error("the photo could not be read; it may be damaged");
    return fakePhotos();
  };
  try {
    const { text } = await run(t.argv("--write"), photos);
    assert.match(text, /line 3: bad: a photo could not be made: the photo could not be read/);
    assert.ok(existsSync(join(t.root, "src/content/collections/catalog/good.json")));
    assert.equal(existsSync(join(t.root, "src/content/collections/catalog/bad.json")), false);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("a mapping that names a column the CSV lacks stops the run", async () => {
  const t = setup(["A,a,Text,1,,1,2,,,,,,ring-1.jpg,Alt text here,"]);
  try {
    writeFileSync(join(t.dir, "mapping.json"), JSON.stringify({ ...mapping, name: "Title" }));
    const { code, text } = await run(t.argv());
    assert.equal(code, 2);
    assert.match(text, /the column "Title", which the CSV does not have/);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("the CSV table helper is what the import reads", () => {
  assert.equal(parseCsvTable(`${HEADER}\nA`).rows.length, 1);
});
