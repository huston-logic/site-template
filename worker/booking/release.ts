import { log } from "../env.ts";
import { json } from "../gift-cards/respond.ts";
import { paymentProvider } from "../payments/provider.ts";
import { readBody } from "../read-body.ts";
import type { BookingDeps } from "./deps.ts";
import { deleteHolds } from "./events.ts";
import { parseBooking } from "./metadata.ts";

/**
 * POST /api/booking/release { sessionId, releaseToken }: the visitor came back from Stripe without paying (design R10). Only a
 * booking of this site and mode is touched, and only when the token equals the one the checkout handed this browser (metadata
 * `rt`): a session id alone, which Stripe's page shows in its address, releases nothing. An open payment page is closed (so it can never be paid later) and the session is read
 * again: only when it really is expired are its holds removed, so a payment that completed a moment ago keeps its time.
 * Always `{ ok: true }` for a well-formed id, whatever was or was not there, so the route tells a stranger nothing.
 */

const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{1,200}$/;
const TOKEN = /^[0-9a-f]{32}$/;
const BODY_BYTES = 1024;

/** Compares without stopping at the first difference; the stored side must itself be 32 hex characters or the answer is no. */
function sameToken(given: string, stored: string): boolean {
  if (!TOKEN.test(stored) || !TOKEN.test(given)) return false;
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= given.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

export async function handleRelease(request: Request, deps: BookingDeps): Promise<Response> {
  const { env, mode, url } = deps;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== url.origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    log("rejected_origin");
    return json(403, { ok: false });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { ok: false });
  const text = await readBody(request, BODY_BYTES);
  if (text === null) return json(413, { ok: false });

  const ip = request.headers.get("cf-connecting-ip");
  if (env.CONTACT_RATE_LIMIT) {
    const { success } = await env.CONTACT_RATE_LIMIT.limit({ key: `booking-release:${ip ?? "unknown"}` });
    if (!success) {
      log("rate_limited");
      return json(429, { ok: false });
    }
  } else {
    log("rate_limit_binding_missing");
    // Local development has no binding; anywhere else a missing one must not leave the route open to floods.
    if (mode !== "development") return json(502, { ok: false });
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return json(400, { ok: false });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return json(400, { ok: false });
  const fields = data as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== "sessionId" && key !== "releaseToken")) return json(400, { ok: false });
  const id = fields["sessionId"];
  const token = fields["releaseToken"];
  if (typeof id !== "string" || !SESSION_ID.test(id) || typeof token !== "string" || !TOKEN.test(token)) return json(400, { ok: false });
  if (mode === "development" || !deps.payments) return json(200, { ok: true });

  const made = paymentProvider(deps.payments, env, mode);
  if (!made.ok) {
    log("payments_misconfigured", { reason: made.reason });
    return json(200, { ok: true });
  }
  const read = await made.provider.readSession(id);
  if (!read.ok || read.value === null) return json(200, { ok: true });
  let session = read.value;
  const booking = session.metadata["site"] === deps.config.workerName ? parseBooking(session.metadata) : null;
  if (!booking || booking.siteMode !== mode) return json(200, { ok: true });
  if (!sameToken(token, session.metadata["rt"] ?? "")) {
    log("booking_release_refused");
    return json(200, { ok: true });
  }

  if (session.status === "open") {
    if (await made.provider.expireSession(id)) {
      const again = await made.provider.readSession(id);
      if (again.ok && again.value) session = again.value;
    }
  }
  if (session.status === "expired") await deleteHolds(deps, session.id, booking.eventIds);
  return json(200, { ok: true });
}
