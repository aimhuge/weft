import { billing, billingService } from "@/lib/billing/billing";
import { handleWebhookWithReferrals } from "@/lib/billing/referral-webhook";

// Stripe's webhook for this app (docs/architecture/billing.md). Mounted on the deployed Weft
// (Vercel), this is the only host Stripe reaches; the signature is the check, so there's no
// localhost guard. The shared AimHuge Stripe account stamps every event with `metadata.app`
// (`"weft"`), and the package drops events stamped for another app — keeping DeckCP and
// BlastCP's webhooks from blowing up here when they share the same account. After the package
// has answered, a completed checkout that used a referral code is recorded (lib/billing/referral-webhook.ts).
export const POST = (req: Request) => handleWebhookWithReferrals(req, (r) => billing.handleStripeWebhook(r, billingService));
