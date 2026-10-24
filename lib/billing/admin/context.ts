import "server-only";

// What every admin billing op works on: the service client, the org, the super-admin acting (for the audit trail), the
// Stripe clients per mode, and the org's subscription row as stored. `orgStripe` resolves the client for the mode the
// row's ids live in (lib/billing/admin/stripe-keys.ts), so an op on a sandbox-upgraded workspace talks to the sandbox.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUBSCRIPTION_COLUMNS_ADMIN } from "./columns";
import { AdminBillingError, clientFor, detectMode, type AdminStripe, type ModeAnswer } from "./stripe-keys";

export interface AdminCtx {
  service: SupabaseClient;
  orgId: string;
  actorEmail: string;
  stripe: AdminStripe;
}

export interface SubscriptionRow {
  org_id: string;
  plan: string;
  status: string;
  billing_interval: string;
  seats: number;
  unit_amount_cents: number;
  current_period_end: string;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
}

// The org's row, or null when it has never had one (it reads as Free).
export async function loadRow(service: SupabaseClient, orgId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await service.from("org_subscriptions").select(SUBSCRIPTION_COLUMNS_ADMIN).eq("org_id", orgId).maybeSingle();
  if (error) throw new AdminBillingError(error.message);
  return (data) ?? null;
}

export interface OrgStripe {
  row: SubscriptionRow | null;
  mode: ModeAnswer;
  client: Stripe;
}

// The row and the client for its mode; throws when the mode is unknown or there's no key for it.
export async function orgStripe(ctx: AdminCtx): Promise<OrgStripe> {
  const row = await loadRow(ctx.service, ctx.orgId);
  const mode = await detectMode(ctx.stripe, { customerId: row?.provider_customer_id ?? null, subscriptionId: row?.provider_subscription_id ?? null });
  if (mode.mode === "none") throw new AdminBillingError("This workspace has no Stripe customer or subscription.");
  return { row, mode, client: clientFor(ctx.stripe, mode.mode) };
}

// Every admin change leaves a row in org_billing_events, kind `admin.<op>`, so a later reader can see who did what.
export async function audit(ctx: AdminCtx, op: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await ctx.service
    .from("org_billing_events")
    .insert({ org_id: ctx.orgId, kind: `admin.${op}`, actor_email: ctx.actorEmail, payload });
  if (error) throw new AdminBillingError(`The change went through but its audit row didn't: ${error.message}`);
}
