// Tests for scripts/check-change-scope.mjs. Fake diffs only: no git repository, no network. Run with:
//   node --test scripts/check-change-scope.test.mjs   (or `npm run test:scripts`)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rules } from "./change-scope-rules.mjs";
import {
  decide,
  evaluateChange,
  formatReport,
  gatherChange,
  main,
  parseArgs,
  parseHunkLines,
  parseNameStatus,
} from "./check-change-scope.mjs";

const file = (path, status = "M", extra = {}) => ({ path, status, added: [], removed: [], ...extra });
const run = (files, existing = []) => evaluateChange({ files, existsAtBase: (p) => existing.includes(p) }, rules);
const kinds = (result) => result.flags.map((f) => f.kind);

const goodPage = `import type { Metadata } from "next";
import { Container } from "@/components/hl/Container";
import { PageHero } from "@/components/hl/PageHero";
import { faqHero, faqMeta } from "@/content/faq";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({ ...faqMeta, path: "/faq" });

export default function FaqPage() {
  return (
    <Container>
      <PageHero eyebrow={faqHero.eyebrow} title={faqHero.title} intro={faqHero.intro} />
    </Container>
  );
}
`;
const components = ["src/components/hl/Container.tsx", "src/components/hl/PageHero.tsx"];
const newPage = (content = goodPage) => file("src/app/(site)/faq/page.tsx", "A", { content });

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP")]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const image = (path, head, size = 1000) => file(path, "A", { head, size });

// ---- tier 1 and tier 3 ----------------------------------------------------------------------------------------

test("a change to content files, images, routes and nav is tier 1", () => {
  const result = run([
    file("src/content/home.ts"),
    file("src/content/services.ts"),
    file("src/lib/routes.ts"),
    file("src/content/nav.ts"),
    image("public/images/team/photo.jpg", jpg),
  ]);
  assert.equal(result.tier, 1);
  assert.deepEqual(result.outside, []);
});

const tier3 = [
  ["worker/contact.ts", "contact form"],
  ["worker/config.ts", "contact form"],
  ["public/_headers", "security headers"],
  ["public/_redirects", "redirect"],
  ["wrangler.jsonc", "deploy"],
  ["site.config.ts", "site settings"],
  ["package.json", "package"],
  ["package-lock.json", "package"],
  [".github/workflows/ci.yml", "workflow"],
  [".claude/settings.json", "Claude"],
  ["src/components/hl/Button.tsx", "shared component"],
  ["src/content/site.ts", "wiring"],
  ["src/content/providers.ts", "wiring"],
  ["src/content/auto-reply.ts", "wiring"],
  ["src/content/deep/nested.ts", "allow-list"],
  ["src/app/layout.tsx", "allow-list"],
  ["src/app/(site)/layout.tsx", "allow-list"],
  ["src/app/(site)/about/page.tsx", "existing page"],
  ["src/lib/metadata.ts", "allow-list"],
  ["scripts/preview.mjs", "allow-list"],
  ["docs/STATUS.md", "allow-list"],
  ["public/brand/logo.svg", "allow-list"],
  ["README.md", "allow-list"],
];
for (const [path, hint] of tier3) {
  test(`${path} is tier 3`, () => {
    const result = run([file("src/content/home.ts"), file(path)]);
    assert.equal(result.tier, 3);
    assert.deepEqual(result.outside.map((o) => o.path), [path]);
    assert.ok(result.outside[0].reason.includes(hint), `reason "${result.outside[0].reason}" should mention "${hint}"`);
  });
}

test("an empty change is tier 1", () => {
  assert.equal(run([]).tier, 1);
});

// ---- new pages ------------------------------------------------------------------------------------------------

test("a new page built from existing components is tier 1", () => {
  const result = run([newPage(), file("src/content/faq.ts", "A"), file("src/lib/routes.ts", "M", { added: ['export const indexableRoutes = ["/", "/faq"];'] })], components);
  assert.equal(result.tier, 1);
  assert.deepEqual(kinds(result), []);
});

test("a new page missing from routes.ts is flagged (it would miss the sitemap and the a11y scan)", () => {
  const result = run([newPage(), file("src/content/faq.ts", "A")], components);
  assert.equal(result.tier, 1);
  assert.deepEqual(kinds(result), ["new-page-not-in-routes"]);
});

