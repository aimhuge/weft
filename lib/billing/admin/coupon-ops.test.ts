import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// lib/billing/admin/coupon-ops.ts: the coupons page's reads (a mode's promotion codes and every referral) and its
// changes (create a code, turn one on or off, pay or void a referral reward). The referrals and coupons modules are
// mocked, so the test pins which mode's client each op reaches for and what it passes on.

const { listReferrals, payReward, voidReferral } = vi.hoisted(() => ({
  listReferrals: vi.fn(),
  payReward: vi.fn(),
  voidReferral: vi.fn(),
}));
vi.mock("../referrals", () => ({ listReferrals, payReward, voidReferral }));

const { createCoupon, listCoupons, readCoupon, setPromotionActive } = vi.hoisted(() => ({
  createCoupon: vi.fn(),
  listCoupons: vi.fn(),
  readCoupon: vi.fn(),
  setPromotionActive: vi.fn(),
}));
vi.mock("./coupons", () => ({ createCoupon, listCoupons, readCoupon, setPromotionActive }));

// AdminBillingError stays real: the refusals it carries are part of the contract.
vi.mock("./stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-keys")>();
  return { ...actual, adminStripe: vi.fn(() => null) };
});

import { AdminBillingError } from "./stripe-keys";
import { couponsView, runCouponOp } from "./coupon-ops";
import type { AdminGate } from "./route-gate";

const liveClient = { id: "live" };
const testClient = { id: "test" };

// The Stripe holder the gate carries, typed with the calls the coupons ops make on it.
interface FakeGateStripe {
  modes: Mock<() => string[]>;
  defaultMode: Mock<() => string | null>;
  client: Mock<(mode: string) => unknown>;
}

// The gate the ops read through: the service client, the actor and the Stripe holder. The ops
// take an AdminGate, whose service client and Stripe clients are the real thing; the fake keeps
// its own shape and is handed over as the gate.
interface FakeGate {
  service: { svc: true };
  actorEmail: string;
  stripe: FakeGateStripe;
}

// A Stripe holder with no key for any mode: the ops must refuse rather than act.
function noKeysStripe(): FakeGateStripe {
  return {
    modes: vi.fn<() => string[]>(() => []),
    defaultMode: vi.fn<() => string | null>(() => null),
    client: vi.fn<(mode: string) => unknown>(() => null),
  };
}

// A Stripe holder with a live key only, so a test can ask for a mode it has no key for.
function liveOnlyStripe(): FakeGateStripe {
  return {
    modes: vi.fn<() => string[]>(() => ["live"]),
    defaultMode: vi.fn<() => string | null>(() => "live"),
    client: vi.fn<(mode: string) => unknown>(() => null),
  };
}

function gate(overrides: Partial<FakeGate> = {}): FakeGate {
  return {
    service: { svc: true },
    actorEmail: "ada@b.co",
    stripe: {
      modes: vi.fn<() => string[]>(() => ["live", "test"]),
      defaultMode: vi.fn<() => string | null>(() => "live"),
      client: vi.fn<(mode: string) => unknown>((mode: string) => (mode === "live" ? liveClient : testClient)),
    },
    ...overrides,
  };
}

// The gate as the ops see it. The fake's own shape is kept alongside, so a test can still reach
// its mocks.
function asGate(g: FakeGate): AdminGate {
  return g as unknown as AdminGate;
}

// The gate's Stripe holder, typed so the test can reach its mocks.
function stripeOf(g: FakeGate): FakeGateStripe {
  return g.stripe;
}

const GATE = gate();

beforeEach(() => {
  vi.clearAllMocks();
  listCoupons.mockResolvedValue([{ code: "SAVE20" }]);
  listReferrals.mockResolvedValue([{ id: "ref_1" }]);
  readCoupon.mockReturnValue({ code: "SAVE20" });
  createCoupon.mockResolvedValue({ code: "SAVE20" });
  setPromotionActive.mockResolvedValue({ code: "SAVE20", active: true });
  payReward.mockResolvedValue({ paid: true });
  voidReferral.mockResolvedValue(undefined);
});

