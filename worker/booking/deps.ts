import type { BookingConfig, BookingSettings } from "../../src/booking/schema.ts";
import type { FormDefinition } from "../../src/forms/schema.ts";
import type { PaymentsConfig } from "../../src/payments/config.ts";
import type { WorkerConfig } from "../config.ts";
import type { ContactEnv, Mode, SaveStatus } from "../env.ts";
import type { Delivery } from "../forms.ts";
import type { CalendarClient } from "./calendar.ts";
import type { SlotLock } from "./lock.ts";

/** What a test (or the integration) can replace in the booking routes. The production defaults are in routes.ts. */
export interface BookingOptions {
  /** The booking settings. Default: the bundled `src/content/booking.json`, like the form files. */
  booking?: BookingSettings;
  /** The calendar client. Default: Google Calendar through the site's service account. */
  calendar?: CalendarClient;
  /** The slot lock. Default: the `BOOKING_LOCK` Durable Object; without the binding the routes fail closed. */
  lock?: SlotLock;
}

/** What every booking route needs, built once per request (or per cron run) by `createWorker`. */
export interface BookingDeps {
  config: WorkerConfig;
  /** The calendar connection (`booking` in site.config.ts); never null here. */
  booking: BookingConfig;
  /** `payments` in site.config.ts: null means no service that takes money can be offered. */
  payments: PaymentsConfig | null;
  settings: BookingSettings;
  /** The booking details form (src/content/forms/booking.json), read from the registry directly. */
  form: FormDefinition;
  env: ContactEnv;
  mode: Mode;
  url: URL;
  /** Milliseconds, like `Date.now`. */
  now: () => number;
  calendar: CalendarClient;
  /** Null without the binding: checkout and fulfilment then fail closed. */
  lock: SlotLock | null;
  /** The one place a ledger row is saved (`saveSubmission` in worker/contact.ts). */
  save: (mode: Mode, delivery: Delivery) => Promise<SaveStatus>;
}
