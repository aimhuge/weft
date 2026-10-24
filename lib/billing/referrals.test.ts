import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/referrals.ts: a workspace's referral code (a Stripe promotion code on the shared referral coupon)
// and the row that records it. The Stripe clients and the mode detection are faked here; the Supabase service
// client is the chainable from() builder in the harness.

const { detectMode } = vi.hoisted(() => ({ detectMode: vi.fn() }));
// Only detectMode is mocked; AdminBillingError stays real (the refusals it carries are part of the contract).
vi.mock("./admin/stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin/stripe-keys")>();
  return { ...actual, detectMode, adminStripe: vi.fn(() => null) };
});

import { fakeCouponStripe, fakeReferralPromo, fakeService } from "./admin/coupons.harness";
import { AdminBillingError } from "./admin/stripe-keys";
import { ensureReferralCoupon, listReferrals, referralCodeFor, storedReferralCode } from "./referrals";

const client = fakeCouponStripe();

const STRIPE = {
  modes: () => ["live", "test"],
  defaultMode: () => "live",
  client: (mode: string) => (mode === "live" ? client : null),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  client.coupons.retrieve.mockResolvedValue({ id: "weft-referral-20off-3mo" });
  client.coupons.create.mockResolvedValue({ id: "weft-referral-20off-3mo" });
  client.promotionCodes.list.mockResolvedValue({ data: [] });
  client.promotionCodes.create.mockResolvedValue({ id: "promo_1", code: "WEFT-ACME" });
  detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
});

describe("ensureReferralCoupon", () => {
  it("makes the shared coupon when it isn't there yet", async () => {
    client.coupons.retrieve.mockRejectedValueOnce(Object.assign(new Error("no such coupon"), { code: "resource_missing" }));
    const id = await ensureReferralCoupon(client as never);
    expect(id).toBe("weft-referral-20off-3mo");
    expect(client.coupons.create).toHaveBeenCalledWith({
      id: "weft-referral-20off-3mo",
      name: "Weft referral: 20% off 3 months",
      percent_off: 20,
      duration: "repeating",
      duration_in_months: 3,
      metadata: { app: "weft", kind: "referral" },
    });
  });

  it("reuses the coupon when it's already there", async () => {
    const id = await ensureReferralCoupon(client as never);
    expect(id).toBe("weft-referral-20off-3mo");
    expect(client.coupons.create).not.toHaveBeenCalled();
  });

  it("passes on any other Stripe error", async () => {
    client.coupons.retrieve.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "api_error" }));
    await expect(ensureReferralCoupon(client as never)).rejects.toThrow("boom");
    expect(client.coupons.create).not.toHaveBeenCalled();
  });
});

