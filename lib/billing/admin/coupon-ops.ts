import "server-only";

// The coupons page's reads and changes (app/api/admin/coupons/route.ts, docs/architecture/billing.md "Coupons and
// referrals"): a mode's promotion codes, every referral, and create / turn on or off / pay / void.

import type Stripe from "stripe";
import { listReferrals, payReward, voidReferral } from "../referrals";
import { REFERRAL_TERMS } from "../referral-terms";
import { createCoupon, listCoupons, readCoupon, setPromotionActive } from "./coupons";
import type { AdminGate } from "./route-gate";
import { AdminBillingError, type StripeMode } from "./stripe-keys";

// The client for the mode asked for (or the deployment's own), and that mode.
function pickMode(gate: AdminGate, mode: unknown): { mode: StripeMode; client: Stripe } {
  const wanted = mode === "live" || mode === "test" ? mode : gate.stripe.defaultMode();
  if (!wanted) throw new AdminBillingError("No Stripe key is set.");
  const client = gate.stripe.client(wanted);
  if (!client) throw new AdminBillingError(`No ${wanted}-mode Stripe key is set (STRIPE_${wanted.toUpperCase()}_SECRET_KEY).`);
  return { mode: wanted, client };
}

export async function couponsView(gate: AdminGate, modeParam: string | null) {
  const { mode, client } = pickMode(gate, modeParam);
  const [coupons, referrals] = await Promise.all([listCoupons(client), listReferrals(gate.service)]);
  return { mode, keys: gate.stripe.modes(), coupons, referrals, terms: REFERRAL_TERMS };
}

export async function runCouponOp(gate: AdminGate, body: Record<string, unknown>): Promise<unknown> {
  const id = typeof body.id === "string" ? body.id : "";
  switch (body.op) {
    case "create":
      return createCoupon(pickMode(gate, body.mode).client, readCoupon(body), gate.actorEmail);
    case "set_active":
      return setPromotionActive(pickMode(gate, body.mode).client, id, body.active === true);
    case "pay_reward":
      return payReward(gate.service, gate.stripe, id, gate.actorEmail);
    case "void_referral":
      await voidReferral(gate.service, id);
      return { ok: true };
    default:
      throw new AdminBillingError("Unknown op. One of: create, set_active, pay_reward, void_referral.");
  }
}
