# Pages as blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every page is one JSON file of designed blocks, built by one renderer and judged by a content check.
**Architecture:** import-free block schema and validator (Node and Next share them), a library of block definitions plus components, a renderer that owns rhythm and motion, JSON pages, updated scope and report tools.
**Tech Stack:** Next 16 static export, React 19, Tailwind v4, Node 22 test runner, TypeScript parser (existing dev dep).
**Spec:** `docs/superpowers/specs/2026-11-25-pages-as-blocks-design.md` (read it first; section numbers below refer to it).

## Global Constraints
- No new dependencies. No edits under `.github/` or `.claude/` (write `<file>.proposed` to the scratchpad instead).
- Files Node scripts import: no `@/` aliases, relative imports with `.ts`, no enums or parameter properties.
- Every string on the five pages is copied verbatim; no visible change (spec 5.3, 6).
- Commit per task after `npm run check:fast`; one plain command per Bash call (CLAUDE.md "Command style").
- Messages from checks are plain words naming file, block number and field.

## Review Focus
- A page JSON with a trailing comma or wrong type at the top: the check says which file and why, never a stack trace (Task 1 test `reports unreadable JSON by file`).
- A link to `/about#story` after `/about` is archived, or to an anchor that is not on the page: fails (Task 1 tests `archived target`, `missing anchor`).
- A YouTube URL with extra params (`&t=30s`, `si=`) or a `youtube.com/watch?v=` with a 10-char id: first passes, second fails (Task 1 `parseVideoUrl` cases).
- A site block reusing a library type name, or an example that breaks its own schema: registry check fails (Task 3 test `registry problems`).
- A page with two `video` signature-free blocks and one signature fixture block twice: the second focal animation fails (Task 1 `one focal animation`).

---

### Task 1: Schema, embeds, validator, page files
**Files:** Create `src/blocks/schema.ts`, `src/blocks/embeds.ts`, `src/blocks/validate.ts`, `src/lib/page-files.ts`, `scripts/check-content.test.mjs`.
**Interfaces (Produces):**
- `schema.ts`: field kinds `text {max, min?, required?}`, `list {of, min, max}`, `object {fields}`, `action {labelMax}` (`{label, href}`), `image` (`{src, alt}`), `video` (URL string), `choice {options}`, `boolean`; every field has `label` and `help?`. `Placement = {position: "first"|"last"|"any", maxPerPage, rhythm: "hero"|"section"|"compact", joinsHero?}`. `Motion = {entrance: "default"} | {entrance: "none", reason} ` plus optional `signature: {keyframes, reason}`. `defineBlock<const F>(def): BlockDefinition<F>`; `ContentOf<F>` inferred. `BlockDefinition` also has `type, title, description, variants: readonly {name, description}[], fixedAnchor?, interactive?, example, source: "library"|"site"`. `PageData`, `BlockInstance = {type, variant?, anchor?, content}`. `MENU_PLACES`, `RESERVED_PATHS` (`/blocks`, `/api`, `/contact/thanks`, `/og.png`, `/icon.svg`, `/sitemap.xml`, `/robots.txt`), `REQUIRED_LIVE = ["/", "/contact"]`, `BOOKING_LINK = "@booking"`.
- `embeds.ts`: `parseVideoUrl(url): {provider: "youtube"|"vimeo", id, hash?} | null`, `embedUrl(v)` (nocookie / `player.vimeo.com` with `dnt=1`, `autoplay=1`), `watchUrl(v)`, `embedOrigins`.
- `validate.ts`: `validatePages(files: {file, data}[], registry, repo: {imageExists(src): boolean}): string[]`; `validateContent(def, content, where, ctx): string[]`; `validateRegistry(registry): string[]`.
- `page-files.ts`: `PAGES_DIR = "src/content/pages"`, `readPageFiles(root = process.cwd()): {file, data, error?}[]`, `livePages(root?)`, `pathForFile(file)` (`home.json` -> `/`).
- [ ] Step 1: tests (fixture registry inside the test): `accepts a valid page`, `reports unreadable JSON by file`, `unknown block type`, `unknown field`, `missing required`, `text too long`, `too many items`, `HTML or markdown link in text`, `javascript: and data: links`, `http: link`, `internal link to missing page`, `archived target`, `missing anchor`, `@booking accepted`, `image missing or generic alt`, `video not on allowlist`, `hero not first`, `closing not last`, `maxPerPage`, `one focal animation`, `duplicate path`, `file name must match path`, `required pages live`, `reserved path`, plus `parseVideoUrl` cases (watch, youtu.be, shorts, embed, nocookie, `&t=30s`, vimeo with hash, bad ids, other hosts).
- [ ] Step 2: `node --test scripts/check-content.test.mjs` fails (modules missing). Step 3: implement. Step 4: passes.
- [ ] Step 5: commit `feat(blocks): schema, video allowlist and content validator`.

