// `node scripts/catalog-fixture.mjs <n> <dir>`: writes a large generated catalog into a THROWAWAY checkout of this repo, to
// measure a build with hundreds of pieces (spec R23). It writes, under <dir>:
//   src/content/collections/catalog/piece-0001.json ...   n live pieces (1 to 4 photos each, the example photos and their cards by path)
//   src/content/catalog.json                              six filters (the showcase's)
//   src/content/pricing.json                              two option groups, a per-person fee and a few exact prices
//   src/content/pages/catalog.json                        a live /catalog page holding one `catalog` block
// No image files are written: the pieces point at public/images/examples/*.jpg and their -card.webp files. The output is
// deterministic (the same n always gives the same files). Never run it in your own checkout; the files are not content.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exampleCatalog } from "../src/catalog/example.ts";

const PHOTOS = [
  { src: "/images/examples/vase-and-pears.jpg", alt: "A pale blue vase beside a blue pear and a rust-red pear on a table" },
  { src: "/images/examples/bowl-and-lemons.jpg", alt: "A shallow bowl holding three blue fruits beside one rust-red fruit" },
  { src: "/images/examples/jug-and-cups.jpg", alt: "A tall blue jug beside two small cups on a table" },
  { src: "/images/examples/stacked-books.jpg", alt: "Abstract still life: a stack of books with a round glass paperweight on top" },
  { src: "/images/examples/candle-and-plate.jpg", alt: "A lit pale candle beside a blue egg-shaped object on a white plate" },
  { src: "/images/examples/window-light.jpg", alt: "Soft light falling through a window onto a wooden table" },
];
const TYPES = [
  { id: "jug", word: "Jug", base: 60, options: ["glaze-colour", "size"] },
  { id: "vase", word: "Vase", base: 80, options: ["glaze-colour", "size"] },
  { id: "bowl", word: "Bowl", base: 35, options: ["glaze-colour", "size"] },
  { id: "mug", word: "Mug", base: 25, options: ["glaze-colour"] },
  { id: "plate", word: "Plate", base: 30, options: ["glaze-colour"] },
  { id: "dinner-set", word: "Dinner set", base: 280, options: ["glaze-colour"] },
];
const pick = (settings, filterId) => settings.filters.find((filter) => filter.id === filterId).values.map((value) => value.id);

/** { [repo path]: JSON data } for n pieces. Pure and deterministic. */
export function buildFixture(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error("n must be a whole number from 0 to 9999");
  const settings = exampleCatalog.settings;
  const glazes = pick(settings, "glaze");
  const sizes = pick(settings, "size");
  const finishes = pick(settings, "finish");
  const collections = pick(settings, "collection");
  const made = pick(settings, "made");
  const exact = {};
  const files = {};
  for (let i = 0; i < n; i += 1) {
    const type = TYPES[i % TYPES.length];
    const glaze = glazes[i % glazes.length];
    const number = String(i + 1).padStart(4, "0");
    const slug = `piece-${number}`;
    const photoCount = 1 + (i % 4);
    const low = type.base + (i % 10) * 5;
    const data = {
      status: "live",
      name: `${type.word} ${number}`,
      photos: Array.from({ length: photoCount }, (_, p) => ({ ...PHOTOS[(i + p) % PHOTOS.length] })),
      description: `A generated ${type.word.toLowerCase()} for measuring the catalog at size. Finished in ${glaze} glaze.`,
      filters: {
        type: [type.id],
        glaze: [glaze],
        size: [sizes[i % sizes.length]],
        finish: [finishes[i % finishes.length]],
        collection: [collections[(i + 1) % collections.length]],
        made: [made[i % made.length]],
      },
      price: i % 40 === 39 ? "ask" : { low, high: low + Math.round(low / 20) * 5 },
      options: [...type.options],
      ...(type.id === "dinner-set" ? { perPerson: true } : {}),
      order: i + 1,
    };
    files[`src/content/collections/catalog/${slug}.json`] = data;
    if (i % 25 === 0 && data.price !== "ask") exact[slug] = { "glaze-colour": { celadon: low + 40, cobalt: low + 55 } };
  }
  files["src/content/catalog.json"] = settings;
  files["src/content/pricing.json"] = { ...exampleCatalog.pricing, exact };
  files["src/content/pages/catalog.json"] = {
    path: "/catalog",
    title: "Catalog",
    description: "A generated catalog, used to measure the build.",
    status: "live",
    menu: { label: "Catalog", order: 20, places: ["header", "footer"] },
    blocks: [
      { type: "hero", content: { title: "The catalog", intro: "Every piece, with an estimate and a way to ask for a quote." } },
      { type: "catalog", content: { heading: "All pieces" } },
    ],
  };
  return files;
}

/** Writes the files under `dir` and returns how many were written. */
export function writeFixture(n, dir) {
  const files = buildFixture(n);
  for (const [path, data] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  }
  return Object.keys(files).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [count, dir] = process.argv.slice(2);
  if (count === undefined || dir === undefined) {
    console.log("Usage: node scripts/catalog-fixture.mjs <n> <dir>   (dir is a throwaway checkout of this repo)");
    process.exitCode = 2;
  } else {
    try {
      const written = writeFixture(Number(count), resolve(dir));
      console.log(`Wrote ${written} files for ${count} pieces under ${resolve(dir)}. Build it there with npm run build.`);
    } catch (error) {
      console.log(`Catalog fixture could not run: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
