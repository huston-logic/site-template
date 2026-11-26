// The contact form as the first form: its fields are src/content/forms/contact.json; what stays code (the partner
// variant, the topic, the 16 KB body limit) is here. Import-free apart from sibling shared modules and the JSON file.
import contactFile from "../content/forms/contact.json" with { type: "json" };
import type { UrlTopic } from "../content/contact-fields.ts";
import { CONTACT_FORM_ID, DEFAULT_FORM_SETTINGS } from "./schema.ts";
import type { FormDefinition } from "./schema.ts";
import { parseForm } from "./validate.ts";

/** The contact form keeps its own, smaller body limit (R13): a 17,000-character message is refused with 413. */
export const CONTACT_BODY_BYTES = 16384;

let parsed: FormDefinition | null = null;

/** The contact form for a request's topic. The partner variant has no `need` question. A fresh copy each call. */
export function contactDefinitionFor(topic: UrlTopic | ""): FormDefinition {
  parsed ??= parseForm(contactFile, DEFAULT_FORM_SETTINGS, CONTACT_FORM_ID);
  if (parsed === null) throw new Error("src/content/forms/contact.json is not a valid form; run npm run check:content for the reason.");
  const fields = parsed.fields.filter((field) => !(topic === "partner" && field.id === "need")).map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) }));
  return { ...parsed, fields };
}
