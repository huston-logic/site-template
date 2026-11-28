"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/catalog/price";
import { clearFields, firstReport, recalledSessionId, rememberSessionId, type StorageLike } from "@/gift-cards/browser-storage";
import { readConfirmation, RECHECK_AT_SECONDS, searchWithoutSessionId, sessionIdFrom, shouldRecheck, type Confirmation } from "@/gift-cards/confirm";
import { giftCardWords } from "@/content/gift-cards";
import { track } from "@/tracking/track";
import { Glow } from "./Glow";
import { HeroContent } from "./PageHero";
import { TextLink } from "./TextLink";

type View = { kind: "checking" } | { kind: "paid"; confirmation: Confirmation } | { kind: "waiting" } | { kind: "notPaid" } | { kind: "error" };

const words = giftCardWords.thanks;

const storage = (kind: "session" | "local"): StorageLike | null => {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

function viewFor(confirmation: Confirmation | null): View {
  if (confirmation === null) return { kind: "error" };
  switch (confirmation.status) {
    case "paid":
      return { kind: "paid", confirmation };
    case "pending":
      return { kind: "waiting" };
    case "unpaid":
      return { kind: "notPaid" };
    case "error":
      return { kind: "error" };
  }
}

/**
 * The gift card thank-you page (spec R8). It asks the Worker whether the session was paid and shows what Stripe says, never
 * what the address says. On `paid` it reports the purchase once per transaction, then says where the certificate went. While
 * the card is not delivered it asks again at 30 and 100 seconds. The session id is read once, kept in sessionStorage and taken out of the address bar at once, because the Meta Pixel sends the full address. Without JavaScript the server page shows a plain message
 * instead. The live region announces each state as it changes.
 */
export function GiftCardThanks({ backHref }: { backHref: string }) {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [toRecipient, setToRecipient] = useState(false);
  const reported = useRef(false);

  useEffect(() => {
    // First thing: the id goes into this tab's sessionStorage and out of the address, before any tag can read the address.
    // Reloads and the later checks use the stored copy.
    let sessionId = sessionIdFrom(window.location.search);
    if (sessionId !== null) {
      rememberSessionId(storage("session"), sessionId);
      const { pathname, search, hash } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${searchWithoutSessionId(search)}${hash}`);
    } else {
      sessionId = recalledSessionId(storage("session"));
    }
    let stopped = false;
    let timer: number | undefined;

    async function ask(attempt: number) {
      if (sessionId === null) return setView({ kind: "notPaid" });
      let confirmation: Confirmation | null = null;
      try {
        const response = await fetch(`/api/gift-cards/confirm?session_id=${encodeURIComponent(sessionId)}`, { credentials: "same-origin", headers: { accept: "application/json" } });
        confirmation = response.ok ? readConfirmation(await response.json().catch(() => null)) : null;
      } catch {
        confirmation = null;
      }
      if (stopped) return;
      // A later failed check never takes a "paid" message away.
      setView((previous) => (previous.kind === "paid" && confirmation === null ? previous : viewFor(confirmation)));
      if (confirmation?.status === "paid" && !reported.current) {
        reported.current = true;
        setToRecipient(confirmation.recipientCopy);
        clearFields(storage("session"));
        if (firstReport(storage("local"), confirmation.transactionId)) {
          track("purchase", { value: confirmation.value, currency: confirmation.currency, transaction_id: confirmation.transactionId });
        }
      }
      const next = RECHECK_AT_SECONDS[attempt];
      if (next !== undefined && shouldRecheck(confirmation)) {
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
  let back = false;
  switch (view.kind) {
    case "paid":
      heading = words.paid.heading;
      lines = [words.paid.body(formatMoney(view.confirmation.value, view.confirmation.currency)), ...(toRecipient ? [words.paid.recipient] : []), words.paid.keepIt];
      break;
    case "waiting":
      heading = words.stillWaiting.heading;
      lines = [words.stillWaiting.body];
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
          {back ? <TextLink href={backHref}>{words.notPaid.back}</TextLink> : null}
        </HeroContent>
      </div>
    </section>
  );
}
