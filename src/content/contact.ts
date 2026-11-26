import { contactDefinitionFor } from "../forms/contact.ts";

/**
 * Contact form, thank-you page and 404 copy (the contact page itself is src/content/pages/contact.json). Client-specific text is a double-bracket placeholder.
 * The form's own fields (labels, limits, options, error messages, the button) are in `src/content/forms/contact.json`; `noteForm` reads them
 * from there so a test or a page can still name them, and this module keeps only what is not a field: headings, placeholders that follow
 * the chosen need, the empty choice of a menu and the send errors. The Worker also reads this module's `thanks`.
 */
const fields = new Map(contactDefinitionFor("").fields.map((field) => [field.id, field]));
const labelOf = (id: string): string => fields.get(id)?.label ?? "";
const errorOf = (id: string): string => fields.get(id)?.error ?? "";

/** The empty first choice of a menu, shared with the generic forms. */
export const selectEmpty = "Choose one";

export const noteForm = {
  heading: "[[Contact form heading]]",
  partnerHeading: "[[Partner contact form heading]]",
  needLegend: labelOf("need"),
  name: { label: labelOf("name") },
  email: { label: labelOf("email") },
  business: { label: labelOf("business") },
  message: {
    label: labelOf("message"),
    placeholders: {
      website: "[[Example message for a website request]]",
      workflow: "[[Example message for a workflow request]]",
      other: "[[Example message for another request]]",
    },
  },
  tools: {
    label: labelOf("tools"),
    placeholders: {
      website: "[[Example answer]]",
      workflow: "[[Example answer]]",
      other: "[[Example answer]]",
    },
  },
  website: { label: labelOf("website") },
  source: { label: labelOf("source"), empty: selectEmpty },
  privacyNote: fields.get("message")?.help ?? "",
  submitLabel: contactDefinitionFor("").button,
  errors: {
    need: errorOf("need"),
    name: errorOf("name"),
    email: errorOf("email"),
    message: errorOf("message"),
  },
  sendErrors: {
    notVerified: "That didn't go through. Please try again.",
    rateLimited: "Too many tries in a row. Wait a minute and try again.",
    failed: "[[Message shown when sending fails, with a fallback email address]]",
  },
};

export const thanks = {
  title: "[[Thank-you page title]]",
  description: "[[Thank-you page description]]",
  heading: "[[Thank-you heading]]",
  /** With the first name the form saved in sessionStorage. */
  headingWithName: "[[Thank-you heading for {firstName}]]",
  body: "[[Thank-you text, mentioning the automatic reply]]",
  /** Replaces `body` when the automatic reply failed to send but the note reached the owner. */
  bodyAutoReplyFailed: "[[Thank-you text when the automatic reply did not send]]",
  pickTimeLabel: "[[Pick a time button label]]",
  after: { lead: "[[What happens after the call? lead]]", label: "[[Link label]]", href: "/services" },
  meanwhile: {
    lead: "[[While you wait lead]]",
    links: [
      { label: "[[Link 1 label]]", href: "/services" },
      { label: "[[Link 2 label]]", href: "/about" },
    ],
  },
};

export const notFound = {
  title: "Page not found | [[Business name]]",
  heading: "Page not found",
  body: "[[404 message]]",
  homeLabel: "Back to home",
  callLabel: "[[404 secondary link label]]",
};
