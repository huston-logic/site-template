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
  count: (shown: number, total: number, plural: string) => (shown === total ? `${total} ${plural}` : `${shown} of ${total} ${plural}`),
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
  photos: "Photos",
  photo: (n: number, of: number, alt: string) => `Photo ${n} of ${of}: ${alt}`,
  /** The link to a full photo for a visitor without JavaScript. */
  photoLink: (n: number, of: number) => `Photo ${n} of ${of}`,
  /** Said after a filter value's number: "12 (12 pieces)". */
  facetCount: (n: number, singular: string, plural: string) => ` (${n} ${n === 1 ? singular : plural})`,
  quote: {
    requestQuote: "Request this quote",
    yourSelection: "Your selection",
    choosePiece: (singular: string) => `${singular.charAt(0).toUpperCase()}${singular.slice(1)}`,
    /** The select's first option, the prompt. */
    choosePrompt: (singular: string) => `Choose a ${singular}`,
    estimateLabel: "Estimate",
    estimateSpoken: "Estimate:",
    peopleHint: (min: number, max: number) => `${min} to ${max}`,
    /** The stepper buttons, named with the field's label in lowercase. */
    decrease: (label: string) => `Fewer ${label}`,
    increase: (label: string) => `More ${label}`,
    noScript: "To ask for a quote, write to me from the contact page.",
    summaryPiece: "Piece",
    formHeading: "Your details",
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
