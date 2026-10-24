import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { priceEnvName as packagePriceEnvName } from "@aimhuge/billing/server";
import { catalog, REGIONAL_PRO_CENTS, type PlanId } from "./plans";
import { isBillingConfigError, missingStripeEnv, priceEnvName, requiredStripeEnv, stripePriceEnvNames } from "./stripe-env";

// What the Stripe provider demands before any checkout, and the price script that has to make all of it.

const FULL = Object.fromEntries(requiredStripeEnv().map((name) => [name, "x"]));

describe("stripePriceEnvNames", () => {
  it("is every paid plan × interval, Team yearly included though checkout never sells it", () => {
    expect(stripePriceEnvNames()).toEqual([
      "STRIPE_PRICE_PRO_MONTHLY",
      "STRIPE_PRICE_PRO_YEARLY",
      "STRIPE_PRICE_TEAM_MONTHLY",
      "STRIPE_PRICE_TEAM_YEARLY",
    ]);
  });

  it("names prices the way the package does", () => {
    for (const name of ["pro", "team", "pro-plus"]) {
      for (const interval of ["monthly", "yearly"] as const) expect(priceEnvName(name, interval)).toBe(packagePriceEnvName(name, interval));
    }
  });
});

describe("missingStripeEnv", () => {
  it("is empty when everything is set", () => {
    expect(missingStripeEnv(FULL)).toEqual([]);
  });

  it("lists unset and blank names, the way the package counts them", () => {
    expect(missingStripeEnv({ ...FULL, STRIPE_PRICE_TEAM_YEARLY: undefined, STRIPE_WEBHOOK_SECRET: "  " })).toEqual([
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_TEAM_YEARLY",
    ]);
  });

  it("reads process.env by default", () => {
    expect(missingStripeEnv()).toEqual(requiredStripeEnv().filter((n) => !(process.env[n] ?? "").trim()));
  });
});

describe("isBillingConfigError", () => {
  it("recognizes the package's missing-variables and publishable-key errors", () => {
    expect(isBillingConfigError(new Error("BILLING_PROVIDER=stripe but these environment variables are missing: STRIPE_PRICE_TEAM_YEARLY."))).toBe(true);
    expect(isBillingConfigError(new Error("STRIPE_SECRET_KEY holds a publishable key (pk_…). It needs the secret key (sk_… or rk_…)."))).toBe(true);
  });

  it("leaves real failures and non-Errors alone", () => {
    expect(isBillingConfigError(new Error("Your card was declined."))).toBe(false);
    expect(isBillingConfigError("BILLING_PROVIDER=stripe but these environment variables are missing: X")).toBe(false);
  });
});

// scripts/stripe-weft-prices.mjs creates the prices and runs on import, so read its PRICES list as text.
describe("scripts/stripe-weft-prices.mjs", () => {
  const source = readFileSync(join(__dirname, "../../scripts/stripe-weft-prices.mjs"), "utf8");
  const prices = [...source.matchAll(/\{ env: "(\w+)", plan: "(\w+)", interval: "(\w+)", cents: (\d+)(?:, variant: "(\w+)")? \}/g)].map(
    ([, env = "", plan = "", interval = "", cents, variant]) => ({ env, plan, interval, cents: Number(cents), variant }),
  );

  it("makes a price for every name the provider demands", () => {
    expect(prices.filter((p) => !p.variant).map((p) => p.env)).toEqual(stripePriceEnvNames());
  });

  it("prices each one the way the catalog does", () => {
    for (const p of prices.filter((x) => !x.variant)) {
      const interval = p.interval === "month" ? "monthly" : "yearly";
      expect(p.env).toBe(priceEnvName(p.plan, interval));
      expect(p.cents, p.env).toBe(catalog.priceCents(p.plan as PlanId, interval));
    }
  });

  it("prices the regional variants at REGIONAL_PRO_CENTS", () => {
    expect(prices.filter((p) => p.variant).map((p) => p.cents)).toEqual([REGIONAL_PRO_CENTS.low, REGIONAL_PRO_CENTS.lowerMiddle]);
  });
});
