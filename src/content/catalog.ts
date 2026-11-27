/**
 * The catalog's interface words: the estimate wording, the filter bar, the empty state, the quote builder and the lines of
 * the estimate email. Plain defaults in the owner's first-person voice, like src/content/blog.ts. Piece names, prices and
 * filter labels live in the content files. A client wanting other wording edits this module. The email lines carry no
 * greeting and no visitor input: the Worker fills in the piece, choices and estimate from its own figures.
 */
export const catalogWords = {
  estimateTag: "Estimate",
  about: "About",
  to: "to",
  onRequest: "Price on request",
  filter: "Filter",
  filters: "Filters",
  clearAll: "Clear all",
  clearFilters: "Clear filters",
  undo: "Undo the last filter",
  showMore: (n: number) => `Show ${n} more`,
  /** "12 of 61 pieces". */
  count: (shown: number, total: number, plural: string) => `${shown} of ${total} ${plural}`,
  /** "Show 12 pieces", on the phone's filter panel. */
  showResults: (n: number, singular: string, plural: string) => `Show ${n} ${n === 1 ? singular : plural}`,
  emptyHeading: (plural: string) => `No ${plural} match these filters`,
  emptyBody: "Try fewer filters, or tell me what you have in mind.",
  removeFilter: (label: string) => `Remove filter: ${label}`,
  noScript: "The filters need JavaScript. Every piece is listed below.",
  askRoute: (singular: string) => `Ask about a custom ${singular}`,
  askRouteBody: "Don't see what you want? Tell me about it and I'll reply with a quote.",
  contactRoute: "Contact me",
  quoteRoute: "Request a quote",
  backToCatalog: (plural: string) => `All ${plural}`,
  backToFiltered: "Back to your filtered view",
  draftTag: "Draft: not on your live site",
  closeMenu: "Close",
  quote: {
    requestQuote: "Request this quote",
    yourSelection: "Your selection",
    choosePiece: "Choose a piece",
    estimateLabel: "Estimate",
    peopleHint: (min: number, max: number) => `${min} to ${max}`,
    decrease: "Fewer",
    increase: "More",
    noScript: "To ask for a quote, write to me from the contact page.",
    summaryPiece: "Piece",
    formHeading: "Request this quote",
    changeSelection: "Change my selection",
  },
  email: {
    intro: "Here is the estimate you asked for.",
    piece: "Piece:",
    estimate: "Estimate:",
    link: "Link:",
    disclaimer: "This is an estimate, not a firm price.",
  },
} as const;