describe("couponsView", () => {
  it("lists a mode's codes and every referral", async () => {
    const view = await couponsView(asGate(GATE), null);
    expect(view.mode).toBe("live");
    expect(view.coupons).toEqual([{ code: "SAVE20" }]);
    expect(view.referrals).toEqual([{ id: "ref_1" }]);
    expect(view.keys).toEqual(["live", "test"]);
    expect(view.terms).toEqual({ percentOff: 20, months: 3, rewardCents: 2000 });
  });

  it("uses the mode asked for", async () => {
    const g = gate();
    await couponsView(asGate(g), "test");
    expect(stripeOf(g).client).toHaveBeenCalledWith("test");
  });

  it("falls back to the deployment's own mode when the ask isn't a mode", async () => {
    const g = gate();
    await couponsView(asGate(g), "nonsense");
    expect(stripeOf(g).client).toHaveBeenCalledWith("live");
  });

  it("refuses when no Stripe key is set at all", async () => {
    const g = gate({ stripe: noKeysStripe() });
    await expect(couponsView(asGate(g), null)).rejects.toThrow(AdminBillingError);
    await expect(couponsView(asGate(g), null)).rejects.toThrow(/No Stripe key is set/);
  });

  it("refuses when the mode asked for has no key", async () => {
    const g = gate({ stripe: liveOnlyStripe() });
    await expect(couponsView(asGate(g), "test")).rejects.toThrow(/No test-mode Stripe key is set/);
  });
});

describe("runCouponOp", () => {
  it("creates a code", async () => {
    const answer = await runCouponOp(asGate(GATE), { op: "create", code: "SAVE20", percentOff: 20 });
    expect(readCoupon).toHaveBeenCalledWith({ op: "create", code: "SAVE20", percentOff: 20 });
    expect(createCoupon).toHaveBeenCalledWith(liveClient, { code: "SAVE20" }, "ada@b.co");
    expect(answer).toEqual({ code: "SAVE20" });
  });

  it("creates a code in the mode asked for", async () => {
    await runCouponOp(asGate(GATE), { op: "create", mode: "test" });
    expect(createCoupon).toHaveBeenCalledWith(testClient, expect.anything(), "ada@b.co");
  });

  it("turns a code on or off", async () => {
    await runCouponOp(asGate(GATE), { op: "set_active", id: "promo_1", active: true });
    expect(setPromotionActive).toHaveBeenCalledWith(liveClient, "promo_1", true);
    await runCouponOp(asGate(GATE), { op: "set_active", id: "promo_1", active: "yes" });
    expect(setPromotionActive).toHaveBeenCalledWith(liveClient, "promo_1", false);
  });

  it("turns a code with no id off by refusing the bad id", async () => {
    await runCouponOp(asGate(GATE), { op: "set_active" });
    expect(setPromotionActive).toHaveBeenCalledWith(liveClient, "", false);
  });

  it("pays a referral reward", async () => {
    const answer = await runCouponOp(asGate(GATE), { op: "pay_reward", id: "ref_1" });
    expect(payReward).toHaveBeenCalledWith(GATE.service, GATE.stripe, "ref_1", "ada@b.co");
    expect(answer).toEqual({ paid: true });
  });

  it("voids a referral", async () => {
    const answer = await runCouponOp(asGate(GATE), { op: "void_referral", id: "ref_1" });
    expect(voidReferral).toHaveBeenCalledWith(GATE.service, "ref_1");
    expect(answer).toEqual({ ok: true });
  });

  it("refuses an op it doesn't know", async () => {
    await expect(runCouponOp(asGate(GATE), { op: "nope" })).rejects.toThrow(AdminBillingError);
    await expect(runCouponOp(asGate(GATE), { op: "nope" })).rejects.toThrow(/Unknown op/);
  });

  it("refuses a body with no op at all", async () => {
    await expect(runCouponOp(asGate(GATE), {})).rejects.toThrow(/Unknown op/);
  });

  it("refuses to create a code when no Stripe key is set", async () => {
    const g = gate({ stripe: noKeysStripe() });
    await expect(runCouponOp(asGate(g), { op: "create" })).rejects.toThrow(/No Stripe key is set/);
  });
});
