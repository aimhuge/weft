// Delete a workspace ({action:"delete"} through runTeamOp, and the deleteTeam server action). Every table that
// hangs off `orgs` cascades (memberships, invites, projects, synced cards, commands, mini apps, share links,
// billing rows), so the checks come first: an owner, who is in another team too (nobody is left with none),
// who typed the team's name, and no paid plan still running (deleting the row wouldn't stop Stripe billing).
import "server-only";
import type { TeamActionResult } from "./team-types";
import type { TeamContext } from "./teams";
import { isPaid } from "./billing/plan-gate";

type Subscription = { plan: string; status: string; cancel_at_period_end: boolean };

// A plan that still bills: a paid one (not Free or a granted $0 plan), not canceled, not already set to end with its period.
function stillBilling(sub: Subscription | null): sub is Subscription {
  return !!sub && isPaid(sub.plan) && sub.status !== "canceled" && !sub.cancel_at_period_end;
}

export async function runDeleteTeam(ctx: TeamContext, confirm: string): Promise<TeamActionResult> {
  if (ctx.role !== "owner") return { ok: false, message: "Only an owner can delete the team." };
  if (ctx.orgs.length < 2) return { ok: false, message: "You need to be in another team before you can delete this one." };
  if (confirm.trim() !== ctx.org.name.trim()) return { ok: false, message: `Type "${ctx.org.name}" to delete it.` };
  const { data: sub } = await ctx.service
    .from("org_subscriptions")
    .select("plan, status, cancel_at_period_end")
    .eq("org_id", ctx.org.id)
    .maybeSingle<Subscription>();
  if (stillBilling(sub)) return { ok: false, message: `Cancel ${ctx.org.name}'s ${sub.plan} plan in Billing first.` };
  const { error } = await ctx.service.from("orgs").delete().eq("id", ctx.org.id);
  if (error) return { ok: false, message: `Could not delete the team: ${error.message}` };
  return { ok: true, message: `Deleted ${ctx.org.name}.` };
}
