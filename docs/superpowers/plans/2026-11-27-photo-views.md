# Catalog photo views: plan

Process run, 2026-11-27, one PR on `feat/catalog-photo-views`. Grant's brief approves the direction; the catalog design
(`docs/superpowers/specs/2026-11-27-catalog-and-quotes-design.md`) is amended by the rulings below (P1 to P9). Opus
plans and reviews, a Sonnet subagent builds, Haiku writes the docs.

## What exists

- Every catalog photo, not only the cover, already has a card file `<name>-card.webp` (720 by 900): the upload path
  marks every photo a touched catalog item uses (`markCardUploads`, `worker/editor/uploads.ts`), the import script
  writes one per photo (`scripts/import-catalog.mjs`), and the content check fails a live piece when any photo lacks
  one (`catalogPageProblems`, `src/collections/site-validate.ts`). The piece page's thumbnails already load them.
- The gallery card is `src/components/hl/CatalogCard.tsx` (server). The piece page's photos are
  `src/components/hl/ItemPhotos.tsx` (client): a square frame, `object-contain`, thumbnail buttons with `aria-pressed`.
- Example pieces (`src/catalog/example.ts`) have `1 + (n % 4)` photos: piece 1 has one, piece 4 has four.

## Rulings

**P1. The second photo needs no new file.** It is the second photo's existing card file. The work is tests that pin
it: the content check names photo 2's missing card, the import writes `-2-card.webp`, an upload used as photo 2 is
marked for a card. Cost if wrong: none found; an owner's photo 2 uploaded before cards existed already gets
`MISSING_CARD`.

**P2. The hover photo is CSS only.** Each card with two or more photos carries a second `<img>` of photo 2's card file,
`loading="lazy"`, `alt=""` and `aria-hidden`, absolutely over the cover and `display: none`. Browsers do not fetch a lazy
image that has no box, so it is requested only when a rule shows it: `:hover` inside `@media (hover: hover)`, and
`:has(a:focus-visible)` everywhere. It fades in by a keyframe on opacity (`hl-card-second-in`, `--duration-lift`); under
reduced motion it appears at once. No JavaScript and nothing hydrates, so the 500-card page costs the same. On a touch
screen no rule matches (no hover, and a tap's focus is not `:focus-visible`), so the card is unchanged and a tap opens
the piece. Cost if wrong: a browser that fetched lazy `display: none` images would load every second card with the page
(about 50 KB each); the browser test pins Chromium's behaviour.

**P3. The second photo is decorative in the gallery.** The card's link is still named by the piece's name; the photo
adds nothing a screen reader needs, and the piece page lists every photo with its alt text. Cost if wrong: none.

**P4. Swiping is native scrolling, not a touch handler.** AGENTS.md's motion rules forbid wheel and touch listeners and
scroll hijacking. The piece page's frame becomes a horizontal scroll-snap strip (`snap-x snap-mandatory`, each photo
`snap-center snap-always`, scrollbar hidden): the browser's own swipe, momentum and edge bounce. An
`IntersectionObserver` on the photos (root: the strip) keeps the index, so the pressed thumbnail follows the swipe; a
thumbnail press scrolls the strip, smoothly only without reduced motion (CSS `scroll-behavior` on the strip; the global
reduced-motion rule makes it instant). This amends R12's "no swipe handler". Cost if wrong: none for visitors; a trackpad
on a laptop also scrolls the strip sideways, which is expected.

**P5. Full photos still load one at a time, when they start to show.** Before hydration the strip holds only photo 1, so
without JavaScript the page is as today (photo 1, the noscript photo links). After hydration the other slots are empty
tint mats; a slot's full photo is mounted the first time any part of it scrolls into the strip or it is chosen, and kept
afterwards. Cost if wrong: a fast swipe may show the mat for a moment before the photo arrives.

