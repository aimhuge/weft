import { beforeEach, describe, expect, it, vi } from "vitest";

// The Stripe webhook route is a one-liner that hands the request to billing.handleStripeWebhook; the
// package owns signature verification, the `metadata.app` drop, and the Supabase mirror. The route wraps
// that in handleWebhookWithReferrals, which reads the same delivery again once the package has answered
// 2xx, to record a referral. That wrapper is mocked here so the test pins the wiring (the right handler
// is called with the right request and the service getter) and the wrapper's own answer bubbles out.

const { handleStripeWebhook, billingService } = vi.hoisted(() => ({
  handleStripeWebhook: vi.fn<(req: Request, getService: () => unknown) => Promise<Response>>(() => Promise.resolve(new Response("ok", { status: 200 }))),
  billingService: vi.fn(() => ({ svc: true })),
}));

const billingMock = { handleStripeWebhook };

vi.mock("@/lib/billing/billing", () => ({ billing: billingMock, billingService }));

const { handleWebhookWithReferrals } = vi.hoisted(() => ({
  // The wrapper calls the handler with the request and returns the handler's response.
  handleWebhookWithReferrals: vi.fn<(req: Request, handle: (req: Request) => Promise<Response>) => Promise<Response>>((req, handle) => handle(req)),
}));

vi.mock("@/lib/billing/referral-webhook", () => ({ handleWebhookWithReferrals }));

const route = await import("./route");

const delivery = () =>
  new Request("https://weft.example/api/billing/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" });

beforeEach(() => {
  vi.clearAllMocks();
  handleStripeWebhook.mockImplementation(() => Promise.resolve(new Response("ok", { status: 200 })));
  billingService.mockReturnValue({ svc: true });
  handleWebhookWithReferrals.mockImplementation((req, handle) => handle(req));
});

describe("POST /api/billing/webhook", () => {
  it("hands the request to billing.handleStripeWebhook with billingService", async () => {
    const req = delivery();
    const res = await route.POST(req);
    expect(res.status).toBe(200);
    expect(handleStripeWebhook).toHaveBeenCalledTimes(1);
    const [passedReq, passedGetService] = handleStripeWebhook.mock.calls[0]!;
    expect(passedReq).toBe(req);
    // Pass the getter itself (not a value) so the handler can ask for the client lazily; null on
    // an unconfigured Weft would have the package return 500 for Stripe to retry.
    expect(typeof passedGetService).toBe("function");
    expect(passedGetService()).toEqual({ svc: true });
  });

  it("lets the package's response bubble out (signature failures stay 4xx, not 500s)", async () => {
    handleStripeWebhook.mockResolvedValueOnce(new Response("bad sig", { status: 400 }));
    const res = await route.POST(delivery());
    expect(res.status).toBe(400);
  });

  it("wraps the package's handler in the referral wrapper", async () => {
    await route.POST(delivery());
    expect(handleWebhookWithReferrals).toHaveBeenCalledTimes(1);
    const [passedReq, passedHandle] = handleWebhookWithReferrals.mock.calls[0]!;
    expect(passedReq).toBeInstanceOf(Request);
    expect(typeof passedHandle).toBe("function");
  });

  it("hands the wrapper a handler that asks the package", async () => {
    await route.POST(delivery());
    const passedHandle = handleWebhookWithReferrals.mock.calls[0]![1];
    await passedHandle(delivery());
    expect(handleStripeWebhook).toHaveBeenCalledTimes(2);
  });
});
