// Coupons and referrals in the admin console (docs/architecture/billing.md "Coupons and referrals"). GET ?mode=live|test
// lists that mode's Weft promotion codes and every referral; POST `{ op, mode, ... }` creates a code, turns one on or off,
// or pays or voids a referral reward (lib/billing/admin/coupon-ops.ts). Super-admin only.
import { couponsView, runCouponOp } from "@/lib/billing/admin/coupon-ops";
import { adminAnswer, adminGate } from "@/lib/billing/admin/route-gate";

export async function GET(req: Request) {
  const gate = await adminGate(req, false);
  if (gate instanceof Response) return gate;
  const mode = new URL(req.url).searchParams.get("mode");
  return adminAnswer(() => couponsView(gate, mode));
}

export async function POST(req: Request) {
  const gate = await adminGate(req, true);
  if (gate instanceof Response) return gate;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return adminAnswer(() => runCouponOp(gate, body));
}
