import "server-only";

// Starting a Stripe Checkout for Pro or Team (docs/architecture/billing.md "The upgrade dialog"). One function for
// every way in: the billing page's Upgrade buttons and the upgrade dialog's server action on weft.zip (lib/billing-actions.ts),
// and the desktop's /api/billing/checkout, which has a Weft access token instead of a cookie session.

import type { SupabaseClient } from "@supabase/supabase-js";
import { roleCan, type OrgRole } from "@aimhuge/teams";
import { BillingError } from "@aimhuge/billing";
import { billing, billingConfigured } from "./billing";
import { orgForUser } from "./org";
import { regionalPick } from "./regional-pick";
import { isBillingConfigError } from "./stripe-env";
import type { CheckoutAnswer, UpgradeInterval, UpgradePlan } from "./upgrade";

export interface UpgradeContext {
  service: SupabaseClient;
  orgId: string;
  orgSlug: string;
  actorEmail: string | null;
  role: OrgRole;
}

export interface UpgradeRequest {
  plan: UpgradePlan;
  interval: UpgradeInterval;
  // The visitor's country from Vercel's edge header, for regional Pro prices; null off Vercel.
  ipCountry: string | null;
  // Where Stripe sends the customer back to, a path on this Weft.
  returnPath: string;
}

// A `BillingError` is safe to show the customer verbatim; anything else is ours and gets logged with its
// message so a real bug is traceable without the customer seeing a raw Stripe or Postgres string. A configuration
// error (a missing STRIPE_* variable, lib/billing/stripe-env.ts) says so, so nobody mistakes it for a passing blip.
export const BILLING_SETUP_INCOMPLETE = "Billing isn't fully set up on this Weft yet.";

export function describeBillingError(err: unknown): string {
  if (err instanceof BillingError) return err.message;
  if (isBillingConfigError(err)) {
    console.error(`Billing setup: ${(err as Error).message}`);
    return BILLING_SETUP_INCOMPLETE;
  }
  console.error(`Billing action: ${err instanceof Error ? err.message : "unknown"}`);
  return "Something went wrong on our end. Try again in a moment.";
}

// How many seats a Team checkout bills: everyone already in the workspace, and at least the buyer.
async function memberCount(service: SupabaseClient, orgId: string): Promise<number> {
  const { count } = await service.from("org_memberships").select("user_id", { count: "exact", head: true }).eq("org_id", orgId);
  return Math.max(1, count ?? 1);
}

// The provider's checkout input. Team bills monthly per seat (its only Stripe price); Pro may take a regional price
// variant on a monthly upgrade, which a billing package without variant support ignores.
async function checkoutInput(ctx: UpgradeContext, req: UpgradeRequest) {
  if (req.plan === "team") {
    return { plan: req.plan, interval: "monthly" as const, seats: await memberCount(ctx.service, ctx.orgId), returnPath: req.returnPath };
  }
  const regional = req.interval === "monthly" ? await regionalPick(ctx.service, ctx.orgId, req.ipCountry) : null;
  return { plan: req.plan, interval: req.interval, seats: 1, returnPath: req.returnPath, ...(regional && { priceVariant: regional.variant }) };
}

// Owners and admins may spend the workspace's money; members are told to ask. The provider answers with a hosted
// Checkout URL, or applies the change inline (a downgrade needs no new card).
export async function startUpgrade(ctx: UpgradeContext, req: UpgradeRequest): Promise<CheckoutAnswer> {
  if (!roleCan(ctx.role, "workspace.manage")) return { ok: false, error: "Ask an owner to change the plan." };
  if (!billingConfigured()) return { ok: false, error: "Billing isn't set up on this Weft yet." };
  const provider = billing.provider();
  try {
    const input = await checkoutInput(ctx, req);
    const billingCtx = { service: ctx.service, orgId: ctx.orgId, orgSlug: ctx.orgSlug, actorEmail: ctx.actorEmail };
    const result = await provider.startCheckout(billingCtx, input);
    return result.kind === "redirect" ? { ok: true, url: result.url } : { ok: true, applied: true };
  } catch (err) {
    return { ok: false, error: describeBillingError(err) };
  }
}

// The desktop's side of the same: the signed-in user's current workspace (lib/billing/org.ts), their role in it and
// their email, read with the service client because the desktop sends a Weft access token, not a cookie. Null when
// the user has no workspace.
export async function upgradeContextFor(service: SupabaseClient, userId: string): Promise<UpgradeContext | null> {
  const org = await orgForUser(service, userId);
  if (!org) return null;
  const [{ data: member }, { data: user }] = await Promise.all([
    service.from("org_memberships").select("role").eq("org_id", org.id).eq("user_id", userId).maybeSingle(),
    service.auth.admin.getUserById(userId),
  ]);
  const role = ((member as { role?: OrgRole } | null)?.role ?? "member");
  return { service, orgId: org.id, orgSlug: org.slug, actorEmail: user.user?.email ?? null, role };
}