describe("referralCodeFor", () => {
  it("answers the row it already has when the mode's promo is on it", async () => {
    const service = fakeService({
      referral_codes: { data: { org_id: "org_1", code: "WEFT-ACME", promotion_codes: { live: "promo_1" } }, error: null },
    });
    const row = await referralCodeFor(service.client as never, STRIPE, "org_1");
    expect(row).toEqual({ org_id: "org_1", code: "WEFT-ACME", promotion_codes: { live: "promo_1" } });
    expect(client.promotionCodes.create).not.toHaveBeenCalled();
  });

  it("refuses when no Stripe key is set", async () => {
    const service = fakeService({ referral_codes: { data: null, error: null } });
    const noKey = { modes: () => [], defaultMode: () => null, client: () => null } as never;
    await expect(referralCodeFor(service.client as never, noKey, "org_1")).rejects.toThrow(AdminBillingError);
    await expect(referralCodeFor(service.client as never, noKey, "org_1")).rejects.toThrow(/STRIPE_SECRET_KEY isn't set/);
  });

  it("refuses when there's no such workspace", async () => {
    const service = fakeService({
      referral_codes: { data: null, error: null },
      orgs: { data: null, error: null },
    });
    await expect(referralCodeFor(service.client as never, STRIPE, "org_1")).rejects.toThrow(/No such workspace/);
  });

  it("makes a code and writes it onto the row", async () => {
    const service = fakeService({
      referral_codes: { select: [{ data: null, error: null }], upsert: [{ data: null, error: null }] },
      orgs: { data: { slug: "acme" }, error: null },
    });
    const row = await referralCodeFor(service.client as never, STRIPE, "org_1");
    expect(row).toEqual({ org_id: "org_1", code: "WEFT-ACME", promotion_codes: { live: "promo_1" } });
    expect(client.promotionCodes.create).toHaveBeenCalledWith({
      promotion: { type: "coupon", coupon: "weft-referral-20off-3mo" },
      code: "WEFT-ACME",
      restrictions: { first_time_transaction: true },
      metadata: { app: "weft", kind: "referral", referrer_org_id: "org_1" },
    });
  });

  it("keeps the code the row already had when it adds another mode's promo", async () => {
    const service = fakeService({
      referral_codes: {
        select: [{ data: { org_id: "org_1", code: "WEFT-OLD", promotion_codes: { test: "promo_9" } }, error: null }],
        upsert: [{ data: null, error: null }],
      },
      orgs: { data: { slug: "acme" }, error: null },
    });
    const row = await referralCodeFor(service.client as never, STRIPE, "org_1");
    expect(row).toEqual({ org_id: "org_1", code: "WEFT-OLD", promotion_codes: { test: "promo_9", live: "promo_1" } });
  });

  it("retries with a suffix when the code is taken", async () => {
    client.promotionCodes.list.mockResolvedValueOnce({ data: [{ id: "promo_taken" }] }).mockResolvedValueOnce({ data: [] });
    const service = fakeService({
      referral_codes: { select: [{ data: null, error: null }], upsert: [{ data: null, error: null }] },
      orgs: { data: { slug: "acme" }, error: null },
    });
    const row = await referralCodeFor(service.client as never, STRIPE, "org_1");
    expect(row.code).toMatch(/^WEFT-ACME-\d{3}$/);
    expect(client.promotionCodes.list).toHaveBeenCalledTimes(2);
  });

  it("gives up after three tries", async () => {
    client.promotionCodes.list.mockResolvedValue({ data: [{ id: "promo_taken" }] });
    const service = fakeService({
      referral_codes: { select: [{ data: null, error: null }] },
      orgs: { data: { slug: "acme" }, error: null },
    });
    await expect(referralCodeFor(service.client as never, STRIPE, "org_1")).rejects.toThrow(/Couldn't find a free referral code/);
    expect(client.promotionCodes.list).toHaveBeenCalledTimes(3);
  });

  it("refuses when the row can't be written", async () => {
    const service = fakeService({
      referral_codes: { select: [{ data: null, error: null }], upsert: [{ data: null, error: { message: "row is locked" } }] },
      orgs: { data: { slug: "acme" }, error: null },
    });
    await expect(referralCodeFor(service.client as never, STRIPE, "org_1")).rejects.toThrow(/row is locked/);
  });
});

describe("listReferrals", () => {
  it("reads the referrals newest first", async () => {
    const service = fakeService({
      referrals: { data: [{ id: "ref_1", referrer_org_id: "org_a", referred_org_id: "org_b", code: "WEFT-A", mode: "live", status: "converted", reward_cents: 2000, created_at: "2026-10-01T00:00:00.000Z" }], error: null },
      orgs: { data: [{ id: "org_a", slug: "acme" }, { id: "org_b", slug: "beta" }], error: null },
    });
    const views = await listReferrals(service.client as never);
    expect(views).toEqual([
      { id: "ref_1", referrer: "acme", referred: "beta", code: "WEFT-A", mode: "live", status: "converted", rewardCents: 2000, createdAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("falls back to the org id when it has no slug", async () => {
    const service = fakeService({
      referrals: { data: [{ id: "ref_1", referrer_org_id: "org_a", referred_org_id: "org_b", code: "WEFT-A", mode: "live", status: "converted", reward_cents: 0, created_at: "2026-10-01T00:00:00.000Z" }], error: null },
      orgs: { data: [], error: null },
    });
    const views = await listReferrals(service.client as never);
    expect(views[0]!.referrer).toBe("org_a");
    expect(views[0]!.referred).toBe("org_b");
  });

  it("copes with no org rows at all", async () => {
    const service = fakeService({
      referrals: { data: [{ id: "ref_1", referrer_org_id: "org_a", referred_org_id: "org_b", code: "WEFT-A", mode: "live", status: "converted", reward_cents: 0, created_at: "2026-10-01T00:00:00.000Z" }], error: null },
      orgs: { data: null, error: null },
    });
    const views = await listReferrals(service.client as never);
    expect(views[0]!.referrer).toBe("org_a");
  });

  it("doesn't ask for orgs when there are no referrals", async () => {
    const service = fakeService({ referrals: { data: [], error: null } });
    expect(await listReferrals(service.client as never)).toEqual([]);
    expect(service.client.from).toHaveBeenCalledTimes(1);
  });

  it("throws when the query fails", async () => {
    const service = fakeService({ referrals: { data: null, error: { message: "table gone" } } });
    await expect(listReferrals(service.client as never)).rejects.toThrow(/table gone/);
  });
});

describe("storedReferralCode", () => {
  it("reads the workspace's code as stored", async () => {
    const service = fakeService({ referral_codes: { data: { code: "WEFT-ACME" }, error: null } });
    expect(await storedReferralCode(service.client as never, "org_1")).toBe("WEFT-ACME");
  });

  it("answers null when the workspace has no code yet", async () => {
    const service = fakeService({ referral_codes: { data: null, error: null } });
    expect(await storedReferralCode(service.client as never, "org_1")).toBeNull();
  });
});

// The referral promo the fake Stripe answers with: a workspace's own code.
export const REFERRAL_PROMO = fakeReferralPromo("org_ref");
