import { defineBlock } from "../../schema.ts";

export const bookingDefinition = defineBlock({
  type: "booking",
  title: "Booking",
  description:
    "Lets a visitor book a time: they choose one of your services, say how many people are coming, pick a day and a time for each session, leave their details and, where you ask for it, pay a deposit or the whole price on Stripe's own page. The services, hours, prices and wording come from the booking settings, not from this block, and every booking goes on your calendar. You can name a service to start with selected. It can only be on a live page once booking is connected for the site, and a page can hold one.",
  source: "library",
  interactive: "Choosing a service, the times and the booking itself all need JavaScript. Without it the block lists the services and says how to get in touch.",
  fields: {
    heading: { kind: "text", label: "Heading", max: 90 },
    intro: { kind: "text", label: "Introduction", max: 280, required: false },
    service: { kind: "text", label: "Service to start with (its id in the booking settings)", max: 60, required: false },
  },
  variants: [{ name: "panel", description: "One centred column: the heading and introduction above the booking panel, with the policy and the way to get in touch inside it." }],
  placement: { position: "any", maxPerPage: 1, rhythm: "section" },
  motion: { entrance: "default" },
  example: {
    heading: "A short heading that invites someone to book",
    intro: "A sentence that says what happens when they choose a time.",
  },
});
