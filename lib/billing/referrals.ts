import "server-only";

// Referrals (docs/architecture/billing.md "Coupons and referrals"). A workspace's referral code is a Stripe promotion code
// on the shared referral coupon (REFERRAL_TERMS), stamped `kind: "referral"` and `referrer_org_id`. Checkout already
// accepts codes, so the referred workspace types it there; when that checkout completes, the webhook calls
// `recordReferral`, which writes the referrals row and credits the referrer's Stripe balance. A referrer with no Stripe
// customer yet stays "converted" until an admin pays it from the console.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERRAL_TERMS, referralCodeFrom, referralCouponId } from "./referral-terms";
import { AdminBillingError, detectMode, type AdminStripe, type StripeMode } from "./admin/stripe-keys";

export interface ReferralCodeRow {
  org_id: string;
  code: string;
  promotion_codes: Partial<Record<StripeMode, string>>;
}

// The shared coupon, made once per mode under a fixed id that names its terms.
export async function ensureReferralCoupon(client: Stripe): Promise<string> {
  const id = referralCouponId();
  try {
    await client.coupons.retrieve(id);
  } catch (err) {
    if ((err as { code?: string }).code !== "resource_missing") throw err;
    await client.coupons.create({
      id,
      name: `Weft referral: ${REFERRAL_TERMS.percentOff}% off ${REFERRAL_TERMS.months} months`,
      percent_off: REFERRAL_TERMS.percentOff,
      duration: "repeating",
      duration_in_months: REFERRAL_TERMS.months,
      metadata: { app: "weft", kind: "referral" },
    });
  }
  return id;
}

// `preferred` is the code the workspace already has in the other mode, so both modes share one word.
async function createPromotion(client: Stripe, orgId: string, slug: string, preferred?: string): Promise<{ code: string; id: string }> {
  const coupon = await ensureReferralCoupon(client);
  // A code another workspace holds (or a coincidence) gets a short suffix; three tries are plenty.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = attempt === 0 && preferred ? preferred : referralCodeFrom(slug, attempt ? String(Math.floor(100 + Math.random() * 900)) : "");
    const { data } = await client.promotionCodes.list({ code, limit: 1 });
    if (data[0]) continue;
    const promo = await client.promotionCodes.create({
      promotion: { type: "coupon", coupon },
      code,
      restrictions: { first_time_transaction: true },
      metadata: { app: "weft", kind: "referral", referrer_org_id: orgId },
    });
    return { code, id: promo.id };
  }
  throw new AdminBillingError("Couldn't find a free referral code for this workspace.");
}

// The workspace's code, made on first ask in the deployment's own mode (the one its Checkout and webhook run in).
export async function referralCodeFor(service: SupabaseClient, stripe: AdminStripe, orgId: string): Promise<ReferralCodeRow> {
  const { data: row } = await service.from("referral_codes").select<string, ReferralCodeRow>("org_id, code, promotion_codes").eq("org_id", orgId).maybeSingle();
  const mode = stripe.defaultMode();
  const client = mode && stripe.client(mode);
  if (row && (!mode || row.promotion_codes[mode])) return row;
  if (!mode || !client) throw new AdminBillingError("STRIPE_SECRET_KEY isn't set, so no referral code can be made.");
  const { data: org } = await service.from("orgs").select<string, { slug: string }>("slug").eq("id", orgId).maybeSingle();
  const slug = org?.slug;
  if (!slug) throw new AdminBillingError("No such workspace.");
  const promo = await createPromotion(client, orgId, slug, row?.code);
  const next: ReferralCodeRow = { org_id: orgId, code: row?.code ?? promo.code, promotion_codes: { ...row?.promotion_codes, [mode]: promo.id } };
  const { error } = await service.from("referral_codes").upsert(next, { onConflict: "org_id" });
  if (error) throw new AdminBillingError(error.message);
  return next;
}

function promotionIds(session: Stripe.Checkout.Session): string[] {
  return (session.discounts ?? [])
    .map((d) => (typeof d.promotion_code === "string" ? d.promotion_code : d.promotion_code?.id))
    .filter((id): id is string => Boolean(id));
}

async function logEvent(service: SupabaseClient, orgId: string, kind: string, payload: Record<string, unknown>, actor: string | null = null) {
  await service.from("org_billing_events").insert({ org_id: orgId, kind, actor_email: actor, payload });
}

