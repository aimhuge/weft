// The referral offer (docs/architecture/billing.md "Coupons and referrals"), client-safe so the billing page can say it.
// Placeholders to tune: the referred workspace gets PERCENT_OFF off its first MONTHS months, and the referrer gets
// REWARD_CENTS (one Pro month) on its Stripe balance, taken off its next invoices. A change applies to codes made after
// it: the coupon id carries the terms, so a new offer is a new coupon and old codes keep theirs.

export const REFERRAL_TERMS = {
  percentOff: 20,
  months: 3,
  rewardCents: 2000,
} as const;

export function referralCouponId(terms: { percentOff: number; months: number } = REFERRAL_TERMS): string {
  return `weft-referral-${terms.percentOff}off-${terms.months}mo`;
}

export function referralOfferLabel(terms: typeof REFERRAL_TERMS = REFERRAL_TERMS): string {
  return `${terms.percentOff}% off their first ${terms.months} months; you get $${terms.rewardCents / 100} off your bill`;
}

// A workspace's code: WEFT- and its slug, upper-cased, letters, digits and dashes only (Stripe's alphabet), at most 30.
export function referralCodeFrom(slug: string, suffix = ""): string {
  const base = slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "TEAM";
  return `WEFT-${base}${suffix ? `-${suffix}` : ""}`;
}
