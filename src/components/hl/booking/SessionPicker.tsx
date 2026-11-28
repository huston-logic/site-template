"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TIMES_PATH, type TimesAnswer } from "@/booking/api";
import type { LocalDate, Service } from "@/booking/schema";
import { addDays, localParts, zoneName } from "@/booking/zone";
import { bookingWords as words } from "@/content/booking";
import { dayName, dayTile, durationText, ruleText, weekDays } from "@/lib/booking-flow";
import { TextLink } from "../TextLink";

type Loaded = { key: string; answer: TimesAnswer | null };

type Props = {
  service: Service;
  party: number;
  /** This session's place, from 0. */
  index: number;
  /** The starts already chosen for sessions 0 to index - 1. */
  before: readonly number[];
  /** This session's chosen start, if any. */
  selected: number | null;
  timeZone: string;
  contactHref: string;
  /** A line shown under the heading, such as "That time was just taken." */
  notice: string | null;
  focusOnMount: boolean;
  onPick: (start: number) => void;
};

/** The first day this session's strip shows: today for the first session, the day the rule allows at the earliest for a later one. */
function firstDay(props: Pick<Props, "service" | "index" | "before" | "timeZone" | "selected">): LocalDate {
  const { service, index, before, timeZone, selected } = props;
  if (selected !== null) return localParts(selected, timeZone).date;
  const previous = before[index - 1];
  if (index === 0 || previous === undefined) return localParts(Date.now(), timeZone).date;
  return addDays(localParts(previous, timeZone).date, service.between?.minDays ?? 0);
}

const chipClass =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border px-4.5 font-ui text-chip font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-rust";

/**
 * One session of a booking: its heading and rule, a week of day buttons, and the chosen day's times as a radio group. The times
 * come from the Worker a week at a time (design R8); a day with none is disabled and says so. The parent gives it a new key
 * whenever an earlier choice changes, so a later session never keeps a time the rule no longer allows.
 */
