import "server-only";

// Refunds from the admin console (docs/architecture/billing.md "Admin console"): the workspace's charges as Stripe has
// them, and a full or partial refund of one. A charge is refunded only when it belongs to the workspace's own customer,
// and never for more than is left on it.

import type Stripe from "stripe";
import { audit, orgStripe, type AdminCtx } from "./context";
import { AdminBillingError } from "./stripe-keys";

export interface ChargeView {
  id: string;
  amountCents: number;
  refundedCents: number;
  refundableCents: number;
  currency: string;
  status: string;
  description: string | null;
  createdAt: string;
  receiptUrl: string | null;
}

export function toChargeView(c: Stripe.Charge): ChargeView {
  const refundable = c.status === "succeeded" ? c.amount - c.amount_refunded : 0;
  return {
    id: c.id,
    amountCents: c.amount,
    refundedCents: c.amount_refunded,
    refundableCents: Math.max(0, refundable),
    currency: c.currency,
    status: c.refunded ? "refunded" : c.status,
    description: c.description,
    createdAt: new Date(c.created * 1000).toISOString(),
    receiptUrl: c.receipt_url ?? null,
  };
}

export async function listCharges(ctx: AdminCtx): Promise<ChargeView[]> {
  const { client, row } = await orgStripe(ctx);
  const customer = row?.provider_customer_id;
  if (!customer) return [];
  const { data } = await client.charges.list({ customer, limit: 24 });
  return data.map(toChargeView);
}

export type RefundReason = "requested_by_customer" | "duplicate" | "fraudulent";
export const REFUND_REASONS: readonly RefundReason[] = ["requested_by_customer", "duplicate", "fraudulent"];

export interface RefundInput {
  chargeId: string;
  // Omitted: everything left on the charge.
  amountCents?: number;
  reason: RefundReason;
}

export function readRefund(body: Record<string, unknown>): RefundInput {
  const chargeId = typeof body.chargeId === "string" ? body.chargeId : "";
  if (!/^(ch|py)_/.test(chargeId)) throw new AdminBillingError("Pick a charge to refund.");
  const reason = (body.reason ?? "requested_by_customer") as RefundReason;
  if (!REFUND_REASONS.includes(reason)) throw new AdminBillingError(`Reason must be one of ${REFUND_REASONS.join(", ")}.`);
  if (body.amountCents === undefined || body.amountCents === null || body.amountCents === "") return { chargeId, reason };
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 1) throw new AdminBillingError("A partial refund is a whole number of cents, at least 1.");
  return { chargeId, amountCents, reason };
}

export async function refundCharge(ctx: AdminCtx, input: RefundInput): Promise<{ refundId: string; amountCents: number }> {
  const { client, row, mode } = await orgStripe(ctx);
  const charge = await client.charges.retrieve(input.chargeId);
  const owner = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  if (!owner || owner !== row?.provider_customer_id) throw new AdminBillingError("That charge isn't this workspace's.");
  const view = toChargeView(charge);
  const amount = input.amountCents ?? view.refundableCents;
  if (amount < 1) throw new AdminBillingError("Nothing is left to refund on that charge.");
  if (amount > view.refundableCents) throw new AdminBillingError(`At most ${view.refundableCents} cents is left to refund on that charge.`);
  const refund = await client.refunds.create(
    { charge: charge.id, amount, reason: input.reason, metadata: { app: "weft", org_id: ctx.orgId, actor: ctx.actorEmail } },
    // A double click refunds once.
    { idempotencyKey: `admin-refund:${charge.id}:${amount}:${view.refundedCents}` },
  );
  await audit(ctx, "refund", { mode: mode.mode, charge: charge.id, refund: refund.id, amountCents: amount, partial: amount < view.refundableCents, reason: input.reason });
  return { refundId: refund.id, amountCents: amount };
}
