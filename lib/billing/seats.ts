import "server-only";

// Team's seat count kept in step with the roster (docs/architecture/billing.md "Team seats"). Team bills per seat on
// the subscription's quantity, so every change to who is in a workspace (an existing account added from the invite box,
// an invite link accepted, a member removed or leaving) re-counts the members and moves the quantity to match through
// the provider's changePlan, prorated. The admin console has its own copy for its per-mode Stripe client
// (lib/billing/admin/members.ts `syncSeats`).

import type { SupabaseClient } from "@supabase/supabase-js";
import { billing } from "./billing";

export interface SeatOrg {
  id: string;
  slug: string;
}

// A subscription still billing: canceled and incomplete have no quantity worth moving.
const BILLING_STATUSES = new Set(["active", "trialing", "past_due"]);

async function memberCount(service: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await service.from("org_memberships").select("user_id", { count: "exact", head: true }).eq("org_id", orgId);
  if (error) throw new Error(error.message);
  return Math.max(1, count ?? 1);
}

// The seats a Team workspace now bills, or null when there is nothing to move: not on Team, not billing, or the row
// belongs to another provider. That last one matters because a local Weft shares the production database while running
// the mock provider (BILLING_PROVIDER unset): the mock must never rewrite a row Stripe owns, and vice versa.
export async function syncTeamSeats(service: SupabaseClient, org: SeatOrg, actorEmail: string | null): Promise<number | null> {
  const sub = await billing.subscription(service, org.id);
  if (sub.plan !== "team" || !BILLING_STATUSES.has(sub.status)) return null;
  const provider = billing.provider();
  if (sub.provider !== provider.id) return null;
  const seats = await memberCount(service, org.id);
  if (seats === sub.seats) return seats;
  await provider.changePlan({ service, orgId: org.id, orgSlug: org.slug, actorEmail }, { plan: "team", interval: sub.interval, seats });
  return seats;
}

// The same, for the team actions: the membership change has already happened and must stand, so a billing failure is
// logged (find it with `vercel logs --query "Team seats"`) and the next change, or the admin console, catches it up.
export async function syncTeamSeatsQuietly(service: SupabaseClient, org: SeatOrg, actorEmail: string | null): Promise<void> {
  try {
    await syncTeamSeats(service, org, actorEmail);
  } catch (err) {
    console.error(`Team seats: ${org.slug}: ${err instanceof Error ? err.message : "unknown"}`);
  }
}
