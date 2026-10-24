import "server-only";

// The admin console's one entry point for a change to a workspace's billing (app/api/admin/billing/[orgId]/route.ts):
// `{ op, ...input }` in, the op's answer out. Every op validates its own input and leaves an audit row
// (docs/architecture/billing.md "Admin console").

import { referralCodeFor } from "../referrals";
import type { PlanId } from "../plans";
import { checkoutLink } from "./checkout-link";
import { applyCoupon, removeDiscount } from "./coupons";
import type { AdminCtx } from "./context";
import { addMember, removeMember, syncSeats } from "./members";
import { readRefund, refundCharge } from "./refunds";
import { readReset, resetBilling } from "./reset";
import { AdminBillingError } from "./stripe-keys";
import { cancelNow, changeSubscription, compPlan, readChange, resync, setCancelAtPeriodEnd } from "./subscription-ops";

type Op = (ctx: AdminCtx, body: Record<string, unknown>) => Promise<unknown>;

export const ORG_OPS: Record<string, Op> = {
  change_plan: (ctx, b) => changeSubscription(ctx, readChange(b)),
  cancel_at_period_end: (ctx) => setCancelAtPeriodEnd(ctx, true),
  resume: (ctx) => setCancelAtPeriodEnd(ctx, false),
  downgrade_free: (ctx, b) => cancelNow(ctx, b.credit === "prorate" ? "prorate" : "none"),
  resync: (ctx) => resync(ctx),
  comp: (ctx, b) => compPlan(ctx, b.plan as PlanId),
  checkout_link: (ctx, b) => checkoutLink(ctx, b),
  refund: (ctx, b) => refundCharge(ctx, readRefund(b)),
  reset: (ctx, b) => resetBilling(ctx, readReset(b)),
  member_add: (ctx, b) => addMember(ctx, b),
  member_remove: (ctx, b) => removeMember(ctx, b),
  sync_seats: (ctx) => syncSeats(ctx),
  coupon_apply: (ctx, b) => applyCoupon(ctx, typeof b.code === "string" ? b.code : ""),
  coupon_remove: (ctx) => removeDiscount(ctx),
  referral_code: (ctx) => referralCodeFor(ctx.service, ctx.stripe, ctx.orgId),
};

export async function runOrgOp(ctx: AdminCtx, body: Record<string, unknown>): Promise<unknown> {
  const op = typeof body.op === "string" ? ORG_OPS[body.op] : undefined;
  if (!op) throw new AdminBillingError(`Unknown op. One of: ${Object.keys(ORG_OPS).join(", ")}.`);
  return (await op(ctx, body)) ?? { ok: true };
}