// checkout.session.completed: when the session used a referral code, record who referred whom and pay the reward.
export async function recordReferral(service: SupabaseClient, stripe: AdminStripe, mode: StripeMode, session: Stripe.Checkout.Session) {
  const client = stripe.client(mode);
  const referred = session.client_reference_id ?? session.metadata?.org_id ?? null;
  if (!client || !referred) return null;
  for (const id of promotionIds(session)) {
    const promo = await client.promotionCodes.retrieve(id);
    const referrer = promo.metadata?.kind === "referral" ? promo.metadata.referrer_org_id : undefined;
    if (!referrer) continue;
    const status = referrer === referred ? "void" : "converted";
    const { data, error } = await service
      .from("referrals")
      .insert({ referrer_org_id: referrer, referred_org_id: referred, code: promo.code, mode, status, checkout_session_id: session.id })
      .select<string, { id: string }>("id")
      .single();
    // 23505: this workspace was already referred, or this session already recorded (a retried webhook).
    if (error?.code === "23505") return null;
    if (error) throw new Error(error.message);
    const referralId = data.id;
    await logEvent(service, referrer, "referral.converted", { referralId, referred, code: promo.code, status });
    return status === "void" ? { referralId, paid: false } : { referralId, ...(await payReward(service, stripe, referralId, null)) };
  }
  return null;
}

// Credit the referrer's Stripe balance with REWARD_CENTS, in the referral's mode. Idempotent on the referral id.
export async function payReward(service: SupabaseClient, stripe: AdminStripe, referralId: string, actorEmail: string | null): Promise<{ paid: boolean; reason?: string }> {
  const { data } = await service.from("referrals").select<string, { id: string; referrer_org_id: string; mode: StripeMode; status: string }>("id, referrer_org_id, mode, status").eq("id", referralId).maybeSingle();
  const referral = data;
  if (!referral) throw new AdminBillingError("No such referral.");
  if (referral.status !== "converted") return { paid: false, reason: `It's ${referral.status}.` };
  const { data: sub } = await service.from("org_subscriptions").select<string, { provider_customer_id: string | null }>("provider_customer_id").eq("org_id", referral.referrer_org_id).maybeSingle();
  const customer = sub?.provider_customer_id ?? null;
  const found = await detectMode(stripe, { customerId: customer, subscriptionId: null });
  if (!customer || found.mode !== referral.mode || found.deleted) return { paid: false, reason: `The referrer has no ${referral.mode}-mode Stripe customer yet.` };
  const client = stripe.client(referral.mode) as Stripe;
  await client.customers.createBalanceTransaction(
    customer,
    { amount: -REFERRAL_TERMS.rewardCents, currency: "usd", description: "Weft referral reward", metadata: { app: "weft", referral_id: referral.id } },
    { idempotencyKey: `referral-reward:${referral.id}` },
  );
  await service.from("referrals").update({ status: "rewarded", reward_cents: REFERRAL_TERMS.rewardCents, rewarded_at: new Date().toISOString() }).eq("id", referral.id);
  await logEvent(service, referral.referrer_org_id, "referral.rewarded", { referralId: referral.id, cents: REFERRAL_TERMS.rewardCents }, actorEmail);
  return { paid: true };
}

export async function voidReferral(service: SupabaseClient, referralId: string): Promise<void> {
  const { error } = await service.from("referrals").update({ status: "void" }).eq("id", referralId).eq("status", "converted");
  if (error) throw new AdminBillingError(error.message);
}

export interface ReferralView {
  id: string;
  referrer: string;
  referred: string;
  code: string;
  mode: string;
  status: string;
  rewardCents: number;
  createdAt: string;
}

interface ReferralRow {
  id: string;
  referrer_org_id: string;
  referred_org_id: string;
  code: string;
  mode: string;
  status: string;
  reward_cents: number;
  created_at: string;
}

export async function listReferrals(service: SupabaseClient): Promise<ReferralView[]> {
  const { data, error } = await service
    .from("referrals")
    .select<string, ReferralRow>("id, referrer_org_id, referred_org_id, code, mode, status, reward_cents, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new AdminBillingError(error.message);
  const rows = data;
  const ids = [...new Set(rows.flatMap((r) => [r.referrer_org_id, r.referred_org_id]))];
  const { data: orgs } = ids.length ? await service.from("orgs").select<string, { id: string; slug: string }>("id, slug").in("id", ids) : { data: [] };
  const slug = new Map((orgs ?? []).map((o) => [o.id, o.slug]));
  return rows.map((r) => ({ id: r.id, referrer: slug.get(r.referrer_org_id) ?? r.referrer_org_id, referred: slug.get(r.referred_org_id) ?? r.referred_org_id, code: r.code, mode: r.mode, status: r.status, rewardCents: r.reward_cents, createdAt: r.created_at }));
}

// The workspace's code as stored, for the billing page (null until someone asks for one).
export async function storedReferralCode(service: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await service.from("referral_codes").select<string, { code: string }>("code").eq("org_id", orgId).maybeSingle();
  return data?.code ?? null;
}