export function SessionPicker(props: Props) {
  const { service, party, index, before, selected, timeZone, contactHref, notice, focusOnMount, onPick } = props;
  const count = service.sessions.length;
  const minutes = service.sessions[index]?.minutes ?? 0;
  const prefix = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [anchor, setAnchor] = useState<LocalDate>(() => firstDay(props));
  const [day, setDay] = useState<LocalDate | null>(() => (selected === null ? null : localParts(selected, timeZone).date));
  const [fallbackZone] = useState(() => zoneName(timeZone, Date.now()));
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const beforeText = before.join(",");
  const key = `${anchor}|${beforeText}`;
  const current = loaded !== null && loaded.key === key ? loaded : null;
  const answer = current?.answer ?? null;
  const loading = current === null;
  const failed = current !== null && (answer === null || !answer.ok);

  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    let gone = false;
    const query = new URLSearchParams({ service: service.id, party: String(party), index: String(index), from: anchor, days: "7", chosen: beforeText });
    void (async () => {
      let result: TimesAnswer | null = null;
      try {
        const response = await fetch(`${TIMES_PATH}?${query.toString()}`, { credentials: "same-origin", headers: { accept: "application/json" } });
        result = response.ok ? ((await response.json().catch(() => null)) as TimesAnswer | null) : null;
      } catch {
        result = null;
      }
      if (!gone) setLoaded({ key, answer: result });
    })();
    return () => {
      gone = true;
    };
  }, [service.id, party, index, anchor, beforeText, key]);

  const days = weekDays(anchor);
  const okAnswer = answer !== null && answer.ok ? answer : null;
  const timesByDay = new Map((okAnswer?.days ?? []).map((entry) => [entry.date, entry.times] as const));
  const span = okAnswer?.window ?? null;
  const canGoBack = span !== null && anchor > span.first;
  const canGoOn = span !== null && addDays(anchor, 7) <= span.last;
  const shownDay = day !== null && days.includes(day) ? day : null;
  const times = shownDay === null ? [] : (timesByDay.get(shownDay) ?? []);
  const anyTimes = days.some((date) => (timesByDay.get(date)?.length ?? 0) > 0);
  const zone = okAnswer?.zoneName ?? fallbackZone;
  const rule = index > 0 ? ruleText(service) : "";

  function move(by: -7 | 7) {
    const target = addDays(anchor, by);
    setAnchor(by < 0 && span !== null && target < span.first ? span.first : target);
  }

  const stepClass = "inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-ink-2 px-4 font-ui text-label font-medium text-ink aria-disabled:cursor-default aria-disabled:opacity-40";

  return (
    <section aria-labelledby={`${prefix}-h`} className="border-t border-hairline pt-8">
      <h3 id={`${prefix}-h`} ref={heading} tabIndex={-1} className="font-ui text-item font-bold focus:outline-none">
        {count === 1 ? words.singleSessionHeading : words.sessionHeading(index + 1, count)}
      </h3>
      <p className="mt-1 text-small text-ink-2">
        {durationText(minutes)}
        {rule ? ` ${rule}` : ""}
      </p>
      <p className="mt-1 text-small text-ink-2">{words.zone(zone)}</p>
      <div role="status" aria-live="polite">
        {notice ? <p className="mt-3 rounded-card bg-tint p-3 text-label text-ink">{notice}</p> : null}
        {loading ? <p className="mt-3 text-small text-ink-2">{words.loading}</p> : null}
      </div>

      {failed ? (
        <div className="mt-4">
          <p className="text-label text-rust">{words.timesFailed}</p>
          <TextLink href={contactHref}>{words.contactLink}</TextLink>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" aria-disabled={canGoBack ? undefined : "true"} onClick={() => canGoBack && move(-7)} className={stepClass}>
              <span aria-hidden="true">&lsaquo;</span>
              {words.previousWeek}
            </button>
            <button type="button" aria-disabled={canGoOn ? undefined : "true"} onClick={() => canGoOn && move(7)} className={stepClass}>
              {words.nextWeek}
              <span aria-hidden="true">&rsaquo;</span>
            </button>
          </div>
          <div role="group" aria-label={words.dayGroupLegend} className="mt-3 grid grid-cols-7 gap-1.5">
            {days.map((date) => {
              const open = (timesByDay.get(date)?.length ?? 0) > 0;
              const on = shownDay === date;
              const tile = dayTile(date);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!open}
                  aria-pressed={on}
                  onClick={() => setDay(date)}
                  className={`flex min-h-16 min-w-0 flex-col items-center justify-center rounded-card border px-0.5 py-2 font-ui focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-rust disabled:cursor-default disabled:border-hairline disabled:text-ink-2 ${
                    on ? "border-ink bg-ink text-silver" : "border-ink-2 text-ink"
                  }`}
                >
                  <span className="sr-only">{open ? dayName(date) : `${dayName(date)}, ${words.noTimesDay}`}</span>
                  <span aria-hidden="true" className="text-small font-medium">
                    {tile.weekday}
                  </span>
                  <span aria-hidden="true" className="text-item font-bold leading-none">
                    {tile.day}
                  </span>
                  <span aria-hidden="true" className="text-tag">
                    {open ? tile.month : "–"}
                  </span>
                </button>
              );
            })}
          </div>
          {okAnswer !== null && !anyTimes ? <p className="mt-4 text-small text-ink-2">{words.noTimesAtAll}</p> : null}
          {shownDay === null && anyTimes ? <p className="mt-4 text-small text-ink-2">{words.pickADay}</p> : null}
          {shownDay !== null && times.length > 0 ? (
            <fieldset role="radiogroup" className="mt-5">
              <legend className="block font-ui text-label font-medium text-ink">{words.timesLegend(dayName(shownDay))}</legend>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {times.map((time) => (
                  <label key={time.start} className="relative">
                    <input type="radio" name={`${prefix}-time`} value={String(time.start)} checked={selected === time.start} onChange={() => onPick(time.start)} className="peer sr-only" />
                    <span className={`${chipClass} ${selected === time.start ? "border-ink bg-ink text-silver" : "border-ink-2 text-ink"}`}>
                      {selected === time.start ? <span aria-hidden="true" className="size-2 rounded-pill bg-rust" /> : null}
                      {time.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </>
      )}
    </section>
  );
}
