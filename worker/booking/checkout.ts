import type { BookingSummary, CheckoutAnswer } from "../../src/booking/api.ts";
import { TURNSTILE_ACTION } from "../../src/booking/api.ts";
import { bookingPrice } from "../../src/booking/price.ts";
import { CHECKOUT_MINUTES, MAX_SESSIONS, type Service } from "../../src/booking/schema.ts";
import { checkSelection } from "../../src/booking/slots.ts";
import { findService } from "../../src/booking/validate.ts";
import { honeypot } from "../../src/content/contact-fields.ts";
import { answerLines, emailOf, nameOf } from "../../src/forms/answers.ts";
import { validateSubmission } from "../../src/forms/validate.ts";
import { readAttribution } from "../attribution.ts";
import { log } from "../env.ts";
import { json } from "../gift-cards/respond.ts";
import { paymentProvider } from "../payments/provider.ts";
import type { PaymentProvider } from "../payments/types.ts";
import { readBody } from "../read-body.ts";
import { loadCatalogData } from "../quote.ts";
import { verifyTurnstile } from "../turnstile.ts";
import { newEventId } from "./calendar.ts";
import type { BookingDeps } from "./deps.ts";
import { bookingEvent, holdEvent, insertOrAdopt, loadBusyForBooking, removeEvents, summaryOf, writeCalendarId } from "./events.ts";
import { finishFree } from "./fulfil.ts";
import { hasTimeLeft, type Claim, type Lease } from "./lock.ts";
import { bookingMetadata, newBookingReference, parseBooking, type Booking, type BookingInput } from "./metadata.ts";

/**
 * POST /api/booking/checkout. The same layers, in the same order, as the gift card route (worker/gift-cards/checkout.ts):
 * mode, same-origin, JSON, 16 KB, unknown keys (a price is never accepted), rate limit, honeypot, validation, Turnstile
 * (action `booking`). Then the Worker, never the browser, judges the choice with the shared rules (`checkSelection`) and
 * decides every amount (`bookingPrice`). Inside the lock it reads the calendar fresh and re-checks every session:
 *   - a service that takes money: the payment page is created first (30 minutes, cards only), then one hold per session is
 *     written; any hold failing undoes the rest and closes the page. Answers `{ kind: "checkout", url, ... }`.
 *   - a free service: the sessions are written as bookings at once, then the ledger, the owner's note and the visitor's
 *     email. Answers `{ kind: "booked", summary }`. If the owner could neither be told nor have the row (R13) it answers 502
 *     `failed` and the calendar events stay: the time is booked, the visitor is asked to get in touch.
 */

