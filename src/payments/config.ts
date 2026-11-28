// The payments setting (`payments` in site.config.ts) and the build decision. Import-free except the shared production-build
// rule, so the Next build, scripts and the Worker read one list. Design: docs/superpowers/specs/2026-11-27-payments-and-gift-cards-design.md (R1, R2, R15).
import { isProductionBuild } from "../lib/build-target.ts";

/** Two-decimal currencies only (R2). site.config.ts spells the same list inline because it imports nothing; a test keeps them equal. */
export const PAYMENT_CURRENCIES = ["usd", "cad", "gbp", "eur", "aud", "nzd"] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

export interface PaymentsConfig {
  provider: "stripe";
  currency: PaymentCurrency;
}

export const PAYMENTS_FIXTURE_ENV = "PAYMENTS_FIXTURE";

interface BuildSiteConfig {
  payments: PaymentsConfig | null;
  domain: { productionBranch: string };
}

/**
 * The payments setting a build uses, or null when nothing ships. `PAYMENTS_FIXTURE=1` gives a local test build
 * `{ stripe, usd }`; on any Workers Builds build (production or preview) it throws, so a fixture can never ship.
 */
export function paymentsForBuild(config: BuildSiteConfig, env: Record<string, string | undefined>): PaymentsConfig | null {
  if (env[PAYMENTS_FIXTURE_ENV] === "1") {
    if (isProductionBuild(env, config.domain.productionBranch) || env["WORKERS_CI"]) {
      throw new Error(`${PAYMENTS_FIXTURE_ENV}=1 is for local test builds only and must not be set on a Workers Builds build.`);
    }
    return { provider: "stripe", currency: "usd" };
  }
  return config.payments;
}
