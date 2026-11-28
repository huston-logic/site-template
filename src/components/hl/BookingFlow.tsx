"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { CHECKOUT_PATH, FREE_SUMMARY_KEY, RELEASE_PATH, RESUME_KEY, type CheckoutAnswer, type CheckoutRequest, type ReleaseRequest } from "@/booking/api";
import { findService } from "@/booking/validate";
import { formatLocal } from "@/booking/zone";
import type { BookingFlowProps } from "@/blocks/library/booking/flow-slot-props";
import { bookingWords as words } from "@/content/booking";
import { honeypot } from "@/content/contact-fields";
import { providers } from "@/content/providers";
import type { FormField } from "@/forms/schema";
import { validateSubmission } from "@/forms/submission";
import { amountsFor, clearResume, loadResume, moneyText, saveResume, type StorageLike } from "@/lib/booking-flow";
import { track } from "@/tracking/track";
import { BookingSummary, type SummaryData } from "./booking/BookingSummary";
import { PartyStepper } from "./booking/PartyStepper";
import { ServiceCards } from "./booking/ServiceCards";
import { SessionPicker } from "./booking/SessionPicker";
import { errorFor, FieldView, Honeypot, labelFor, SubmitButton, type FieldIds } from "./form/controls";
import { TextLink } from "./TextLink";
import { turnstileSiteKey, useTurnstile } from "./useTurnstile";

type SendError = keyof typeof words.errors;

