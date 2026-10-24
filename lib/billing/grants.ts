import "server-only";

// Granting a $0 plan for a year (docs/architecture/billing.md): Open Source and Education are given, not sold, so
// there's no Stripe customer and no Checkout. The grant is the workspace's subscription row with its end in
// trial_end (a $0 row's period rolls forward on every read, so the period can't say when a grant runs out);
// lib/billing/plan-gate.ts reads it as Free after that, until a re-check renews it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { billing } from "./billing";
import { isPaid } from "./plan-gate";

export const GRANT_MONTHS = 12;

// Renew a grant this close to its end, so a maintainer who signs in during the last month doesn't lapse first.
export const RENEW_WITHIN_DAYS = 30;

export type GrantPlan = "oss" | "edu";

export type GrantOutcome =
  | { granted: true; plan: GrantPlan; periodEnd: string }
  // "paid": the workspace pays for Pro or Team, which already include everything a grant does.
  | { granted: false; reason: "paid" };

// The grant's end: the same day GRANT_MONTHS on, in UTC.
export function grantEnd(now: Date): string {
  const end = new Date(now.getTime());
  end.setUTCMonth(end.getUTCMonth() + GRANT_MONTHS);
  return end.toISOString();
}

// Whether a grant ending at endsAt is due a re-check: lapsed, unreadable, or inside its last RENEW_WITHIN_DAYS.
export function renewDue(endsAt: string | null | undefined, now: Date): boolean {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  if (!(end > 0)) return true;
  return end - now.getTime() <= RENEW_WITHIN_DAYS * 86_400_000;
}

// Put a workspace on a granted plan for the next GRANT_MONTHS. A paying workspace is left alone: overwriting its
// row would drop a live Stripe subscription out of our mirror while Stripe kept charging it.
export async function grantPlan(
  service: SupabaseClient,
  orgId: string,
  plan: GrantPlan,
  now: Date = new Date(),
): Promise<GrantOutcome> {
  const current = await billing.subscription(service, orgId);
  if (isPaid(current.plan) && current.status !== "canceled") return { granted: false, reason: "paid" };
  const periodEnd = grantEnd(now);
  await billing.saveSubscription(service, orgId, {
    plan,
    status: "active",
    interval: "yearly",
    seats: 1,
    unitAmountCents: 0,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: periodEnd,
  });
  return { granted: true, plan, periodEnd };
}
