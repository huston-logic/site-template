# Collections and brand settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Sonnet implements each task in
> waves; one review at the end, per CLAUDE.md "Autonomous runs"). Steps use checkbox (`- [ ]`) syntax.

**Goal:** owners keep a blog, videos, episodes, testimonials and a team, and change business details, brand and a notice,
by chatting, through the existing propose, preview, publish path. **Architecture:** one JSON file per item and per
settings file in `src/content/`; import-free shared modules (`src/collections/`, `src/brand/`, `src/settings/`) judge
them for the build, `check:content` and the Worker; list blocks read items at build time; `palette.css` and `fonts.ts` are
generated from `brand.json`. **Tech:** TypeScript, Next static export, Workers, Node test runner, Playwright+axe.
**Spec:** `docs/superpowers/specs/2026-11-25-collections-and-brand-design.md` (rulings 1 to 30 and the builder check are binding).

## Global Constraints

- Branch `feat/collections-and-brand`, one PR. Commit per task after `npm run check:fast` (in your own worktree). No new dependency. No owner-only path.
- Shared modules are import-free except each other, with explicit `.ts` imports; never `site.ts`, Node, Next or a library.
- Text is plain: only `**bold**` and `[[placeholder]]`; never `dangerouslySetInnerHTML`; links follow the existing link rules.
- Blocks: tokens only (`npm run check:design`), renderer-owned spacing and entrance, no layout shift, `npm run blocks:catalog` after any definition change.
- Tests use fakes only (fake GitHub, fake R2, fake Images); no network, no real credentials. Never weaken a test, threshold or axe rule.
- Visitor-facing UI words (empty text, "Draft: not on your live site", pager words) live in content modules or page/item data, not JSX.

## Review Focus

- A production build (`WORKERS_CI=1`, `WORKERS_CI_BRANCH=main`) builds no draft page, lists none in a block, the sitemap or the feed (T3, T4 tests).
- A hostile `brand.json` (`"#fff;}body{x"`, font id `"../x"`, logo `/images/a.svg`) is refused by `validateBrand`, and the generators throw on it (T2 tests).
- A post body with a `javascript:` link, a link to an archived page, an inline object with an extra key or 40,001 characters is refused (T1 tests).
- Pagination: 10 live posts make no `/blog/page/2`; 11 make it with one post; `/blog/page/1` is never generated (T4 tests).
- An item or settings file changed on `main` after proposing makes publish refuse with "the site moved" (T7 test).

## Wave 1 (parallel worktrees): T1, T2. Wave 2: T3. Wave 3 (parallel): T4, T5, T6, T7. Wave 4: T8, then T9 docs.

### Task 1: Collections core (shared rules)

