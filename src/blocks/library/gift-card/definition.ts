import { defineBlock } from "../../schema.ts";

export const giftCardDefinition = defineBlock({
  type: "gift-card",
  title: "Gift cards",
  description:
    "Sells gift cards: the visitor chooses one of the amounts you list (or an amount of their own, if you allow one), says who it is for and pays on Stripe's own page. The amounts, the redeem wording and the terms come from the gift card settings, not from this block. While selling is off it shows a plain note that gift cards are not on sale. It can only be on a live page once the site's payments are set up.",
  source: "library",
  interactive: "Choosing an amount, the form checks and the payment all need JavaScript. Without it the panel says so and gives the contact route.",
  fields: {
    heading: { kind: "text", label: "Heading", max: 90 },
    intro: { kind: "text", label: "Introduction", max: 280, required: false },
  },
  variants: [
    { name: "panel", description: "One centred column: the heading and introduction above the form panel, the redeem wording and terms below it." },
    { name: "beside", description: "The heading, introduction, redeem wording and terms on the left, the form panel on the right (stacked on phones)." },
  ],
  placement: { position: "any", maxPerPage: 1, rhythm: "section" },
  motion: { entrance: "default" },
  example: {
    heading: "A short heading that invites someone to give a gift card",
    intro: "A sentence that says what the card is for and what happens after the buyer pays.",
  },
});
