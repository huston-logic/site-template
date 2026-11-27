// The few words the item page and the quote builder need beyond src/content/catalog.ts: names for landmarks and the photo
// buttons. No visitor input, no business facts.
export const itemWords = {
  breadcrumb: "Breadcrumb",
  photos: "Photos",
  photo: (n: number, of: number, alt: string) => `Photo ${n} of ${of}: ${alt}`,
  chooseLabel: "Piece",
  summaryOption: (group: string) => group,
} as const;
