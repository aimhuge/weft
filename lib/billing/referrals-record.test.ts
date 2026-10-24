import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/referrals.ts, the recording half: what a completed checkout does — write the referral row, void a
// self-referral, and pay the referrer's reward on its Stripe balance. The Stripe clients and the mode detection
// are faked here; the Supabase service client is the chainable from() builder in the harness.

const { detectMode } = vi.hoisted(() => ({ detectMode: vi.fn() }));
// Only detectMode is mocked; AdminBillingError stays real (the refusals it carries are part of the contract).
vi.mock("./admin/stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin/stripe-keys")>();
  return { ...actual, detectMode, adminStripe: vi.fn(() => null) };
});

import { fakeCouponStripe, fakeReferralPromo, fakeService } from "./admin/coupons.harness";
import { payReward, recordReferral, voidReferral } from "./referrals";

const client = fakeCouponStripe();

const STRIPE = {
  modes: () => ["live", "test"],
  defaultMode: () => "live",
  client: (mode: string) => (mode === "live" ? client : null),
} as never;

const SESSION = { id: "cs_1", client_reference_id: "org_new", discounts: [{ promotion_code: "promo_1" }] };

// The service rows a converted referral needs: the insert, the row payReward reads, the reward update and the event.
function convertedService(referrerOrgId = "org_ref") {
  return fakeService({
    referrals: {
      insert: [{ data: { id: "ref_1" }, error: null }],
      select: [{ data: { id: "ref_1", referrer_org_id: referrerOrgId, mode: "live", status: "converted" }, error: null }],
      update: [{ data: null, error: null }],
    },
    org_billing_events: { insert: [{ data: null, error: null }] },
    org_subscriptions: { data: { provider_customer_id: "cus_ref" }, error: null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  client.promotionCodes.retrieve.mockResolvedValue(fakeReferralPromo("org_ref"));
  client.customers.createBalanceTransaction.mockResolvedValue({ id: "cbtxn_1" });
  detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
});

describe("recordReferral", () => {
  it("does nothing without a client", async () => {
    const service = fakeService();
    const noClient = { modes: () => [], defaultMode: () => "live", client: () => null } as never;
    expect(await recordReferral(service.client as never, noClient, "live", SESSION as never)).toBeNull();
  });

  it("does nothing without a referred workspace", async () => {
    const service = fakeService();
    expect(await recordReferral(service.client as never, STRIPE, "live", { id: "cs_1", discounts: [] } as never)).toBeNull();
  });

  it("skips a promo that isn't a referral code", async () => {
    client.promotionCodes.retrieve.mockResolvedValueOnce({ id: "promo_2", code: "SAVE20", metadata: { kind: "coupon" } });
    const service = fakeService();
    expect(await recordReferral(service.client as never, STRIPE, "live", SESSION as never)).toBeNull();
    expect(service.client.from).not.toHaveBeenCalled();
  });

  it("voids a self-referral", async () => {
    client.promotionCodes.retrieve.mockResolvedValueOnce(fakeReferralPromo("org_new"));
    const service = fakeService({
      referrals: { insert: [{ data: { id: "ref_1" }, error: null }] },
      org_billing_events: { insert: [{ data: null, error: null }] },
    });
    const answer = await recordReferral(service.client as never, STRIPE, "live", SESSION as never);
    expect(answer).toEqual({ referralId: "ref_1", paid: false });
  });

  it("answers null when the referral is already there", async () => {
    const service = fakeService({ referrals: { insert: [{ data: null, error: { code: "23505", message: "duplicate key" } }] } });
    expect(await recordReferral(service.client as never, STRIPE, "live", SESSION as never)).toBeNull();
  });

  it("throws on any other insert error", async () => {
    const service = fakeService({ referrals: { insert: [{ data: null, error: { code: "42501", message: "permission denied" } }] } });
    await expect(recordReferral(service.client as never, STRIPE, "live", SESSION as never)).rejects.toThrow(/permission denied/);
  });

  it("records a converted referral and pays the reward", async () => {
    const service = convertedService();
    const answer = await recordReferral(service.client as never, STRIPE, "live", SESSION as never);
    expect(answer).toEqual({ referralId: "ref_1", paid: true });
    expect(client.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_ref",
      { amount: -2000, currency: "usd", description: "Weft referral reward", metadata: { app: "weft", referral_id: "ref_1" } },
      { idempotencyKey: "referral-reward:ref_1" },
    );
  });

  it("reads a discount whose promotion code is an expanded object", async () => {
    const service = convertedService();
    const answer = await recordReferral(service.client as never, STRIPE, "live", {
      id: "cs_1",
      client_reference_id: "org_new",
      discounts: [{ promotion_code: { id: "promo_1" } }],
    } as never);
    expect(answer).toEqual({ referralId: "ref_1", paid: true });
    expect(client.promotionCodes.retrieve).toHaveBeenCalledWith("promo_1");
  });

  it("takes the referred workspace from the session's metadata", async () => {
    const service = convertedService();
    await recordReferral(service.client as never, STRIPE, "live", {
      id: "cs_1",
      metadata: { org_id: "org_new" },
      discounts: [{ promotion_code: "promo_1" }],
    } as never);
    const insert = service.calls.find((c) => c.table === "referrals" && c.op === "insert");
    expect((insert?.arg as { referred_org_id: string }).referred_org_id).toBe("org_new");
  });

  it("ignores a discount with no promotion code at all", async () => {
    const service = fakeService();
    expect(await recordReferral(service.client as never, STRIPE, "live", { id: "cs_1", client_reference_id: "org_new", discounts: [{}] } as never)).toBeNull();
    expect(client.promotionCodes.retrieve).not.toHaveBeenCalled();
  });

  it("copes with a session that has no discounts at all", async () => {
    const service = fakeService();
    expect(await recordReferral(service.client as never, STRIPE, "live", { id: "cs_1", client_reference_id: "org_new" } as never)).toBeNull();
    expect(client.promotionCodes.retrieve).not.toHaveBeenCalled();
  });
});

describe("payReward", () => {
  it("refuses a referral that isn't there", async () => {
    const service = fakeService({ referrals: { data: null, error: null } });
    await expect(payReward(service.client as never, STRIPE, "ref_1", null)).rejects.toThrow(/No such referral/);
  });

  it("doesn't pay a referral that isn't converted", async () => {
    const service = fakeService({ referrals: { data: { id: "ref_1", referrer_org_id: "org_ref", mode: "live", status: "void" }, error: null } });
    expect(await payReward(service.client as never, STRIPE, "ref_1", null)).toEqual({ paid: false, reason: "It's void." });
    expect(client.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("doesn't pay when the referrer has no customer", async () => {
    const service = fakeService({
      referrals: { data: { id: "ref_1", referrer_org_id: "org_ref", mode: "live", status: "converted" }, error: null },
      org_subscriptions: { data: { provider_customer_id: null }, error: null },
    });
    const answer = await payReward(service.client as never, STRIPE, "ref_1", null);
    expect(answer.paid).toBe(false);
    expect(answer.reason).toMatch(/no live-mode Stripe customer yet/);
  });

  it("doesn't pay when the customer is another mode", async () => {
    const service = fakeService({
      referrals: { data: { id: "ref_1", referrer_org_id: "org_ref", mode: "live", status: "converted" }, error: null },
      org_subscriptions: { data: { provider_customer_id: "cus_ref" }, error: null },
    });
    detectMode.mockResolvedValue({ mode: "test", deleted: false, checked: ["test"], detail: null });
    const answer = await payReward(service.client as never, STRIPE, "ref_1", null);
    expect(answer.paid).toBe(false);
  });

  it("doesn't pay when the customer was deleted", async () => {
    const service = fakeService({
      referrals: { data: { id: "ref_1", referrer_org_id: "org_ref", mode: "live", status: "converted" }, error: null },
      org_subscriptions: { data: { provider_customer_id: "cus_ref" }, error: null },
    });
    detectMode.mockResolvedValue({ mode: "live", deleted: true, checked: ["live"], detail: null });
    const answer = await payReward(service.client as never, STRIPE, "ref_1", null);
    expect(answer.paid).toBe(false);
  });

  it("credits the referrer's balance and marks the referral rewarded", async () => {
    const service = convertedService();
    const answer = await payReward(service.client as never, STRIPE, "ref_1", "ada@b.co");
    expect(answer).toEqual({ paid: true });
    expect(client.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("voidReferral", () => {
  it("voids a converted referral", async () => {
    const service = fakeService({ referrals: { data: null, error: null } });
    await expect(voidReferral(service.client as never, "ref_1")).resolves.toBeUndefined();
  });

  it("throws when the row can't be written", async () => {
    const service = fakeService({ referrals: { data: null, error: { message: "nope" } } });
    await expect(voidReferral(service.client as never, "ref_1")).rejects.toThrow(/nope/);
  });
});
