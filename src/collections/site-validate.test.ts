import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnyBlockDefinition } from "../blocks/schema.ts";
import type { Repo } from "../blocks/validate.ts";
import brand from "../content/brand.json" with { type: "json" };
import business from "../content/business.json" with { type: "json" };
import notice from "../content/notice.json" with { type: "json" };
import catalog from "../content/catalog.json" with { type: "json" };
import pricing from "../content/pricing.json" with { type: "json" };
import giftCards from "../content/gift-cards.json" with { type: "json" };
import booking from "../content/booking.json" with { type: "json" };
import bookingForm from "../content/forms/booking.json" with { type: "json" };
import quote from "../content/forms/quote.json" with { type: "json" };
import type { ItemFile } from "./schema.ts";
import { toLoadedItems, validateSite } from "./site-validate.ts";
import type { SiteInput } from "./site-validate.ts";

const repo: Repo = { imageExists: (src) => src.startsWith("/images/"), fileExists: () => true };

const base: AnyBlockDefinition = {
  type: "first",
  title: "First",
  description: "Opens a page.",
  source: "library",
  fields: { heading: { kind: "text", label: "Heading", max: 40 } },
  variants: [{ name: "a", description: "a" }],
  placement: { position: "first", maxPerPage: 1, rhythm: "hero" },
  motion: { entrance: "default" },
  example: { heading: "x" },
};
const postIndex: AnyBlockDefinition = { ...base, type: "post-index", placement: { position: "any", maxPerPage: 1, rhythm: "section", onlyOn: "/blog" } };
const registry = [base, postIndex];

const page = (path: string, extra: unknown[] = [], status = "live") => ({
  file: path === "/" ? "home.json" : `${path.slice(1)}.json`,
  data: { path, title: "t", description: "d", status, blocks: [{ type: "first", content: { heading: "x" } }, ...extra] },
});
const index = { type: "post-index", content: { heading: "x" } };
const post = (data: Record<string, unknown> = {}): ItemFile => ({
  kind: "posts",
  slug: "hello",
  data: { status: "live", title: "T", description: "D", date: "2026-03-27", body: [{ type: "paragraph", text: "Hi" }], ...data },
});
const site = (over: Partial<SiteInput> = {}): SiteInput => ({ pages: [page("/"), page("/contact")], items: [], forms: [], business, brand, notice, catalog, pricing, "gift-cards": giftCards, booking, ...over });
const has = (problems: string[], text: string) => assert.ok(problems.some((p) => p.includes(text)), `${text} in ${JSON.stringify(problems)}`);

describe("validateSite", () => {
  it("judges the gift card settings: selling cannot be on while payments is off", () => {
    const selling = { ...giftCards, selling: true };
    has(validateSite(site({ "gift-cards": selling }), registry, repo), "Gift card sales cannot be turned on yet");
    assert.deepEqual(validateSite(site({ "gift-cards": selling }), registry, repo, { paymentsOn: true }), []);
    has(validateSite(site({ "gift-cards": undefined }), registry, repo), "src/content/gift-cards.json is missing");
  });

  it("a live page with a gift-card block fails while payments is off, and an archived one does not", () => {
    const giftBlock = { type: "gift-card", content: {} };
    const live = validateSite(site({ pages: [page("/"), page("/gifts", [giftBlock])] }), registry, repo);
    has(live, "src/content/pages/gifts.json: this page has a gift card block, but payments are not set up");
    assert.equal(validateSite(site({ pages: [page("/"), page("/gifts", [giftBlock], "archived")] }), registry, repo).filter((p) => p.includes("payments are not set up")).length, 0);
    const withPayments = validateSite(site({ pages: [page("/"), page("/gifts", [giftBlock])] }), registry, repo, { paymentsOn: true });
    assert.equal(withPayments.filter((p) => p.includes("payments are not set up")).length, 0);
  });

  it("passes a good site", () => {
    assert.deepEqual(validateSite(site(), registry, repo), []);
  });

  it("a live post without a /blog page fails, and a draft post does not", () => {
    has(validateSite(site({ items: [post()] }), registry, repo), "/blog must be a live page");
    assert.deepEqual(validateSite(site({ items: [post({ status: "draft" })] }), registry, repo), []);
  });

  it("a live post needs /blog to be live and to hold a post-index block", () => {
    has(validateSite(site({ items: [post()], pages: [page("/"), page("/contact"), page("/blog", [])] }), registry, repo), "/blog must be a live page");
    has(validateSite(site({ items: [post()], pages: [page("/"), page("/contact"), page("/blog", [index], "archived")] }), registry, repo), "/blog must be a live page");
    assert.deepEqual(validateSite(site({ items: [post()], pages: [page("/"), page("/contact"), page("/blog", [index])] }), registry, repo), []);
  });

  it("post-index is allowed only on /blog", () => {
    has(validateSite(site({ pages: [page("/", [index]), page("/contact")] }), registry, repo), "can only be used on the page /blog");
  });

  it("judges item links against the page index and item images against the repo", () => {
    const withLink = post({ body: [{ type: "paragraph", text: ["See ", { text: "this", href: "/nowhere" }] }] });
    has(validateSite(site({ items: [withLink] }), registry, repo), "/nowhere");
    const withImage = post({ status: "draft", body: [{ type: "photo", image: { src: "/images/missing/none.jpg", alt: "A bright window over a table" } }] });
    const strict: Repo = { imageExists: () => false, fileExists: () => true };
    has(validateSite(site({ items: [withImage] }), registry, strict), "none.jpg");
  });

  it("reports a missing or unreadable settings file by name, not as a crash", () => {
    const problems = validateSite(site({ business: undefined, notice: undefined, settingsErrors: { notice: "is not valid JSON (x)." } }), registry, repo);
    has(problems, "src/content/business.json is missing");
    has(problems, "src/content/notice.json is not valid JSON");
  });

  it("orders problems: pages, items, settings, then cross rules", () => {
    const problems = validateSite(
      site({ pages: [page("/"), { file: "contact.json", data: { path: "/contact" } }], items: [post({ title: "" })], brand: { colors: 1 }, business: undefined }),
      registry,
      repo,
    );
    const at = (text: string) => problems.findIndex((p) => p.includes(text));
    assert.ok(at("contact.json") >= 0 && at("contact.json") < at("posts/hello.json"), JSON.stringify(problems));
    assert.ok(at("posts/hello.json") < at("business.json is missing"));
    assert.ok(at("business.json is missing") < at("/blog must be a live page"));
  });
});