### Task 2: Tokens and the motion layer
**Files:** Modify `src/app/hl.css`, `src/app/globals.css`, every `src/components/hl/*.tsx`. Create `scripts/design-rules.mjs`, `scripts/check-design.mjs`, `scripts/check-design.test.mjs`, `scripts/compare-screenshots.mjs`, `scripts/compare-screenshots.test.mjs`. Modify `package.json` (scripts `check:design`, `compare:screens`).
**Interfaces (Produces):** `designProblems(path, text): string[]` (spec 5.7 rules), `cssMotionProblems(css): string[]` (raw durations in transitions/animations outside token definitions; keyframes animating anything but opacity/transform/translate/scale/rotate/clip-path; reduced-motion block missing), `motionDeclarationProblems(registry, css): string[]` (none needs reason >= 20 chars; signature keyframes `hl-signature-<name>` exist), `decodePng(buf) -> {width, height, data}`, `comparePngs(a, b) -> {identical, changedPixels, box}`. CLI `compare-screenshots.mjs <dir>` walks `<dir>/<page>/before-*.png` vs `after-*.png`.
- [ ] Step 1: tests: each banned pattern fails with its reason (hex, `text-[17px]`, `text-lg`, `bg-red-500`, `font-sans`, `duration-300`, `ease-in`, `animate-spin`, `style={{`, `py-16` on `<section`), each allowed form passes (`grid-cols-[5fr_7fr]`, `aria-[invalid=true]:border-rust`, `[&::-webkit-details-marker]:hidden`, `[--hl-u-color:var(--hl-silver)]`, `bg-ink/40`); PNG identical and one-pixel-different cases (encode test PNGs with node:zlib).
- [ ] Step 2: add tokens (spec 5.7, 5.8): text steps `list` 17/1.55, `control` 17, `label` 15, `chip` 16, `card-title` 28/1.25/-0.03em, `subhead` 24/1.25, `question` 20/1.375; containers `page` 1320px, `measure` 64ch, `intro` 60ch, `narrow` 48ch, `answer` 66ch, `faq` 760px, `heading` 17em, `title` 18em; breakpoint `split` 900px; `--color-white: var(--hl-white)`; spacing `dot` 0.6em; motion tokens `--duration-underline` 500ms, `--ease-underline`, `--duration-nudge` 150ms, `--duration-lift` 250ms, `--ease-hover: ease-out`, `--motion-enter-distance` 16px, `--motion-enter-range` 240px; glow position classes `.hl-glow-hero`, `.hl-glow-closing`. Entrance rule and `@keyframes hl-enter` (spec 5.8).
- [ ] Step 3: replace every arbitrary value in `src/components/hl/*.tsx` with the token or the spacing step of the same pixels (72px -> 18, 54px -> 13.5 ...). `npm run check:design` passes; `npm run build`.
- [ ] Step 4: `npm run report:changes -- --base-out <scratchpad>/before-out` then `npm run compare:screens -- change-report`: every page identical. Commit `feat(design): tokens-only primitives, motion tokens, design check`.

