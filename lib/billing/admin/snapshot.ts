import "server-only";

// What the admin console reads (docs/architecture/billing.md "Admin console"): the workspace list with each one's plan,
// and one workspace's whole billing picture: its row, which Stripe mode its ids live in, its people, its mirrored
// invoices, its recent billing events, its charges from Stripe and its referral code.

import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLikeWildcards } from "@aimhuge/teams";
import { loadRow, type AdminCtx } from "./context";
import { listMembers } from "./members";
import { listCharges, type ChargeView } from "./refunds";
import { AdminBillingError, detectMode } from "./stripe-keys";

export interface OrgListRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  seats: number;
  hasStripeIds: boolean;
}

interface Sub {
  org_id: string;
  plan: string;
  status: string;
  seats: number;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
}

export async function listOrgs(service: SupabaseClient, q: string): Promise<OrgListRow[]> {
  let query = service.from("orgs").select("id, slug, name").order("created_at", { ascending: false }).limit(50);
  const term = q.trim();
  if (term) query = query.or(`slug.ilike.%${escapeLikeWildcards(term)}%,name.ilike.%${escapeLikeWildcards(term)}%`);
  const { data, error } = await query;
  if (error) throw new AdminBillingError(error.message);
  const orgs = (data as { id: string; slug: string; name: string }[] | null) ?? [];
  if (orgs.length === 0) return [];
  const { data: subs } = await service
    .from("org_subscriptions")
    .select<string, Sub>("org_id, plan, status, seats, provider_customer_id, provider_subscription_id")
    .in("org_id", orgs.map((o) => o.id));
  const byOrg = new Map((subs ?? []).map((s) => [s.org_id, s]));
  return orgs.map((o) => {
    const s = byOrg.get(o.id);
    return { ...o, plan: s?.plan ?? "free", status: s?.status ?? "active", seats: s?.seats ?? 1, hasStripeIds: Boolean(s?.provider_customer_id ?? s?.provider_subscription_id) };
  });
}

// One read that can fail without taking the panel down: the console shows what it could read and says what it couldn't.
async function settle<T>(work: Promise<T>, fallback: T): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await work, error: null };
  } catch (err) {
    return { value: fallback, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function orgDetail(ctx: AdminCtx) {
  const { data: org } = await ctx.service.from("orgs").select("id, slug, name").eq("id", ctx.orgId).maybeSingle();
  if (!org) throw new AdminBillingError("No such workspace.");
  const row = await loadRow(ctx.service, ctx.orgId);
  const mode = await detectMode(ctx.stripe, { customerId: row?.provider_customer_id ?? null, subscriptionId: row?.provider_subscription_id ?? null });
  const canCharge = (mode.mode === "live" || mode.mode === "test") && Boolean(ctx.stripe.client(mode.mode)) && Boolean(row?.provider_customer_id);
  const [members, invoices, events, charges, referral] = await Promise.all([
    settle(listMembers(ctx), []),
    ctx.service.from("org_invoices").select("number, status, total_cents, amount_paid_cents, issued_at, provider").eq("org_id", ctx.orgId).order("issued_at", { ascending: false }).limit(24),
    ctx.service.from("org_billing_events").select("kind, actor_email, payload, created_at").eq("org_id", ctx.orgId).order("created_at", { ascending: false }).limit(30),
    canCharge ? settle(listCharges(ctx), [] as ChargeView[]) : Promise.resolve({ value: [] as ChargeView[], error: null }),
    ctx.service.from("referral_codes").select("code, promotion_codes").eq("org_id", ctx.orgId).maybeSingle(),
  ]);
  return {
    org,
    row,
    mode,
    keys: ctx.stripe.modes(),
    defaultMode: ctx.stripe.defaultMode(),
    members: members.value,
    invoices: invoices.data ?? [],
    events: events.data ?? [],
    charges: charges.value,
    referral: referral.data ?? null,
    errors: [members.error, charges.error].filter(Boolean),
  };
}
