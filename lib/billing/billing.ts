import "server-only";

// The shared AimHuge billing binding for Weft (docs/architecture/billing.md): one Stripe account, app =
// "weft", `WFT-2026-0001`-style invoice numbers, a Stripe webhook mounted by another thread. The catalog lives
// in lib/billing/plans.ts so a plan picker can import it without pulling in Supabase or Stripe.

import { createBilling } from "@aimhuge/billing/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../account";
import { catalog } from "./plans";

export const billing = createBilling({
  app: "weft",
  displayName: "Weft",
  url: "https://weft.zip",
  catalog,
  invoicePrefix: "WFT",
  // Active and trialing are metered. past_due falls back to the free plan's allowance: Stripe's dunning still
  // runs, but the workspace stops spending Pro tokens while a payment is failing.
  meteredStatuses: ["active", "trialing"],
  // Weft's own name, icon and clay accent on Stripe Checkout, over the shared AimHuge account's dashboard branding
  // (which shows another company's logo). Receipts, invoice emails and the portal still carry the account's.
  checkoutBranding: { displayName: "Weft", iconUrl: "https://weft.zip/app-icon.png", buttonColor: "#da7a4c" },
});

// The service-role Supabase client that every billing table reads and writes through. Weft's RLS locks these
// tables down with no policies, so only the secret-key client reaches them. Returns null on a local Weft that
// doesn't have a key — the rest of billing is allowed to fail closed.
export function billingService(): SupabaseClient | null {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// True when real Stripe is wired up: a missing key or provider leaves us on the mock, which is fine for tests
// and a local dev run but isn't a path for real customers.
export function billingConfigured(): boolean {
  return process.env.BILLING_PROVIDER === "stripe" && Boolean(process.env.STRIPE_SECRET_KEY);
}