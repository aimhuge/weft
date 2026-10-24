import "server-only";

// Coupon codes (docs/architecture/billing.md "Coupons and referrals"). Stripe holds them: a coupon is the discount, a
// promotion code is the word a customer types at Checkout (which already allows codes: @aimhuge/billing sets
// `allow_promotion_codes`). Weft's are stamped `metadata.app = "weft"` so the shared account's other apps' codes stay out
// of the list. No table of our own: Stripe is the source of truth, per mode.

import type Stripe from "stripe";
import { audit, orgStripe, type AdminCtx } from "./context";
import { AdminBillingError } from "./stripe-keys";

export type CouponDuration = "once" | "repeating" | "forever";
const DURATIONS: readonly CouponDuration[] = ["once", "repeating", "forever"];

export interface CouponView {
  promotionId: string;
  code: string;
  active: boolean;
  couponId: string;
  name: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: string;
  durationMonths: number | null;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: string | null;
  // "coupon" for an admin-made code, "referral" for a workspace's referral code (lib/billing/referrals.ts).
  kind: string;
  referrerOrgId: string | null;
}

function couponOf(p: Stripe.PromotionCode): Stripe.Coupon | null {
  const c = p.promotion.coupon;
  return c && typeof c !== "string" ? c : null;
}

// The coupon's half of the view; a promotion code listed without its coupon expanded shows the id alone.
function discountOf(p: Stripe.PromotionCode, c: Stripe.Coupon | null) {
  if (!c) return { couponId: typeof p.promotion.coupon === "string" ? p.promotion.coupon : "", name: null, percentOff: null, amountOffCents: null, duration: "once", durationMonths: null };
  return { couponId: c.id, name: c.name, percentOff: c.percent_off, amountOffCents: c.amount_off, duration: c.duration, durationMonths: c.duration_in_months };
}

export function toCouponView(p: Stripe.PromotionCode): CouponView {
  const c = couponOf(p);
  return {
    promotionId: p.id,
    code: p.code,
    active: p.active,
    ...discountOf(p, c),
    timesRedeemed: p.times_redeemed,
    maxRedemptions: p.max_redemptions,
    expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
    kind: p.metadata?.kind ?? c?.metadata?.kind ?? "coupon",
    referrerOrgId: p.metadata?.referrer_org_id ?? null,
  };
}

const isWeft = (p: Stripe.PromotionCode) => p.metadata?.app === "weft" || couponOf(p)?.metadata?.app === "weft";

export async function listCoupons(client: Stripe): Promise<CouponView[]> {
  const { data } = await client.promotionCodes.list({ limit: 100, expand: ["data.promotion.coupon"] });
  return data.filter(isWeft).map(toCouponView);
}

export async function findPromotionCode(client: Stripe, code: string): Promise<Stripe.PromotionCode | null> {
  const { data } = await client.promotionCodes.list({ code, active: true, limit: 1 });
  return data[0] ?? null;
}

export interface CouponInput {
  code: string;
  name: string;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: CouponDuration;
  durationMonths: number | null;
  maxRedemptions: number | null;
  expiresAt: number | null;
  firstTimeOnly: boolean;
}

function optionalInt(value: unknown, what: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new AdminBillingError(`${what} must be a whole number from ${min} to ${max}.`);
  return n;
}

function readDiscount(body: Record<string, unknown>) {
  const percentOff = optionalInt(body.percentOff, "Percent off", 1, 100);
  const amountOffCents = optionalInt(body.amountOffCents, "Amount off", 1, 1_000_000);
  if ((percentOff === null) === (amountOffCents === null)) throw new AdminBillingError("Give a percent off or an amount off, not both.");
  return { percentOff, amountOffCents };
}

function readDuration(body: Record<string, unknown>) {
  const duration = (body.duration ?? "once") as CouponDuration;
  if (!DURATIONS.includes(duration)) throw new AdminBillingError(`Duration must be one of ${DURATIONS.join(", ")}.`);
  const durationMonths = duration === "repeating" ? optionalInt(body.durationMonths, "Months", 1, 36) : null;
  if (duration === "repeating" && durationMonths === null) throw new AdminBillingError("A repeating coupon needs a number of months.");
  return { duration, durationMonths };
}

export function readCoupon(body: Record<string, unknown>, now = Date.now()): CouponInput {
  const code = (typeof body.code === "string" ? body.code : "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,40}$/.test(code)) throw new AdminBillingError("A code is 3 to 40 letters, digits or dashes.");
  const { percentOff, amountOffCents } = readDiscount(body);
  const { duration, durationMonths } = readDuration(body);
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? Math.floor(Date.parse(body.expiresAt) / 1000) : null;
  if (expiresAt !== null && !(expiresAt * 1000 > now)) throw new AdminBillingError("The expiry has to be a date in the future.");
  const name = (typeof body.name === "string" && body.name.trim()) || code;
  return { code, name, percentOff, amountOffCents, duration, durationMonths, maxRedemptions: optionalInt(body.maxRedemptions, "Max redemptions", 1, 100_000), expiresAt, firstTimeOnly: body.firstTimeOnly === true };
}

export async function createCoupon(client: Stripe, input: CouponInput, actorEmail: string, extra: Record<string, string> = {}): Promise<CouponView> {
  if (await findPromotionCode(client, input.code)) throw new AdminBillingError(`${input.code} is already an active code.`);
  const metadata = { app: "weft", kind: "coupon", created_by: actorEmail, ...extra };
  const coupon = await client.coupons.create({
    name: input.name,
    ...(input.percentOff !== null ? { percent_off: input.percentOff } : { amount_off: input.amountOffCents as number, currency: "usd" }),
    duration: input.duration,
    ...(input.durationMonths !== null && { duration_in_months: input.durationMonths }),
    metadata,
  });
  const promo = await client.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code: input.code,
    ...(input.maxRedemptions !== null && { max_redemptions: input.maxRedemptions }),
    ...(input.expiresAt !== null && { expires_at: input.expiresAt }),
    ...(input.firstTimeOnly && { restrictions: { first_time_transaction: true } }),
    metadata,
    expand: ["promotion.coupon"],
  });
  return toCouponView(promo);
}

export async function setPromotionActive(client: Stripe, promotionId: string, active: boolean): Promise<CouponView> {
  if (!promotionId.startsWith("promo_")) throw new AdminBillingError("Pick a promotion code.");
  const promo = await client.promotionCodes.update(promotionId, { active, expand: ["promotion.coupon"] });
  return toCouponView(promo);
}

// Put a code's discount on a workspace's live subscription (from its next invoice), or take the discount off.
export async function applyCoupon(ctx: AdminCtx, code: string): Promise<void> {
  const { client, row, mode } = await orgStripe(ctx);
  const id = row?.provider_subscription_id;
  if (!id) throw new AdminBillingError("No subscription to discount. Put the code on a checkout link instead.");
  const promo = await findPromotionCode(client, code.trim());
  if (!promo) throw new AdminBillingError(`No active promotion code ${code} in ${mode.mode} mode.`);
  await client.subscriptions.update(id, { discounts: [{ promotion_code: promo.id }] });
  await audit(ctx, "coupon_apply", { mode: mode.mode, subscription: id, code: promo.code, promotion: promo.id });
}

export async function removeDiscount(ctx: AdminCtx): Promise<void> {
  const { client, row, mode } = await orgStripe(ctx);
  const id = row?.provider_subscription_id;
  if (!id) throw new AdminBillingError("No subscription to take a discount off.");
  await client.subscriptions.update(id, { discounts: "" });
  await audit(ctx, "coupon_remove", { mode: mode.mode, subscription: id });
}
