import "server-only";

// The referral half of Stripe's webhook (docs/architecture/billing.md "Coupons and referrals"). @aimhuge/billing handles
// the event first (subscription, invoices, idempotency); once it has answered 2xx, this reads the same delivery again,
// verifies its signature with the same secret, and on a completed Weft checkout records the referral. It never changes
// the webhook's answer: a failure here is logged, and an admin can pay the reward from the console.

import type Stripe from "stripe";
import { billing, billingService } from "./billing";
import { recordReferral } from "./referrals";
import { adminStripe } from "./admin/stripe-keys";

export async function referralFromWebhook(raw: string, signature: string | null): Promise<void> {
  const service = billingService();
  if (!service || !signature) return;
  const event: Stripe.Event = billing.stripe.client().webhooks.constructEvent(raw, signature, billing.stripe.config().webhookSecret);
  if (event.type !== "checkout.session.completed") return;
  const session = event.data.object;
  if (session.metadata?.app !== "weft" || !session.discounts?.length) return;
  await recordReferral(service, adminStripe(), event.livemode ? "live" : "test", session);
}

// Wraps the package's handler: a copy of the body for the referral read, taken before the package consumes it.
export async function handleWebhookWithReferrals(req: Request, handle: (req: Request) => Promise<Response>): Promise<Response> {
  const copy = req.clone();
  const res = await handle(req);
  if (res.ok) {
    try {
      await referralFromWebhook(await copy.text(), copy.headers.get("stripe-signature"));
    } catch (err) {
      console.error(`Referral webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}
