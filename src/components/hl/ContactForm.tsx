"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type SyntheticEvent } from "react";
import { Text } from "@/components/ui/Text";
import { noteForm } from "@/content/contact";
import { honeypot, needOptions, urlTopics, type Need, type UrlTopic } from "@/content/contact-fields";
import { providers } from "@/content/providers";
import { contactDefinitionFor } from "@/forms/contact";
import type { FormField } from "@/forms/schema";
import { saveHandoff } from "@/lib/contact-handoff";
import { validateContact, type ContactField, type ContactInput } from "@/lib/contact-validation";
import { firstName } from "@/lib/first-name";
import { errorFor, FieldView, Honeypot, SubmitButton, type FieldIds } from "./form/controls";
import { turnstileSiteKey, useTurnstile } from "./useTurnstile";

type Errors = Partial<Record<ContactField, string>>;
type SendError = keyof typeof noteForm.sendErrors;

const CONTACT_FIELDS: readonly string[] = ["need", "name", "email", "message"];

/** The contact form's element ids, as they have always been: `cf-<field>`, with the website field's `cf-site` and the one help line `cf-privacy`. */
function idsFor(field: FormField): FieldIds {
  const input = `cf-${field.id === "website" ? "site" : field.id}`;
  return { input, help: "cf-privacy", error: `${input}-error` };
}

function asUrlTopic(value: string | null): UrlTopic | "" {
  return value !== null && (urlTopics as readonly string[]).includes(value) ? (value as UrlTopic) : "";
}

/**
 * The contact form (docs/website-plan.md B7). Its fields come from src/content/forms/contact.json, drawn by the same
 * primitives as the `form` block. It validates with the same rules as the Worker (`src/lib/contact-validation.ts`), gets a
 * Turnstile token, and posts JSON to `/api/contact` (worker/contact.ts). Only a real success moves on to /contact/thanks,
 * with the first name passed through sessionStorage, never the URL. Every failure keeps the visitor's answers. No
 * `action`, and `method="post"`, so without JavaScript nothing is sent and nothing lands in the URL.
 */
