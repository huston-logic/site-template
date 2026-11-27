# Catalog and quotes: plan

Design: `docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md` (rulings R1 to R23). One branch,
`feat/catalog`, one PR. Process run: Opus plans, integrates and reviews; Sonnet implements; Haiku drafts docs.

## Phase 1: the shared core (one Sonnet, main checkout, committed before phase 2)

1. `src/catalog/schema.ts`: types (`CatalogSettings`, `PricingTable`, `CatalogItem`, `Selection`, `PriceResult`,
   `CatalogData`), limits from R2 to R4, `QUOTE_FORM_ID = "quote"`, `CATALOG_DATA_PATH = "/catalog.json"`,
   `cardPathFor(src)`, `itemPathFor(pagePath, slug)`.
2. `src/catalog/price.ts`: `resolveSelection`, `priceRange`, `formatRange`, `defaultRange` (R6), with tests for every
   step: ask, exact override, add and multiply order, per person, spread and rounding direction, refusals.
3. `src/catalog/validate.ts`: `validateCatalogSettings`, `validatePricing`, the cross-file rules (R3 to R5, R21).
4. Collection kind `catalog` (R2) in `src/collections/*`; field kinds `price`, `filter-values`, `option-groups` in
   `src/blocks/schema.ts` and `validate.ts` (context carries the catalog settings and pricing); settings names
   `catalog` and `pricing`; `validateSite` rules (R21); `content-files.ts` reads them.
5. Template files: `src/content/catalog.json`, `src/content/pricing.json` (empty catalog), `src/content/forms/quote.json`
   (live; `reply`), forms schema `reply` for `quote` only, `selection` reserved, `quote` refused in a `form` block;
   `npm run sync:config` regenerates the registry.
6. `src/catalog/example.ts` (R22) and `src/catalog/data.ts` (`buildCatalogData` for `/catalog.json`).
7. `src/content/catalog.ts`: interface words (Estimate, About, to, Price on request, Filter, Clear all, Show N more,
   the empty state, the no-JavaScript line, the quote summary words, the estimate email's fixed lines).
8. `npm run check:fast` passes; commit.

## Phase 2: four Sonnet implementers in parallel worktrees (disjoint files)

**A. Site (src/app, src/blocks/library, src/components, tests/):**
`[slug]` to `[...path]` (R9); `catalog` and `quote-builder` blocks with definitions, examples and components (R10,
R13); `CatalogFilters` island (R11); item view (R12); quote builder and quote form panel (posting `selection`);
`/blocks/catalog/[slug]` showcase items; `/catalog.json` route; `routes.ts` (item pages in the sitemap, one item page
audited); tracking calls; `tests/tracking` spec for view_item, quote_start, lead; a11y coverage; `check:design` clean.

**B. Worker (worker/*.ts except worker/editor, worker/uploads/*):**
quote extras in `worker/forms.ts` (R14, R15), `env.ASSETS` read with a fake in tests, delivery lines and the estimate
email in `worker/messages.ts` (R16), forged range, unknown option, unknown item, out-of-range people and asset failure
tests; one end-to-end test where Sheet row, owner email and visitor email carry the same range and source; card file
made at upload time in `worker/uploads/` (R8) with tests.

**C. Editor (worker/editor/*):**
catalog collection and the two settings targets, `scale_price` (R18), price impact lines in the change list, card files
in publish, read tools, instructions; `worker/editor/catalog-acceptance.test.ts` with the five owner sayings: add an
item with a photo, raise 18k gold by 5 percent, add a filter Style with Vintage and Modern, hide the price on this item,
archive an item.

**D. Scripts (scripts/*):**
`import-catalog.mjs` with `catalog-csv.mjs` (parser), mapping, dry run and report (R20) and a Chrome image step behind
an injectable function; `catalog-fixture.mjs` (R23); scope check and change report rules (R21); the example photos'
card files; `blocks-catalog.mjs` documents the catalog and pricing settings; `package.json` script `import:catalog`.

Each implementer runs `npm run check:fast` in its own worktree and commits there.

## Phase 3: integrate and verify (Opus)

1. Merge A to D into `feat/catalog`; fix conflicts; `npm run check:fast`, `npm run check`.
2. Build the 500-item fixture in a throwaway worktree; record time, size and file counts in the design's "Measured".
3. Local preview: filter by two filters, open an item, pick options, request a quote against a mocked Worker; no-JS
   view; `npm run test:tracking` with the fixture IDs; `npm run test:a11y`; local Lighthouse on `/blocks` and an item
   page (new scripts over 1 KB).
4. Docs (Haiku): EDITING.md, EDITING-LANES.md, TRACKING.md, CHANGE-SCOPE.md, BLOCKS.md (generated), AGENTS.md
   architecture lines, README; STATUS.md at the end.
5. Reviews: review-code, review-a11y, review-security once each; design critique from screenshots at 1440 and 390 of
   the gallery, the item view and the quote builder. Fix, re-check.
6. PR, `gh pr merge <n> --auto --squash`, STATUS.md with the timing table.

## Done when

The brief's "Done when" list, each item checked with evidence in the PR description.
