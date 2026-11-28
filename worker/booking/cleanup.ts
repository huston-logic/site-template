import { log } from "../env.ts";
import { paymentProvider } from "../payments/provider.ts";
import type { BookingDeps } from "./deps.ts";
import { deleteHolds, writeCalendarId } from "./events.ts";
import { fulfil, judgeBooking } from "./fulfil.ts";

/**
 * The cron (every 15 minutes, booking design R10): holds whose checkout has closed are cleaned up, and a paid session the
 * webhook missed is fulfilled. Only for the production site with payments on (a preview has no cron). For each hold past
 * its `hl_expires`, its payment session is read: expired or unknown means the holds go; complete and paid means the same
 * fulfilment as the webhook runs (it is safe to repeat); anything else is left alone. Errors are logged, never thrown, so
 * one bad session never stops the rest.
 */

const DAY_MS = 86_400_000;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/;
/** Holds can sit this far beyond the booking horizon (a later session of a long service). */
const BEYOND_HORIZON_DAYS = 400;

export async function cleanupHolds(deps: BookingDeps): Promise<void> {
  const { env, settings, payments } = deps;
  if (deps.mode !== "production" || !payments) return;
  const calendarId = writeCalendarId(deps);
  if (!calendarId) return;
  const made = paymentProvider(payments, env, deps.mode);
  if (!made.ok) {
    log("payments_misconfigured", { reason: made.reason });
    return;
  }
  const now = deps.now();
  const ahead = Math.max(settings.hours.aheadDays, ...settings.services.map((service) => service.hours?.aheadDays ?? 0));
  const listed = await deps.calendar.listHolds(calendarId, now - DAY_MS, now + (ahead + BEYOND_HORIZON_DAYS) * DAY_MS, deps.config.workerName);
  if (!listed.ok) {
    log("cleanup_list_failed");
    return;
  }
  const bySession = new Map<string, string[]>();
  for (const hold of listed.value) {
    const expires = Number(hold.props["hl_expires"]);
    const session = hold.props["hl_session"] ?? "";
    if (!Number.isFinite(expires) || expires * 1000 > now || !SESSION_ID.test(session) || hold.props["hl_mode"] !== deps.mode) continue;
    bySession.set(session, [...(bySession.get(session) ?? []), hold.id]);
  }
  let handled = 0;
  for (const [sessionId, eventIds] of bySession) {
    try {
      const read = await made.provider.readSession(sessionId);
      if (!read.ok) continue;
      const session = read.value;
      if (session === null || session.status === "expired") {
        await deleteHolds(deps, sessionId, eventIds);
        handled += 1;
      } else if (session.status === "complete" && session.paymentStatus === "paid") {
        const judged = judgeBooking(deps, session);
        if (judged.kind === "paid") {
          await fulfil(deps, made.provider, session, judged.booking, { webhookMissing: false });
          handled += 1;
        }
      }
    } catch {
      log("cleanup_session_failed");
    }
  }
  log("cleanup_done", { holds: listed.value.length, sessions: bySession.size, handled });
}