### Task 3: Library blocks and the renderer
**Files:** Create `src/blocks/library/<type>/definition.ts` and component for `hero`, `highlights`, `prose`, `faq`, `closing-cta`, `contact-form`, `steps`, `legal-sections`; `src/blocks/definitions.ts` (`registry`), `src/blocks/components.tsx` (`blockComponents: Record<string, BlockComponent>`), `src/blocks/rhythm.ts` (`spacingFor(def, index, previous)`), `src/blocks/BlockRenderer.tsx`, `src/site-blocks/{definitions.ts,components.tsx,README.md}`. Refactor `PageHero` into `HeroContent` (shared by the hero block, thanks and 404).
**Interfaces:** `BlockProps<C> = {content: C, variant: string, anchor?: string, headingId: string, primary: boolean}`; `BlockRenderer({blocks})` wraps each in `div.relative` with spacing, glow (hero first, seam on `position: "last"`), `data-motion="enter"` after index 0 unless `entrance: "none"`.
- [ ] Step 1: test `registry problems` in `check-content.test.mjs` (duplicate type, bad example, empty variants) and `every library example validates`.
- [ ] Step 2: implement; content limits fit today's data (spec 7). Commit `feat(blocks): library blocks, registry and renderer`.

### Task 4: Pages as data
**Files:** Create `src/content/pages/{home,services,about,contact,privacy}.json`, `src/lib/pages.ts` (`getPages()`, `getPage(path)`, `getMenu(place)`; throws on validation problems), `src/app/(site)/[slug]/page.tsx`. Modify `src/app/(site)/page.tsx`, `src/lib/routes.ts` (`showcaseRoute`), `src/app/sitemap.ts`, `src/content/nav.ts` (only `menuLabel`), `Header.tsx`/`HeaderNav.tsx` (menu as props), `Footer.tsx` (footer and legal menus). Delete the four old page files and `home.ts`, `about.ts`, `services.ts`, `privacy.ts`. Create `scripts/check-content.mjs`; add `check:content` to `check:fast`.
- [ ] Step 1: convert strings verbatim; anchors `highlights`, `services`, `story`, `faq`, `next` keep the old heading ids.
- [ ] Step 2: `npm run build`, then report + compare as in Task 2 step 4: identical. Commit `feat(pages): pages as JSON blocks, menu and sitemap from page data`.

### Task 5: Video blocks, CSP and the showcase
**Files:** Create `src/blocks/library/video/*`, `src/blocks/library/video-grid/*` (client facade, `interactive` reason), `src/app/(site)/blocks/page.tsx`, `src/content/showcase.ts`. Modify `scripts/sync-config.mjs` (frame-src and `autoplay=(...)` from `embedOrigins`), `public/_headers` (via `npm run sync:config`), `src/lib/routes.ts` (showcase in `noindexRoutes`), `lighthouserc.cjs` (`assertMatrix`, spec 5.10), README CSP note.
- [ ] Step 1: build, `npm run test:a11y`, local `npm run test:lighthouse` (new client script). Commit `feat(blocks): video, video grid and the block showcase`.

### Task 6: Scope check and change report
**Files:** Modify `scripts/change-scope-rules.mjs`, `scripts/check-change-scope.mjs`, `scripts/change-scope-code.mjs`, `scripts/image-alt.mjs`, `scripts/change-report.mjs` and their tests (spec 5.5).
- [ ] Step 1: tests: page JSON passing/failing content check at head is tier 1 / blocking problem; deleting or renaming a page file tier 3 "archive the page instead"; `contact-fields.ts`, `routes.ts`, any `src/app/` file tier 3; no flags section; alt text found in JSON; report maps page JSON and block folders to routes and says "page archived". Remove grammar code after `grep -rn pageProblem scripts src` shows only its own uses. Commit `feat(scope): pages as data in the change scope check and report`.

### Task 7: Catalog and docs
**Files:** Create `scripts/blocks-catalog.mjs` (`--check`; writes `docs/BLOCKS.md`, `docs/blocks.json`, the lane 1 list in `docs/EDITING-LANES.md`), `docs/EDITING-LANES.md`, `docs/CONVERT-TO-BLOCKS.md`. Modify `docs/PROCESS.md` (rule 16), `docs/CHANGE-SCOPE.md`, `AGENTS.md`, `README.md`; `check:content` runs the catalog `--check`. Write `ci.yml.proposed` to the scratchpad. Commit `docs: block catalog, editing lanes, conversion guide, new-block gate`.

### Task 8: Proof, review, PR
- [ ] Full `npm run check`; screenshots of all pages identical; review-code, review-a11y, review-security on the branch; design critique of `/blocks` at 1440 and 390; fix findings; STATUS.md with timing table; PR; auto-merge per CLAUDE.md.
