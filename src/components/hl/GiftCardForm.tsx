"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type SyntheticEvent } from "react";
import { formatMoney } from "@/catalog/price";
import { honeypot } from "@/content/contact-fields";
import { giftCardWords as words } from "@/content/gift-cards";
import { providers } from "@/content/providers";
import { loadFields, saveFields, type StorageLike } from "@/gift-cards/browser-storage";
import {
  chosenAmount,
  checkoutBody,
  emptyValues,
  FIELD_ORDER,
  giftCardProblems,
  MESSAGE_MAX,
  OTHER_CHOICE,
  type GiftCardField,
  type GiftCardValues,
} from "@/gift-cards/form-check";
import type { GiftCardSettings } from "@/gift-cards/schema";
import type { PaymentCurrency } from "@/payments/config";
import { track } from "@/tracking/track";
import { ErrorLine, Honeypot, inputClass, labelClass, SubmitButton } from "./form/controls";
import { turnstileSiteKey, useTurnstile } from "./useTurnstile";

type Errors = Partial<Record<GiftCardField, string>>;
type SendError = keyof typeof words.errors;

const textareaClass =
  "mt-2 block min-h-30 w-full rounded-field border border-ink-2 bg-white px-3.5 py-3 font-text text-control text-ink placeholder:text-ink-2 focus:border-ink aria-[invalid=true]:border-rust";

const browserStorage = (kind: "session" | "local"): StorageLike | null => {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

/** The symbol in front of the "Other amount" box ("$"), taken from the currency so it never disagrees with the cards. */
function currencySymbol(currency: PaymentCurrency): string {
  const part = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((entry) => entry.type === "currency");
  return part?.value ?? "";
}

type TextFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
  /** Shown beside the hint, on the right (the message's count). */
  aside?: ReactNode;
};

/** A label, its control, a hint and the live error line, wired together by id. */
function Labeled({ id, label, hint, error, children, aside }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : undefined, aside ? `${id}-aside` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(describedBy)}
      {hint || aside ? (
        <div className="mt-2 flex items-start justify-between gap-4 text-small text-ink-2">
          {hint ? <p id={`${id}-hint`}>{hint}</p> : <span />}
          {aside}
        </div>
      ) : null}
      <ErrorLine id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * The gift card form (spec R14, R9). A radio card per amount the owner lists, "Other amount" when a range is set, then the
 * buyer's and the recipient's details. It checks what a person can fix before sending, gets a Turnstile token (action
 * `gift_card`, loaded on first focus) and posts JSON to `/api/gift-cards/checkout`; the Worker is the authority and charges only
 * the amount it works out from the owner's file. On `{ url }` it saves the fields (never the token) for a cancel, reports
 * `begin_checkout` and leaves for Stripe's page. Coming back with `?checkout=cancelled` restores the fields and says
 * nothing was charged. No `action`, `method="post"`, so without JavaScript nothing is sent. Answers never go in a URL.
 */
