# Pages as blocks: design

Run: "Pages as blocks" (process run, autonomous), 2026-11-25. Source: Grant's brief in the run prompt, which is the
approval of the direction. Where the brief left something open, the call is recorded below as a **ruling** with its cost
if wrong.

## 1. Intent

Clients will change their own sites by chatting with their AI, and it has to be easier and safer than Wix. Today copy is
data (`src/content/*.ts`) but each page's layout is a code file (`src/app/(site)/<name>/page.tsx`), so adding a section is a
code change. After this run a page is one data file: its path, title, description, status and an ordered list of
**blocks** (a type, an optional designed variant and the content). One renderer builds every page. Nearly every client
change becomes a data change that a check can judge.

**The bar:** a page assembled from blocks must look as designed as a hand-built page. A block is a designed section, not
a widget. Where a rule conflicts with flexibility, quality wins.

## 2. Goals, non-goals, anti-goals

Goals: the 15 build items in the brief (pages as data, library + catalog, conversion with no visible change, content
check, scope check update, archive, video blocks, two client docs, tokens-only blocks, a shared motion layer, arrangement
rules, designed variants, a showcase page, the new-block gate).

Non-goals (brief): owner sign-in, chat tools or a connector, uploads, collections, brand settings, a form builder, a coding
agent, hosted video, an AI design review per change. Also not converted: the thanks page and the 404 (they are not page
content a client arranges; they stay code pages that use the shared hero).

Anti-goals: any visible change to the five template pages; a generic "page builder" look; free styling in data (colors,
sizes, classes, inline styles); content hidden behind motion; a slower site; a weaker gate (a11y, Lighthouse thresholds,
image rules, change report all stay).

## 3. Constraints

- Static export, Cloudflare Workers, Next 16 App Router, Tailwind v4, strict TS. Runtime deps stay Next/React only.
  **No new dependencies** in this run (none is needed).
- Node scripts load TypeScript by type stripping (Node >= 22.19), so anything a script imports is import-free or uses
  relative imports with explicit `.ts` extensions, no `@/` aliases, no enums.
- Owner-only paths (`.github/workflows`, `.claude/**`) are proposals in the scratchpad, never edited.
- Copy is not changed in meaning; the converted pages keep every string exactly.
- `docs/superpowers/plans/*` newest plan <= 150 lines (`check:process`).

## 4. Approaches considered

1. **JSON page files + a typed block registry + one renderer** (chosen). Pages are `src/content/pages/<name>.json`;
   blocks are registered definitions (schema, rules, example) plus a component. JSON cannot contain code, so a page file
   needs no code parser to be safe, and a chat tool writes it trivially.
2. TS page modules checked by the existing plain-data parser. Keeps types in the editor, but every page needs a parser
   pass, an index file to register it, and an AI must write TypeScript. Rejected: more moving parts, weaker guarantee.
3. MDX or markdown pages with embedded components. Rejected: free-form text with components invites free styling and
   needs a parser dependency; the brief wants designed sections, not documents.

## 5. The design

### 5.1 Pages as data

- One file per page: `src/content/pages/<name>.json`; `home.json` is `/`, every other file name equals its one-segment
  path (`services.json` is `/services`). **Ruling:** paths are one level deep (`/name`). Cost if wrong: nested paths need
  a `[...slug]` route and a file-name rule; a contained change.
- Shape (unknown keys fail):
  `{ "path", "title", "description", "status": "live"|"archived", "menu"?: { "label", "order", "places": ["header"|"footer"|"legal"] }, "blocks": [ { "type", "variant"?, "anchor"?, "content": {...} } ] }`.
- `src/lib/page-files.ts` (node:fs, no aliases, import-free otherwise) reads the folder from `process.cwd()`; Next, the
  scripts, Playwright and Lighthouse CI all use it. `src/lib/routes.ts` keeps its exports (`indexableRoutes`,
  `noindexRoutes`) but derives the live pages from the files, plus `showcaseRoute` (`/blocks`). The sitemap, the menu
  (header, footer, legal line) and the route list all come from the same files. `nav.ts` keeps only `menuLabel`.
- Routes: `src/app/(site)/page.tsx` renders `/`; `src/app/(site)/[slug]/page.tsx` renders the rest with
  `generateStaticParams` over live pages and `dynamicParams = false`; metadata from `pageMetadata()`. The Organization
  JSON-LD stays on `/` only. The old five page files are deleted, and so are `home.ts`, `about.ts`, `services.ts`,
  `privacy.ts` (their strings move verbatim into the JSON). `contact.ts` keeps the form, thanks and 404 copy.
- `src/lib/pages.ts` (Next side) loads the pages and **validates them with the content check at build time**; an invalid
  page fails `next build` with the same plain-words message. So every CI job that builds (check, a11y, lighthouse) already
  enforces the content check, with no workflow edit.
