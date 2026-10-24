import "server-only";

// The admin console's subscription changes (docs/architecture/billing.md "Admin console"): upgrade, downgrade and switch
// between paid plans and intervals, change seats, cancel at period end or now, resume, re-read from Stripe, and comp a $0
// plan. Each Stripe call goes to the client for the org's own mode (./context.ts `orgStripe`), and the row is written
// back through `billing.saveSubscription` from what Stripe answered, the same mirror a webhook would make.

import type Stripe from "stripe";
import { BILLING_INTERVALS, isBillingInterval, type BillingInterval } from "@aimhuge/billing";
import { fromUnix, toSubscriptionStatus } from "@aimhuge/billing/server";
import { billing } from "../billing";
import { grantPlan, type GrantPlan } from "../grants";
import { catalog, type PlanId } from "../plans";
import { audit, orgStripe, type AdminCtx } from "./context";
import { AdminBillingError, type StripeMode } from "./stripe-keys";

export type Proration = "create_prorations" | "always_invoice" | "none";
export const PRORATIONS: readonly Proration[] = ["create_prorations", "always_invoice", "none"];

// scripts/stripe-weft-prices.mjs names every price `weft_<plan>_<interval>_<cents>`, the same in both modes, so the
// console finds a mode's price for a plan without that mode's STRIPE_PRICE_* ids.
export function priceLookupKey(plan: PlanId, interval: BillingInterval): string {
  return `weft_${plan}_${interval}_${catalog.priceCents(plan, interval)}`;
}

export async function priceFor(client: Stripe, mode: StripeMode, plan: PlanId, interval: BillingInterval): Promise<string> {
  const key = priceLookupKey(plan, interval);
  const { data } = await client.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  const price = data[0];
  if (!price) throw new AdminBillingError(`No active ${mode}-mode price with lookup key ${key}. Run scripts/stripe-weft-prices.mjs with the ${mode} key.`);
  return price.id;
}

// A price's plan and interval: its metadata (the price script stamps both), else its lookup key.
export function planOfPrice(price: Pick<Stripe.Price, "metadata" | "lookup_key"> | null | undefined): { plan: PlanId; interval: BillingInterval } | null {
  if (!price) return null;
  const fromKey = /^weft_([a-z]+)_(monthly|yearly)_/.exec(price.lookup_key ?? "");
  const plan = price.metadata.plan ?? fromKey?.[1];
  const interval = price.metadata.interval ?? fromKey?.[2];
  if (!plan || !catalog.paid.includes(plan as PlanId) || !isBillingInterval(interval)) return null;
  return { plan: plan as PlanId, interval };
}

// Stripe's subscription, written onto the org's row. Dahlia keeps the period on the item, not the subscription.
export async function mirror(ctx: AdminCtx, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  const found = planOfPrice(item?.price);
  if (!item || !found) throw new AdminBillingError(`Subscription ${sub.id} isn't on a Weft price, so it can't be mirrored.`);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  await billing.saveSubscription(ctx.service, ctx.orgId, {
    plan: found.plan,
    interval: found.interval,
    seats: item.quantity ?? 1,
    unitAmountCents: item.price.unit_amount ?? 0,
    status: toSubscriptionStatus(sub.status),
    currentPeriodStart: fromUnix(item.current_period_start) ?? new Date().toISOString(),
    currentPeriodEnd: fromUnix(item.current_period_end) ?? new Date().toISOString(),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: fromUnix(sub.canceled_at),
    trialEnd: fromUnix(sub.trial_end),
    provider: "stripe",
    providerCustomerId: customer,
    providerSubscriptionId: sub.id,
  });
}

async function subscriptionOf(ctx: AdminCtx) {
  const org = await orgStripe(ctx);
  const id = org.row?.provider_subscription_id;
  if (!id) throw new AdminBillingError("No Stripe subscription. Send a checkout link to move a Free workspace onto a paid plan.");
  return { ...org, id };
}

export interface ChangeInput {
  plan: PlanId;
  interval: BillingInterval;
  seats: number;
  proration: Proration;
}

export function readChange(body: Record<string, unknown>): ChangeInput {
  const plan = body.plan as PlanId;
  if (!catalog.paid.includes(plan)) throw new AdminBillingError(`Plan must be one of ${catalog.paid.join(", ")}.`);
  const interval = body.interval;
  if (!isBillingInterval(interval)) throw new AdminBillingError(`Interval must be ${BILLING_INTERVALS.join(" or ")}.`);
  const seats = Number(body.seats ?? 1);
  if (!Number.isInteger(seats) || seats < 1 || seats > 500) throw new AdminBillingError("Seats must be a whole number from 1 to 500.");
  const proration = (body.proration ?? "create_prorations") as Proration;
  if (!PRORATIONS.includes(proration)) throw new AdminBillingError(`Proration must be one of ${PRORATIONS.join(", ")}.`);
  return { plan, interval, seats: plan === "pro" ? 1 : seats, proration };
}

