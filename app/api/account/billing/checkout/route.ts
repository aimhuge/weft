import { startCheckout } from "@/lib/billing-client";
import type { UpgradeInterval, UpgradePlan } from "@/lib/billing/upgrade";
import { fail, guard } from "@/lib/guard";

// The board's way into Stripe Checkout (docs/architecture/billing.md "The upgrade dialog"): forwards
// { plan, interval } to the deployed Weft's /api/billing/checkout with the signed-in user's token and hands back
// its answer, { ok: true, url } for the dialog to open in the system browser, or { ok: false, error }.

export async function POST(req: Request) {
  const denied = guard(req, { write: true });
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { plan?: UpgradePlan; interval?: UpgradeInterval };
    return Response.json(await startCheckout(body.plan === "team" ? "team" : "pro", body.interval === "yearly" ? "yearly" : "monthly"));
  } catch (err) {
    return fail(err);
  }
}