**P6. The closer look is a native modal `<dialog>`.** Pressing the main photo (a button laid over each slide after
hydration, named "Open photo 2 of 4 larger: <alt>") calls `showModal()`: the rest of the page is inert, focus is held
inside and Escape closes. It shows the full photo as large as the screen allows (`object-contain`, the same file, already
loaded), "Photo 2 of 4" in a polite live region, Previous and Next buttons (disabled at the ends, no wrap), Left and
Right arrow keys, and a Close button. A press outside the photo and the controls closes it. Inside it the photos are the
same swipe strip (P4), so a phone swipes there too. Closing returns focus to the element that opened it and the page's
strip and thumbnails show the photo last seen. The page does not scroll behind it (`html:has(dialog[open])`). Cost if
wrong: none known; no pinch zoom (not in this run).

**P7. One photo is exactly as today.** A piece with one photo renders today's markup: no strip, no button, no dialog, no
second image on its card. Cost if wrong: a one-photo piece has no closer look.

**P8. Words** join `catalogWords` in `src/content/catalog.ts` as plain interface defaults, like the filter words
(`openLarge`, `largeView`, `previousPhoto`, `nextPhoto`, `closeLarge`, `photoCount`). No copy in the site's copy doc
covers them. Cost if wrong: a client wanting other wording edits the module.

**P9. No new dependency, no CSP change, no new token.** Motion uses the existing tokens. Cost if wrong: none.

## Tasks (one commit each, `npm run check:fast` before each)

1. **Card files, pinned by tests (P1).** `src/collections/site-validate.test.ts`: a live piece whose photo 2 has no card
   names "photo 2 has no card file". `scripts/import-catalog.test.mjs`: already writes `-2-card.webp` (confirm, else
   add). `worker/editor/uploads.test.ts` (or the acceptance test): an upload used as photo 2 is marked `card: true`.
2. **Gallery hover (P2, P3, P7).** `CatalogCard.tsx`: second `next/image` (unoptimized output is a plain `img`),
   `loading="lazy"`, `data-card-second`, only when `view.photos.length > 1`. `hl.css`: `.hl-card-second` rules, the
   keyframe, the hover media query. `npm run check:design` must pass.
3. **Swipe strip (P4, P5, P7).** `ItemPhotos.tsx`: the strip, the observer, thumbnails in step, the one-photo branch
   untouched.
4. **Large view (P6).** New `src/components/hl/PhotoViewer.tsx` (client), used by `ItemPhotos`. Words (P8).
5. **Browser tests** in `tests/a11y/catalog.spec.ts`, on the showcase (`/blocks`) and a four-photo piece
   (`showcaseItemRoutes[3]`): hover and focus show the second photo and the network shows its card requested only then
   (none at load); on `mobile` (touch) the card's second image never loads; swipe (scroll the strip by one width, or
   `touchscreen` drag) moves through all four photos and the pressed thumbnail follows; a thumbnail press moves the
   strip; the large view opens from the main photo, Next and Previous step, arrow keys step, it closes by the button,
   Escape and a press outside, focus returns to the opener, and axe is clean with it open; a one-photo piece
   (`exampleItemRoute`) has no strip, no open button and no second card image.
6. **500-piece fixture** (`scripts/catalog-fixture.mjs 500` in a throwaway checkout): build passes; record the time.
7. **Docs (Haiku):** `docs/BLOCKS.md` via `npm run blocks:catalog` if the definition text changes, else a line in the
   catalog block's description; `docs/EDITING.md` Catalog section (the second photo shows on hover, photo order matters,
   a closer look on the piece page); the spec's R8 and R12 get a pointer to P1 to P9; STATUS.md at the end.
8. **Review:** review-code, review-a11y, review-security on the branch; design critique from screenshots at 1440 and 390
   of the gallery hover state, the piece page and the large view. Fix, then `npm run check`, `test:a11y`,
   `test:lighthouse`, PR.

## Done when

The brief's list: hover and focus show photo 2 and the network shows it requested only then; a phone-width touch test
swipes through four photos with the thumbnail in step; the large view opens, steps and closes three ways and passes axe;
one photo behaves as today; the fixture and every required check pass at unchanged thresholds; the critique passes.