describe("toLoadedItems", () => {
  it("splits the status from the fields and leaves out unreadable items", () => {
    const bad: ItemFile = { kind: "posts", slug: "bad", data: undefined, error: "x" };
    const [only, ...rest] = toLoadedItems([post(), bad]);
    assert.equal(rest.length, 0);
    assert.equal(only?.status, "live");
    assert.equal(only?.data["status"], undefined);
    assert.equal(only?.data["title"], "T");
  });
});

describe("catalog rules", () => {
  const catalogBlock: AnyBlockDefinition = { ...base, type: "catalog", placement: { position: "any", maxPerPage: 1, rhythm: "section" } };
  const reg = [base, postIndex, catalogBlock];
  const gallery = { type: "catalog", content: { heading: "x" } };
  const quoteForm = (status = "live") => ({ id: "quote", data: { ...quote, status } });
  const piece = (slug = "tall-jug", data: Record<string, unknown> = {}): ItemFile => ({
    kind: "catalog",
    slug,
    data: { status: "live", name: "Tall jug", photos: [{ src: "/images/a/jug.jpg", alt: "A tall blue jug on a table" }], description: "A jug.", price: { low: 60, high: 80 }, order: 1, ...data },
  });
  const cards = new Set(["/images/a/jug-card.webp"]);
  const withCards: Repo = { imageExists: (src) => src.startsWith("/images/") && (!src.endsWith("-card.webp") || cards.has(src)), fileExists: () => true };
  const good = () => site({ pages: [page("/"), page("/contact"), page("/catalog", [gallery])], items: [piece()], forms: [quoteForm()] });
  const run = (input: SiteInput, repoUsed: Repo = withCards) => validateSite(input, reg, repoUsed);

  it("passes a joined catalog", () => assert.deepEqual(run(good()), []));
  it("refuses the gallery on /, /blog and /contact", () => {
    has(run(site({ pages: [page("/", [gallery]), page("/contact")], forms: [quoteForm()] })), "cannot be on /");
    has(run(site({ pages: [page("/"), page("/contact", [gallery])], forms: [quoteForm()] })), "cannot be on /contact");
  });
  it("allows one live catalog page", () => {
    has(run(site({ pages: [page("/"), page("/contact"), page("/catalog", [gallery]), page("/shop", [gallery])], forms: [quoteForm()] })), "both hold a catalog block");
    assert.deepEqual(run(site({ pages: [page("/"), page("/contact"), page("/catalog", [gallery]), page("/shop", [gallery], "archived")], forms: [quoteForm()] })), []);
  });
  it("a live piece needs a live catalog page, a draft does not", () => {
    has(run(site({ items: [piece()], forms: [quoteForm()] })), "must show them");
    assert.deepEqual(run(site({ items: [piece("tall-jug", { status: "draft" })] })), []);
  });
  it("a live catalog page needs a live quote form", () => {
    has(run(site({ pages: [page("/"), page("/contact"), page("/catalog", [gallery])] })), "needs a live quote form");
    has(run(site({ pages: [page("/"), page("/contact"), page("/catalog", [gallery])], forms: [quoteForm("archived")] })), "it is archived");
  });
  it("a live piece needs a card file for every photo", () => {
    const two = piece("tall-jug", { photos: [{ src: "/images/a/jug.jpg", alt: "A tall blue jug on a table" }, { src: "/images/a/jug-two.jpg", alt: "The same jug from above" }] });
    has(run({ ...good(), items: [two] }), "photo 2 has no card file");
    assert.deepEqual(run({ ...good(), items: [two] }, { ...withCards, imageExists: () => true }), []);
    assert.ok(!run({ ...good(), items: [piece("tall-jug", { status: "draft", photos: [{ src: "/images/a/other.jpg", alt: "A jug on a shelf" }] })] }).join().includes("card file"));
  });
  it("judges filters and options against the settings", () => {
    has(run({ ...good(), items: [piece("tall-jug", { filters: { glaze: ["ash"] } })] }), 'the filter "glaze", which is not in src/content/catalog.json');
    has(run({ ...good(), items: [piece("tall-jug", { options: ["metal"] })] }), 'the option group "metal"');
  });
  it("judges the two settings files and the exact prices", () => {
    has(run({ ...good(), catalog: { itemWord: { singular: "", plural: "x" }, filters: [] } }), "src/content/catalog.json");
    has(run({ ...good(), pricing: { ...pricing, rounding: 3 } }), "src/content/pricing.json");
    has(run({ ...good(), pricing: { ...pricing, exact: { ghost: { metal: { a: 1 } } } } }), 'prices for "ghost"');
  });
  it("names a missing settings file", () => has(run({ ...good(), catalog: undefined }), "src/content/catalog.json is missing"));
});