- **Archive, never delete:** `status: "archived"` removes the page from the build, the menu, the sitemap, the a11y and
  Lighthouse lists; the file and its content stay, and setting `live` restores it. A link to an archived page fails the
  content check. `/` and `/contact` (the booking fallback and the form live there) cannot be archived.

### 5.2 The block library

- `src/blocks/schema.ts` (import-free): field kinds `text` (min, max, optional `pattern`), `list` (of a field or of an
  object of fields; min/max items), `object`, `action` (`{ label, href }`), `link`, `image` (`{ src, alt }`), `video`
  (a URL), `boolean`, `choice`; `defineBlock()`; content types are **inferred from the schema** so the component and
  the check can never disagree.
- A definition: `type` (kebab name), `title`, `description` (plain words: what it is for), `fields`, `variants`
  (`[{ name, description }]`, first is the default), `placement` (`position: "first"|"last"|"any"`, `maxPerPage`,
  `rhythm: "hero"|"section"|"compact"`, `joinsHero`), `motion` (below), `fixedAnchor`?, `interactive`? (reason, required
  if the block's folder holds a `"use client"` file), `example` (content that must pass its own schema).
- Layout: `src/blocks/library/<type>/definition.ts` + `<Name>.tsx`; `src/blocks/definitions.ts` lists every library
  definition plus `src/site-blocks/definitions.ts`; `src/blocks/components.tsx` maps type to component (library plus
  `src/site-blocks/components.tsx`). **A site's own blocks live in `src/site-blocks/`**, registered the same way; the
  template ships it with empty lists and a README and never changes those files after a site is created, so template
  updates do not overwrite them. A site block may not reuse a library type name (the check fails).
- Blocks from today's pages (strings unchanged): `hero` (eyebrow?, title, intro?, action?), `highlights` (heading, items
  of title + body; variants `two-column`, `three-column`), `prose` (heading, paragraphs), `faq` (heading, items of
  question + answer), `closing-cta` (heading, body?, action, note?), `contact-form` (the booking column and the form;
  heading, body, buttonLabel, unsetNote; fixed anchor `book`), `steps` (heading, steps of lead + body, emailLabel?),
  `legal-sections` (sections of heading + body, footnote). New: `video`, `video-grid` (5.6).