// Upgrade, downgrade or switch between paid plans and intervals, or change the seat count: one item swap.
export async function changeSubscription(ctx: AdminCtx, input: ChangeInput): Promise<void> {
  const { client, mode, id, row } = await subscriptionOf(ctx);
  const price = await priceFor(client, mode.mode as StripeMode, input.plan, input.interval);
  const current = await client.subscriptions.retrieve(id);
  const item = current.items.data[0];
  if (!item) throw new AdminBillingError(`Subscription ${id} has no item to change.`);
  const updated = await client.subscriptions.update(id, {
    // Replace the item, not add one: leaving out its id bills old and new.
    items: [{ id: item.id, price, quantity: input.seats }],
    proration_behavior: input.proration,
    cancel_at_period_end: false,
  });
  await mirror(ctx, updated);
  await audit(ctx, "change_plan", { mode: mode.mode, from: { plan: row?.plan, interval: row?.billing_interval, seats: row?.seats }, to: input });
}

export async function setCancelAtPeriodEnd(ctx: AdminCtx, cancel: boolean): Promise<void> {
  const { client, mode, id } = await subscriptionOf(ctx);
  const updated = await client.subscriptions.update(id, { cancel_at_period_end: cancel });
  await mirror(ctx, updated);
  await audit(ctx, cancel ? "cancel_at_period_end" : "resume", { mode: mode.mode, subscription: id });
}

export type CancelCredit = "none" | "prorate";

// The row a workspace has on Free: no subscription, $0, one seat. The customer id stays, so a later checkout reuses it.
export const FREE_PATCH = {
  plan: "free" as PlanId,
  status: "active" as const,
  seats: 1,
  unitAmountCents: 0,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  providerSubscriptionId: null,
};

// Downgrade to Free now: end the Stripe subscription in its own mode (crediting the unused time to the customer's balance
// when asked), then set the row back to Free whatever Stripe says, so a subscription already gone still lands on Free.
export async function cancelNow(ctx: AdminCtx, credit: CancelCredit): Promise<{ stripe: string }> {
  const { client, mode, id } = await subscriptionOf(ctx);
  let outcome = "canceled";
  try {
    await client.subscriptions.cancel(id, credit === "prorate" ? { prorate: true, invoice_now: true } : {});
  } catch (err) {
    if ((err as { code?: string }).code !== "resource_missing") throw err;
    outcome = "already gone";
  }
  await billing.saveSubscription(ctx.service, ctx.orgId, { ...FREE_PATCH, canceledAt: new Date().toISOString() });
  await audit(ctx, "downgrade_free", { mode: mode.mode, subscription: id, credit, stripe: outcome });
  return { stripe: outcome };
}

// Re-read the subscription from Stripe and mirror it: a repair after a missed webhook.
export async function resync(ctx: AdminCtx): Promise<void> {
  const { client, mode, id } = await subscriptionOf(ctx);
  const sub = await client.subscriptions.retrieve(id);
  if (sub.status === "canceled") await billing.saveSubscription(ctx.service, ctx.orgId, { ...FREE_PATCH, canceledAt: fromUnix(sub.canceled_at) });
  else await mirror(ctx, sub);
  await audit(ctx, "resync", { mode: mode.mode, subscription: id, status: sub.status });
}

export const COMP_PLANS: readonly PlanId[] = ["free", "oss", "edu"];

// Put a workspace on a $0 plan by hand. Refuses one with a live subscription: downgrade it first, so nobody keeps paying.
export async function compPlan(ctx: AdminCtx, plan: PlanId): Promise<void> {
  if (!COMP_PLANS.includes(plan)) throw new AdminBillingError(`Comp one of ${COMP_PLANS.join(", ")}; paid plans go through Stripe.`);
  const current = await billing.subscription(ctx.service, ctx.orgId);
  if (current.providerSubscriptionId && current.status !== "canceled") {
    throw new AdminBillingError("This workspace has a Stripe subscription. Downgrade it to Free first.");
  }
  if (plan === "free") await billing.setPlanByAdmin(ctx.service, { orgId: ctx.orgId, plan, actorEmail: ctx.actorEmail });
  else await grantPlan(ctx.service, ctx.orgId, plan as GrantPlan);
  await audit(ctx, "comp", { from: current.plan, to: plan });
}
