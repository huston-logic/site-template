"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIRM_PATH, FREE_SUMMARY_KEY, type BookingSummary, type ConfirmAnswer } from "@/booking/api";
import { bookingWords } from "@/content/booking";
import { firstReport, type StorageLike } from "@/gift-cards/browser-storage";
import { RECHECK_AT_SECONDS, searchWithoutSessionId, sessionIdFrom } from "@/gift-cards/confirm";
import { readConfirm, readSummary, recalledBookingSession, rememberBookingSession } from "@/lib/booking-flow";
import { track } from "@/tracking/track";
import { Glow } from "./Glow";
import { HeroContent } from "./PageHero";
import { TextLink } from "./TextLink";

type View =
  | { kind: "checking" }
  | { kind: "paid"; answer: Extract<ConfirmAnswer, { status: "paid" }> }
  | { kind: "free"; summary: BookingSummary | null }
  | { kind: "notPaid" }
  | { kind: "error" };

const words = bookingWords.thanks;

const storage = (kind: "session" | "local"): StorageLike | null => {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The booking thank-you page. For a paid booking it asks the Worker what Stripe and the calendar say, never what the address
 * says: booked (the times), clash (the owner will be in touch) or waiting (asks again at 30 and 100 seconds). `purchase` is
 * reported once per payment. For a free booking (`?booked=1`) it shows the summary the flow kept and reports `lead` once. The
 * session id is read once, kept in sessionStorage and taken out of the address bar, because the Meta Pixel sends the full
 * address. The live region announces each state as it changes.
 */
export function BookingThanks({ backHref, ownerName }: { backHref: string; ownerName: string | null }) {
  const [view, setView] = useState<View>({ kind: "checking" });
  const reported = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const search = window.location.search;

    if (new URLSearchParams(search).get("booked") === "1") {
      let summary: BookingSummary | null = null;
      try {
        const raw = window.sessionStorage.getItem(FREE_SUMMARY_KEY);
        summary = raw === null ? null : readSummary(JSON.parse(raw));
      } catch {
        summary = null;
      }
      queueMicrotask(() => {
        if (stopped) return;
        setView({ kind: "free", summary });
        if (summary !== null && !reported.current) {
          reported.current = true;
          if (firstReport(storage("local"), `booking-${summary.reference}`)) track("lead", { form_id: "booking" });
        }
      });
      return () => {
        stopped = true;
      };
    }

    // First thing: the id goes into this tab's sessionStorage and out of the address, before any tag can read the address.
    let sessionId = sessionIdFrom(search);
    if (sessionId !== null) {
      rememberBookingSession(storage("session"), sessionId);
      const { pathname, search: current, hash } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${searchWithoutSessionId(current)}${hash}`);
    } else {
      sessionId = recalledBookingSession(storage("session"));
    }

    async function ask(attempt: number) {
      if (sessionId === null) return setView({ kind: "notPaid" });
      let answer: ConfirmAnswer | null = null;
      try {
        const response = await fetch(`${CONFIRM_PATH}?session_id=${encodeURIComponent(sessionId)}`, { credentials: "same-origin", headers: { accept: "application/json" } });
        answer = response.ok ? readConfirm(await response.json().catch(() => null)) : null;
      } catch {
        answer = null;
      }
      if (stopped) return;
      // A later failed check never takes a "paid" message away.
      setView((previous) => {
        if (answer === null) return previous.kind === "paid" ? previous : { kind: "error" };
        if (answer.status === "paid") return { kind: "paid", answer };
        return answer.status === "unpaid" ? { kind: "notPaid" } : answer.status === "pending" ? { kind: "checking" } : { kind: "error" };
      });
      if (answer?.status === "paid" && !reported.current) {
        reported.current = true;
        if (firstReport(storage("local"), answer.transactionId)) track("purchase", { value: answer.value, currency: answer.currency, transaction_id: answer.transactionId });
      }
      const next = RECHECK_AT_SECONDS[attempt];
      const settled = answer?.status === "paid" && answer.booked !== "waiting";
      if (next !== undefined && answer?.status !== "unpaid" && !settled) {
        const elapsed = attempt === 0 ? 0 : (RECHECK_AT_SECONDS[attempt - 1] ?? 0);
        timer = window.setTimeout(() => void ask(attempt + 1), (next - elapsed) * 1000);
      }
    }

    void ask(0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  let heading: string = words.checking.heading;
  let lines: string[] = [words.checking.body];
  let summary: BookingSummary | null = null;
  let back = false;
  switch (view.kind) {
    case "paid": {
      summary = view.answer.summary;
      const { booked } = view.answer;
      if (booked === "booked") {
        heading = words.booked.heading;
        lines = [words.booked.paid(summary.paidText), ...(summary.dueLaterText ? [summary.dueLaterText] : []), view.answer.emailed ? words.booked.emailed : words.booked.notEmailed];
      } else if (booked === "clash") {
        heading = words.clash.heading;
        lines = [words.clash.body(ownerName ?? words.clash.ownerFallback)];
      } else {
        heading = words.waiting.heading;
        lines = [words.waiting.body];
      }
      break;
    }
    case "free":
      if (view.summary === null) {
        heading = words.freeMissing.heading;
        lines = [words.freeMissing.body];
      } else {
        summary = view.summary;
        heading = words.booked.heading;
        lines = [words.booked.free, ...(summary.dueLaterText ? [summary.dueLaterText] : []), words.booked.emailed];
      }
      break;
    case "notPaid":
      heading = words.notPaid.heading;
      lines = [words.notPaid.body];
      back = true;
      break;
    case "error":
      heading = words.error.heading;
      lines = [words.error.body];
      break;
    case "checking":
      break;
  }
  const showTimes = summary !== null && !(view.kind === "paid" && view.answer.booked === "clash");

  return (
    <section className="hl-js-only relative pb-24 pt-18">
      <Glow variant="green" className="hl-glow-hero" />
      <div role="status" aria-live="polite" aria-atomic="true">
        <HeroContent
          title={heading}
          intro={
            <>
              {lines.map((line, index) => (
                <span key={line} className={index > 0 ? "mt-3 block" : "block"}>
                  {line}
                </span>
              ))}
            </>
          }
        >
          {summary !== null && showTimes ? (
            <div className="rounded-panel bg-white p-6 shadow-card md:p-8">
              <p className="font-ui text-item font-bold">{summary.service}</p>
              {summary.item ? <p className="mt-1 text-small text-ink-2">{`${words.summary.forItem}: ${summary.item}`}</p> : null}
              <ul className="mt-4 divide-y divide-hairline border-y border-hairline text-list">
                {summary.sessions.map((session) => (
                  <li key={session.start} className="py-2.5">
                    {session.label}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-small text-ink-2">{summary.zoneName}</p>
            </div>
          ) : null}
          {back ? <TextLink href={backHref}>{words.notPaid.back}</TextLink> : null}
        </HeroContent>
      </div>
    </section>
  );
}
