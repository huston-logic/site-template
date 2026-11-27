import { defineBlock } from "../../schema.ts";

export const quoteBuilderDefinition = defineBlock({
  type: "quote-builder",
  title: "Quote builder",
  description:
    "A panel where the visitor picks a piece, chooses its options, sees the price estimate change and asks for a quote. Name a piece to preselect it; otherwise the visitor chooses from every visible piece. It is left out of the page while no piece is visible.",
  source: "library",
  collection: "catalog",
  interactive: "The options, the changing estimate and the quote form need JavaScript. Without it the panel shows the contact route.",
  fields: {
    heading: { kind: "text", label: "Heading", max: 90 },
    intro: { kind: "text", label: "Introduction", max: 280, required: false },
    item: { kind: "catalog-item", label: "Piece", required: false, help: "The piece to preselect. Leave empty to let the visitor choose." },
  },
  variants: [
    { name: "panel", description: "One centred panel with the heading and introduction above the builder." },
    { name: "beside", description: "The heading and introduction on the left, the builder panel on the right (stacked on phones)." },
  ],
  placement: { position: "any", maxPerPage: 1, rhythm: "section" },
  motion: { entrance: "default" },
  example: {
    heading: "A short heading that invites a quote request",
    intro: "A sentence that says what the visitor can choose and what happens after they ask.",
  },
});
