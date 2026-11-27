# Catalog, price ranges and quotes: design

Process run "Catalog and quotes", 2026-11-27. Grant's brief is the approval of the direction; where it left something
open the call is a numbered **ruling** with its cost if wrong. Repo rules: AGENTS.md, CLAUDE.md, docs/PROCESS.md.

## Why

A business that sells from a portfolio (a jeweler, a cabinet maker, a cake studio) needs visitors to browse its work,
narrow it down, see a price range at once and ask for a quote. It is built as library blocks any site can use, and the
owner runs it by chat after Huston Logic sets it up: add pieces, change filters, change prices. A catalog may hold
several hundred items.

## Anti-goals (a failure even if it works)

- An estimate that reads as a firm price: every price shown is a range or "About", always beside the word "Estimate"
  and the pricing table's note.
- A price the owner never set: every figure comes from the item's base price, the pricing table and the exact prices
  the owner entered, through one function. The Worker never trusts a figure from the browser.
- A filter combination that leaves the visitor stuck: counts beside every value, values that would show nothing are
  marked, and the empty state always offers "Clear filters", undoing the last filter and a way to ask.

Not in this run: payments, gift cards, booking, a cart, live metal prices, text search, visitor accounts, reading
Airtable directly.

## The data (three kinds of file)

**R1. Files.** Items are a new collection kind `catalog`: `src/content/collections/catalog/<slug>.json`, the slug rule
of collections. Two settings files join `business`, `brand` and `notice`: `src/content/catalog.json` (filters and the
item word) and `src/content/pricing.json` (the pricing table). The template ships both with an empty catalog (no
filters, no option groups, the default note) and no catalog items, so every site has them and the editor's tools work
the day Huston Logic sets a catalog up. Cost if wrong: a site without a catalog carries two small unused files.

