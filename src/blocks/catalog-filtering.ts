// The gallery's filter rules as pure functions (spec R11): values inside one filter are OR, filters are AND, unknown ids
// in the address are dropped. The island (library/catalog/CatalogFilters.tsx) and the tests share them. Import-free.

/** The sessionStorage key where the gallery keeps its filtered address, for the piece page's way back. */
export const RETURN_KEY = "hl-catalog-return";

export type FilterDef = { id: string; name: string; values: readonly { id: string; label: string }[] };
/** Filter id to the value ids chosen in it. A filter with nothing chosen is absent. */
export type Selected = Record<string, string[]>;
/** What a card says about itself: filter id to the value ids of its piece. */
export type CardValues = Record<string, readonly string[]>;
/** One chosen value, in the order the visitor chose it (for "undo the last filter"). */
export type Pick = { filter: string; value: string };

/** The choices an address holds (`?type=jug,vase&glaze=ash`), keeping only filters and values the site has. */
export function parseSearch(search: string, filters: readonly FilterDef[]): Pick[] {
  const params = new URLSearchParams(search);
  const picks: Pick[] = [];
  for (const [key, raw] of params) {
    const filter = filters.find((candidate) => candidate.id === key);
    if (filter === undefined) continue;
    for (const value of raw.split(",")) {
      if (!filter.values.some((candidate) => candidate.id === value)) continue;
      if (!picks.some((pick) => pick.filter === key && pick.value === value)) picks.push({ filter: key, value });
    }
  }
  return picks;
}

/** The chosen values grouped by filter. */
export function selectedOf(picks: readonly Pick[]): Selected {
  const selected: Selected = {};
  for (const { filter, value } of picks) (selected[filter] ??= []).push(value);
  return selected;
}

/** The query string for the choices, in the site's filter order: "?type=jug,vase&glaze=ash", or "" for none. */
export function toSearch(picks: readonly Pick[], filters: readonly FilterDef[]): string {
  const selected = selectedOf(picks);
  const parts = filters.flatMap((filter) => {
    const values = filter.values.filter((value) => selected[filter.id]?.includes(value.id)).map((value) => value.id);
    return values.length === 0 ? [] : [`${filter.id}=${values.join(",")}`];
  });
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** Adds the pick, or removes it when it is already chosen. */
export function toggle(picks: readonly Pick[], pick: Pick): Pick[] {
  const has = picks.some((candidate) => candidate.filter === pick.filter && candidate.value === pick.value);
  return has ? picks.filter((candidate) => !(candidate.filter === pick.filter && candidate.value === pick.value)) : [...picks, pick];
}

/** True when the card fits every chosen filter (one of the chosen values of each). `ignore` leaves one filter out. */
export function fits(card: CardValues, selected: Selected, ignore?: string): boolean {
  for (const [filter, values] of Object.entries(selected)) {
    if (filter === ignore || values.length === 0) continue;
    const own = card[filter] ?? [];
    if (!values.some((value) => own.includes(value))) return false;
  }
  return true;
}

/** The positions of the cards that fit, in order. */
export function matchingPositions(cards: readonly CardValues[], selected: Selected): number[] {
  const out: number[] = [];
  cards.forEach((card, index) => {
    if (fits(card, selected)) out.push(index);
  });
  return out;
}

/** For every value, how many cards would show if it were chosen (given the other filters; its own filter is left out). */
export function facetCounts(cards: readonly CardValues[], filters: readonly FilterDef[], selected: Selected): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const filter of filters) {
    const counts: Record<string, number> = Object.fromEntries(filter.values.map((value) => [value.id, 0]));
    for (const card of cards) {
      if (!fits(card, selected, filter.id)) continue;
      for (const value of card[filter.id] ?? []) if (value in counts) counts[value] = (counts[value] ?? 0) + 1;
    }
    out[filter.id] = counts;
  }
  return out;
}
