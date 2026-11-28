import type { TimesAnswer } from "../../src/booking/api.ts";
import { effectiveHours } from "../../src/booking/hours.ts";
import { TIMES_DAYS_MAX } from "../../src/booking/schema.ts";
import { checkSelection, openDays } from "../../src/booking/slots.ts";
import { findService } from "../../src/booking/validate.ts";
import { addDays, daysBetween, formatTime, isLocalDate, localParts, startOfLocalDay, zoneName } from "../../src/booking/zone.ts";
import { log } from "../env.ts";
import { json } from "../gift-cards/respond.ts";
import type { BookingDeps } from "./deps.ts";
import { loadBusyBucketed } from "./events.ts";

/**
 * GET /api/booking/times?service=&party=&index=&from=&days=&chosen= (booking design R8). The query is judged strictly:
 * anything a person could not have made through the page is a 400. Open times are the rules minus busy time (free/busy over
 * every busy calendar) minus other people's live holds; a result is kept 30 seconds per calendar set and range. Reads do
 * not take the lock and are not rate limited: a visitor paging through weeks would hit the forms' limit. If any calendar
 * cannot be read the route fails closed (502), never offering a time it could not check. In development nothing outside is
 * called: times come from the rules alone.
 */

const DAY_MS = 86_400_000;
const reply = (body: TimesAnswer, status: number): Response => json(status, body);
const INTEGER = /^\d{1,16}$/;

export async function handleTimes(request: Request, deps: BookingDeps): Promise<Response> {
  const { settings, config, mode, url } = deps;
  // Only the site's own pages read times: a cross-site fetch is refused, and an Origin that is present must be ours. A plain
  // GET from the page may carry neither header, or `none` (an address typed in), so neither alone is a reason to refuse.
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") || (origin !== null && origin !== url.origin)) {
    log("rejected_origin");
    return reply({ ok: false, error: "rejected" }, 403);
  }
  const query = new URL(request.url).searchParams;
  const tz = config.timeZone;

  if (!settings.taking) return reply({ ok: false, error: "closed" }, 409);
  const service = findService(settings, query.get("service") ?? "");
  if (!service) return reply({ ok: false, error: "not_found" }, 404);

  const partyText = query.get("party") ?? "";
  const indexText = query.get("index") ?? "";
  const daysText = query.get("days") ?? "";
  const from = query.get("from") ?? "";
  const chosenText = query.get("chosen") ?? "";
  const party = INTEGER.test(partyText) ? Number(partyText) : NaN;
  const index = INTEGER.test(indexText) ? Number(indexText) : NaN;
  const days = INTEGER.test(daysText) ? Number(daysText) : NaN;
  const chosen = chosenText === "" ? [] : chosenText.split(",").map((part) => (INTEGER.test(part) ? Number(part) : NaN));
  const bad = !Number.isSafeInteger(party) || party < service.party.min || party > service.party.max || !Number.isSafeInteger(index) || index < 0 || index >= service.sessions.length || !Number.isSafeInteger(days) || days < 1 || days > TIMES_DAYS_MAX || !isLocalDate(from) || chosen.length !== index || !chosen.every((start) => Number.isSafeInteger(start));
  if (bad) return reply({ ok: false, error: "rejected" }, 400);

  const now = deps.now();
  if (index > 0) {
    // The earlier sessions must themselves be times this service could have offered (busy time is ignored for them).
    const earlier = checkSelection(settings, { ...service, sessions: service.sessions.slice(0, index) }, party, chosen, [], now, tz);
    if (!earlier.ok) return reply({ ok: false, error: "rejected" }, 400);
  }

  // The dates this session may fall on are known before anything is asked of Google; dates outside them are not answered.
  const hours = effectiveHours(settings.hours, service);
  const today = localParts(now, tz).date;
  let window: { first: string; last: string };
  if (index === 0) window = { first: today, last: addDays(today, hours.aheadDays) };
  else {
    const previousDate = localParts(chosen[index - 1] as number, tz).date;
    window = { first: addDays(previousDate, service.between?.minDays ?? 0), last: addDays(previousDate, service.between?.maxDays ?? 0) };
  }
  const asked = { first: from, last: addDays(from, days - 1) };
  const first = asked.first < window.first ? window.first : asked.first;
  const last = asked.last > window.last ? window.last : asked.last;
  let open: ReturnType<typeof openDays> = [];
  if (first <= last) {
    const count = daysBetween(first, last) + 1;
    let busy: { start: number; end: number }[] = [];
    if (mode !== "development") {
      const loaded = await loadBusyBucketed(deps, startOfLocalDay(first, tz) - DAY_MS, startOfLocalDay(last, tz) + 2 * DAY_MS);
      if (loaded === null) {
        log("times_unavailable");
        return reply({ ok: false, error: "unavailable" }, 502);
      }
      busy = loaded;
    }
    open = openDays({ settings, service, index, chosen, busy, now, from: first, days: count, tz });
  }
  return reply(
    {
      ok: true,
      zone: tz,
      zoneName: zoneName(tz, startOfLocalDay(from, tz)),
      days: open.map((day) => ({ date: day.date, times: day.starts.map((start) => ({ start, label: formatTime(start, tz) })) })),
      window,
    },
    200,
  );
}