describe("booking rules", () => {
  const bookingBlock: AnyBlockDefinition = { ...base, type: "booking", placement: { position: "any", maxPerPage: 1, rhythm: "section" } };
  const reg = [base, postIndex, bookingBlock];
  const block = { type: "booking", content: { heading: "x" } };
  const formFile = (data: Record<string, unknown> = {}) => ({ id: "booking", data: { ...bookingForm, ...data } });
  const withPage = (over: Partial<SiteInput> = {}) => site({ pages: [page("/"), page("/contact"), page("/book", [block])], forms: [formFile()], ...over });
  const run = (input: SiteInput, calendarOn = true) => validateSite(input, reg, repo, { calendarOn });

  it("passes a live booking page with the calendar connected", () => assert.deepEqual(run(withPage()), []));

  it("fails a live page with a booking block while the calendar is not connected, and not an archived one", () => {
    has(run(withPage(), false), "src/content/pages/book.json: this page has a booking block, but the calendar is not connected on this site, so nobody could book. Take the block off, or archive the page.");
    const archived = site({ pages: [page("/"), page("/contact"), page("/book", [block], "archived")], forms: [formFile()] });
    assert.deepEqual(run(archived, false), []);
  });

  it("allows one live booking page", () => {
    has(run(site({ pages: [page("/"), page("/contact"), page("/book", [block]), page("/visit", [block])], forms: [formFile()] })), "both hold a booking block");
  });

  it("needs the booking form live, with a name and exactly one email", () => {
    has(run(withPage({ forms: [] })), "needs a live booking form (src/content/forms/booking.json); it is missing");
    has(run(withPage({ forms: [formFile({ status: "archived" })] })), "it is archived");
    const fields = bookingForm.fields as Record<string, unknown>[];
    has(run(withPage({ forms: [formFile({ fields: fields.filter((f) => f["type"] !== "email") })] })), "exactly one email field");
    has(run(withPage({ forms: [formFile({ fields: fields.filter((f) => f["purpose"] !== "name") })] })), 'whose purpose is "name"');
  });

  it("limits the answers' text to what fits in the payment's notes", () => {
    const fields = (bookingForm.fields as Record<string, unknown>[]).map((f) => (f["id"] === "notes" ? { ...f, max: 3000 } : f));
    has(run(withPage({ forms: [formFile({ fields })] })), "the booking form takes at most 2000");
  });

  it("without a booking block, the form can be archived", () => {
    assert.deepEqual(run(site({ forms: [formFile({ status: "archived" })] })), []);
  });

  it("judges the booking settings: taking cannot be on without the calendar, a paid service needs payments", () => {
    const taking = { ...booking, taking: true };
    has(run(site({ booking: taking }), false), "Booking cannot be turned on yet");
    assert.deepEqual(run(site({ booking: taking })), []);
    has(run(site({ booking: undefined })), "src/content/booking.json is missing");
    const paid = { ...booking, services: [{ ...booking.services[0], price: { amount: 50, per: "person" }, payment: { kind: "full" } }] };
    has(run(site({ booking: paid })), "payments are not set up");
  });
});
