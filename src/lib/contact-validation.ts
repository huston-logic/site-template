import { fieldLimits, needOptions, urlTopics, type Need, type UrlTopic } from "../content/contact-fields.ts";
import { cleanLine } from "../forms/clean.ts";
import { contactDefinitionFor } from "../forms/contact.ts";
import { validateSubmission } from "../forms/validate.ts";

export { cleanLine, cleanText, EMAIL_PATTERN } from "../forms/clean.ts";

/** Fields that have a Rev 7.1 error message (docs/website-plan.md B7). */
export type ContactField = "need" | "name" | "email" | "message";

export type ContactSubmission = {
  need: Need | "";
  topic: UrlTopic | "";
  name: string;
  email: string;
  business: string;
  message: string;
  tools: string;
  website: string;
  source: string;
};

export const contactKeys = ["need", "topic", "name", "email", "business", "message", "tools", "website", "source"] as const;
export type ContactInput = Partial<Record<(typeof contactKeys)[number], unknown>>;

export type ContactValidation =
  | { ok: true; value: ContactSubmission }
  | {
      ok: false;
      /** Fields to show the Rev 7.1 message for, in form order. */
      fields: ContactField[];
      /** A value no person could enter through the form (wrong type, unknown option, over the length limit). */
      malformed: boolean;
    };

function isUrlTopic(value: string): value is UrlTopic {
  return (urlTopics as readonly string[]).includes(value);
}

const textKeys = ["name", "email", "business", "message", "tools", "website", "source"] as const;

/**
 * Validates a contact submission exactly as the form does. Used by the form in the browser and by the Worker. It is the
 * contact form's entry point over the one form validator: it builds the definition for the request's topic and maps the
 * `need` value to its option label and back.
 */
export function validateContact(input: ContactInput): ContactValidation {
  let malformed = false;
  const raw = (key: (typeof contactKeys)[number]): string => {
    const value = input[key];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      malformed = true;
      return "";
    }
    return value;
  };

  const topicValue = cleanLine(raw("topic"));
  let topic: UrlTopic | "" = "";
  if (isUrlTopic(topicValue)) topic = topicValue;
  else if (topicValue !== "") malformed = true;
  const partner = topic === "partner";

  const needValue = cleanLine(raw("need"));
  const option = needOptions.find((candidate) => candidate.value === needValue);
  if (option === undefined && needValue !== "") malformed = true;

  const answers: Record<string, unknown> = {};
  for (const key of textKeys) if (input[key] !== undefined) answers[key] = input[key];
  // `tools` is one line in the form. Its limit (500) is above a short-text field's, so the file calls it long-text; the
  // line cleaning it always had is kept here, after the limit is judged on what was sent.
  const tools = raw("tools");
  if (tools.length > fieldLimits.tools) malformed = true;
  if (answers["tools"] !== undefined && typeof answers["tools"] === "string") answers["tools"] = cleanLine(tools);
  if (!partner) answers["need"] = option?.label ?? "";

  const result = validateSubmission(contactDefinitionFor(topic), answers);
  if (!result.ok) return { ok: false, fields: result.fields as ContactField[], malformed: malformed || result.malformed };
  if (malformed) return { ok: false, fields: [], malformed: true };
  const text = (key: (typeof textKeys)[number]): string => result.value[key] as string;
  return {
    ok: true,
    value: {
      need: partner ? "" : (option?.value ?? ""),
      topic,
      name: text("name"),
      email: text("email"),
      business: text("business"),
      message: text("message"),
      tools: text("tools"),
      website: text("website"),
      source: text("source"),
    },
  };
}
