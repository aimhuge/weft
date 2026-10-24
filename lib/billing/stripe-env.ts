// The environment @aimhuge/billing's Stripe provider demands before it starts any checkout (docs/architecture/billing.md
// "Environment"). Its readStripeConfig wants the key, the webhook secret and a STRIPE_PRICE_<PLAN>_<INTERVAL> for every
// paid plan × every billing interval, even one Weft never sells (Team yearly), and throws one plain Error naming
// every missing variable. On 2026-10-24 that Error reached customers as "Something went wrong on our end", and the
// cause showed only in Vercel's logs; this module names the same list up front so an owner sees a gap first.

import { BILLING_INTERVALS } from "@aimhuge/billing";
import { catalog } from "./plans";

// The package's priceEnvName (server/stripe/client.js), rebuilt here so this stays client-safe;
// stripe-env.test.ts checks the two agree.
export function priceEnvName(plan: string, interval: string): string {
  return `STRIPE_PRICE_${plan.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${interval.toUpperCase()}`;
}

// Every STRIPE_PRICE_* the provider will ask for, derived from the catalog: Pro and Team, monthly and yearly.
// scripts/stripe-weft-prices.mjs creates exactly these (plus the optional regional variants).
export function stripePriceEnvNames(): string[] {
  return catalog.paid.flatMap((plan) => BILLING_INTERVALS.map((interval) => priceEnvName(plan, interval)));
}

export function requiredStripeEnv(): string[] {
  return ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", ...stripePriceEnvNames()];
}

// The required names that are unset or blank, the same test the package applies. Empty when Stripe is fully wired.
export function missingStripeEnv(env: Record<string, string | undefined> = process.env): string[] {
  return requiredStripeEnv().filter((name) => !(env[name] ?? "").trim());
}

// The package's configuration errors are plain Errors, recognized by their wording: the missing-variables list and
// a publishable key in the secret slot. Anything else is a real failure.
const CONFIG_ERROR = /^BILLING_PROVIDER=stripe but these environment variables are missing|^STRIPE_SECRET_KEY holds a publishable key/;

export function isBillingConfigError(err: unknown): boolean {
  return err instanceof Error && CONFIG_ERROR.test(err.message);
}
