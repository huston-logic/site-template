import type { PaymentCurrency } from "../../src/payments/config.ts";

/** Every supported currency has two decimals (design R2), so minor units are the amount times this. */
export const MINOR_PER_UNIT = 100;

export const SYMBOLS: Record<PaymentCurrency, string> = { usd: "$", cad: "CA$", gbp: "£", eur: "€", aud: "A$", nzd: "NZ$" };

export const toMinor = (amount: number): number => amount * MINOR_PER_UNIT;

/** 5000 and "usd" become "$50.00"; thousands are grouped ("$1,250.00"). */
export function formatMoney(minor: number, currency: PaymentCurrency): string {
  const whole = Math.trunc(Math.abs(minor) / MINOR_PER_UNIT);
  const cents = String(Math.abs(minor) % MINOR_PER_UNIT).padStart(2, "0");
  return `${minor < 0 ? "-" : ""}${SYMBOLS[currency]}${String(whole).replace(/\B(?=(\d{3})+$)/g, ",")}.${cents}`;
}

/** For display where a whole amount reads better without cents (the certificate): 5000 is "$50", 5050 is "$50.50". */
export function formatAmount(minor: number, currency: PaymentCurrency): string {
  const full = formatMoney(minor, currency);
  return minor % MINOR_PER_UNIT === 0 ? full.slice(0, -3) : full;
}
