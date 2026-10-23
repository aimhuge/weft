import "server-only";

// "Does this workspace's plan let it have people?" (docs/architecture/teams.md, billing.md). Teams are a paid
// capability: a Free workspace stays a team of one, and inviting or adding a member needs Pro or Team.
//
// The check lives here rather than in lib/team-ops.ts so the rule ("which plans may have members") is one
// list, testable without a Supabase client, and shared by anything else that asks — the team page's upsell
// note, for one. A caller that must fail closed (an invite, a role change) should treat a null plan as
// not-allowed: canHaveMembers only answers for a plan id we actually know.

import type { SupabaseClient } from "@supabase/supabase-js";
import { catalog, type PlanId } from "./plans";

// The plans whose workspaces may invite and manage members. Free is deliberately absent.
export const TEAM_PLANS: readonly PlanId[] = ["pro", "team"];

// Whether a workspace is on a paid plan at all — anything above Free. The billing page's "is this paid?"
// question: a paying workspace shows Manage billing and Invoices whether it's Pro or Team, so this must not be
// written as `plan === "pro"`, which a Team workspace fails. Derived from the catalog's price, so adding a
// paid plan later doesn't need this list touched; an unknown id falls back to free and answers false.
export function isPaid(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return catalog.get(plan).monthlyUnitAmountCents > 0;
}

// Whether a plan id may have members. An unknown id is false: the direction that refuses. The parameter is a
// plain string because the row we read it from is `text`, not a PlanId.
export function canHaveMembers(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return TEAM_PLANS.includes(plan as PlanId) && catalog.get(plan).id === plan;
}

// The plan a workspace is on, or "free" when we can't tell — a subscription read that fails, or a workspace
// with no subscription row yet. Under-granting is the safe direction for a gate, so a read that throws is
// caught and answered "free": a database hiccup must not unlock a paid capability, and must not 500 an invite
// form either.
export async function workspacePlan(service: SupabaseClient, orgId: string): Promise<PlanId> {
  const row = await readSubscription(service, orgId);
  if (!row || typeof row.plan !== "string") return "free";
  const status = typeof row.status === "string" ? row.status : "";
  if (status && status !== "active" && status !== "trialing") return "free";
  return catalog.get(row.plan).id;
}

// The one subscription read, as a row or null. Split out so workspacePlan has a single place that can fail:
// a missing client, a client that throws on from(), or a rejected query all land on "no row".
async function readSubscription(service: SupabaseClient, orgId: string): Promise<{ plan?: unknown; status?: unknown } | null> {
  try {
    const { data } = await service
      .from("org_subscriptions")
      .select("plan, status")
      .eq("org_id", orgId)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

// workspacePlan + canHaveMembers in one call, for the ops that gate on it.
export async function workspaceCanHaveMembers(service: SupabaseClient, orgId: string): Promise<boolean> {
  return canHaveMembers(await workspacePlan(service, orgId));
}