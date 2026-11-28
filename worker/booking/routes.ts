import { CHECKOUT_PATH, CONFIRM_PATH, RELEASE_PATH, TIMES_PATH } from "../../src/booking/api.ts";
import { BOOKING_FORM_ID, type BookingSettings } from "../../src/booking/schema.ts";
import bundledBooking from "../../src/content/booking.json" with { type: "json" };
import { parseForm } from "../../src/forms/validate.ts";
import type { WorkerConfig } from "../config.ts";
import { log, type ContactEnv, type Mode, type SaveStatus } from "../env.ts";
import { formFiles, type Delivery } from "../forms.ts";
import { json } from "../gift-cards/respond.ts";
import type { PaymentProvider, PaymentSession } from "../payments/types.ts";
import { googleCalendar } from "./calendar.ts";
import { handleCheckout } from "./checkout.ts";
import { handleConfirm } from "./confirm.ts";
import type { BookingDeps, BookingOptions } from "./deps.ts";
import { deleteHolds } from "./events.ts";
import { alertMismatch, fulfil, judgeBooking } from "./fulfil.ts";
import { durableLock } from "./lock.ts";
import { parseBooking } from "./metadata.ts";
import { handleRelease } from "./release.ts";
import { handleTimes } from "./times.ts";

/**
 * The booking routes, answered only while `booking` is set in site.config.ts (the caller returns 404 before this otherwise,
 * booking design R1):
 *   GET  /api/booking/times      open times for one session (times.ts)
 *   POST /api/booking/checkout   the block starts a booking (checkout.ts)
 *   POST /api/booking/release    the visitor came back from Stripe without paying (release.ts)
 *   GET  /api/booking/confirm    the thank-you page asks what happened (confirm.ts)
 * Stripe's signed webhook is the payments route (worker/gift-cards/routes.ts), which hands booking sessions to
 * `handleBookingEvent` below.
 */

const bundled = bundledBooking as unknown as BookingSettings;

export const isBookingPath = (pathname: string): boolean => pathname === TIMES_PATH || pathname === CHECKOUT_PATH || pathname === RELEASE_PATH || pathname === CONFIRM_PATH;

export interface BuildInput {
  config: WorkerConfig;
  env: ContactEnv;
  mode: Mode;
  url: URL;
  options: BookingOptions & { now?: () => number };
  save: (mode: Mode, delivery: Delivery) => Promise<SaveStatus>;
}

/** The deps for one request or cron run, or null when booking is off or the details form is not usable (fails closed). */
export function buildBookingDeps({ config, env, mode, url, options, save }: BuildInput): BookingDeps | null {
  const { booking } = config;
  if (!booking) return null;
  const entry = formFiles.find((file) => file.id === BOOKING_FORM_ID);
  const form = entry ? parseForm(entry.data, config.forms, BOOKING_FORM_ID) : null;
  if (!form) {
    log("booking_form_invalid");
    return null;
  }
  return {
    config,
    booking,
    payments: config.payments,
    settings: options.booking ?? bundled,
    form,
    env,
    mode,
    url,
    now: options.now ?? Date.now,
    calendar: options.calendar ?? googleCalendar(env.GOOGLE_SERVICE_ACCOUNT_KEY),
    lock: options.lock ?? durableLock(env.BOOKING_LOCK),
    save,
  };
}

/** Routes one request. `deps` is built: the caller already answered 404 for a site without booking. */
export async function handleBookingRoute(pathname: string, request: Request, deps: BookingDeps): Promise<Response> {
  const wantsGet = pathname === TIMES_PATH || pathname === CONFIRM_PATH;
  if (request.method !== (wantsGet ? "GET" : "POST")) return json(405, { error: "method_not_allowed" }, { allow: wantsGet ? "GET" : "POST" });
  if (pathname === TIMES_PATH) return handleTimes(request, deps);
  if (pathname === CHECKOUT_PATH) return handleCheckout(request, deps);
  if (pathname === RELEASE_PATH) return handleRelease(request, deps);
  return handleConfirm(request, deps);
}

/**
 * What the webhook hands over for a session whose metadata says `kind: booking`. True means done (or nothing to do);
 * false asks Stripe to deliver again (the webhook answers 500).
 *  - expired: the session is read again (the event is not trusted); if it really is expired its holds are removed.
 *  - completed or async succeeded: the same judgement as the thank-you page, then fulfilment.
 */
export async function handleBookingEvent(deps: BookingDeps, type: string, session: PaymentSession, provider: PaymentProvider): Promise<boolean> {
  if (type === "checkout.session.expired") {
    const booking = session.metadata["site"] === deps.config.workerName ? parseBooking(session.metadata) : null;
    if (!booking || booking.siteMode !== deps.mode || session.status !== "expired") return true;
    return deleteHolds(deps, session.id, booking.eventIds);
  }
  const judged = judgeBooking(deps, session);
  if (judged.kind === "ignore" || judged.kind === "not_paid") {
    log("webhook_nothing_to_do", { reason: judged.kind });
    return true;
  }
  if (judged.kind === "mismatch") {
    log("payment_mismatch");
    return alertMismatch(deps, provider, session, judged.booking);
  }
  return (await fulfil(deps, provider, session, judged.booking, { webhookMissing: false })).done;
}
