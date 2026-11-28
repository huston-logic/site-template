import type { TimesAnswer } from "../../src/booking/api.ts";
import { effectiveHours } from "../../src/booking/hours.ts";
import { TIMES_DAYS_MAX } from "../../src/booking/schema.ts";
import { checkSelection, openDays } from "../../src/booking/slots.ts";
import { findService } from "../../src/booking/validate.ts";
import { addDays, formatTime, isLocalDate, localParts, startOfLocalDay, zoneName } from "../../src/booking/zone.ts";
import { log } from "../env.ts";
import { json } from "../gift-cards/respond.ts";
import type { BookingDeps } from "./deps.ts";
import { loadBusy } from "./events.ts";

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
  const { settings, config, mode } = deps;
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

  const lastDate = addDays(from, days - 1);
  let busy: { start: number; end: number }[] = [];
  if (mode !== "development") {
    const loaded = await loadBusy(deps, startOfLocalDay(from, tz) - DAY_MS, startOfLocalDay(lastDate, tz) + 2 * DAY_MS, { fresh: false });
    if (loaded === null) {
      log("times_unavailable");
      return reply({ ok: false, error: "unavailable" }, 502);
    }
    busy = loaded;
  }

  const hours = effectiveHours(settings.hours, service);
  const open = openDays({ settings, service, index, chosen, busy, now, from, days, tz });
  const today = localParts(now, tz).date;
  let window: { first: string; last: string };
  if (index === 0) window = { first: today, last: addDays(today, hours.aheadDays) };
  else {
    const previousDate = localParts(chosen[index - 1] as number, tz).date;
    window = { first: addDays(previousDate, service.between?.minDays ?? 0), last: addDays(previousDate, service.between?.maxDays ?? 0) };
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
