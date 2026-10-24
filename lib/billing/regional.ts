// Regional pricing (docs/architecture/billing.md): Pro at $5 a month in World Bank low-income countries and $10 in
// lower-middle-income ones. Still plan "pro" with Pro's allowance; only the Stripe price differs, picked at Checkout
// by country. The country comes from the visitor's IP (Vercel's x-vercel-ip-country) and the workspace's billing
// address, and either one qualifying is enough. The card's issuing country isn't checked, so a VPN gets the price:
// lost revenue, not lost money, as long as $5 covers a Pro user's Puku tokens.
//
// The income groups are the World Bank's (api.worldbank.org/v2/country, FY2026), not the UN LDC list. They change
// every July 1st; refresh both sets from that API then.

import { REGIONAL_PRO_CENTS } from "./plans";

export type RegionalTier = "low" | "lowerMiddle";

// ISO 3166-1 alpha-2 codes.
export const LOW_INCOME: ReadonlySet<string> = new Set([
  "AF", "BF", "BI", "CD", "CF", "ER", "ET", "GM", "GW", "KP", "LR", "MG", "ML", "MW", "MZ", "NE", "RW", "SD", "SL",
  "SO", "SS", "SY", "TD", "UG", "YE",
]);

export const LOWER_MIDDLE_INCOME: ReadonlySet<string> = new Set([
  "AO", "BD", "BJ", "BO", "BT", "CG", "CI", "CM", "DJ", "EG", "GH", "GN", "HN", "HT", "IN", "KE", "KG", "KH", "KI",
  "KM", "LA", "LB", "LS", "MA", "MM", "MR", "NA", "NG", "NI", "NP", "PG", "PK", "PS", "SB", "SN", "ST", "SZ", "TG",
  "TJ", "TL", "TN", "TZ", "UZ", "VE", "VU", "ZM", "ZW",
]);

// The Stripe price variant each tier sells through: STRIPE_PRICE_PRO_MONTHLY_REGIONAL_LOW and
// STRIPE_PRICE_PRO_MONTHLY_REGIONAL_LOWER_MIDDLE on the deployment.
export const REGIONAL_VARIANTS: Record<RegionalTier, string> = {
  low: "regional_low",
  lowerMiddle: "regional_lower_middle",
};

export function tierFor(country: string | null | undefined): RegionalTier | null {
  const code = country?.trim().toUpperCase();
  if (!code) return null;
  if (LOW_INCOME.has(code)) return "low";
  if (LOWER_MIDDLE_INCOME.has(code)) return "lowerMiddle";
  return null;
}

// The cheapest tier any of the given countries qualifies for (IP and billing address), or null for full price.
export function regionalTier(...countries: (string | null | undefined)[]): RegionalTier | null {
  const tiers = countries.map(tierFor);
  if (tiers.includes("low")) return "low";
  if (tiers.includes("lowerMiddle")) return "lowerMiddle";
  return null;
}

// What Pro costs a month on a tier, in cents.
export function regionalCents(tier: RegionalTier): number {
  return REGIONAL_PRO_CENTS[tier];
}
