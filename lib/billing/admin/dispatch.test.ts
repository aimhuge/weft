import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/dispatch.ts: the admin console's one entry point for a change to a workspace's billing. Every op
// lives in its own module; this test pins that each op name reaches the right function with the right input, and
// that an op nobody knows is refused.

const { referralCodeFor } = vi.hoisted(() => ({ referralCodeFor: vi.fn() }));
vi.mock("../referrals", () => ({ referralCodeFor }));

const { checkoutLink } = vi.hoisted(() => ({ checkoutLink: vi.fn() }));
vi.mock("./checkout-link", () => ({ checkoutLink }));

const { applyCoupon, removeDiscount } = vi.hoisted(() => ({ applyCoupon: vi.fn(), removeDiscount: vi.fn() }));
vi.mock("./coupons", () => ({ applyCoupon, removeDiscount }));

const { addMember, removeMember, syncSeats } = vi.hoisted(() => ({ addMember: vi.fn(), removeMember: vi.fn(), syncSeats: vi.fn() }));
vi.mock("./members", () => ({ addMember, removeMember, syncSeats }));

const { readRefund, refundCharge } = vi.hoisted(() => ({ readRefund: vi.fn(), refundCharge: vi.fn() }));
vi.mock("./refunds", () => ({ readRefund, refundCharge }));

const { readReset, resetBilling } = vi.hoisted(() => ({ readReset: vi.fn(), resetBilling: vi.fn() }));
vi.mock("./reset", () => ({ readReset, resetBilling }));

const { cancelNow, changeSubscription, compPlan, readChange, resync, setCancelAtPeriodEnd } = vi.hoisted(() => ({
  cancelNow: vi.fn(),
  changeSubscription: vi.fn(),
  compPlan: vi.fn(),
  readChange: vi.fn(),
  resync: vi.fn(),
  setCancelAtPeriodEnd: vi.fn(),
}));
vi.mock("./subscription-ops", () => ({ cancelNow, changeSubscription, compPlan, readChange, resync, setCancelAtPeriodEnd }));

// AdminBillingError stays real: the refusals it carries are part of the contract.
vi.mock("./stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-keys")>();
  return { ...actual, adminStripe: vi.fn(() => null) };
});

import { AdminBillingError } from "./stripe-keys";
import { ORG_OPS, runOrgOp } from "./dispatch";
import type { AdminCtx } from "./context";

// The context the ops read through: the service client, the workspace, the actor and the Stripe
// holder. The ops take an AdminCtx, whose service client and Stripe clients are the real thing;
// the fake keeps its own shape and is handed over as the context.
interface FakeCtx {
  service: { svc: true };
  orgId: string;
  actorEmail: string;
  stripe: { id: string };
}

const CTX: FakeCtx = { service: { svc: true }, orgId: "org_1", actorEmail: "ada@b.co", stripe: { id: "stripe" } };

// The context as the ops see it. The fake's own shape is kept alongside, so a test can still
// reach its parts.
function asCtx(c: FakeCtx): AdminCtx {
  return c as unknown as AdminCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
  readChange.mockReturnValue({ plan: "pro", interval: "monthly", seats: 1, proration: "create_prorations" });
  readRefund.mockReturnValue({ chargeId: "ch_1", reason: "requested_by_customer" });
  readReset.mockReturnValue({ plan: "free" });
});

describe("ORG_OPS", () => {
  it("knows every op the console offers", () => {
    expect(Object.keys(ORG_OPS).sort()).toEqual([
      "cancel_at_period_end",
      "change_plan",
      "checkout_link",
      "comp",
      "coupon_apply",
      "coupon_remove",
      "downgrade_free",
      "member_add",
      "member_remove",
      "referral_code",
      "refund",
      "reset",
      "resume",
      "resync",
      "sync_seats",
    ]);
  });
});