const badPages = [
  ["imports a component that does not exist at the base", goodPage.replace("hl/Container", "hl/Nope"), "Nope"],
  ["uses a relative import", goodPage + 'import { x } from "./helper";\n', "./helper"],
  ["imports another lib file", goodPage + 'import { x } from "@/lib/placeholders";\n', "@/lib/placeholders"],
  ["imports the wiring module site.ts", goodPage + 'import { siteConfig } from "@/content/site";\n', "@/content/site"],
  ["imports a package", goodPage + 'import leftPad from "left-pad";\n', "left-pad"],
  ["has a bare side-effect import", goodPage + 'import "./evil.css";\n', "./evil.css"],
  ["is a client component", '"use client";\n' + goodPage, "use client"],
  ["uses dangerouslySetInnerHTML", goodPage.replace("<Container>", "<div dangerouslySetInnerHTML={{ __html: x }} /><Container>"), "dangerouslySetInnerHTML"],
  ["adds a script tag", goodPage.replace("<Container>", "<script src=\"x\" /><Container>"), "<script"],
  ["adds an iframe", goodPage.replace("<Container>", "<iframe src=\"x\" /><Container>"), "<iframe"],
  ["calls fetch", goodPage + 'const r = fetch("/api");\n', "fetch("],
  ["reads process.env", goodPage + "const k = process.env.KEY;\n", "process.env"],
  ["uses eval", goodPage + 'eval("1");\n', "eval("],
  ["uses a dynamic import", goodPage + 'const m = import("x");\n', "import("],
  ["does not call pageMetadata", goodPage.replace("pageMetadata(", "somethingElse("), "pageMetadata"],
];
for (const [name, content, hint] of badPages) {
  test(`a new page that ${name} is tier 3`, () => {
    const result = run([newPage(content)], components);
    assert.equal(result.tier, 3);
    assert.ok(result.outside[0].reason.includes(hint), `reason "${result.outside[0].reason}" should mention "${hint}"`);
  });
}

test("page files that are not exactly src/app/(site)/<name>/page.tsx stay tier 3", () => {
  for (const path of [
    "src/app/(site)/a/b/page.tsx",
    "src/app/(site)/Faq/page.tsx",
    "src/app/(site)/faq/layout.tsx",
    "src/app/(site)/faq/opengraph-image.tsx",
    "src/app/faq/page.tsx",
    "src/app/(site)/faq/route.ts",
  ]) {
    assert.equal(run([file(path, "A", { content: goodPage })], components).tier, 3, path);
  }
});

test("editing an existing page is tier 3, and an unreadable new page is tier 3", () => {
  assert.equal(run([file("src/app/(site)/faq/page.tsx", "M", { content: goodPage })], components).tier, 3);
  assert.equal(run([file("src/app/(site)/faq/page.tsx", "A")], components).tier, 3);
});

// ---- removed pages and routes ---------------------------------------------------------------------------------

test("deleting a page is tier 1 but flagged", () => {
  const result = run([file("src/app/(site)/faq/page.tsx", "D")]);
  assert.equal(result.tier, 1);
  assert.deepEqual(kinds(result), ["removed-page"]);
});

test("removing a route from routes.ts is flagged; moving it is not", () => {
  const removed = run([file("src/lib/routes.ts", "M", { removed: ['export const indexableRoutes = ["/", "/faq"];'], added: ['export const indexableRoutes = ["/"];'] })]);
  assert.deepEqual(kinds(removed), ["removed-page"]);
  const moved = run([file("src/lib/routes.ts", "M", { removed: ['export const indexableRoutes = ["/", "/faq"];'], added: ['export const indexableRoutes = ["/",', '  "/faq"];'] })]);
  assert.deepEqual(kinds(moved), []);
});

// ---- flags ----------------------------------------------------------------------------------------------------

const flagged = (line, side = "added") => run([file("src/content/home.ts", "M", { [side]: [line] })]);

test("dollar amounts are flagged, in added and in removed lines", () => {
  for (const line of ['title: "From $900"', "price: '[[$750]]'", 'note: "about 500 USD"', 'note: "12 dollars a month"', 'note: "$1,200.50"']) {
    assert.deepEqual(kinds(flagged(line)), ["dollar"], line);
    assert.deepEqual(kinds(flagged(line, "removed")), ["dollar"], line);
  }
});

