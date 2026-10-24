import "server-only";

// Adding and removing a workspace's people from the admin console (docs/architecture/billing.md "Admin console"), with
// Team's seat count kept in step: Team bills per seat on the Stripe subscription's quantity, so each change re-counts the
// roster and moves the quantity to match (prorated). The admin skips the team gate on purpose (a comp, a support fix),
// but never removes a workspace's last owner.

import { normalizeEmail } from "@aimhuge/teams";
import { audit, loadRow, type AdminCtx } from "./context";
import { AdminBillingError } from "./stripe-keys";
import { changeSubscription } from "./subscription-ops";

export type MemberRole = "owner" | "admin" | "member";
const ROLES: readonly MemberRole[] = ["owner", "admin", "member"];

export interface MemberView {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  joinedAt: string;
}

export async function listMembers(ctx: AdminCtx): Promise<MemberView[]> {
  const { data, error } = await ctx.service.from("org_memberships").select("user_id, role, created_at").eq("org_id", ctx.orgId).order("created_at");
  if (error) throw new AdminBillingError(error.message);
  const rows = (data as { user_id: string; role: string; created_at: string }[] | null) ?? [];
  if (rows.length === 0) return [];
  const { data: profiles } = await ctx.service.from("profiles").select<string, { id: string; email: string | null; name: string | null }>("id, email, name").in("id", rows.map((r) => r.user_id));
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return rows.map((r) => ({ userId: r.user_id, email: byId.get(r.user_id)?.email ?? null, name: byId.get(r.user_id)?.name ?? null, role: r.role, joinedAt: r.created_at }));
}

// Team's quantity follows the roster. Other plans have one seat, and a Team row without a subscription has nothing to move.
export async function syncSeats(ctx: AdminCtx): Promise<{ seats: number } | null> {
  const row = await loadRow(ctx.service, ctx.orgId);
  if (row?.plan !== "team" || !row.provider_subscription_id) return null;
  const { count } = await ctx.service.from("org_memberships").select("user_id", { count: "exact", head: true }).eq("org_id", ctx.orgId);
  const seats = Math.max(1, count ?? 1);
  if (seats === row.seats) return { seats };
  await changeSubscription(ctx, { plan: "team", interval: row.billing_interval === "yearly" ? "yearly" : "monthly", seats, proration: "create_prorations" });
  return { seats };
}

export async function addMember(ctx: AdminCtx, body: Record<string, unknown>) {
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!email.includes("@")) throw new AdminBillingError("Give the person's email.");
  const role = (body.role ?? "member") as MemberRole;
  if (!ROLES.includes(role)) throw new AdminBillingError(`Role must be one of ${ROLES.join(", ")}.`);
  const { data: profile } = await ctx.service.from("profiles").select<string, { id: string }>("id").ilike("email", email).maybeSingle();
  const userId = profile?.id;
  if (!userId) throw new AdminBillingError(`No Weft account for ${email}. They sign in once first, or get an invite from the workspace.`);
  const { error } = await ctx.service.from("org_memberships").upsert({ org_id: ctx.orgId, user_id: userId, role }, { onConflict: "org_id,user_id" });
  if (error) throw new AdminBillingError(error.message);
  await audit(ctx, "member_add", { email, userId, role });
  return { userId, seats: await syncSeats(ctx) };
}

export async function removeMember(ctx: AdminCtx, body: Record<string, unknown>) {
  const userId = typeof body.userId === "string" ? body.userId : "";
  const members = await listMembers(ctx);
  const target = members.find((m) => m.userId === userId);
  if (!target) throw new AdminBillingError("That person isn't in this workspace.");
  if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) {
    throw new AdminBillingError("That's the last owner. Make someone else an owner first.");
  }
  const { error } = await ctx.service.from("org_memberships").delete().eq("org_id", ctx.orgId).eq("user_id", userId);
  if (error) throw new AdminBillingError(error.message);
  await audit(ctx, "member_remove", { email: target.email, userId, role: target.role });
  return { seats: await syncSeats(ctx) };
}
