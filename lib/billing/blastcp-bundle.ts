import "server-only";

// The BlastCP tier a Weft user's plan gives them (docs/architecture/billing.md "BlastCP usage"). BlastCP reads it from
// /api/billing/status when Weft connects or syncs (its side: aimhuge/blastcp docs/architecture/weft-token-exchange.md)
// and sets the user's own BlastCP workspace to it. One tier per person, on their own BlastCP workspace:
//
// - Team gives every member Creator: each of them is a paid seat.
// - Pro, Open Source and Education give the workspace's owners Creator: Pro is priced per workspace, not per person,
//   and the grants are free, so the people a workspace invites don't each get a paid BlastCP plan.
// - Anything that isn't paying or granted right now (Free, a failing or canceled subscription, a lapsed grant) is Free.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription } from "@aimhuge/billing";
import { billing } from "./billing";
import { grantLapsed } from "./plan-gate";
import { catalog, type BlastcpTier } from "./plans";

export type BlastcpBundle = BlastcpTier["id"];

// The statuses a plan counts in, as for the Puku meter (lib/billing/billing.ts `meteredStatuses`).
const LIVE = new Set(["active", "trialing"]);

export function blastcpBundle(sub: Pick<Subscription, "plan" | "status" | "trialEnd">, role: string | null): BlastcpBundle {
  if (!LIVE.has(sub.status) || grantLapsed(sub.plan, sub.trialEnd)) return "free";
  const tier = catalog.get(sub.plan).blastcp.id;
  if (tier === "free" || sub.plan === "team") return tier;
  return role === "owner" ? tier : "free";
}

// What BlastCP is told (/api/billing/blastcp): the best tier any of the user's workspaces gives them, and until when it is
// paid or granted, so BlastCP can drop it back to Free on its own if Weft goes quiet (a lapsed card, an uninstalled app).
export interface BlastcpAnswer {
  tier: BlastcpBundle;
  // The end of the period (or the grant) that gives Creator; null on Free.
  until: string | null;
}

function untilOf(sub: Subscription): string {
  return sub.plan === "oss" || sub.plan === "edu" ? (sub.trialEnd ?? sub.currentPeriodEnd) : sub.currentPeriodEnd;
}

export async function blastcpAnswer(service: SupabaseClient, userId: string): Promise<BlastcpAnswer> {
  const { data, error } = await service.from("org_memberships").select("org_id, role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const rows = (data as { org_id: string; role: string }[] | null) ?? [];
  let until: string | null = null;
  for (const row of rows) {
    const sub = await billing.subscription(service, row.org_id);
    if (blastcpBundle(sub, row.role) !== "creator") continue;
    const end = untilOf(sub);
    if (until === null || end > until) until = end;
  }
  return { tier: until === null ? "free" : "creator", until };
}