describe("runOrgOp", () => {
  it("changes the plan", async () => {
    await runOrgOp(asCtx(CTX), { op: "change_plan", plan: "pro", interval: "monthly" });
    expect(readChange).toHaveBeenCalledWith({ op: "change_plan", plan: "pro", interval: "monthly" });
    expect(changeSubscription).toHaveBeenCalledWith(CTX, { plan: "pro", interval: "monthly", seats: 1, proration: "create_prorations" });
  });

  it("cancels at the period end", async () => {
    await runOrgOp(asCtx(CTX), { op: "cancel_at_period_end" });
    expect(setCancelAtPeriodEnd).toHaveBeenCalledWith(CTX, true);
  });

  it("resumes", async () => {
    await runOrgOp(asCtx(CTX), { op: "resume" });
    expect(setCancelAtPeriodEnd).toHaveBeenCalledWith(CTX, false);
  });

  it("downgrades to free without credit", async () => {
    await runOrgOp(asCtx(CTX), { op: "downgrade_free" });
    expect(cancelNow).toHaveBeenCalledWith(CTX, "none");
  });

  it("downgrades to free with credit", async () => {
    await runOrgOp(asCtx(CTX), { op: "downgrade_free", credit: "prorate" });
    expect(cancelNow).toHaveBeenCalledWith(CTX, "prorate");
  });

  it("re-reads from Stripe", async () => {
    await runOrgOp(asCtx(CTX), { op: "resync" });
    expect(resync).toHaveBeenCalledWith(CTX);
  });

  it("comps a plan", async () => {
    await runOrgOp(asCtx(CTX), { op: "comp", plan: "oss" });
    expect(compPlan).toHaveBeenCalledWith(CTX, "oss");
  });

  it("makes a checkout link", async () => {
    await runOrgOp(asCtx(CTX), { op: "checkout_link", plan: "pro", interval: "monthly" });
    expect(checkoutLink).toHaveBeenCalledWith(CTX, { op: "checkout_link", plan: "pro", interval: "monthly" });
  });

  it("refunds a charge", async () => {
    await runOrgOp(asCtx(CTX), { op: "refund", chargeId: "ch_1" });
    expect(readRefund).toHaveBeenCalledWith({ op: "refund", chargeId: "ch_1" });
    expect(refundCharge).toHaveBeenCalledWith(CTX, { chargeId: "ch_1", reason: "requested_by_customer" });
  });

  it("resets the billing", async () => {
    await runOrgOp(asCtx(CTX), { op: "reset", plan: "free" });
    expect(readReset).toHaveBeenCalledWith({ op: "reset", plan: "free" });
    expect(resetBilling).toHaveBeenCalledWith(CTX, { plan: "free" });
  });

  it("adds a member", async () => {
    await runOrgOp(asCtx(CTX), { op: "member_add", email: "a@b.co" });
    expect(addMember).toHaveBeenCalledWith(CTX, { op: "member_add", email: "a@b.co" });
  });

  it("removes a member", async () => {
    await runOrgOp(asCtx(CTX), { op: "member_remove", userId: "u1" });
    expect(removeMember).toHaveBeenCalledWith(CTX, { op: "member_remove", userId: "u1" });
  });

  it("syncs the seats", async () => {
    await runOrgOp(asCtx(CTX), { op: "sync_seats" });
    expect(syncSeats).toHaveBeenCalledWith(CTX);
  });

  it("applies a coupon", async () => {
    await runOrgOp(asCtx(CTX), { op: "coupon_apply", code: "SAVE20" });
    expect(applyCoupon).toHaveBeenCalledWith(CTX, "SAVE20");
  });

  it("applies a coupon with no code as an empty one", async () => {
    await runOrgOp(asCtx(CTX), { op: "coupon_apply" });
    expect(applyCoupon).toHaveBeenCalledWith(CTX, "");
  });

  it("removes a discount", async () => {
    await runOrgOp(asCtx(CTX), { op: "coupon_remove" });
    expect(removeDiscount).toHaveBeenCalledWith(CTX);
  });

  it("makes the workspace's referral code", async () => {
    await runOrgOp(asCtx(CTX), { op: "referral_code" });
    expect(referralCodeFor).toHaveBeenCalledWith(CTX.service, CTX.stripe, "org_1");
  });

  it("answers { ok: true } when the op answered nothing", async () => {
    changeSubscription.mockResolvedValue(undefined);
    expect(await runOrgOp(asCtx(CTX), { op: "change_plan", plan: "pro", interval: "monthly" })).toEqual({ ok: true });
  });

  it("passes an op's own answer through", async () => {
    changeSubscription.mockResolvedValue({ changed: true });
    expect(await runOrgOp(asCtx(CTX), { op: "change_plan", plan: "pro", interval: "monthly" })).toEqual({ changed: true });
  });

  it("refuses an op it doesn't know", async () => {
    await expect(runOrgOp(asCtx(CTX), { op: "nope" })).rejects.toThrow(AdminBillingError);
    await expect(runOrgOp(asCtx(CTX), { op: "nope" })).rejects.toThrow(/Unknown op/);
  });

  it("refuses a body with no op at all", async () => {
    await expect(runOrgOp(asCtx(CTX), {})).rejects.toThrow(/Unknown op/);
  });

  it("refuses an op that isn't a string", async () => {
    await expect(runOrgOp(asCtx(CTX), { op: 7 })).rejects.toThrow(/Unknown op/);
  });
});