- **Links** (`action.href`, `link`): an internal path `/name` or `/name#anchor` that resolves to a live page (and an
  anchor on it), `https://` URLs, `mailto:`, `tel:`, or `@booking` (the site's booking link: `schedulerUrl`, else
  `/contact#book`, today's `bookCallHref()`). Never `javascript:`, `data:`, `http:`, `//host` or anything else.
- **Catalog:** `npm run blocks:catalog` writes `docs/BLOCKS.md` (readable) and `docs/blocks.json` (machine-readable:
  every block's description, fields with types/required/limits, variants, placement, motion, example; plus the page-level
  rules: one hero first, one focal animation, link and embed rules). It also rewrites the generated lane 1 list in
  `docs/EDITING-LANES.md` between markers. `check:content` fails when any generated file is stale.

### 5.3 Conversion with no visible change

The five pages become JSON with every string copied exactly. Proof: `npm run report:changes` (before = `main`, after = this
branch, 390 and 1440 wide, reduced motion) for all five pages, plus a new `scripts/compare-screenshots.mjs` that compares
each before/after PNG pixel by pixel (node:zlib PNG decode, no dependency) and reports identical or the changed pixel
count and area. Any difference is fixed or explained in the PR.

### 5.4 The content check (`npm run check:content`, in `check:fast`)

`src/blocks/validate.ts` (pure; inputs are page objects and a small "repo view": does this image exist) returns a list of
plain-words problems naming file, block number and field, for example `services.json, block 3 (faq): "items" has 9
questions; this block takes at most 8.` It checks: page keys, path rules and file name, unique paths, title and
description lengths, status, menu (labels, places, at most 6 header items); every block type known; variant one of the
block's; anchors unique and well formed; content keys known, required present, types, text and item limits; **text is
plain text** (only the two marks `Text` renders: `**bold**` and `[[placeholder]]`; no HTML tags or entities, no markdown
links, no control characters); links as in 5.2; images under `/images/`, existing, jpg/png/webp, alt text real (the
generic-word list is shared with the scope rules); video URLs on the allowlist; placement (first/last/max per page, a
page starts with a `first` block) and **at most one focal (signature) animation per page**. The CLI also validates every
block's example and the catalog freshness. Tests: `scripts/check-content.test.mjs` (fixtures, no network).

### 5.5 Change scope check

- Tier 1: page files `src/content/pages/<name>.json` that pass the content check **at the head commit** (pages and the
  image list are read from git, so the verdict matches the ref), images under `public/images/` (image rules unchanged),
  and plain-data content modules (`contact.ts`, `nav.ts`). Content problems block on `change/` branches.
- Tier 3: everything else, now including `contact-fields.ts` and `routes.ts` (code now), every `src/app/` file, and
  **deleting or renaming a page file** (reason: "archive the page instead").
- The "Flagged for Grant" list is removed (prices, contact details, legal text, links, page changes, size). Bad links are
  now content-check failures instead of flags.
- The new-page JSX grammar (`pageProblem` and its rules) is removed once a search shows nothing else uses it; the
  plain-data parser stays for the content modules. The alt-text finder learns to read `.json` uses (same `{ src, alt }`
  shape). The change report maps a page file to its route, a block folder to the pages using that type plus `/blocks`,
  and shows "page archived" when a page goes from live to archived.

### 5.6 Video and video grid

`src/blocks/embeds.ts` (import-free) is the single allowlist: YouTube (`youtube.com/watch?v=`, `youtu.be/`, `/embed/`,
`/shorts/`, `youtube-nocookie.com/embed/`; 11-character id) and Vimeo (`vimeo.com/<digits>[/<hash>]`,
`player.vimeo.com/video/<digits>`). The embed URL is rebuilt from the parsed id, never the raw input. A poster-style
facade (16:9 box, so no layout shift) shows the title and a play control; no request reaches YouTube or Vimeo until the
visitor presses play (privacy-friendly, loads only when needed). Without JavaScript it is a link that opens the video in a
new tab. With JavaScript the press swaps in `youtube-nocookie.com` or `player.vimeo.com` (`dnt=1`) with `autoplay=1`,
`title` set to the video title for screen readers, and focus moves to the player. Optional `poster` image (`{ src, alt }`,
the image rules apply); without one the facade is a designed tokens-only panel. `video` variants: `wide`, `inset`.
`video-grid`: heading?, 2 to 6 videos; variants `two-column`, `three-column`.
`sync-config` adds the embed origins to `frame-src` and to `Permissions-Policy` `autoplay` (so the press plays at once)
from `embeds.ts`. **Ruling:** these origins are on for every site, so lane 1 video needs no wiring. Cost if wrong: one
setting to make them conditional.

### 5.7 Tokens only (`npm run check:design`, in `check:fast`)

Scans block components (`src/blocks/**`, `src/site-blocks/**`) and the primitives they are built from
(`src/components/hl/**`), plus the showcase route. Fails on: color literals (hex, rgb/hsl/oklch); Tailwind default
palette colors, font families, font sizes (`text-xs`..`text-9xl`), durations, delays, eases, `animate-*`, radii and
shadows outside the tokens; any arbitrary `[value]` except layout tracks (`grid-cols-[...]`), variant brackets
(`aria-[...]:`, `[&...]:`) and `[--x:var(--token)]`; `style=` props; `font-[...]`; padding on a block's `<section>` (the
renderer owns rhythm). The fix list adds the missing tokens to `hl.css`/`globals.css` (type steps such as `text-list`,
`text-label`, measures such as `max-w-measure`, a `split` breakpoint) and moves the glow offsets into CSS; every value
keeps its pixels, so nothing moves. Header and footer are not blocks and stay out of scope (a known limit).

### 5.8 One motion layer

Inventory today: link underline (0.5 s, `--hl-ease`), arrow nudge (150 ms ease-out), card lift (250 ms ease-out), mobile
menu panel (`--duration-feedback`/`--duration-panel`, `--ease-site`), native smooth anchor scroll, the global
reduced-motion switch. No entrance or scroll animation exists. The layer:
- Tokens in `globals.css` `@theme static`: the existing three plus `--duration-underline`, `--ease-underline`,
  `--duration-nudge`, `--duration-lift`, `--ease-hover`, `--motion-enter-distance`, `--motion-enter-range`. Every
  transition and keyframe in `hl.css` uses tokens; `check:design` fails a raw duration there.
- **Entrance (default for every block):** the renderer marks each block after the first `data-motion="enter"`; CSS rises
  it from `--motion-enter-distance` as it scrolls into view, using a CSS scroll-driven animation
  (`animation-timeline: view()`) inside `@supports` and `prefers-reduced-motion: no-preference`. No JavaScript, no scroll
  listener, transform and opacity only (no layout shift), resting state identical. Unsupported browsers and reduced
  motion show the resting state. The first block never animates (it is the first paint and usually the LCP). **Ruling:**
  scroll-driven rather than a time-based reveal, because AGENTS.md forbids JS-gated hidden content. Cost if wrong: swap
  the CSS rule; blocks are unaffected.
- **Ruling (made during the build):** the entrance is a rise with no fade. With a fade, Lighthouse (which does not use
  reduced motion) read the `/services` FAQ below the first screen at near-zero opacity and scored accessibility 96 instead
  of 100; any reader that does not scroll would see faint text. Cost if wrong: a fade can come back once checkers and
  previews are shown to read the resting state.