test("lines without a dollar amount are not flagged", () => {
  for (const line of ["const a = `${name} says hi`;", 'title: "Our dollar store"', 'cost: "$"', 'year: "2026"', 'title: "Opening hours"']) {
    assert.deepEqual(kinds(flagged(line)), [], line);
  }
});

test("contact details and booking links are flagged", () => {
  for (const line of [
    'email: "owner@example.com"',
    'href: "mailto:hello@example.org"',
    'href: "tel:+15551234567"',
    'phone: "(555) 123-4567"',
    'phone: "555-123-4567"',
    'phone: "555.123.4567"',
    'href: "https://calendly.com/someone/30min"',
    'href: "https://cal.com/someone"',
    'href: "https://calendar.app.google/abc"',
  ]) {
    assert.deepEqual(kinds(flagged(line)), ["contact"], line);
  }
});

test("import specifiers and dates are not mistaken for contact details", () => {
  for (const line of ['import { x } from "@/content/home";', 'updated: "2026-11-22"', 'a: "version 1.2.3"', 'b: "@lhci/cli@0.16.1"']) {
    assert.deepEqual(kinds(flagged(line)), [], line);
  }
});

test("changes to the privacy text and the form fields are flagged", () => {
  assert.deepEqual(kinds(run([file("src/content/privacy.ts")])), ["sensitive-file"]);
  assert.deepEqual(kinds(run([file("src/content/contact-fields.ts")])), ["sensitive-file"]);
});

