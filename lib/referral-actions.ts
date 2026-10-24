"use server";
// The billing page's referral action (docs/architecture/billing.md "Coupons and referrals"): an owner or admin asks for
// the workspace's referral code, made in Stripe on first ask (lib/billing/referrals.ts). Like lib/billing-actions.ts it
// re-runs the gate and the workspace-management permission, then re-renders the page, or comes back with ?error=….

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { roleCan } from "@aimhuge/teams";
import { requireTeam } from "./teams";
import { describeBillingError } from "./billing/checkout";
import { referralCodeFor } from "./billing/referrals";
import { AdminBillingError, adminStripe } from "./billing/admin/stripe-keys";

export async function referralCodeForm(slug: string): Promise<void> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  if (!roleCan(ctx.role, "workspace.manage")) redirect(`/${slug}/billing?error=${encodeURIComponent("Ask an owner for the referral code.")}`);
  let error: string | null = null;
  try {
    await referralCodeFor(ctx.service, adminStripe(), ctx.org.id);
  } catch (err) {
    // Our own refusals are written for the customer; anything else (Stripe, Postgres) is logged and said plainly.
    error = err instanceof AdminBillingError ? err.message : describeBillingError(err);
  }
  if (error) redirect(`/${slug}/billing?error=${encodeURIComponent(error)}`);
  revalidatePath(`/${slug}/billing`);
}
