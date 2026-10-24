import { accountClient, SUPABASE_KEY } from "./account";
import { TRIAL_URL } from "./puku-trial";
import type { BillingStatus } from "./billing/status";
import type { CheckoutAnswer, UpgradeInterval, UpgradePlan } from "./billing/upgrade";

// The desktop's bridge to the deployed Weft's billing endpoint (docs/architecture/billing.md). We don't host
// billing here — the deployed Weft does, and the page lives at /<orgSlug>/billing. This client only fetches
// the status the Settings → Weft account section shows next to the sign-in form.

// Same deployment as the Puku trial: WEFT_BILLING_URL lets a preview or fork point at its own deployed Weft.
const BASE = (process.env.WEFT_BILLING_URL || TRIAL_URL.replace(/\/api\/puku$/, "")).replace(/\/+$/, "");

export type BillingClientResult = BillingStatus | { error: string } | null;

// Calls the deployed Weft's /api/billing/status with the signed-in user's access token. null when signed out
// (so the section can hide itself), { error } on a network or non-OK reply with a short human message.
export async function fetchBillingStatus(): Promise<BillingClientResult> {
  if (!SUPABASE_KEY) return null;
  const { data } = await accountClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/billing/status`, { headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    return { error: `Couldn't reach Weft's billing: ${(err as Error).message}` };
  }
  // 404 (a deployment without billing yet, or no workspace) and 503 (billing not set up there) aren't errors you
  // can act on, so the section stays hidden rather than showing them.
  if (res.status === 404 || res.status === 503) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown } & Partial<BillingStatus>;
  if (!res.ok) {
    return { error: typeof body.error === "string" ? body.error : `Weft's billing answered ${res.status}.` };
  }
  return body as BillingStatus;
}

// Starts a Stripe Checkout for the signed-in user's workspace on the deployed Weft's /api/billing/checkout (the upgrade
// dialog, components/UpgradeDialog.tsx). The answer's url is the Checkout page the board opens in the system browser.
export async function startCheckout(plan: UpgradePlan, interval: UpgradeInterval): Promise<CheckoutAnswer> {
  if (!SUPABASE_KEY) return { ok: false, error: "Sign in to your Weft account first." };
  const { data } = await accountClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in to your Weft account first." };
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/billing/checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ plan, interval }),
    });
  } catch (err) {
    return { ok: false, error: `Couldn't reach Weft's billing: ${(err as Error).message}` };
  }
  const body = (await res.json().catch(() => ({}))) as Partial<CheckoutAnswer> & { error?: unknown };
  if (body.ok === true) return body as CheckoutAnswer;
  if (typeof body.error === "string") return { ok: false, error: body.error };
  // A deployment that predates the route answers 404 with no JSON.
  return { ok: false, error: res.status === 404 ? "weft.zip can't take payments from this Weft yet." : `Weft's billing answered ${res.status}.` };
}
