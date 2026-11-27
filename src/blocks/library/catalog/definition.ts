import { defineBlock } from "../../schema.ts";

export const catalogDefinition = defineBlock({
  type: "catalog",
  title: "Catalog",
  description:
    "Every piece in your catalog as a card with its photo, name and price estimate, with filters, a count and a Show more button. Each card opens the piece's own page, where the visitor chooses options and asks for a quote. Without JavaScript every piece is listed. It is left out of the page while no piece is visible.",
  source: "library",
  collection: "catalog",
  interactive: "The filter bar, the count, the empty state and Show more need JavaScript; they show and hide the cards the server already drew, so the whole catalog still lists without it.",
  fields: {
    heading: { kind: "text", label: "Heading", max: 90 },
    intro: { kind: "text", label: "Introduction", max: 280, required: false },
  },
  variants: [
    { name: "grid", description: "Four cards across on wide screens and two on phones: a tall photo, the name and a price estimate." },
    { name: "showcase", description: "Three larger cards across on wide screens and one on phones, with the name set larger and a quiet line of facts under it." },
  ],
  placement: { position: "any", maxPerPage: 1, rhythm: "section" },
  motion: { entrance: "none", reason: "The filter bar reveals and hides cards itself, so the grid stays still and never moves under the visitor's pointer." },
  example: {
    heading: "A short heading for the catalog",
    intro: "A sentence that says what the pieces are and how to narrow them down.",
  },
});