export const CHECKOUT_BODY_BYTES = 16_384;
const RETURN_PATH = /^\/[a-z0-9/-]{0,120}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN_KEY = "turnstileToken";
const MAX_TOKEN_LENGTH = 2048;
const KEYS = new Set<string>(["service", "party", "starts", "answers", "item", "returnPath", TOKEN_KEY, honeypot.name]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const reply = (body: CheckoutAnswer, status: number): Response => json(status, body);

type Shape = { service: string; party: number; starts: number[]; answers: Record<string, unknown>; item: string | null; returnPath: string };

/** The request's shape, or null when no person could have made it through the page. */
function readShape(fields: Record<string, unknown>): Shape | null {
  const { service, party, starts, answers, item, returnPath } = fields;
  if (typeof service !== "string" || typeof party !== "number" || !Number.isInteger(party)) return null;
  if (!Array.isArray(starts) || starts.length < 1 || starts.length > MAX_SESSIONS || !starts.every((start) => Number.isSafeInteger(start))) return null;
  if (!isRecord(answers) || typeof returnPath !== "string" || !RETURN_PATH.test(returnPath)) return null;
  if (item !== undefined && item !== null && typeof item !== "string") return null;
  return { service, party, starts: starts as number[], answers, item: typeof item === "string" && SLUG.test(item) && item.length <= 100 ? item : null, returnPath };
}

/** The name, the email and the first phone field's answer; every other answer is a note. */
function splitAnswers(deps: BookingDeps, value: Record<string, string | boolean>): { name: string; email: string; phone: string; others: { label: string; text: string }[] } {
  const def = deps.form;
  const phoneField = def.fields.find((field) => field.type === "phone");
  const nameField = def.fields.find((field) => field.type === "short-text" && field.purpose === "name");
  const emailField = def.fields.find((field) => field.type === "email");
  const skipped = new Set([phoneField?.label, nameField?.label, emailField?.label]);
  const phone = phoneField ? value[phoneField.id] : "";
  return {
    name: nameOf(def, value),
    email: emailOf(def, value),
    phone: typeof phone === "string" ? phone : "",
    others: answerLines(def, value).filter((line) => !skipped.has(line.label)),
  };
}

interface Context {
  deps: BookingDeps;
  service: Service;
  party: number;
  booking: Booking;
  metadata: Record<string, string>;
  calendarId: string;
  provider: PaymentProvider | null;
  cancelUrl: string;
  /** Filled in as each event is written, so the lock remembers the times even when a later step stops early. */
  claims: Claim[];
  /** Proves to the release route that the browser that started this checkout is the one asking (metadata `rt`). */
  releaseToken: string;
}

/** 32 hex characters from the platform's random source. */
export function newReleaseToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Everything that needs the lock: the fresh check, then the holds or the bookings. */
async function underLock(ctx: Context, lease: Lease): Promise<Response | "free_written"> {
  const { deps, booking, service, calendarId } = ctx;
  const { config, settings, url } = deps;
  const busy = await loadBusyForBooking(deps, booking, lease.claims);
  if (busy === null) return reply({ ok: false, error: "unavailable" }, 502);
  const fresh = checkSelection(settings, service, ctx.party, booking.starts, busy, deps.now(), config.timeZone);
  if (!fresh.ok) {
    if (fresh.reason === "busy") return reply({ ok: false, error: "taken", index: fresh.index }, 409);
    log("booking_refused", { reason: fresh.reason, index: fresh.index });
    return reply({ ok: false, error: "rejected" }, 400);
  }
  if (!hasTimeLeft(lease, deps.now())) {
    log("booking_lock_slow");
    return reply({ ok: false, error: "unavailable" }, 502);
  }
  const sessionClaims: Claim[] = booking.starts.map((start, index) => ({ start, end: booking.ends[index] as number, ref: booking.eventIds[index] as string }));

  if (booking.dueNowMinor === 0) {
    for (let index = 0; index < booking.starts.length; index++) {
      if (!hasTimeLeft(lease, deps.now())) {
        log("booking_lock_slow");
        await removeEvents(deps, calendarId, booking.eventIds);
        return reply({ ok: false, error: "unavailable" }, 502);
      }
      const result = await insertOrAdopt(deps, calendarId, bookingEvent(deps, booking, index));
      if (!result.ok) {
        await removeEvents(deps, calendarId, booking.eventIds);
        log("booking_write_failed", { status: result.status });
        return reply({ ok: false, error: "unavailable" }, 502);
      }
      ctx.claims.push(sessionClaims[index] as Claim);
    }
    return "free_written";
  }

  // Paid: the payment page first, so a hold is never written for a page that does not exist.
  const { provider } = ctx;
  if (!provider || !config.payments) return reply({ ok: false, error: "failed" }, 502);
  // Stripe wants a page to stay open at least 30 minutes; one more minute covers the time this request takes.
  const expiresAt = Math.floor(deps.now() / 1000) + CHECKOUT_MINUTES * 60 + 60;
  const created = await provider.createCheckout(
    {
      currency: config.payments.currency,
      amountMinor: booking.dueNowMinor,
      productName: `${booking.serviceName} booking (${booking.dueLaterMinor > 0 ? "deposit" : "full payment"})`,
      customerEmail: booking.email,
      successUrl: `${url.origin}/booking/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: ctx.cancelUrl,
      metadata: ctx.metadata,
      expiresAt,
      cardOnly: true,
    },
    `book-checkout-${booking.reference}`,
  );
  if (!created.ok) {
    log("checkout_failed", { status: created.status, ...(created.code ? { code: created.code } : {}) });
    return reply({ ok: false, error: "unavailable" }, 502);
  }
  const sessionId = created.value.id;
  for (let index = 0; index < booking.starts.length; index++) {
    const timedOut = !hasTimeLeft(lease, deps.now());
    const result = timedOut ? null : await insertOrAdopt(deps, calendarId, holdEvent(deps, booking, sessionId, expiresAt, index));
    if (result === null || !result.ok) {
      await removeEvents(deps, calendarId, booking.eventIds);
      await provider.expireSession(sessionId);
      if (result === null) log("booking_lock_slow");
      else log("hold_write_failed", { status: result.status });
      return reply({ ok: false, error: "unavailable" }, 502);
    }
    ctx.claims.push(sessionClaims[index] as Claim);
  }
  return reply({ ok: true, kind: "checkout", url: created.value.url, sessionId, dueNow: booking.dueNowMinor / 100, currency: booking.currency.toUpperCase(), releaseToken: ctx.releaseToken }, 200);
}

export async function handleCheckout(request: Request, deps: BookingDeps): Promise<Response> {
  const { config, env, mode, url, settings } = deps;

  // Only the site's own pages may post here; a JSON content type also forces a CORS preflight from anywhere else.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== url.origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    log("rejected_origin");
    return reply({ ok: false, error: "rejected" }, 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return reply({ ok: false, error: "rejected" }, 415);
  if (Number(request.headers.get("content-length") ?? "0") > CHECKOUT_BODY_BYTES) return reply({ ok: false, error: "rejected" }, 413);
  const body = await readBody(request, CHECKOUT_BODY_BYTES);
  if (body === null) return reply({ ok: false, error: "rejected" }, 413);

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return reply({ ok: false, error: "rejected" }, 400);
  }
  if (!isRecord(data) || Object.keys(data).some((key) => !KEYS.has(key))) return reply({ ok: false, error: "rejected" }, 400);
  const fields = data;

  const ip = request.headers.get("cf-connecting-ip");
  if (env.CONTACT_RATE_LIMIT) {
    const { success } = await env.CONTACT_RATE_LIMIT.limit({ key: `booking:${ip ?? "unknown"}` });
    if (!success) {
      log("rate_limited");
      return reply({ ok: false, error: "rate_limited" }, 429);
    }
  } else {
    log("rate_limit_binding_missing");
    // Local development has no binding; anywhere else a missing one must not leave the route open to floods.
    if (mode !== "development") return reply({ ok: false, error: "failed" }, 502);
  }

  const trap = fields[honeypot.name];
  if (trap !== undefined && trap !== "") {
    log("honeypot_filled");
    return reply({ ok: false, error: "rejected" }, 400);
  }

  const shape = readShape(fields);
  if (!shape) return reply({ ok: false, error: "rejected" }, 400);
  const submission = validateSubmission(deps.form, shape.answers);
  if (!submission.ok) {
    return submission.malformed || submission.fields.length === 0 ? reply({ ok: false, error: "rejected" }, 400) : reply({ ok: false, error: "invalid", fields: submission.fields }, 400);
  }
  const person = splitAnswers(deps, submission.value);

  if (!env.TURNSTILE_SECRET_KEY) {
    log("turnstile_config_missing");
    return reply({ ok: false, error: "failed" }, 502);
  }
  const token = fields[TOKEN_KEY];
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    log("turnstile_token_missing");
    return reply({ ok: false, error: "rejected" }, 403);
  }
  const check = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip);
  if (check.unavailable) {
    log("turnstile_unavailable", { codes: check.errorCodes.join(",") });
    return reply({ ok: false, error: "failed" }, 502);
  }
  // Cloudflare's test keys (local development only) return no action and hostname "example.com".
  const strict = mode !== "development";
  const reason = !check.success ? "not_success" : strict && check.hostname !== url.hostname ? "hostname_mismatch" : strict && check.action !== TURNSTILE_ACTION ? "action_mismatch" : null;
  if (reason) {
    log("turnstile_failed", { reason, codes: check.errorCodes.join(",") });
    return reply({ ok: false, error: "rejected" }, 403);
  }

  // The Worker, not the browser, judges the choice and decides the amount.
  if (!settings.taking) return reply({ ok: false, error: "closed" }, 409);
  const service = findService(settings, shape.service);
  if (!service) {
    log("booking_refused", { reason: "service" });
    return reply({ ok: false, error: "rejected" }, 400);
  }
  const now = deps.now();
  const first = checkSelection(settings, service, shape.party, shape.starts, [], now, config.timeZone);
  if (!first.ok) {
    log("booking_refused", { reason: first.reason, index: first.index });
    return reply({ ok: false, error: "rejected" }, 400);
  }
  const price = bookingPrice(service, shape.party);
  const totalMinor = price?.totalMinor ?? 0;
  const dueNowMinor = price?.dueNowMinor ?? 0;
  const dueLaterMinor = price?.dueLaterMinor ?? 0;
  if (dueNowMinor > 0 && !config.payments) {
    log("booking_refused", { reason: "payments_off" });
    return reply({ ok: false, error: "rejected" }, 400);
  }
  const currency = config.payments?.currency ?? "usd";
  const cancelUrl = `${url.origin}${shape.returnPath}?checkout=cancelled`;

  const received = new Date(now);
  const receivedAt = received.toISOString();
  const attribution = readAttribution(request.headers.get("cookie"), Math.floor(received.getTime() / 1000));
  const input: BookingInput = {
    reference: newBookingReference(),
    serviceId: service.id,
    serviceName: service.name,
    party: shape.party,
    starts: shape.starts,
    ends: shape.starts.map((start, index) => start + (service.sessions[index]?.minutes ?? 0) * 60_000),
    eventIds: shape.starts.map(() => newEventId()),
    totalMinor,
    dueNowMinor,
    dueLaterMinor,
    currency,
    name: person.name,
    email: person.email,
    phone: person.phone,
    answers: person.others,
    item: null,
    siteMode: mode,
    site: config.workerName,
    releaseToken: newReleaseToken(),
  };

  if (mode === "development") {
    log("dry_run", { booking: true, paid: dueNowMinor > 0 });
    const dev = parseBooking(bookingMetadata(input, attribution, receivedAt));
    if (!dev) return reply({ ok: false, error: "failed" }, 502);
    if (dueNowMinor > 0) return reply({ ok: true, kind: "checkout", url: cancelUrl, sessionId: "dev", dueNow: dueNowMinor / 100, currency: currency.toUpperCase(), releaseToken: input.releaseToken }, 200);
    const summary: BookingSummary = { ...summaryOf(deps, dev), reference: "dev" };
    return reply({ ok: true, kind: "booked", summary }, 200);
  }

  const calendarId = writeCalendarId(deps);
  if (!calendarId) {
    log("preview_calendar_missing");
    return reply({ ok: false, error: "preview_calendar_missing" }, 502);
  }
  const { siteEmail } = config;
  if (!siteEmail || !env.RESEND_API_KEY) {
    log("config_incomplete");
    return reply({ ok: false, error: "failed" }, 502);
  }
  let provider: PaymentProvider | null = null;
  if (dueNowMinor > 0 && config.payments) {
    const made = paymentProvider(config.payments, env, mode);
    if (!made.ok) {
      log("payments_misconfigured", { reason: made.reason });
      return reply({ ok: false, error: "payments_misconfigured" }, 502);
    }
    // Nobody pays into a site that could not deliver: without the webhook secret no booking could be confirmed.
    if (!env.STRIPE_WEBHOOK_SECRET) {
      log("payments_misconfigured", { reason: "no_webhook_secret" });
      return reply({ ok: false, error: "payments_misconfigured" }, 502);
    }
    provider = made.provider;
  }

  // The catalog piece is only a label for the emails and the ledger; one the site does not know is dropped, never an error.
  if (shape.item !== null) {
    const catalog = await loadCatalogData(env, url.href);
    const known = catalog !== null && Object.hasOwn(catalog.items, shape.item) ? catalog.items[shape.item] : undefined;
    if (known) input.item = { slug: shape.item, name: known.name };
    else log("booking_item_dropped");
  }
  const metadata = bookingMetadata(input, attribution, receivedAt);
  const booking = parseBooking(metadata);
  if (!booking) {
    log("booking_metadata_invalid");
    return reply({ ok: false, error: "failed" }, 502);
  }

  if (!deps.lock) {
    log("booking_lock_missing");
    return reply({ ok: false, error: "failed" }, 502);
  }
  const lease = await deps.lock.acquire();
  if (!lease) {
    log("booking_lock_busy");
    return reply({ ok: false, error: "unavailable" }, 502);
  }
  const ctx: Context = { deps, service, party: shape.party, booking, metadata, calendarId, provider, cancelUrl, claims: [], releaseToken: input.releaseToken };
  let outcome: Response | "free_written";
  try {
    outcome = await underLock(ctx, lease);
  } finally {
    try {
      await deps.lock.release(lease.token, ctx.claims);
    } catch {
      // The lease is taken back on its own after a minute; a failed release must never replace the real outcome.
      log("booking_lock_release_failed");
    }
  }
  if (outcome !== "free_written") return outcome;

  if (!(await finishFree(deps, siteEmail, booking))) {
    // The events stay on the calendar: the time is booked even though the owner could not be told.
    log("booking_free_not_recorded");
    return reply({ ok: false, error: "failed" }, 502);
  }
  return reply({ ok: true, kind: "booked", summary: summaryOf(deps, booking) }, 200);
}
