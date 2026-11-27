"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { TextLink } from "@/components/hl/TextLink";
import { catalogWords } from "@/content/catalog";
import {
  RETURN_KEY,
  facetCounts,
  matchingPositions,
  mergeSearch,
  parseSearch,
  selectedOf,
  toggle,
  toSearch,
  type CardValues,
  type FilterDef,
  type Pick,
  type Selected,
} from "@/blocks/catalog-filtering";

/** Pieces shown at first and added by each "Show more". The stylesheet hides the same number before first paint (hl.css). */
const PAGE = 24;

type Props = {
  filters: FilterDef[];
  itemWord: { singular: string; plural: string };
  total: number;
  /** The id of the server-drawn list of cards this island shows and hides. */
  gridId: string;
  /** The id of the empty place after the list where "Show more" is drawn. */
  moreId: string;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** The checkboxes of one filter, each with how many pieces it would show. A value that would show nothing stays, dimmed. */
function Values({
  filter,
  selected,
  counts,
  onToggle,
  idBase,
  itemWord,
}: {
  filter: FilterDef;
  selected: Selected;
  counts: Record<string, number> | undefined;
  onToggle: (value: string) => void;
  idBase: string;
  itemWord: { singular: string; plural: string };
}) {
  return (
    <ul role="list">
      {filter.values.map((value) => {
        const checked = selected[filter.id]?.includes(value.id) === true;
        const count = counts?.[value.id] ?? 0;
        const dim = count === 0 && !checked;
        return (
          <li key={value.id}>
            <label
              htmlFor={`${idBase}-${value.id}`}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-field px-2 font-text text-control ${dim ? "text-ink-2" : "text-ink"}`}
            >
              <input
                id={`${idBase}-${value.id}`}
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(value.id)}
                className="size-5 shrink-0 accent-ink"
              />
              <span>{value.label}</span>
              <span className="ml-auto text-small tabular-nums text-ink-2">
                <span aria-hidden="true">{count}</span>
                <span className="sr-only">
                  {catalogWords.facetCount(
                    count,
                    itemWord.singular,
                    itemWord.plural,
                  )}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The gallery's filter bar, count, empty state and "Show more" (spec R10, R11). The cards are drawn by the server and stay
 * where they are: this island reads each card's `data-f-<filter>` values once, then shows and hides the cards with the
 * `hidden` attribute, keeps the choices in the address with `history.replaceState` (no Back-button trap) and reads them
 * on load, so a link from an ad lands on a filtered view. "Show more" is drawn into the server's empty place after the list.
 */
export function CatalogFilters({
  filters,
  itemWord,
  total,
  gridId,
  moreId,
}: Props) {
  const prefix = useId();
  const [cards, setCards] = useState<CardValues[] | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [moreHost, setMoreHost] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cardEls = useRef<HTMLElement[]>([]);
  const focusAt = useRef<number | null>(null);
  // Set when a control that is about to unmount (a chip, "Clear all", "Undo") was used; the number is the place of the pick removed.
  const refocus = useRef<number | null>(null);
  const addressSynced = useRef(false);

  // Once, in the browser: read the cards the server drew, and the choices the address holds.
  useEffect(() => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const els = Array.from(
      grid.querySelectorAll<HTMLElement>(":scope > [data-card]"),
    );
    cardEls.current = els;
    /* eslint-disable react-hooks/set-state-in-effect -- the browser's address and the server's cards are only readable after mount. */
    setCards(
      els.map((el) =>
        Object.fromEntries(
          filters.map((filter) => [
            filter.id,
            (el.getAttribute(`data-f-${filter.id}`) ?? "")
              .split(" ")
              .filter(Boolean),
          ]),
        ),
      ),
    );
    setPicks(parseSearch(window.location.search, filters));
    setMoreHost(document.getElementById(moreId));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [gridId, moreId, filters]);

  const selected = useMemo(() => selectedOf(picks), [picks]);
  const matches = useMemo(
    () => (cards === null ? null : matchingPositions(cards, selected)),
    [cards, selected],
  );
  const counts = useMemo(
    () => (cards === null ? null : facetCounts(cards, filters, selected)),
    [cards, filters, selected],
  );

  // Show the cards that fit (up to the limit), mark the list ready, keep the address and the way back in step.
  useEffect(() => {
    if (matches === null) return;
    const shown = new Set(matches.slice(0, limit));
    cardEls.current.forEach((el, index) => {
      el.hidden = !shown.has(index);
    });
    const grid = document.getElementById(gridId);
    if (grid) {
      grid.hidden = matches.length === 0;
      grid.setAttribute("data-ready", "");
    }
    const search = toSearch(picks, filters);
    try {
      // On the first run the picks came from the address, so it is left exactly as the visitor (or the ad) wrote it.
      if (addressSynced.current) {
        const next = mergeSearch(window.location.search, picks, filters);
        if (next !== window.location.search)
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${next}${window.location.hash}`,
          );
      }
      addressSynced.current = true;
      window.sessionStorage.setItem(RETURN_KEY, search);
    } catch {
      // The address and the way back are conveniences; the filters still work without them.
    }
    if (focusAt.current !== null) {
      const position = matches[focusAt.current];
      focusAt.current = null;
      if (position !== undefined)
        cardEls.current[position]?.querySelector("a")?.focus();
    }
  }, [matches, limit, picks, filters, gridId]);

  // A removed chip, "Clear all" or "Undo" took the focused control with it: move focus to the next chip, else the first trigger.
  useEffect(() => {
    if (refocus.current === null || root.current === null) return;
    const place = refocus.current;
    refocus.current = null;
    const chips = root.current.querySelectorAll<HTMLElement>("[data-chip]");
    const triggers = Array.from(
      root.current.querySelectorAll<HTMLElement>("[data-trigger]"),
    );
    const trigger =
      triggers.find((el) => el.offsetParent !== null) ?? triggers[0];
    (chips[Math.min(place, chips.length - 1)] ?? trigger)?.focus();
  }, [picks]);

  // Close the open panel when focus or a press lands outside the bar.
  useEffect(() => {
    if (open === null) return;
    const outside = (event: Event) => {
      if (
        !root.current ||
        (event.target instanceof Node && root.current.contains(event.target))
      )
        return;
      setOpen(null);
    };
    document.addEventListener("focusin", outside);
    if (open !== "mobile") document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("focusin", outside);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const change = (next: Pick[], removedAt?: number) => {
    if (removedAt !== undefined) refocus.current = removedAt;
    setPicks(next);
    setLimit(PAGE);
  };
  const labelOf = (pick: Pick) =>
    filters
      .find((filter) => filter.id === pick.filter)
      ?.values.find((value) => value.id === pick.value)?.label ?? pick.value;
  const closeTo = (key: string) => {
    setOpen(null);
    root.current
      ?.querySelector<HTMLButtonElement>(`[data-trigger="${key}"]`)
      ?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open !== null) {
      event.stopPropagation();
      closeTo(open);
    }
  };

  const shownCount = matches === null ? total : matches.length;
  const plural = shownCount === 1 ? itemWord.singular : itemWord.plural;
  const remaining = matches === null ? 0 : Math.max(0, matches.length - limit);
  // The empty state's three actions share one look: green, medium, 44px high, the site's underline.
  const emptyAction =
    "inline-flex min-h-11 items-center font-ui font-medium text-green";
  const buttonClass =
    "inline-flex min-h-11 items-center gap-2 rounded-pill border px-4.5 font-ui text-chip font-medium text-ink";

  return (
    <>
      <div ref={root} onKeyDown={onKeyDown} className="hl-catalog-bar">
        <div className="border-y border-hairline py-3 md:py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {filters.length > 0 ? (
              <>
                <div className="hidden flex-wrap gap-2.5 md:flex">
                  {filters.map((filter) => {
                    const active = selected[filter.id]?.length ?? 0;
                    const isOpen = open === filter.id;
                    const panelId = `${prefix}-panel-${filter.id}`;
                    return (
                      <div key={filter.id} className="relative">
                        <button
                          data-trigger={filter.id}
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : filter.id)}
                          className={`${buttonClass} ${isOpen ? "border-ink bg-tint" : active > 0 ? "border-ink" : "border-ink-2"}`}
                        >
                          {filter.name}
                          {active > 0 ? (
                            <span className="grid size-6 place-items-center rounded-pill bg-ink text-tag text-silver">
                              {active}
                            </span>
                          ) : null}
                          <Chevron open={isOpen} />
                        </button>
                        {isOpen ? (
                          <div
                            id={panelId}
                            className="absolute left-0 top-full z-20 mt-2 max-h-96 w-72 overflow-y-auto rounded-card border border-hairline bg-white p-3 shadow-card"
                          >
                            <fieldset>
                              <legend className="sr-only">{filter.name}</legend>
                              <Values
                                filter={filter}
                                selected={selected}
                                counts={counts?.[filter.id]}
                                onToggle={(value) =>
                                  change(
                                    toggle(picks, { filter: filter.id, value }),
                                  )
                                }
                                idBase={`${prefix}-d-${filter.id}`}
                                itemWord={itemWord}
                              />
                            </fieldset>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="md:hidden">
                  <button
                    data-trigger="mobile"
                    type="button"
                    aria-expanded={open === "mobile"}
                    onClick={() => setOpen(open === "mobile" ? null : "mobile")}
                    className={`${buttonClass} ${open === "mobile" ? "border-ink bg-tint" : picks.length > 0 ? "border-ink" : "border-ink-2"}`}
                  >
                    {catalogWords.filter}
                    {picks.length > 0 ? (
                      <span className="grid size-6 place-items-center rounded-pill bg-ink text-tag text-silver">
                        {picks.length}
                      </span>
                    ) : null}
                    <Chevron open={open === "mobile"} />
                  </button>
                </div>
              </>
            ) : null}
            <p
              aria-live="polite"
              aria-atomic="true"
              className="ml-auto font-voice text-subhead italic text-ink-2"
            >
              {catalogWords.count(shownCount, total, plural)}
            </p>
          </div>
        </div>

        {open === "mobile" ? (
          <div
            id={`${prefix}-mobile`}
            className="mt-4 rounded-card border border-hairline bg-white p-5 shadow-card md:hidden"
          >
            <div className="space-y-6">
              {filters.map((filter) => (
                <fieldset key={filter.id}>
                  <legend className="font-ui text-item font-semibold">
                    {filter.name}
                  </legend>
                  <Values
                    filter={filter}
                    selected={selected}
                    counts={counts?.[filter.id]}
                    onToggle={(value) =>
                      change(toggle(picks, { filter: filter.id, value }))
                    }
                    idBase={`${prefix}-m-${filter.id}`}
                    itemWord={itemWord}
                  />
                </fieldset>
              ))}
            </div>
            <button
              type="button"
              onClick={() => closeTo("mobile")}
              className="mt-6 inline-flex min-h-13.5 w-full items-center justify-center rounded-btn bg-ink px-6 font-ui text-btn font-semibold text-silver"
            >
              {catalogWords.showResults(
                shownCount,
                itemWord.singular,
                itemWord.plural,
              )}
            </button>
          </div>
        ) : null}

        {picks.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {picks.map((pick, place) => (
              <button
                key={`${pick.filter}-${pick.value}`}
                data-chip=""
                type="button"
                aria-label={catalogWords.removeFilter(labelOf(pick))}
                onClick={() => change(toggle(picks, pick), place)}
                className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-tint px-4 font-ui text-chip font-medium text-ink"
              >
                {labelOf(pick)}
                <Cross />
              </button>
            ))}
            <button
              type="button"
              onClick={() => change([], 0)}
              className="inline-flex min-h-11 items-center px-2 font-ui text-chip font-medium text-green underline underline-offset-quarter-em"
            >
              {catalogWords.clearAll}
            </button>
          </div>
        ) : null}

        {matches !== null && matches.length === 0 ? (
          <div className="mt-8 rounded-card bg-tint p-8 md:p-12">
            <p className="max-w-title font-voice text-h3 italic leading-snug">
              {catalogWords.emptyHeading(itemWord.plural)}
            </p>
            <p className="mt-3 max-w-narrow text-body">
              {catalogWords.emptyBody}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
              {picks.length > 0 ? (
                <button
                  type="button"
                  onClick={() => change(picks.slice(0, -1), picks.length - 2)}
                  className={emptyAction}
                >
                  <span className="hl-u">{catalogWords.undo}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => change([], 0)}
                className={emptyAction}
              >
                <span className="hl-u">{catalogWords.clearFilters}</span>
              </button>
              <TextLink href="/contact">
                {catalogWords.askRoute(itemWord.singular)}
              </TextLink>
            </div>
          </div>
        ) : null}
      </div>
      {moreHost !== null && remaining > 0
        ? createPortal(
            <button
              type="button"
              onClick={() => {
                focusAt.current = limit;
                setLimit(limit + PAGE);
              }}
              className="inline-flex min-h-13.5 items-center rounded-btn border border-ink px-6 font-ui text-btn font-semibold text-ink"
            >
              {catalogWords.showMore(Math.min(PAGE, remaining))}
            </button>,
            moreHost,
          )
        : null}
    </>
  );
}
