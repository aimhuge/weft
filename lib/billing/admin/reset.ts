import "server-only";

// Reset a workspace's billing state (docs/architecture/billing.md "Admin console"): clear the Stripe customer and
// subscription ids so the next checkout starts fresh, and put the row back on Free. Made for the sandbox case: a dev run
// on the shared production Supabase leaves test-mode ids on a real workspace, and a later live checkout would try to reuse
// a customer the live account has never heard of. The old ids go into the audit row, so nothing is lost.

import { billing } from "../billing";
import { audit, loadRow, type AdminCtx } from "./context";
import { AdminBillingError, detectMode } from "./stripe-keys";

export interface ResetInput {
  // Cancel the subscription in Stripe first (in its own mode), when there is one.
  cancelUpstream: boolean;
  // Delete the mirrored Stripe invoices and cards too (right for sandbox rows, which were never real money).
  purgeMirror: boolean;
}

export function readReset(body: Record<string, unknown>): ResetInput {
  return { cancelUpstream: body.cancelUpstream === true, purgeMirror: body.purgeMirror === true };
}

async function purge(ctx: AdminCtx, table: "org_invoices" | "org_payment_methods"): Promise<number> {
  const { data, error } = await ctx.service.from(table).delete().eq("org_id", ctx.orgId).eq("provider", "stripe").select("id");
  if (error) throw new AdminBillingError(`Couldn't clear ${table}: ${error.message}`);
  return (data as unknown[] | null)?.length ?? 0;
}

export async function resetBilling(ctx: AdminCtx, input: ResetInput) {
  const row = await loadRow(ctx.service, ctx.orgId);
  const ids = { customerId: row?.provider_customer_id ?? null, subscriptionId: row?.provider_subscription_id ?? null };
  const mode = await detectMode(ctx.stripe, ids);
  let canceled: string | null = null;
  if (input.cancelUpstream && ids.subscriptionId && (mode.mode === "live" || mode.mode === "test")) {
    const client = ctx.stripe.client(mode.mode);
    if (!client) throw new AdminBillingError(`No ${mode.mode} Stripe key to cancel the subscription with. Untick "cancel in Stripe" to reset anyway.`);
    try {
      await client.subscriptions.cancel(ids.subscriptionId);
      canceled = "canceled";
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
      canceled = "already gone";
    }
  }
  await billing.saveSubscription(ctx.service, ctx.orgId, {
    plan: "free",
    status: "active",
    seats: 1,
    unitAmountCents: 0,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: null,
    provider: "mock",
    providerCustomerId: null,
    providerSubscriptionId: null,
  });
  const purged = input.purgeMirror ? { invoices: await purge(ctx, "org_invoices"), cards: await purge(ctx, "org_payment_methods") } : null;
  const summary = { mode: mode.mode, before: { plan: row?.plan ?? "free", ...ids }, canceled, purged };
  await audit(ctx, "billing_reset", summary);
  return summary;
}