function Form({ urlTopic }: { urlTopic: string | null }) {
  const topic = asUrlTopic(urlTopic);
  const partner = topic === "partner";
  const definition = contactDefinitionFor(topic);
  const router = useRouter();
  const preselected = topic === "website" || topic === "workflow" ? needOptions.find((option) => option.value === topic)?.label : undefined;
  const [need, setNeed] = useState<string>(preselected ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const {
    containerRef: turnstileRef,
    start: startTurnstile,
    getToken,
    reset: resetTurnstile,
    isConfigError: turnstileConfigError,
  } = useTurnstile(providers.turnstileSiteKey);

  const needValue: Need | null = needOptions.find((option) => option.label === need)?.value ?? null;
  const key = needValue === "website" || needValue === "workflow" ? needValue : "other";
  const needChoices = (definition.fields.find((field) => field.id === "need")?.options ?? []).map((label) => ({
    value: needOptions.find((option) => option.label === label)?.value ?? label,
    label,
  }));

  function showFieldErrors(fields: ContactField[]) {
    const next: Errors = {};
    for (const field of definition.fields) if (fields.includes(field.id as ContactField)) next[field.id as ContactField] = errorFor(field);
    setErrors(next);
    const first = definition.fields.find((field) => next[field.id as ContactField]);
    if (!first) return;
    const target =
      first.id === "need"
        ? formRef.current?.querySelector<HTMLInputElement>('input[name="need"]')
        : formRef.current?.querySelector<HTMLElement>(`#${idsFor(first).input}`);
    target?.focus();
  }

  function fail(error: SendError) {
    resetTurnstile();
    setSending(false);
    setSendError(error);
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (sending || !formRef.current) return;
    const data = new FormData(formRef.current);
    const text = (field: string) => {
      const value = data.get(field);
      return typeof value === "string" ? value : "";
    };
    const answers: ContactInput = {
      need: needValue ?? "",
      topic,
      name: text("name"),
      email: text("email"),
      message: text("message"),
      business: text("business"),
      tools: text("tools"),
      website: text("website"),
      source: text("source"),
    };

    setSendError(null);
    const result = validateContact(answers);
    if (!result.ok) {
      showFieldErrors(result.fields);
      if (result.fields.length === 0) setSendError("notVerified");
      return;
    }
    setErrors({});
    // A missing site key can't verify anything, so it is an honest failure. The launch gate checks the key itself.
    if (!turnstileSiteKey(providers.turnstileSiteKey)) {
      setSendError("failed");
      return;
    }

    setSending(true);
    const token = await getToken();
    // A Turnstile setup error (for example a hostname missing from the widget) is our fault, so retrying can't help.
    if (!token) return fail(turnstileConfigError() ? "failed" : "notVerified");

    let response: Response;
    try {
      response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...answers, [honeypot.name]: text(honeypot.name), turnstileToken: token }),
      });
    } catch {
      return fail("failed");
    }
    const body = (await response.json().catch(() => null)) as { ok?: boolean; autoReply?: boolean; error?: string; fields?: unknown } | null;

    if (response.ok && body?.ok === true) {
      saveHandoff(firstName(result.value.name), body.autoReply !== false);
      router.push("/contact/thanks");
      return;
    }
    if (response.status === 400 && body?.error === "invalid" && Array.isArray(body.fields)) {
      resetTurnstile();
      setSending(false);
      showFieldErrors(body.fields.filter((f): f is ContactField => CONTACT_FIELDS.includes(f as string)));
      return;
    }
    if (response.status === 429) return fail("rateLimited");
    if (body?.error === "rejected") return fail("notVerified");
    return fail("failed");
  }

  return (
    <div className="rounded-panel bg-white p-6 shadow-card md:p-9">
      <h2 className="font-ui text-card-title font-bold">
        {partner ? noteForm.partnerHeading : noteForm.heading}
      </h2>

      <form ref={formRef} method="post" noValidate onSubmit={submit} onFocus={startTurnstile} className="mt-6 space-y-6">
        <input type="hidden" name="topic" value={topic} />

        {definition.fields.map((field) => {
          const placeholder = field.id === "message" ? noteForm.message.placeholders[key] : field.id === "tools" ? noteForm.tools.placeholders[key] : undefined;
          return (
            <FieldView
              key={field.id}
              field={field}
              ids={idsFor(field)}
              label={field.label}
              error={errors[field.id as ContactField]}
              rich={false}
              placeholder={placeholder}
              oneLine={field.id === "tools"}
              emptyChoice={noteForm.source.empty}
              chips={
                field.display === "buttons"
                  ? {
                      options: needChoices,
                      selected: needValue ?? "",
                      onSelect: (value) => {
                        setNeed(needChoices.find((choice) => choice.value === value)?.label ?? "");
                        setErrors((previous) => ({ ...previous, need: undefined }));
                      },
                    }
                  : undefined
              }
            />
          );
        })}

        <Honeypot id="cf-fax" />

        <div>
          {/* Turnstile draws here only if Cloudflare needs the visitor to click. */}
          <div ref={turnstileRef} className="not-empty:mb-4" />
          <SubmitButton label={definition.button} sending={sending} />
        </div>

        <div role="status">
          {sendError ? (
            <p className="text-label text-rust">
              <Text>{noteForm.sendErrors[sendError]}</Text>
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function FormFromUrl() {
  const topic = useSearchParams().get("topic");
  return <Form key={topic ?? ""} urlTopic={topic} />;
}

/** A static page cannot read the query at build time, so the form reads ?topic= in the browser. Before that (and without JS) it shows the unselected form. */
export function ContactForm() {
  return (
    <Suspense fallback={<Form urlTopic={null} />}>
      <FormFromUrl />
    </Suspense>
  );
}