test("a change is flagged only when it is over the size limits", () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`);
  assert.deepEqual(kinds(run([file("src/content/home.ts", "M", { added: lines(150), removed: lines(150) })])), []);
  assert.deepEqual(kinds(run([file("src/content/home.ts", "M", { added: lines(150), removed: lines(151) })])), ["size"]);
  const tenFiles = Array.from({ length: 10 }, (_, i) => file(`src/content/c${i}.ts`));
  assert.deepEqual(kinds(run(tenFiles)), []);
  assert.deepEqual(kinds(run([...tenFiles, file("src/content/c10.ts")])), ["size"]);
});

test("flags never change the tier", () => {
  const result = run([file("src/content/home.ts", "M", { added: ['title: "$900"'] }), file("src/content/privacy.ts")]);
  assert.equal(result.tier, 1);
  assert.equal(result.flags.length, 2);
});

// ---- images ---------------------------------------------------------------------------------------------------

test("jpg, png and webp images with matching bytes under 500 KB pass", () => {
  const result = run([image("public/images/a.jpg", jpg), image("public/images/b.JPEG", jpg), image("public/images/c.png", png), image("public/images/d/e.webp", webp)]);
  assert.deepEqual(result.imageProblems, []);
});

test("other formats fail, SVG included", () => {
  for (const path of ["public/images/a.svg", "public/images/a.gif", "public/images/a.avif", "public/images/a"]) {
    const result = run([image(path, svg)]);
    assert.equal(result.imageProblems.length, 1, path);
    assert.equal(result.imageProblems[0].path, path);
  }
  assert.match(run([image("public/images/a.svg", svg)]).imageProblems[0].reason, /SVG/);
});

test("a file whose bytes do not match its extension fails (an SVG renamed to .png)", () => {
  assert.equal(run([image("public/images/a.png", svg)]).imageProblems.length, 1);
  assert.equal(run([image("public/images/a.jpg", png)]).imageProblems.length, 1);
  assert.equal(run([image("public/images/a.webp", jpg)]).imageProblems.length, 1);
});

test("the size limit is 500 KB (512,000 bytes)", () => {
  assert.equal(run([image("public/images/a.jpg", jpg, 512000)]).imageProblems.length, 0);
  assert.equal(run([image("public/images/a.jpg", jpg, 512001)]).imageProblems.length, 1);
});

test("deleted images and files outside public/images are not checked by the image rules", () => {
  assert.deepEqual(run([file("public/images/a.svg", "D")]).imageProblems, []);
  assert.deepEqual(run([image("public/brand/logo.svg", svg)]).imageProblems, []);
});

// ---- placeholders ---------------------------------------------------------------------------------------------

test("a new [[placeholder]] in content or app files is reported", () => {
  const result = run([
    file("src/content/home.ts", "M", { added: ['phone: "[[Phone number]]"'] }),
    file("src/app/(site)/faq/page.tsx", "M", { added: ["<p>[[TBD]]</p>"] }),
  ]);
  assert.deepEqual(result.placeholders.map((p) => p.text), ["[[Phone number]]", "[[TBD]]"]);
});

test("removed placeholder lines and other folders are not reported", () => {
  const result = run([
    file("src/content/home.ts", "M", { removed: ['phone: "[[Phone number]]"'] }),
    file("worker/contact.ts", "M", { added: ["// [[note]]"] }),
    file("docs/STATUS.md", "M", { added: ["[[x]]"] }),
    file("src/app/hl.css", "M", { added: ["/* [[x]] */"] }),
  ]);
  assert.deepEqual(result.placeholders, []);
});

// ---- the decision ---------------------------------------------------------------------------------------------

test("strict mode fails on tier 3, bad images and new placeholders, and passes on a flagged tier 1 change", () => {
  assert.equal(decide(run([file("worker/contact.ts")]), "strict").ok, false);
  assert.equal(decide(run([image("public/images/a.svg", svg)]), "strict").ok, false);
  assert.equal(decide(run([file("src/content/home.ts", "M", { added: ["[[x]]"] })]), "strict").ok, false);
  assert.equal(decide(run([file("src/content/home.ts", "M", { added: ['"$9"'] })]), "strict").ok, true);
  assert.equal(decide(run([file("src/content/home.ts")]), "strict").ok, true);
});

test("report-only mode never fails", () => {
  assert.equal(decide(run([file("worker/contact.ts"), image("public/images/a.svg", svg)]), "report-only").ok, true);
});

// ---- plain-English output -------------------------------------------------------------------------------------

test("the report says in plain English what happened", () => {
  const ok = formatReport(run([file("src/content/home.ts", "M", { added: ['"$900"'] })]), { mode: "strict" });
  assert.match(ok, /Tier 1/);
  assert.match(ok, /Flagged for Grant/);
  assert.match(ok, /dollar/i);
  assert.match(ok, /PASS/);
  const bad = formatReport(run([file("worker/contact.ts"), image("public/images/a.svg", svg), file("src/content/home.ts", "M", { added: ["[[x]]"] })]), { mode: "strict" });
  assert.match(bad, /Tier 3/);
  assert.match(bad, /worker\/contact\.ts/);
  assert.match(bad, /public\/images\/a\.svg/);
  assert.match(bad, /\[\[x\]\]/);
  assert.match(bad, /FAIL/);
  assert.match(formatReport(run([file("worker/contact.ts")]), { mode: "report-only" }), /report only/i);
});

// ---- parsing git output ---------------------------------------------------------------------------------------

test("parseNameStatus reads git's NUL-separated output, keeping odd paths intact", () => {
  const raw = "M\0src/content/home.ts\0A\0src/app/(site)/faq/page.tsx\0D\0old file.txt\0";
  assert.deepEqual(parseNameStatus(raw), [
    { status: "M", path: "src/content/home.ts" },
    { status: "A", path: "src/app/(site)/faq/page.tsx" },
    { status: "D", path: "old file.txt" },
  ]);
  assert.deepEqual(parseNameStatus(""), []);
});

test("parseHunkLines ignores diff headers, even when a changed line starts with +++ or ---", () => {
  const patch = [
    "diff --git a/x.ts b/x.ts",
    "index 111..222 100644",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,2 +1,2 @@",
    "-old line",
    "+++ new line that starts with plus signs",
    "--- dashes inside the hunk",
    "+new line",
    "\\ No newline at end of file",
    "@@ -9 +9 @@",
    "+later",
  ].join("\n");
  assert.deepEqual(parseHunkLines(patch), {
    added: ["++ new line that starts with plus signs", "new line", "later"],
    removed: ["old line", "-- dashes inside the hunk"],
  });
});

// ---- command line ---------------------------------------------------------------------------------------------

test("parseArgs: defaults, explicit refs and modes", () => {
  assert.deepEqual(parseArgs([], {}), { base: "origin/main", head: "HEAD", mode: "strict" });
  assert.deepEqual(parseArgs(["--base", "main", "--head", "feature", "--report-only"], {}), { base: "main", head: "feature", mode: "report-only" });
  assert.equal(parseArgs(["--strict"], {}).mode, "strict");
});

test("parseArgs --ci reads GitHub's own variables: strict only on change/ branches", () => {
  assert.deepEqual(parseArgs(["--ci"], { GITHUB_BASE_REF: "main", GITHUB_HEAD_REF: "change/opening-hours" }), { base: "origin/main", head: "HEAD", mode: "strict" });
  assert.equal(parseArgs(["--ci"], { GITHUB_BASE_REF: "main", GITHUB_HEAD_REF: "feat/x" }).mode, "report-only");
  assert.match(parseArgs(["--ci"], {}).skip, /not a pull request/i);
});

test("parseArgs rejects unknown flags and missing values", () => {
  assert.match(parseArgs(["--nope"], {}).error, /--nope/);
  assert.match(parseArgs(["--base"], {}).error, /--base/);
});

// ---- the git layer, with a fake git ---------------------------------------------------------------------------

function fakeGit(table) {
  return (args) => {
    const key = args.join(" ");
    if (!(key in table)) throw new Error(`unexpected git call: ${key}`);
    return Buffer.from(table[key]);
  };
}

const scenario = () => ({
  "merge-base origin/main HEAD": "abc123\n",
  "diff --name-status -z --no-renames origin/main...HEAD": "M\0src/content/home.ts\0A\0public/images/new.jpg\0A\0src/app/(site)/faq/page.tsx\0",
  "diff -U0 --no-renames origin/main...HEAD -- src/content/home.ts": '@@ -1 +1 @@\n-title: "Old"\n+title: "From $900"\n',
  "show HEAD:public/images/new.jpg": jpg,
  "show HEAD:src/app/(site)/faq/page.tsx": goodPage,
  "diff -U0 --no-renames origin/main...HEAD -- src/app/(site)/faq/page.tsx": goodPage.split("\n").map((l) => `+${l}`).join("\n").replace(/^/, "@@ -0,0 +1 @@\n"),
  "cat-file -e abc123:src/components/hl/Container.tsx": "",
  "cat-file -e abc123:src/components/hl/PageHero.tsx": "",
});

test("gatherChange builds the change from git output and evaluateChange sorts it", () => {
  const change = gatherChange({ base: "origin/main", head: "HEAD", git: fakeGit(scenario()) });
  assert.deepEqual(change.files.map((f) => [f.status, f.path]), [
    ["M", "src/content/home.ts"],
    ["A", "public/images/new.jpg"],
    ["A", "src/app/(site)/faq/page.tsx"],
  ]);
  assert.deepEqual(change.files[0].added, ['title: "From $900"']);
  assert.equal(change.files[1].size, jpg.length);
  const result = evaluateChange(change, rules);
  assert.equal(result.tier, 1);
  assert.deepEqual(kinds(result).sort(), ["dollar", "new-page-not-in-routes"]);
});

test("main prints the report and sets the exit code for the mode", () => {
  const out = [];
  const env = {};
  assert.equal(main({ argv: [], env, git: fakeGit(scenario()), out: (t) => out.push(t) }), 0);
  assert.match(out.join("\n"), /Tier 1/);

  const bad = { ...scenario(), "diff --name-status -z --no-renames origin/main...HEAD": "M\0worker/contact.ts\0", "diff -U0 --no-renames origin/main...HEAD -- worker/contact.ts": "" };
  assert.equal(main({ argv: [], env, git: fakeGit(bad), out: () => {} }), 1);
  assert.equal(main({ argv: ["--report-only"], env, git: fakeGit(bad), out: () => {} }), 0);
});

test("main exits 2 on bad flags, 0 with a note outside a pull request, and 2 if git fails", () => {
  const out = [];
  assert.equal(main({ argv: ["--nope"], env: {}, git: fakeGit({}), out: (t) => out.push(t) }), 2);
  assert.equal(main({ argv: ["--ci"], env: {}, git: fakeGit({}), out: (t) => out.push(t) }), 0);
  assert.match(out.join("\n"), /not a pull request/i);
  assert.equal(main({ argv: [], env: {}, git: fakeGit({}), out: (t) => out.push(t) }), 2);
});

test("main appends the report to the GitHub job summary when one is set", () => {
  const dir = mkdtempSync(join(tmpdir(), "scope-"));
  try {
    const summary = join(dir, "summary.md");
    main({ argv: [], env: { GITHUB_STEP_SUMMARY: summary }, git: fakeGit(scenario()), out: () => {} });
    assert.match(readFileSync(summary, "utf8"), /Tier 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
