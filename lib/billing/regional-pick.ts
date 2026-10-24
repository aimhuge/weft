import "server-only";

// Which regional price a workspace's Checkout uses (docs/architecture/billing.md): the visitor's IP country, from
// Vercel's x-vercel-ip-country header, and the workspace's billing-address country. Either qualifying is enough.
// Shared by the billing page (to show the price) and the upgrade action (to sell it), so they can't disagree.

import type { SupabaseClient } from "@supabase/supabase-js";
import { billing } from "./billing";
import { REGIONAL_VARIANTS, regionalCents, regionalTier, type RegionalTier } from "./regional";

export interface RegionalPick {
  tier: RegionalTier;
  // The Stripe price variant Checkout sells through (STRIPE_PRICE_PRO_MONTHLY_<VARIANT>).
  variant: string;
  monthlyCents: number;
}

export const IP_COUNTRY_HEADER = "x-vercel-ip-country";

export async function regionalPick(
  service: SupabaseClient,
  orgId: string,
  ipCountry: string | null | undefined,
): Promise<RegionalPick | null> {
  // A billing profile that can't be read just means the IP decides on its own.
  const profile = await billing.profile(service, orgId).catch(() => null);
  const tier = regionalTier(ipCountry, profile?.country);
  if (!tier) return null;
  return { tier, variant: REGIONAL_VARIANTS[tier], monthlyCents: regionalCents(tier) };
}