export function GiftCardForm({ settings, currency }: { settings: GiftCardSettings; currency: PaymentCurrency }) {
  const prefix = useId();
  const [values, setValues] = useState<GiftCardValues>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { containerRef: turnstileRef, start: startTurnstile, getToken, reset: resetTurnstile, isConfigError: turnstileConfigError } = useTurnstile(providers.turnstileSiteKey, "gift_card");

  // Back from Stripe without paying: the page's own address carries only the flag, and the choices come from this tab's storage.
  // The page's first render is the static HTML's, so the restore waits one tick (a microtask) rather than setting state in the effect body.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("checkout") !== "cancelled") return;
    let gone = false;
    queueMicrotask(() => {
      if (gone) return;
      const saved = loadFields(browserStorage("session"));
      if (saved) setValues(saved);
      setCancelled(true);
    });
    return () => {
      gone = true;
    };
  }, []);

  // The browser's back button restores this page from its cache with the button still busy; a token is also used up.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setSending(false);
      resetTurnstile();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [resetTurnstile]);

  const money = (amount: number) => formatMoney(amount, currency);
  const other = values.choice === OTHER_CHOICE;
  const range = settings.custom;
  const idFor = (field: GiftCardField) => `${prefix}-${field}`;

  const messages: Record<GiftCardField, string> = {
    amount: words.fieldErrors.amount,
    custom: range === null ? words.fieldErrors.amount : words.fieldErrors.customAmount(money(range.min), money(range.max)),
    buyerName: words.fieldErrors.buyerName,
    buyerEmail: words.fieldErrors.buyerEmail,
    recipientName: words.fieldErrors.recipientName,
    message: words.fieldErrors.message,
    recipientEmail: words.fieldErrors.recipientEmail,
  };

  function showErrors(fields: readonly GiftCardField[]) {
    const next: Errors = {};
    for (const field of fields) next[field] = messages[field];
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field] !== undefined);
    if (first === undefined) return;
    document.getElementById(first === "amount" ? `${idFor("amount")}-0` : idFor(first))?.focus();
  }

  function change(field: keyof GiftCardValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    const clears: GiftCardField[] = field === "choice" ? ["amount", "custom"] : [field];
    setErrors((previous) => (clears.some((key) => previous[key] !== undefined) ? Object.fromEntries(Object.entries(previous).filter(([key]) => !clears.includes(key as GiftCardField))) : previous));
  }
  const onText = (field: keyof GiftCardValues) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(field, event.target.value);

  function fail(error: SendError) {
    resetTurnstile();
    setSending(false);
    setSendError(error);
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (sending || !formRef.current) return;
    setSendError(null);
    const problems = giftCardProblems(settings, values);
    const choice = chosenAmount(values);
    if (problems.length > 0 || choice === null) {
      showErrors(problems.length > 0 ? problems : ["amount"]);
      return;
    }
    setErrors({});
    // A missing site key can't verify anything, so it is an honest failure. The launch gate checks the key itself.
    if (!turnstileSiteKey(providers.turnstileSiteKey)) return setSendError("unavailable");

    setSending(true);
    const token = await getToken();
    if (!token) return fail(turnstileConfigError() ? "unavailable" : "verification");

    const trap = new FormData(formRef.current).get(honeypot.name);
    let response: Response;
    try {
      response = await fetch("/api/gift-cards/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...checkoutBody(values, choice, window.location.pathname), [honeypot.name]: typeof trap === "string" ? trap : "", turnstileToken: token }),
      });
    } catch {
      return fail("unavailable");
    }
    const body = (await response.json().catch(() => null)) as { url?: unknown; error?: unknown; fields?: unknown } | null;

    // Stripe's hosted page is the only place the buyer is sent; anything else in the answer is not trusted.
    if (response.ok && typeof body?.url === "string" && body.url.startsWith("https://")) {
      saveFields(browserStorage("session"), values);
      track("begin_checkout", { value: choice.amount, currency: currency.toUpperCase() });
      window.location.assign(body.url);
      return;
    }
    if (response.status === 400 && Array.isArray(body?.fields)) {
      const named = new Set<GiftCardField>();
      for (const field of body.fields) {
        if (field === "choice" || field === "amount") named.add(other ? "custom" : "amount");
        else if ((FIELD_ORDER as readonly unknown[]).includes(field)) named.add(field as GiftCardField);
      }
      resetTurnstile();
      setSending(false);
      if (named.size > 0) return showErrors(FIELD_ORDER.filter((field) => named.has(field)));
      return setSendError("refused");
    }
    if (response.status === 409 && body?.error === "closed") return fail("closed");
    if (response.status === 429) return fail("rateLimited");
    if ((response.status === 400 || response.status === 403) && body?.error === "rejected") return fail("verification");
    if (response.status === 400) return fail("refused");
    return fail("unavailable");
  }

  const symbol = currencySymbol(currency);
  const amountDescribed = errors.amount ? `${idFor("amount")}-error` : undefined;
  const cards: { value: string; label: string; note?: string }[] = [
    ...settings.amounts.map((entry) => ({ value: String(entry.amount), label: money(entry.amount), ...(entry.label === undefined ? {} : { note: entry.label }) })),
    ...(range === null ? [] : [{ value: OTHER_CHOICE, label: words.otherAmount }]),
  ];

  return (
    <div className="hl-js-only rounded-panel bg-white p-6 shadow-card md:p-9">
      <div role="status" aria-live="polite">
        {cancelled ? <p className="mb-7 rounded-card bg-tint p-4 text-list">{words.cancelled}</p> : null}
      </div>
      <form ref={formRef} method="post" noValidate onSubmit={submit} onFocus={startTurnstile} className="space-y-7">
        <fieldset role="radiogroup" aria-required="true" aria-describedby={amountDescribed} aria-invalid={errors.amount || errors.custom ? "true" : undefined}>
          <legend className={labelClass}>{words.amountLegend}</legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {cards.map((card, index) => {
              const on = values.choice === card.value;
              return (
                <label key={card.value} className="relative block">
                  <input
                    id={`${idFor("amount")}-${index}`}
                    type="radio"
                    name={idFor("amount")}
                    value={card.value}
                    checked={on}
                    onChange={() => change("choice", card.value)}
                    aria-describedby={card.value === OTHER_CHOICE && on ? `${idFor("custom")}-hint` : amountDescribed}
                    className="peer sr-only"
                  />
                  <span
                    className={`flex min-h-20 cursor-pointer flex-col justify-center rounded-card border px-4 py-3 font-ui peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-rust ${
                      on ? "border-ink bg-ink text-silver" : errors.amount ? "border-rust text-ink" : "border-ink-2 text-ink"
                    }`}
                  >
                    <span className={`${card.value === OTHER_CHOICE ? "text-item" : "text-card-title"} font-bold`}>{card.label}</span>
                    {card.note ? <span className="mt-1 text-small font-medium">{card.note}</span> : null}
                    {on ? <span aria-hidden="true" className="absolute right-3 top-3 size-2 rounded-pill bg-rust" /> : null}
                  </span>
                </label>
              );
            })}
          </div>
          <ErrorLine id={`${idFor("amount")}-error`} message={errors.amount} />
          {other && range !== null ? (
            <div className="mt-5">
              <label htmlFor={idFor("custom")} className={labelClass}>
                {words.otherAmountLabel}
              </label>
              <div className="relative max-w-60">
                <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 mt-1 -translate-y-1/2 font-text text-control text-ink-2">
                  {symbol}
                </span>
                <input
                  id={idFor("custom")}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={7}
                  value={values.custom}
                  onChange={onText("custom")}
                  aria-invalid={errors.custom ? "true" : undefined}
                  aria-describedby={[`${idFor("custom")}-hint`, errors.custom ? `${idFor("custom")}-error` : undefined].filter(Boolean).join(" ")}
                  className={`${inputClass} pl-8`}
                />
              </div>
              <p id={`${idFor("custom")}-hint`} className="mt-2 text-small text-ink-2">
                {words.otherAmountHint(money(range.min), money(range.max))}
              </p>
              <ErrorLine id={`${idFor("custom")}-error`} message={errors.custom} />
            </div>
          ) : null}
        </fieldset>

        <div className="grid gap-7 md:grid-cols-2 md:gap-5">
          <Labeled id={idFor("buyerName")} label={words.buyerNameLabel} error={errors.buyerName}>
            {(describedBy) => (
              <input id={idFor("buyerName")} name="buyerName" type="text" autoComplete="name" maxLength={100} value={values.buyerName} onChange={onText("buyerName")} aria-required="true" aria-invalid={errors.buyerName ? "true" : undefined} aria-describedby={describedBy} className={inputClass} />
            )}
          </Labeled>
          <Labeled id={idFor("buyerEmail")} label={words.buyerEmailLabel} hint={words.buyerEmailHint} error={errors.buyerEmail}>
            {(describedBy) => (
              <input id={idFor("buyerEmail")} name="buyerEmail" type="email" autoComplete="email" maxLength={254} value={values.buyerEmail} onChange={onText("buyerEmail")} aria-required="true" aria-invalid={errors.buyerEmail ? "true" : undefined} aria-describedby={describedBy} className={inputClass} />
            )}
          </Labeled>
        </div>

        <Labeled id={idFor("recipientName")} label={words.recipientNameLabel} error={errors.recipientName}>
          {(describedBy) => (
            <input id={idFor("recipientName")} name="recipientName" type="text" autoComplete="off" maxLength={100} value={values.recipientName} onChange={onText("recipientName")} aria-invalid={errors.recipientName ? "true" : undefined} aria-describedby={describedBy} className={inputClass} />
          )}
        </Labeled>

        <Labeled
          id={idFor("message")}
          label={words.messageLabel}
          hint={words.messageHint}
          error={errors.message}
          aside={
            <span id={`${idFor("message")}-aside`} className="shrink-0">
              {words.messageCount(values.message.length, MESSAGE_MAX)}
            </span>
          }
        >
          {(describedBy) => (
            <textarea id={idFor("message")} name="message" rows={4} maxLength={MESSAGE_MAX} value={values.message} onChange={onText("message")} aria-invalid={errors.message ? "true" : undefined} aria-describedby={describedBy} className={textareaClass} />
          )}
        </Labeled>

        <Labeled id={idFor("recipientEmail")} label={words.recipientEmailLabel} hint={words.recipientEmailHint} error={errors.recipientEmail}>
          {(describedBy) => (
            <input id={idFor("recipientEmail")} name="recipientEmail" type="email" autoComplete="off" maxLength={254} value={values.recipientEmail} onChange={onText("recipientEmail")} aria-invalid={errors.recipientEmail ? "true" : undefined} aria-describedby={describedBy} className={inputClass} />
          )}
        </Labeled>

        <Honeypot id={`${prefix}-fax`} />

        <div>
          {/* Turnstile draws here only if Cloudflare needs the visitor to click. */}
          <div ref={turnstileRef} className="not-empty:mb-4" />
          <SubmitButton label={sending ? words.working : words.button} sending={sending} />
          <p className="mt-4 text-small text-ink-2">{words.payNote}</p>
        </div>

        <div role="status">{sendError ? <p className="text-label text-rust">{words.errors[sendError]}</p> : null}</div>
      </form>
    </div>
  );
}
