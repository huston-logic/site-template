// The booking setting (`booking` in site.config.ts) and the build decision. Import-free except the shared production-build
// rule, so the Next build, scripts and the Worker read one rule. Design: docs/superpowers/specs/2026-11-27-booking-design.md (R1, R19).
import { isProductionBuild } from "../lib/build-target.ts";
import type { BookingConfig } from "./schema.ts";

export const BOOKING_FIXTURE_ENV = "BOOKING_FIXTURE";

/** What a local test build gets with BOOKING_FIXTURE=1: obviously fake calendar ids, never a real one. */
export const FIXTURE_BOOKING: BookingConfig = { calendarId: "bookings@calendar.example.test", busyCalendarIds: [], previewCalendarId: "preview@calendar.example.test" };

interface BuildSiteConfig {
  booking?: BookingConfig | null;
  domain: { productionBranch: string };
}

/**
 * The booking setting a build uses, or null when nothing ships. `BOOKING_FIXTURE=1` gives a local test build the fixture
 * above (so the thank-you page and the block's flow build); on any Workers Builds build it throws, so a fixture never ships.
 */
export function bookingForBuild(config: BuildSiteConfig, env: Record<string, string | undefined>): BookingConfig | null {
  if (env[BOOKING_FIXTURE_ENV] === "1") {
    if (isProductionBuild(env, config.domain.productionBranch) || env["WORKERS_CI"]) {
      throw new Error(`${BOOKING_FIXTURE_ENV}=1 is for local test builds only and must not be set on a Workers Builds build.`);
    }
    return FIXTURE_BOOKING;
  }
  return config.booking ?? null;
}
