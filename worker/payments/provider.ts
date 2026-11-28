import type { PaymentsConfig } from "../../src/payments/config.ts";
import type { ContactEnv, Mode } from "../env.ts";
import { createCheckoutSession, getSession, markPayment } from "./stripe.ts";
import type { PaymentProvider } from "./types.ts";
import { verifyStripeSignature, type VerifyResult } from "./webhook.ts";

/**
 * THE one place a payment provider is chosen (`payments.provider` in site.config.ts, design R2). Products talk to the
 * small `PaymentProvider` interface (worker/payments/types.ts), never to Stripe. OTHER PROVIDER GOES HERE: add its name
 * to `PaymentsConfig` in src/payments/config.ts and to scripts/config-rules.mjs (its secrets), write its client next to
 * stripe.ts, add a branch in `paymentProvider` and in `verifyPaymentWebhook`, and add tests like stripe.test.ts.
 *
 * The key's mode must match the site's (design R3): a test key only in a preview, a live key only in production. A
 * development Worker never calls the provider at all.
 */

export type ProviderProblem = "no_key" | "key_mode" | "development";
export type ProviderResult = { ok: true; provider: PaymentProvider } | { ok: false; reason: ProviderProblem };

/** Stripe restricted (`rk_`) and secret (`sk_`) keys name their mode: `rk_test_...` or `rk_live_...`. */
export function keyMode(key: string): "test" | "live" | null {
  const match = /^(?:rk|sk)_(test|live)_/.exec(key);
  return match ? (match[1] as "test" | "live") : null;
}

export function paymentProvider(config: PaymentsConfig, env: ContactEnv, mode: Mode): ProviderResult {
  if (mode === "development") return { ok: false, reason: "development" };
  switch (config.provider) {
    case "stripe": {
      const key = env.STRIPE_SECRET_KEY;
      if (!key) return { ok: false, reason: "no_key" };
      if (keyMode(key) !== (mode === "production" ? "live" : "test")) return { ok: false, reason: "key_mode" };
      return {
        ok: true,
        provider: {
          createCheckout: (params, idempotencyKey) => createCheckoutSession(key, params, idempotencyKey),
          readSession: (id) => getSession(key, id),
          writeMarks: (paymentId, marks) => markPayment(key, paymentId, marks),
        },
      };
    }
    // OTHER PROVIDER GOES HERE (see the comment at the top of this file).
  }
}

/** Checks a webhook's signature with the endpoint secret. Runs before anything else reads the body. */
export async function verifyPaymentWebhook(config: PaymentsConfig, env: ContactEnv, rawBody: string, header: string | null, nowSeconds: number): Promise<VerifyResult | { ok: false; reason: "unconfigured" }> {
  switch (config.provider) {
    case "stripe":
      if (!env.STRIPE_WEBHOOK_SECRET) return { ok: false, reason: "unconfigured" };
      return verifyStripeSignature(rawBody, header, env.STRIPE_WEBHOOK_SECRET, nowSeconds);
    // OTHER PROVIDER GOES HERE.
  }
}