**Files:** Modify `src/blocks/schema.ts`, `src/blocks/validate.ts`, `src/blocks/embeds.ts`, `scripts/finish-build.mjs`. Create `src/collections/schema.ts`, `src/collections/definitions.ts`, `src/collections/validate.ts`, `src/lib/build-target.ts`, the five example items `src/content/collections/{posts,videos,episodes,testimonials,team}/example.json` (spec ruling 5), tests beside each (`*.test.ts`).
**Produces:**
- schema.ts: field kinds `{kind:"date"}` (value string `YYYY-MM-DD`), `{kind:"number"; min; max}` (whole number), `{kind:"audio"}` (string), `{kind:"body"; maxParts: 200; maxChars: 40000}` (value `BodyPart[]`); `type Inline = string | (string | { text: string; href: string })[]`; `BodyPart` per ruling 6; `Placement.onlyOn?: string`; `BlockDefinition.collection?: CollectionKind`.
- collections/schema.ts: `COLLECTION_KINDS = ["posts","videos","episodes","testimonials","team"] as const`, `CollectionKind`, `ITEM_STATUSES = ["draft","live","archived"] as const`, `ItemStatus`, `SLUG_RE` (ruling 2, max 60), `RESERVED_POST_SLUGS = ["page","feed"]`, `ITEM_DIR = "src/content/collections"`, `itemFilePath(kind, slug): string`, `type ItemFile = { kind: string; slug: string; data: unknown; error?: string }`, `type LoadedItem = { kind: CollectionKind; slug: string; status: ItemStatus; data: Record<string, unknown> }`, `type CollectionDefinition = { kind; title; singular; description; fields: Fields; sort: "date" | "order"; labelField: string; example: unknown }`.
- definitions.ts: `collections: CollectionDefinition[]` (fields and limits from rulings 7 and 8), `collectionFor(kind): CollectionDefinition | undefined`.
- collections/validate.ts: `validateItems(items: ItemFile[], ctx: Context): string[]` (keys, status, slug, reserved slugs, fields through the block field validator, unique slugs per kind, body rules); `sortItems(def, items: LoadedItem[]): LoadedItem[]`; `visibleItems(items, { drafts: boolean }): LoadedItem[]` (never archived; drafts only when asked).
- validate.ts: exports `validateFields(fields, value, where, ctx): string[]` used by items; handles the four new kinds; `onlyOn` placement rule.
- embeds.ts (ruling 10): `AudioRef`, `parseAudioUrl(input: unknown): AudioRef | null`, `audioEmbedUrl(ref)`, `audioListenUrl(ref)`, `AUDIO_PLAYER_HEIGHT = { spotify: 152, apple: 175 }`, `audioProviders`; `embedOrigins` adds `https://open.spotify.com` and `https://embed.podcasts.apple.com`.
- build-target.ts: `isProductionBuild(env: Record<string, string | undefined>, productionBranch: string): boolean` (the rule `finish-build.mjs` uses today, which now imports it).
- [ ] Tests first: each new field kind's limits; `parseAudioUrl` accepts the Spotify episode URL with and without `intl-de/` and `?si=`, and an Apple episode URL; refuses a Spotify show URL, Apple without `?i=`, `http:`, a lookalike host; embed URLs rebuilt from parts; Review Focus line 3; `visibleItems` with and without drafts; `isProductionBuild` matches the old finish-build cases (existing `finish-build.test.mjs` still passes).
- [ ] Implement; add the test globs `src/collections/*.test.ts src/brand/*.test.ts src/settings/*.test.ts` to `test:worker` if not present; `npm run sync:config` (headers gain the two origins); `npm run check:fast`; commit `feat: collections core, audio allowlist, build target`.

### Task 2: Brand and settings core (shared rules)