**R2. Item fields.** `name` (1 to 80), `photos` (1 to 6 images, shape 4:5, the first is the cover; `{ src, alt,
focus? }`), `description` (1 to 600, plain text), `filters` (filter id to a list of 1 to 6 value ids; a filter may be
left out), `price` (`{ "low": n, "high": n }` whole currency units 0 to 10,000,000 with low not above high, or the
string `"ask"`: "ask for a price"), `options` (0 to 4 option-group ids from the pricing table), `perPerson` (optional
boolean, default false: the table's per-person fee applies to this item), `order` (0 to 9,999, lower first, then name),
and `status` (`draft`, `live`, `archived`, as every collection). New field kinds in `src/blocks/schema.ts`: `price`,
`filter-values` and `option-groups`, judged against the settings through the validator's context, so one validator
judges items in the build, the content check and the editor. Cost if wrong: a seventh photo or a fifth option group
is refused.

**R3. Catalog settings** (`catalog.json`): `itemWord` `{ singular, plural }` (1 to 24 each, lowercase allowed, for
example "piece"/"pieces", "cake"/"cakes"), and `filters`: 0 to 7, each `{ id, name (1 to 30), values: [{ id, label
(1 to 40) }] }` with 1 to 24 values; ids are slugs (1 to 40), unique within their list. Renaming a label never
changes an id, so links from ads keep working. Removing a value or filter that a live item uses is refused (the
sentence names the items). Cost if wrong: an eighth filter is refused.

**R4. Pricing table** (`pricing.json`):
```json
{ "currency": "USD", "rounding": 10, "spread": 0, "note": "Prices are estimates. I confirm the final price after we talk.",
  "groups": [{ "id": "metal", "name": "Metal", "choices": [
    { "id": "14k-gold", "label": "14k gold", "add": 0 }, { "id": "18k-gold", "label": "18k gold", "multiply": 1.25 } ] }],
  "perPerson": { "label": "Guests", "amount": 6, "min": 10, "max": 300 },
  "exact": { "oval-halo-ring": { "metal": { "18k-gold": 2100, "platinum": 2600 } } } }
```
`currency`: USD, CAD, GBP, EUR, AUD or NZD. `rounding`: 1, 5, 10, 25, 50, 100, 500 or 1000. `spread`: whole percent
0 to 50. `note`: 1 to 160, plain text. `groups`: 0 to 6, each 2 to 12 choices; a choice has exactly one of `add`
(whole number -100,000 to 1,000,000) or `multiply` (0.1 to 10, at most 4 decimals); the first choice is the default.
`perPerson`: null or `{ label (1 to 24), amount (0 to 10,000), min, max (1 to 1,000, min not above max) }`. `exact`:
item slug to group id to choice id to a whole amount. Owners never write formulas or code: only these numbers.
Cost if wrong: a price that depends on two groups together (a stone price that differs by metal) cannot be entered.

**R5. Exact prices live in the pricing table, under the item's slug,** not in the item file. A price sheet is a table
of items by choices, so it is entered as written in one place, and "raise 18k gold by 5 percent" is one file however
many items carry an 18k exact price (a change to 200 item files would break the 10-items-per-proposal cap). Only one
group per item may carry exact prices; the content check refuses exact prices for an unknown item, a group the item
does not use, or an unknown choice. Archived items keep theirs. The editor's `get_item` shows an item's exact prices
beside it. Cost if wrong: the item file alone does not show every price it can have.

**R6. One price function** (`src/catalog/price.ts`, import-free, used by the browser and the Worker):
1. Resolve the selection: each of the item's groups takes the visitor's choice, else its first choice; people take the
   visitor's number, else `perPerson.min`. An unknown group, a group the item does not use, an unknown choice or people
   outside min..max is a refusal (`{ ok: false, problem }`), never a guess.
2. Base: the item's `price` (`"ask"` returns `{ kind: "ask" }` and stops). If the item has an exact price for a chosen
   choice, that figure replaces the base (low and high both) and that group adds no rule.
3. Subtotal = base × every chosen `multiply` + every chosen `add`. Total = subtotal + `perPerson.amount` × people
   (only for items with `perPerson: true`).
4. Shown: low × (1 − spread%) rounded down to `rounding`, high × (1 + spread%) rounded up, never below 0. Equal ends
   read "About $2,100"; otherwise "$1,200 to $1,800". Currency through `Intl.NumberFormat("en-US")`, no cents.
The card in the grid shows the default selection (first choices, smallest party). Cost if wrong: a business that wants
multipliers to apply to add-ons too gets lower figures for heavily optioned pieces; the formula is one place to change.

## Photos

**R7. Catalog photos live in the repo, as today** (`public/images/uploads/<id>.webp` from the editor,
`public/images/catalog/<slug>-<n>.webp` from the import). Numbers for a 500-item catalog at 3 photos an item (6 at
most): 1,500 web photos (1600 px, typically 150 to 300 KB, capped at 450 KB) plus 500 cover cards (about 50 KB) is
about 0.3 to 0.5 GB and 2,000 files; at 6 photos everywhere, 3,000 photos and at most 1.4 GB. The build copies photos
and does not process them, so build time grows with pages, not photos (measured below). Workers static assets
(wrangler 4.163): 20,000 files per version by default (an account's plan can raise it), 25 MiB per file. Each static
page is about 6 files (the HTML and Next's segment files), so a piece costs about 6 page files plus 2 per photo: a
500-piece catalog at 3 photos is about 3,500 page files and 3,000 photo files, a third of the limit, and the limit is
reached near 1,600 pieces at 3 photos (1,100 at 6). Git keeps every replaced photo forever; GitHub warns
at 1 GB of history. Repo photos keep what R2 storage would lose: one commit per change, a preview per branch, the
scope check's photo rules, and offboarding as a plain clone. Cost if wrong: past about 1,500 items (the asset-file limit) or heavy photo
churn, clones slow and the repo nears GitHub's soft limit; moving to R2 then needs a photo resolver in the Worker and
a new upload path (a later run, listed in Needs Grant as a watch item).

**R8. The grid never loads full-size photos.** Every cover has a card file beside it, `<name>-card.webp`: a 720 by 900
(4:5) cover crop honouring `focus`, WebP, at most 150 KB, no metadata. The grid and the item page's thumbnail buttons
load only card files; the item page loads one full photo at a time in a 4:5 frame with `object-contain` on the tint
mat, so no product photo is cut off. The content check fails a live item whose cover has no card file; the scope
check accepts `<id>-card.webp` beside an upload and `-card.webp` under `public/images/catalog/` with the usual photo
rules. Cards come from the Worker at upload time (one more Images transformation per photo: 3 to 6 per photo instead
of 2 to 5, so the 5,000 free transformations a month cover about 830 to 1,670 photos across all sites) and from the
import script locally. Cost if wrong: a non-cover photo opened large loads its full file (by design).

## Pages and blocks

**R9. Routes.** The catalog page is the one live page holding the `catalog` block (the content check allows at most
one, never `/`, `/blog` or `/contact`). Each visible item is a static page at `<catalog page>/<slug>`, in the sitemap
when live, `noindex` and tagged when a draft (as posts). `src/app/(site)/[slug]` becomes `[...path]`: one segment is a
page, two are an item of the catalog page, anything else is the 404. A catch-all always has addresses (the required
`/contact`), which a nested `[slug]/[item]` route would not have on a site without a catalog. The showcase's example
items are built at `/blocks/catalog/<slug>` outside production only (finish-build already removes `/blocks`).
`/catalog.json` (a static route) holds the pricing table, the item word, the catalog page path and every visible
item's name, price, options and perPerson: the Worker's price source (R14). Cost if wrong: an owner who wants items at
a different address than their gallery page cannot have it.

**R10. The `catalog` block (the gallery).** Fields: `heading` (90), optional `intro` (280). Variants: `grid` (four
across on wide screens, two on phones) and `showcase` (three across with larger cards and the name set in the display
face). Placement: any, once per page, rhythm section; entrance motion none, because the island reveals cards itself
(reason recorded). Rendering: the server renders every visible item as a card (cover card photo, name, price line,
an "Estimate" tag) in order, so without JavaScript the whole catalog shows and every card links to its page, and a
closing line offers the quote route and the contact page. One small client island (`CatalogFilters`) owns the filter
bar, the count, the empty state and "Show more"; it shows and hides the server-rendered cards by their `data-` values
instead of re-rendering them, so a 500-item page hydrates no cards. With JavaScript, cards after the 24th are hidden by
CSS before first paint (the `js` class), so nothing shifts. Measured: a 500-card gallery page is 1.24 MB of HTML raw and
39 KB gzipped (what the visitor downloads; Cloudflare compresses it). Cost if wrong: very large catalogs (thousands) would want a JSON index
and paged HTML instead.

**R11. Filters in the address.** `?<filter id>=<value id>,<value id>&<filter id>=...`: values within a filter are OR,
filters are AND; unknown ids are dropped quietly (a stale ad link still lands on a working page). The island writes the
address with `history.replaceState` (no Back-button trap) and reads it on load, so an ad links to a filtered view.
Desktop: a row of filter buttons, each opening a panel of checkboxes with counts (`aria-expanded`, Escape closes,
focus returns); phones: one "Filter" button opening the same panels stacked, with "Show N pieces". Active filters show
as removable chips with "Clear all". The count is a polite live region ("12 of 61 pieces"). A value whose count is 0
stays reachable but is marked "0" and dimmed (never hidden, so the bar does not jump). Empty state: "No pieces match
these filters", buttons to undo the last filter and clear all, and the quote/contact route. "Show 24 more" moves focus
to the first new card. Cost if wrong: no sort control (order is the owner's).

**R12. The item view** (`<catalog page>/<slug>`): breadcrumb back to the gallery (it returns to the filtered view the
visitor came from when there is one, from `sessionStorage`), the photo frame with up to six thumbnail buttons
(`aria-pressed`, no carousel, no autoplay, no swipe handler), the name as H1, the description, the item's filter values
as facts, and the quote builder. Fires `view_item` (item_id the slug, item_name the name) once per view. Without
JavaScript the price line shows the default range and the builder's place shows the contact route. Cost if wrong: no
zoom on photos.

**R13. The quote builder** (client component, used by the item view and the `quote-builder` block): one radio group
per option group (chips; the choice's effect is never shown as a formula), a people stepper when the item takes the
per-person fee (number input with − and + buttons, clamped to min..max), and the range in large type with "Estimate"
and the note, updated at once (polite live region, no network). "Request this quote" fires `quote_start`, then reveals
the quote form in place under a summary of the selection, focus moving to the form's heading. Success shows the form's
thank-you, fires `lead` with form_id `quote`. The `quote-builder` block: `heading` (90), optional `intro` (280),
optional `item` (a catalog slug: preselected); without `item` the visitor first picks a piece from a select of every
visible item. Variants `panel` (one centred panel) and `beside` (text left, builder right). Cost if wrong: the select
grows long past a few hundred items (the gallery is the better door there).

## The quote form and the Worker

**R14. The quote form is the form file with id `quote`** (`src/content/forms/quote.json`, shipped live), bound in code
like `contact`: it is shown only by the quote builder (a `form` block may not hold it), the owner may change its
questions, button and thank-you by chat under the forms rules, and it may not be archived while a catalog page is live.
It gains one optional key, only for this id: `reply` `{ subject (1 to 120), next (1 to 600) }`, the owner's words in the
visitor's estimate email. The selection travels beside the answers as one key, `selection: { item, options: { group:
choice }, people? }`, added in code; it is not an owner field and no owner field may be named `selection`. Cost if
wrong: an owner wanting two quote forms gets one.

**R15. The Worker recomputes.** `POST /api/forms/quote` runs the forms handler with quote extras: it reads
`/catalog.json` from the site's own static assets (`env.ASSETS`, the same deploy as the Worker), refuses a missing or
non-live item, an unknown or inapplicable option, people out of range or a missing required people value with 400
`malformed` (no person can do that through the page), refuses any key besides the answers, `selection`, the honeypot
and the token (so a posted `range` or `price` is refused, never read), then computes the range with `price.ts` and uses
only its own number everywhere. If the asset read fails the post is refused with 502 and a fixed log event (fail
closed). Same layers as every form: same origin, size, rate limit (`quote:<ip>`), honeypot, Turnstile (action `form`).
A preview's `/catalog.json` holds draft pieces, so a preview accepts quotes for drafts because the preview shows them
(its emails go only to the site's own address); production data never holds a draft. Cost if wrong: a quote during a deploy's first seconds could read the previous version's prices (the assets and the
Worker switch together, so this is a theory, not an observed case).

**R16. Delivery** through the site's existing destination, the same Worker-computed text in every place:
- Sheet: the Forms tab row (`Received | Form | Name | Email | Answers | Mode` plus last run's five source cells); the
  Answers cell starts with `Piece: Oval halo ring`, `Link: <site url>/<page>/<slug>`, one `<Group>: <choice>` line per
  option, `Guests: 40` when it applies, `Estimate: $2,100 to $2,700` (or `Price on request`), then the answers. No new
  column, so the Apps Script and Sheet need no change.
- Owner email: subject `New quote request: <item> from <name or email>`; the same lines, the answers, the `Came from`
  line, Received and the save line.
- Visitor email (plain text, production to the visitor, preview to the site's own address): the form's `reply.subject`,
  then fixed lines from `src/content/forms.ts` with the item, choices and estimate, the pricing note, then `reply.next`
  and the business name. No visitor input appears in it. Sent only after the owner has the request.
- Pipeline: the forms message (`Form: <name>`) with the same lines before the answers.
Cost if wrong: owners wanting the estimate in its own Sheet column add the column and a later run fills it.

**R17. Tracking.** `view_item` (item view), `quote_start` (Request this quote), `lead` (form_id `quote`, on success),
all through `track()`; the events already exist in `src/tracking/events.ts`. No price or answer is sent to any tag.

## Owner tools (site editor)

**R18. Chat changes.** Catalog items are a collection (`add_item`, `set`, `set_item_status`, with `upload:<id>` photos;
the publish adds each photo's card file). `catalog.json` and `pricing.json` are settings targets for `set`,
`insert_item` and `remove_item`. One new operation, `scale_price { group, choice, percent }` (−50 to 100): it scales that
choice's `add` (rounded to a whole unit) or `multiply` (rounded to 4 decimals) and every exact price for that choice
(rounded to a whole unit), so "raise 18k gold by 5 percent" is one operation. Every change to `pricing.json` (by any
operation) ends its change list with "This changes the price of N pieces", then up to 12 lines `<item>, with <choice>:
$2,000 to $2,500 → $2,100 to $2,625` (the first changed selection of each item, one choice at a time) and "and M more".
`get_item` shows the item with its exact prices; `get_settings` covers catalog and pricing. The instructions: never
invent a price, a filter value or an item fact; prices come only from the owner's words; say "estimate", never
"price" alone; "hide the price" sets `price` to `"ask"`.

**R19. Caps stay as they are.** A proposal touches at most 10 items, the site publishes at most 10 changes a day
(`editor.dailyChangeLimit`) and takes at most 50 uploads a day. By chat that is at most 50 photos and 100 items a day,
so a first load of 300 items with 3 photos each would take 18 days. The first load is Huston Logic's import script
(R20), not chat; chat is for the few changes a week that follow. A price change is one file whatever it touches. Cost
if wrong: an owner adding a new collection of 40 pieces in one go needs 4 proposals and their photos over a day.

**R20. The import script** (`npm run import:catalog -- <csv> <photos folder> <mapping.json> [--write]`, run by Huston
Logic): dry run by default, `--write` writes item files, the `exact` entries, missing filter values and the photos.
The mapping file names the CSV column for each field (`slug` optional, else made from the name), how filter columns
map (a column per filter, values split on `;`), price columns (low, high, or one "ask" word), option groups, exact-price
columns (`exact: { "metal/18k-gold": "Price 18k" }`) and photo columns (file names, split on `;`). The report lists
every skipped row with its line number and reason (missing name, no photo, photo not found, photo not JPEG, PNG or
WebP, low above high, unknown option, duplicate slug, a value the content check refuses) and ends with counts. Photos
are resized in headless Chrome (installed Google Chrome or Playwright's Chromium, as `report:changes` does; no new
dependency): EXIF orientation applied, 1600 px WebP at most 450 KB, the 720 by 900 card, and the metadata cleaner run
on both. Written items are `draft` unless the mapping says `live`. Cost if wrong: HEIC photos must be converted first
(the report says so).

## Checks, showcase and docs

**R21. Checks.** The content check adds: every item rule above; every live item has a cover with real alt text and its
card file; filter values, groups and exact prices exist; low not above high; at most one catalog page; a live item
needs a live catalog page; a live catalog page needs a live `quote` form. The scope check: item files, `catalog.json`,
`pricing.json` and `forms/quote.json` are tier 1 when they pass; card files follow the photo rules. The change report:
an item maps to the catalog page and its own page; `catalog.json` and `pricing.json` map to the catalog page and the
first three item pages. Each new block passes rule 16.

**R22. Showcase.** `src/catalog/example.ts` builds a deterministic example catalog in code (never files, so it counts
toward nothing): 60 ceramics pieces (the example photos are still lifes of jugs, bowls and vases), six filters (Type,
Glaze, Size, Finish, Collection, Made), two option groups (Glaze colour, adding; Size, multiplying), a per-person
"Place settings" fee on the dinner sets, a few exact prices and two "ask" items. The six example photos get card files.
No business facts: names are generic ("Tall jug, ash glaze").

**R23. The 500-item fixture.** `scripts/catalog-fixture.mjs <n> <dir>` writes n items, the settings and a catalog page
into a throwaway checkout; the run builds it and records the time and size here. Not committed as content.

## Measured (2026-11-27, Grant's Mac, `scripts/catalog-fixture.mjs 500` in a throwaway checkout)

| Measure | Template (60 example pieces in the showcase) | 500-piece fixture |
|---|---|---|
| Pages generated | 77 in 0.36 s | 578 in 0.94 s |
| `npm run build`, wall clock | 11.0 s with `.next` deleted | 4.8 s with `.next` deleted (Turbopack's compile cache warm) |
| Files in `out/` | 466 (the showcase's 60 piece pages; production removes `/blocks`) | 3,474 (piece pages: 3,004, about 6 each) |
| Size of `out/` | 12 MB | 83 MB (piece pages 68 MB raw; the fixture reuses the example photos) |
| Gallery page HTML | | 1.24 MB raw, 39 KB gzipped |
| One piece page HTML | | 48 KB raw, 7.5 KB gzipped |
| `/catalog.json` | | 66 KB raw, 4.8 KB gzipped |
| Piece files in the repo | | 500 JSON files, about 1 MB |

Page generation grows by about 1 ms a piece; the compile step, not the pieces, sets the build time. Photos are not in
these numbers: at 3 photos a piece, a real 500-piece catalog adds about 3,000 photo files and 0.3 to 0.5 GB (R7).
