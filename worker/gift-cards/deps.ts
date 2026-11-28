import type { GiftCardSettings } from "../../src/gift-cards/schema.ts";
import type { PaymentsConfig } from "../../src/payments/config.ts";
import type { WorkerConfig } from "../config.ts";
import type { ContactEnv, Mode, SaveStatus } from "../env.ts";
import type { Delivery } from "../forms.ts";
import type { PaymentProvider, PaymentSession } from "../payments/types.ts";
import type { CertificateInput } from "./certificate-types.ts";

/** Makes the certificate PDF. Fulfilment takes it as a dependency; the real maker is wired in at integration, tests pass a fake. */
export type MakeCertificate = (input: CertificateInput, env: ContactEnv, requestUrl: string) => Promise<Uint8Array>;

/** What every gift card route needs, built once per request by `createWorker`. */
export interface GiftCardDeps {
  config: WorkerConfig;
  payments: PaymentsConfig;
  env: ContactEnv;
  mode: Mode;
  url: URL;
  settings: GiftCardSettings;
  makeCertificate: MakeCertificate;
  /** Milliseconds, like `Date.now`. */
  now: () => number;
  /** The one place a submission is saved (`saveSubmission` in worker/contact.ts), so the ledger follows `contact.destination`. */
  save: (mode: Mode, delivery: Delivery) => Promise<SaveStatus>;
  /**
   * Booking's share of the webhook: set only while `booking` is on. It gets every event for a session whose metadata says
   * `kind: booking` and answers true when done (false asks Stripe to deliver again). Absent, such a session is ignored.
   */
  booking?: (eventType: string, session: PaymentSession, provider: PaymentProvider) => Promise<boolean>;
}