**Files:** Create `src/brand/color.ts`, `src/brand/contrast-pairs.ts`, `src/brand/derive.ts`, `src/brand/fonts.ts`, `src/brand/palette.ts`, `src/settings/brand.ts`, `src/settings/business.ts`, `src/settings/notice.ts`, `src/content/brand.json` (today's 13 colors, fonts outfit/inter/newsreader, logo null), `src/content/business.json` (placeholders as in `site.config.ts` today), `src/content/notice.json` (`{"text":"","endsOn":null}`), tests beside each.
**Produces:**
- color.ts: `parseHex(s): RGB | null` (only `#rrggbb`), `toHex(rgb)`, `toOklch(hex)`, `fromOklch({ l, c, h }): string` (reduce c until in sRGB), `contrastRatio(a, b): number` (WCAG 2.2).
- contrast-pairs.ts: `COLOR_TOKENS` (the 13 keys of `theme.colors` today), `type Palette = Record<ColorToken, string>`, `CONTRAST_PAIRS: { fg; bg; min: 4.5 | 3; where: string }[]` found by reading every `text-*`/`bg-*`/border/ring use in `src/components` and `src/blocks`; `failingPairs(p: Palette): { fg; bg; ratio; min; where }[]`.
- derive.ts (ruling 17, builder check 2): `deriveFromBrand(current: Palette, brand: string): Palette`, `nearestPassing(current: Palette, role: "brand" | "accent", requested: string): string | null`, `TEMPLATE_COMPANIONS`.
- fonts.ts (ruling 19): `FONT_ROLES`, `CURATED_FONTS: Record<FontRole, { id; family; label; axes?: string[] }[]>`, `fontsModule(choice: Record<FontRole, string>): string` (today's `fonts.ts` text for the defaults, except accent `preload: false`; throws on an unknown id).
- palette.ts: `paletteCss(colors: Palette): string` (the whole generated file: header comment plus `:root { --hl-<kebab>: <hex>; ... }`; throws on a bad hex).
- settings/brand.ts: `type BrandData`, `validateBrand(data: unknown, repo: Repo): string[]` (ruling 18 reasons with the nearest color, ruling 20 logo rules, `/^\/images\/uploads\/[a-z0-9]{8}\.webp$/`).
- settings/business.ts (rulings 15, 16): `type BusinessData`, `SOCIAL_NETWORKS` (id, label, hosts), `validateBusiness(data: unknown, ctx: Context): string[]`, `formatHours(hours): { days: string; time: string }[]`, `telHref(phone: string): string | null`.
- settings/notice.ts (ruling 22): `type NoticeData`, `validateNotice(data: unknown, ctx: Context): string[]`, `todayIn(timeZone: string, now: Date): string`, `noticeShows(n: NoticeData, today: string): boolean`.
- [ ] Tests first: the template palette passes every pair; a light brand color (`#9fc5ff`) is refused with a `#rrggbb` suggestion that itself passes after derivation; a grey brand color derives greys; Review Focus line 2; every curated font exists in Next's `font-data.json` as variable with latin (italic for accent); `fontsModule(defaults)` equals today's `src/lib/fonts.ts` except accent preload; `formatHours` groups Mon to Thu 9 to 5, Fri 9 to 3, Sat and Sun closed; `telHref("555 0142") === "tel:5550142"`; Instagram URL on `instagram.com` passes, on `evil.com` fails; `noticeShows` true on `endsOn`, false the day after; `todayIn("America/Chicago", 2026-12-27T03:00Z) === "2026-12-26"`.
- [ ] Implement; `npm run check:fast`; commit `feat: brand, business and notice rules`.

### Task 3: One site validator and the loaders (after Wave 1 merges)

**Files:** Create `src/collections/site-validate.ts`, `src/lib/content-files.ts`, `src/lib/collections.ts`, `src/lib/settings.ts`, `src/lib/drafts.ts`; modify `src/lib/pages.ts`, `src/lib/page-files.ts` if shared reading fits; tests.
**Produces:** `validateSite(input: { pages: PageFile[]; items: ItemFile[]; business: unknown; brand: unknown; notice: unknown }, registry, repo, extra): string[]` (all validators plus cross rules: a live post needs live `/blog` holding `post-index`; `post-index` only on `/blog`; item links use the page index); `readItemFiles(root?): ItemFile[]` and `readSettingsFiles(root?)` (plain Node loadable, like `page-files.ts`); `showDrafts(): boolean` (`!isProductionBuild(process.env, siteConfig.domain.productionBranch)`); `getItems(kind): LoadedItem[]` (visible, sorted), `getItem(kind, slug)`, `getBusiness()`, `getBrand()`, `getNotice()`; `pages.ts` throws on any `validateSite` problem at build.
- [ ] Tests: a live post without `/blog` fails; Review Focus line 1 for `getItems` under a production env; run `npm run check:fast`; commit `feat: one site validator and content loaders`.

### Task 4: Blog (pages, pagination, feed, post blocks, audit routes)

**Files:** Create `src/app/(site)/blog/page.tsx`, `blog/[slug]/page.tsx`, `blog/page/[n]/page.tsx`, `blog/feed.xml/route.ts`, `src/lib/feed.ts`, `src/lib/blog.ts` (`postPages(posts, perPage = 10)`), `src/components/hl/PostBody.tsx`, `PostCard.tsx`, `src/blocks/library/latest-posts/`, `src/blocks/library/post-index/`, `src/content/pages/blog.json`, `src/content/blog.ts` (UI words); modify `src/blocks/BlockRenderer.tsx`, `src/blocks/types.ts`, the showcase page, `src/app/(site)/[slug]/page.tsx` (skip `/blog`), `src/lib/routes.ts`, `src/app/sitemap.ts`, `lighthouserc.cjs`, `tests/a11y/site.a11y.spec.ts`, `docs/proposals/content-fast-lane-files/lighthouserc.cjs.proposed`, registry files.
**Produces:** `BlockProps` gains `items: readonly LoadedItem[]` (empty for non-list blocks); the renderer resolves `getItems(def.collection)` and leaves out a list block with no items (except `post-index`); the showcase passes `collectionFor(kind).example` items; `rssFeed({ site, posts }): string`, `xmlEscape(s)`; `auditRoutes` and the new `indexableRoutes` (ruling 14).
- [ ] Tests: Review Focus line 4; feed escapes `<&"'`, holds only live posts with absolute links; draft post page has `noindex` and the draft tag; post page JSON-LD has the real date. `npm run check` builds `/blog`, `/blog/example`, `/blog/feed.xml`; commit `feat: blog pages, feed and post blocks`.

### Task 5: List blocks for videos, episodes, testimonials and team

**Files:** Create `src/blocks/library/{video-list,episode-list,testimonials,team}/` (definition, component), `src/blocks/library/episode-list/AudioFacade.tsx` (`"use client"`, `interactive` reason set); modify registry files.
**Consumes:** `BlockProps.items` (T4 contract), `parseAudioUrl`, `audioEmbedUrl`, `AUDIO_PLAYER_HEIGHT`, the existing `VideoFacade`. Variants and fields per ruling 11.
- [ ] Tests: the facade renders a link with no iframe before play and reserves the provider's height; `npm run check:content` and `check:design` pass; commit `feat: video, episode, testimonial and team sections`.

### Task 6: Business details, brand and notice on the site

**Files:** Create `src/app/palette.css` (generated), `src/blocks/library/business-details/`, `src/components/layout/Notice.tsx`; modify `scripts/sync-config.mjs` (writes `palette.css` and `fonts.ts` from `brand.json` with `paletteCss`/`fontsModule`; stops writing `hl.css`), `scripts/config-rules.mjs`, `src/app/hl.css` (palette block removed), `src/app/layout.tsx` (imports `palette.css` first), `site.config.ts` (remove `theme`, `brand.logo`, `owner.phone`, `contact.linkedInUrl`; add `business.timeZone: "UTC"`), `src/content/site.ts`, `src/content/providers.ts`, `src/components/layout/{Logo,Footer,Header,SiteChrome}.tsx`, `src/lib/site-organization.ts`, `src/lib/metadata.ts` (`siteName`), `scripts/check-placeholders.mjs`, `scripts/make-example-photos.mjs`, `worker/config.ts` (any value read from removed keys moves to a wiring key, for example `contact.emailColors`), their tests.
- [ ] Tests: `check:config` fails when `palette.css` or `fonts.ts` differ from `brand.json`; Logo renders an image with width and height when `brand.logo` is set, the name as text otherwise; the notice shows above the header only while `noticeShows`; the footer reads phone, email and socials from `business.json`. Commit `feat: business details, brand files and site notice`.

### Task 7: Editor tools for collections, business, brand and notice

**Files:** Modify `worker/editor/{operations,site-reader,service,change-list,tools,tool-schemas,read-tools,instructions,types,uploads}.ts`; create `worker/editor/collections-acceptance.test.ts` and unit tests.
**Consumes:** `validateSite`, `deriveFromBrand`, `nearestPassing`, `failingPairs`, `paletteCss`, `fontsModule`, `CURATED_FONTS`, `itemFilePath`, `collections`.
**Produces:** rulings 23 to 27: target-taking `set`/`insert_item`/`remove_item`, `add_item`, `set_item_status`, `set_brand_color`, `set_font`; `upload:<id>` in items and `/logo` (size from the upload record); a brand proposal commits `brand.json`, `src/app/palette.css` and `src/lib/fonts.ts`; the snapshot records item and settings trees for the stale check; publish refuses a brand proposal with no preview; tools `list_collections`, `get_collection`, `get_item`, `get_settings`.
- [ ] Tests: one test per acceptance saying (spec list, 1 to 7), each asserting the change-list words and the committed paths; a refused light brand color names the pair and a passing suggestion; Review Focus line 5; a 6th page or 11th item refused. Commit `feat(editor): collections, business, brand and notice tools`.

### Task 8: Checks, report and catalog

**Files:** Modify `scripts/check-content.mjs`, `scripts/change-scope-rules.mjs`, `scripts/check-change-scope.mjs`, `scripts/change-report.mjs`, `scripts/blocks-catalog.mjs`, their tests, `scripts/content-lane.test.mjs`.
- [ ] Rulings 28 to 30: tests for tier 1 item, settings and generated files (byte-equal only), tier 3 for a deleted item, an unknown kind, a nested file, a hand-edited `palette.css`; report mapping; catalog sections; content lane returns null for `brand.json`. `npm run blocks:catalog`; commit `feat: scope, content check, report and catalog know collections and settings`.

### Task 9: Docs (Haiku)

- [ ] Update `docs/EDITING.md` (tools table, what works, Known limits, the ready-to-paste "Add collections and brand settings" message), `docs/EDITING-LANES.md`, `docs/CONVERT-TO-BLOCKS.md`, `docs/CHANGE-SCOPE.md`, `AGENTS.md` (Worker-allowed modules, files the editor writes), `docs/STYLE-GUIDE.md` §2 and §3 pointers; commit `docs: collections and brand settings`.