- **Hover:** the existing underline, arrow and lift, through the primitives. **Scroll:** native only.
- A block declares `motion: { entrance: "default" }`, or `{ entrance: "none", reason }`, or adds `signature: { keyframes,
  reason }` naming an `@keyframes hl-signature-<name>` in `hl.css`. Signature blocks are the page's focal animation, so the
  content check allows one per page. `check:design` checks every keyframe animates only opacity/transform family, every
  signature names a real keyframe, and the global reduced-motion rule is intact. No library block ships a signature in
  this run (the starter has none); a test fixture proves the mechanism.

### 5.9 Arrangement and rhythm

Definitions carry placement (5.2). The renderer (`src/blocks/BlockRenderer.tsx`) wraps each block and sets: spacing from
a rhythm table (`hero`: 72 px top, 64 bottom; `section`: 64/96; `compact`: 48/64; a `joinsHero` block directly after the
hero drops its top padding), the hero glow on the first block, the seam glow on a closing block, and the motion attribute.
This table reproduces today's pages exactly. **Ruling:** no colored bands in this run, because style guide v3 blends
sections with glows; a site whose guide has bands adds a tone to the rhythm table. Cost if wrong: renderer-only change.

### 5.10 Showcase

`/blocks` (noindex, not in the menu or sitemap): every registered block and variant with its example, each under a small
non-heading label; the first hero keeps the page's only H1, other hero variants render an H2. Added to the a11y page list,
to the change report, and to Lighthouse through an `assertMatrix` entry with the same performance, accessibility and best
practices thresholds and no SEO assertion (a noindex page fails "is crawlable" by design). Existing pages keep all four
assertions unchanged. **Ruling:** this is coverage added, not a threshold changed; flagged on the "Needs your eyes" line.

### 5.11 Docs and process

`docs/BLOCKS.md` and `docs/blocks.json` (generated); `docs/EDITING-LANES.md` (client words; lane 1 list generated from the
library; lane 2 and 3 marked "coming" or "Huston Logic builds it"); `docs/CONVERT-TO-BLOCKS.md` (steps, the helper
scripts, registering site blocks, proving no visible change, a ready-to-paste run message); `docs/PROCESS.md` rule 16 (the
new-block gate, with its why); updates to `docs/CHANGE-SCOPE.md`, `AGENTS.md` (architecture, content and motion rules),
`README.md` (CSP and embed origins), and STATUS.md at the end. CI's check job runs `check:content` through the build; an
explicit `npm run check:content` and `npm run check:design` step is written as a `ci.yml.proposed` for Grant.

## 6. Builder check answers

A fresh reviewer read this design as a builder. Its questions, settled:

- **What "no visible change" means:** pixel-identical before/after screenshots of the five pages at 390 and 1440 wide is
  the target; a difference is fixed, or explained in the PR when it is a deliberate fix. The change report and the a11y
  check both run with reduced motion (`reducedMotion: "reduce"` in `scripts/change-report.mjs` and
  `playwright.config.ts`), so they see the resting state. Lighthouse does not, but the first block never animates and the
  entrance uses transform and opacity only, so neither LCP's element nor CLS changes. The baseline build of `main` is
  taken before any edit.
- **Contact:** `ContactForm` is unchanged and wrapped by the `contact-form` block. The "prefer email" line with the site
  email is the `steps` block's `emailLabel` (the address comes from `site.config.ts`, as today). The booking link, email,
  LinkedIn and Turnstile stay wiring in `site.config.ts`; header and footer are layout, not blocks.
- **SEO fields:** today every page calls `pageMetadata({ title, description, path })` and nothing else; only the thanks
  page (a code page) is noindex. The page schema covers that losslessly.
- **Menu:** `nav.ts` today holds only page links (header: Services, About, Contact; footer: the same; legal: Privacy) and
  `menuLabel`. The footer's email and LinkedIn rows come from `site.config.ts` and stay there.
- **Routes:** `/contact` is a page file; `/contact/thanks` stays a static code route, which Next prefers over `[slug]`.
  Verified by the build.
- **Plan:** one plan file, at most 150 lines.
- **Lighthouse:** `lighthouserc.cjs` is not owner-only; LHCI supports `assertMatrix`. Ruling in 5.10 stands.
- **Limits** (for example 8 FAQ items, 6 header links): the builder's guardrail calls, made for designed layouts.

## 7. Left to the builder

Exact field limits (generous enough for real copy, tight enough to keep layouts designed; current data must pass), file
names inside each block folder, the TypeScript inference shape, test fixture design, how the facade's play control is
drawn (tokens only, AA contrast, 44 px target), and the showcase label style.