const browserStorage = (kind: "session" | "local"): StorageLike | null => {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

/** The piece a visitor came from: `?item=<slug>` is honoured only when /catalog.json knows the slug. */
async function pieceName(slug: string): Promise<string | null> {
  try {
    const response = await fetch("/catalog.json", { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const data = (await response.json()) as { items?: Record<string, { name?: unknown }> };
    const name = data.items?.[slug]?.name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/**
 * The booking flow (design R16): the service, the people, then each session's day and time in turn, the booking form, a summary
 * and one button. It sends choices only (the Worker computes every amount, never a price from here), gets a Turnstile token
 * (action `booking`, loaded on first focus) and posts JSON to the checkout route. A paid booking leaves for Stripe's page after
 * saving its choices in sessionStorage; coming back with `?checkout=cancelled` restores them and releases the held times. A free
 * one goes straight to the thank-you page. No `action`, `method="post"`, so without JavaScript nothing is sent.
 */
export function BookingFlow({ view, service: startService }: BookingFlowProps) {
  const { settings, currency, timeZone, form, giftCardLine, contact } = view;
  const services = settings.services;
  const prefix = useId();
  const router = useRouter();
  // Nothing is chosen in the first render (the static HTML's); a named or only service is selected right after.
  const [serviceId, setServiceId] = useState<string | null>(null);
  const service = serviceId === null ? null : findService(settings, serviceId);
  const [party, setPartyState] = useState(1);
  const [starts, setStarts] = useState<number[]>([]);
  const [refresh, setRefresh] = useState<Record<number, number>>({});
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ index: number; text: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [cleared, setCleared] = useState<string | null>(null);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const focusDetails = useRef(false);
  const [item, setItem] = useState<{ slug: string; name: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const restored = useRef<Record<string, string | boolean> | null>(null);
  const { containerRef: turnstileRef, start: startTurnstile, getToken, reset: resetTurnstile, isConfigError: turnstileConfigError } = useTurnstile(providers.turnstileSiteKey, "booking");

  const count = service?.sessions.length ?? 0;
  const complete = service !== null && starts.length === count && count > 0;

  // Arriving with an address that names a service or a piece, or back from Stripe without paying. The first render is the
  // static HTML's, so each change waits one tick (a microtask) rather than setting state in the effect body.
  useEffect(() => {
    let gone = false;
    queueMicrotask(async () => {
      if (gone) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout") === "cancelled") {
        const storage = browserStorage("session");
        const saved = loadResume(storage, RESUME_KEY);
        if (saved !== null && findService(settings, saved.service) !== null) {
          setServiceId(saved.service);
          setPartyState(saved.party);
          setStarts(saved.starts);
          restored.current = saved.answers;
          if (saved.item !== null) {
            const name = await pieceName(saved.item);
            if (!gone && name !== null) setItem({ slug: saved.item, name });
          }
          if (saved.sessionId !== null) {
            const release: ReleaseRequest | null = saved.releaseToken === null ? null : { sessionId: saved.sessionId, releaseToken: saved.releaseToken };
            if (release !== null) void fetch(RELEASE_PATH, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(release) }).catch(() => undefined);
          }
          clearResume(storage, RESUME_KEY);
        }
        if (!gone) setCancelled(true);
        return;
      }
      const wanted = params.get("service") ?? startService ?? (settings.services.length === 1 ? (settings.services[0]?.id ?? null) : null);
      const found = wanted === null ? null : findService(settings, wanted);
      if (found !== null) {
        setServiceId(found.id);
        setPartyState(found.party.min);
      }
      const slug = params.get("item");
      if (slug !== null && slug !== "") {
        const name = await pieceName(slug);
        if (!gone && name !== null) setItem({ slug, name });
      }
    });
    return () => {
      gone = true;
    };
  }, [settings, startService]);

  // Answers kept across a trip to Stripe go back into the details form once it is drawn.
  useEffect(() => {
    const answers = restored.current;
    const element = formRef.current;
    if (!complete || answers === null || element === null) return;
    restored.current = null;
    for (const [name, value] of Object.entries(answers)) {
      const control = element.elements.namedItem(name);
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true;
      else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) control.value = typeof value === "string" ? value : "";
    }
  }, [complete]);

  // The last session chosen: focus goes to the details heading, once the form is drawn.
  useEffect(() => {
    if (complete && focusDetails.current) {
      focusDetails.current = false;
      detailsHeading.current?.focus();
    }
  }, [complete]);

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

  /** Clears the live region first so the same words said twice are still read out twice. */
  function say(text: string) {
    setAnnounce("");
    window.setTimeout(() => setAnnounce(text), 60);
  }

  function chooseService(id: string) {
    const next = findService(settings, id);
    setServiceId(id);
    setPartyState(next?.party.min ?? 1);
    setStarts([]);
    setFocusIndex(null);
    setNotice(null);
    setSendError(null);
    if (starts.length > 0 && id !== serviceId) {
      setCleared(words.clearedByService);
      say(words.clearedByService);
    } else setCleared(null);
  }

  function setParty(value: number) {
    setPartyState(value);
    setStarts([]);
    setFocusIndex(null);
    setNotice(null);
    if (starts.length > 0) {
      setCleared(words.clearedByParty);
      say(words.clearedByParty);
    } else setCleared(null);
  }

  function pick(index: number, start: number) {
    setStarts((previous) => [...previous.slice(0, index), start]);
    setFocusIndex(null);
    setNotice(null);
    setSendError(null);
    setCleared(null);
    say(words.chosenAnnounce(formatLocal(start, timeZone), index + 1, count));
    focusDetails.current = index + 1 === count;
  }

  const idsFor = (field: FormField): FieldIds => ({ input: `${prefix}-${field.id}`, help: `${prefix}-${field.id}-help`, error: `${prefix}-${field.id}-error` });

  function showFieldErrors(fields: readonly string[]) {
    const next: Record<string, string> = {};
    for (const field of form.fields) if (fields.includes(field.id)) next[field.id] = errorFor(field);
    setErrors(next);
    const first = form.fields.find((field) => next[field.id]);
    if (first) document.getElementById(idsFor(first).input)?.focus();
  }

  function fail(error: SendError) {
    resetTurnstile();
    setSending(false);
    setSendError(error);
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (sending || !formRef.current || service === null) return;
    if (!complete) return setSendError("chooseTimes");
    const data = new FormData(formRef.current);
    const answers: Record<string, string | boolean> = {};
    for (const field of form.fields) {
      if (field.type === "checkbox" || field.type === "consent") answers[field.id] = data.get(field.id) !== null;
      else {
        const value = data.get(field.id);
        answers[field.id] = typeof value === "string" ? value : "";
      }
    }
    const trap = data.get(honeypot.name);

    setSendError(null);
    const result = validateSubmission(form, answers);
    if (!result.ok) {
      showFieldErrors(result.fields);
      if (result.fields.length === 0) setSendError("verification");
      return;
    }
    setErrors({});
    // A missing site key can't verify anything, so it is an honest failure. The launch gate checks the key itself.
    if (!turnstileSiteKey(providers.turnstileSiteKey)) return setSendError("unavailable");

    setSending(true);
    const token = await getToken();
    if (!token) return fail(turnstileConfigError() ? "unavailable" : "verification");

    const request: CheckoutRequest = {
      service: service.id,
      party,
      starts,
      answers,
      ...(item === null ? {} : { item: item.slug }),
      returnPath: window.location.pathname,
      [honeypot.name]: typeof trap === "string" ? trap : "",
      turnstileToken: token,
    };
    let response: Response;
    try {
      response = await fetch(CHECKOUT_PATH, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(request) });
    } catch {
      return fail("unavailable");
    }
    const body = (await response.json().catch(() => null)) as CheckoutAnswer | null;
    if (body === null) return fail("unavailable");

    if (body.ok && body.kind === "checkout") {
      // Stripe's hosted page is the only place the visitor is sent; anything else in the answer is not trusted.
      if (!body.url.startsWith("https://")) return fail("unavailable");
      saveResume(browserStorage("session"), RESUME_KEY, { service: service.id, party, starts, answers, sessionId: body.sessionId, releaseToken: body.releaseToken ?? null, item: item?.slug ?? null });
      track("begin_checkout", { value: body.dueNow, currency: body.currency.toUpperCase() });
      window.location.assign(body.url);
      return;
    }
    if (body.ok) {
      clearResume(browserStorage("session"), RESUME_KEY);
      try {
        window.sessionStorage.setItem(FREE_SUMMARY_KEY, JSON.stringify(body.summary));
      } catch {
        // The thank-you page then says the booking is confirmed without its details.
      }
      router.push("/booking/thanks?booked=1");
      return;
    }
    switch (body.error) {
      case "invalid":
        resetTurnstile();
        setSending(false);
        return showFieldErrors(body.fields);
      case "taken": {
        resetTurnstile();
        setSending(false);
        const index = Math.min(Math.max(body.index, 0), starts.length - 1);
        setStarts((previous) => previous.slice(0, index));
        setRefresh((previous) => ({ ...previous, [index]: (previous[index] ?? 0) + 1 }));
        setFocusIndex(index);
        setNotice({ index, text: words.taken });
        return;
      }
      case "rate_limited":
        return fail("rateLimited");
      case "closed":
        return fail("closed");
      case "rejected":
        return fail("verification");
      default:
        return fail("unavailable");
    }
  }

  const amounts = service === null ? null : amountsFor(service, party);
  const money = (minor: number) => moneyText(minor, currency ?? "usd");
  const summary: SummaryData | null =
    service === null || !complete
      ? null
      : {
          serviceName: service.name,
          sessions: starts.map((start, index) => ({ heading: count > 1 ? words.sessionHeading(index + 1, count) : words.summary.when, label: formatLocal(start, timeZone) })),
          people: service.party.max > 1 ? words.partyOutput(party) : null,
          money:
            amounts === null
              ? null
              : {
                  total: money(amounts.totalMinor),
                  dueNow: amounts.dueNowMinor === 0 ? words.summary.nothingNow : money(amounts.dueNowMinor),
                  dueLater: amounts.dueLaterMinor > 0 ? money(amounts.dueLaterMinor) : null,
                },
          policy: settings.policy,
          giftCardLine,
          itemName: item?.name ?? null,
        };
  const payNow = amounts !== null && amounts.dueNowMinor > 0;
  const shown = service === null ? 0 : Math.min(starts.length + 1, count);

  return (
    <div className="hl-js-only rounded-panel bg-white p-6 shadow-card md:p-9">
      <div role="status" aria-live="polite">
        {cancelled ? <p className="mb-7 rounded-card bg-tint p-4 text-list">{words.cancelled}</p> : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="space-y-8">
        <ServiceCards services={services} currency={currency ?? "usd"} selected={serviceId} onSelect={chooseService} />

        {service !== null && service.party.max > 1 ? <PartyStepper min={service.party.min} max={service.party.max} value={party} onChange={setParty} /> : null}
        {cleared !== null ? <p className="rounded-card bg-tint p-3 text-label text-ink">{cleared}</p> : null}

        {service === null
          ? null
          : Array.from({ length: shown }, (_, index) => (
              <SessionPicker
                key={`${service.id}|${party}|${starts.slice(0, index).join(",")}|${refresh[index] ?? 0}`}
                service={service}
                party={party}
                index={index}
                before={starts.slice(0, index)}
                selected={starts[index] ?? null}
                timeZone={timeZone}
                contactHref={contact.href}
                notice={notice !== null && notice.index === index ? notice.text : null}
                focusOnMount={focusIndex === index}
                onPick={(start) => pick(index, start)}
              />
            ))}

        {complete && summary !== null ? (
          <form ref={formRef} method="post" noValidate onSubmit={submit} onFocus={startTurnstile} className="space-y-6 border-t border-hairline pt-8">
            <h3 ref={detailsHeading} tabIndex={-1} className="font-ui text-item font-bold focus:outline-none">{words.detailsHeading}</h3>
            {form.fields.map((field) => (
              <FieldView key={field.id} field={field} ids={idsFor(field)} label={labelFor(field, false)} error={errors[field.id]} rich={false} emptyChoice="" />
            ))}
            <Honeypot id={`${prefix}-fax`} />
            <BookingSummary data={summary} headingId={`${prefix}-summary`} />
            <div>
              {/* Turnstile draws here only if Cloudflare needs the visitor to click. */}
              <div ref={turnstileRef} className="not-empty:mb-4" />
              <SubmitButton label={sending ? words.working : payNow ? words.payButton(money(amounts?.dueNowMinor ?? 0)) : words.confirmButton} sending={sending} />
              <p className="mt-4 text-small text-ink-2">{payNow ? words.payNote : words.noPayNote}</p>
            </div>
            <div role="status">
              {sendError ? (
                <p className="text-label text-rust">
                  {words.errors[sendError]}{" "}
                  {sendError === "unavailable" || sendError === "closed" ? <TextLink href={contact.href}>{words.contactLink}</TextLink> : null}
                </p>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
