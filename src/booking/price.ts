// What a booking costs and what is taken online (design R5). Minor units (cents); the settings hold whole currency units.
import type { Service } from "./schema.ts";

export function bookingPrice(service: Service, party: number): { totalMinor: number; dueNowMinor: number; dueLaterMinor: number; perPerson: boolean } | null {
  const { price, payment } = service;
  if (price === null) return null;
  const perPerson = price.per === "person";
  const totalMinor = price.amount * 100 * (perPerson ? party : 1);
  let dueNowMinor = 0;
  if (payment.kind === "full") dueNowMinor = totalMinor;
  else if (payment.kind === "deposit") {
    const wanted = "percent" in payment ? Math.round((totalMinor * payment.percent) / 100) : payment.amount * 100;
    dueNowMinor = Math.min(totalMinor > 0 ? Math.max(wanted, 1) : 0, totalMinor);
  }
  return { totalMinor, dueNowMinor, dueLaterMinor: totalMinor - dueNowMinor, perPerson };
}
