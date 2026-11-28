// A service's hours over the site's (design R6): its own keys replace the site's, except `closed`, which adds.
import type { Hours, LocalDate, Service } from "./schema.ts";

export function effectiveHours(site: Hours, service: Service): Hours {
  const own = service.hours ?? {};
  return {
    weekly: own.weekly ?? site.weekly,
    starts: own.starts ?? site.starts,
    bufferMinutes: own.bufferMinutes ?? site.bufferMinutes,
    noticeHours: own.noticeHours ?? site.noticeHours,
    aheadDays: own.aheadDays ?? site.aheadDays,
    closed: [...site.closed, ...(own.closed ?? [])],
  };
}

export function isClosed(date: LocalDate, hours: Hours): boolean {
  return hours.closed.some((range) => date >= range.from && date <= range.to);
}
