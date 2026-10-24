import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/referral-webhook.ts: the referral half of Stripe's webhook. The package (@aimhuge/billing) answers the
// delivery first; once it has, this reads the same delivery again and records the referral. The billing binding and the
// referrals module are mocked, so the test pins what is verified, what is skipped and what the wrapper returns.

const { billing, billingService } = vi.hoisted(() => ({ billing: {}, billingService: vi.fn() }));
vi.mock("./billing", () => ({ billing, billingService }));

const { recordReferral } = vi.hoisted(() => ({ recordReferral: vi.fn() }));
vi.mock("./referrals", () => ({ recordReferral }));

const { adminStripe } = vi.hoisted(() => ({ adminStripe: vi.fn() }));
vi.mock("./admin/stripe-keys", () => ({ adminStripe }));

import { handleWebhookWithReferrals, referralFromWebhook } from "./referral-webhook";

const SERVICE = { svc: true };
const STRIPE = { id: "stripe" };

const constructEvent = vi.fn();

const EVENT = {
  type: "checkout.session.completed",
  livemode: false,
  data: { object: { id: "cs_1", metadata: { app: "weft" }, discounts: [{ promotion_code: "promo_1" }] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  billingService.mockReturnValue(SERVICE);
  adminStripe.mockReturnValue(STRIPE);
  constructEvent.mockReturnValue(EVENT);
  Object.assign(billing, {
    stripe: {
      client: () => ({ webhooks: { constructEvent } }),
      config: () => ({ webhookSecret: "whsec_x" }),
    },
  });
  recordReferral.mockResolvedValue(null);
});

describe("referralFromWebhook", () => {
  it("does nothing without a service client", async () => {
    billingService.mockReturnValue(null);
    await referralFromWebhook("{}", "sig");
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("does nothing without a signature", async () => {
    await referralFromWebhook("{}", null);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("verifies the signature with the webhook secret", async () => {
    await referralFromWebhook("{}", "sig");
    expect(constructEvent).toHaveBeenCalledWith("{}", "sig", "whsec_x");
  });

  it("ignores an event that isn't a completed checkout", async () => {
    constructEvent.mockReturnValue({ type: "invoice.paid", data: { object: {} } });
    await referralFromWebhook("{}", "sig");
    expect(recordReferral).not.toHaveBeenCalled();
  });

  it("ignores a checkout that isn't Weft's", async () => {
    constructEvent.mockReturnValue({ type: "checkout.session.completed", livemode: false, data: { object: { metadata: { app: "other" }, discounts: [{ promotion_code: "promo_1" }] } } });
    await referralFromWebhook("{}", "sig");
    expect(recordReferral).not.toHaveBeenCalled();
  });

  it("ignores a checkout with no discounts", async () => {
    constructEvent.mockReturnValue({ type: "checkout.session.completed", livemode: false, data: { object: { metadata: { app: "weft" }, discounts: [] } } });
    await referralFromWebhook("{}", "sig");
    expect(recordReferral).not.toHaveBeenCalled();
  });

  it("records the referral in test mode", async () => {
    await referralFromWebhook("{}", "sig");
    expect(recordReferral).toHaveBeenCalledWith(SERVICE, STRIPE, "test", EVENT.data.object);
  });

  it("records the referral in live mode", async () => {
    constructEvent.mockReturnValue({ ...EVENT, livemode: true });
    await referralFromWebhook("{}", "sig");
    expect(recordReferral).toHaveBeenCalledWith(SERVICE, STRIPE, "live", EVENT.data.object);
  });
});

describe("handleWebhookWithReferrals", () => {
  const delivery = () => new Request("https://weft.example/api/billing/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });

  it("hands the original request to the handler and returns its answer", async () => {
    const req = delivery();
    const handle = vi.fn<(req: Request) => Promise<Response>>(() => Promise.resolve(new Response("ok", { status: 200 })));
    const res = await handleWebhookWithReferrals(req, handle);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0]![0]).toBe(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("records the referral after a 2xx answer", async () => {
    await handleWebhookWithReferrals(delivery(), () => Promise.resolve(new Response("ok", { status: 200 })));
    expect(recordReferral).toHaveBeenCalledTimes(1);
  });

  it("doesn't record the referral when the handler refused", async () => {
    const res = await handleWebhookWithReferrals(delivery(), () => Promise.resolve(new Response("bad sig", { status: 400 })));
    expect(res.status).toBe(400);
    expect(recordReferral).not.toHaveBeenCalled();
  });

  it("swallows a referral failure and still returns the handler's answer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    recordReferral.mockRejectedValue(new Error("stripe is down"));
    const res = await handleWebhookWithReferrals(delivery(), () => Promise.resolve(new Response("ok", { status: 200 })));
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith("Referral webhook: stripe is down");
    error.mockRestore();
  });

  it("logs a non-Error failure too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    recordReferral.mockRejectedValue("just a string");
    await handleWebhookWithReferrals(delivery(), () => Promise.resolve(new Response("ok", { status: 200 })));
    expect(error).toHaveBeenCalledWith("Referral webhook: just a string");
    error.mockRestore();
  });

  it("hands the copied body to the referral read, not the consumed one", async () => {
    await handleWebhookWithReferrals(delivery(), () => Promise.resolve(new Response("ok", { status: 200 })));
    expect(constructEvent).toHaveBeenCalledWith("{}", "t=1,v1=x", "whsec_x");
  });
});
