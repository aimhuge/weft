import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/checkout-link.ts: a Stripe Checkout link an admin makes for a workspace, so a Free workspace can
// be moved onto a paid plan from the console. The context (the org's row and the audit trail), the mode detection,
// the price lookup and the promotion-code lookup are mocked; the test pins what is asked of Stripe.

const { loadRow, audit } = vi.hoisted(() => ({ loadRow: vi.fn(), audit: vi.fn() }));
vi.mock("./context", () => ({ loadRow, audit }));

const { detectMode } = vi.hoisted(() => ({ detectMode: vi.fn() }));
// AdminBillingError stays real: the refusals it carries are part of the contract.
vi.mock("./stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-keys")>();
  return { ...actual, detectMode, adminStripe: vi.fn(() => null) };
});

const { priceFor } = vi.hoisted(() => ({ priceFor: vi.fn() }));
// readChange stays real: it validates the plan, the interval and the seats.
vi.mock("./subscription-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subscription-ops")>();
  return { ...actual, priceFor };
});

const { findPromotionCode } = vi.hoisted(() => ({ findPromotionCode: vi.fn() }));
vi.mock("./coupons", () => ({ findPromotionCode }));

import { AdminBillingError } from "./stripe-keys";
import { checkoutLink } from "./checkout-link";
import { firstCall } from "./admin.harness";

const SESSION = { id: "cs_1", url: "https://checkout.stripe.test/c/cs_1" };

// Stripe's checkout session, as the console reads it. The url may be missing — Stripe sometimes
// answers without a page — and the test deliberately makes it so.
interface FakeSession {
  id: string;
  url: string | null;
}

function stripeFake() {
  return {
    checkout: { sessions: { create: vi.fn<(body: Record<string, unknown>) => Promise<FakeSession>>(() => Promise.resolve(SESSION)) } },
    prices: { list: vi.fn<(query: Record<string, unknown>) => Promise<{ data: unknown[] }>>(() => Promise.resolve({ data: [] })) },
  };
}

const client = stripeFake();

// The orgs table lookup: one row with a slug, or none at all.
function orgService(slug: string | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: slug ? { slug } : null })),
        })),
      })),
    })),
  };
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    service: orgService("acme"),
    orgId: "org_1",
    actorEmail: "ada@b.co",
    stripe: {
      modes: () => ["live", "test"],
      defaultMode: () => "live",
      client: (mode: string) => (mode === "live" ? client : null),
    },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.checkout.sessions.create.mockResolvedValue(SESSION);
  loadRow.mockResolvedValue(null);
  audit.mockResolvedValue(undefined);
  detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
  priceFor.mockResolvedValue("price_pro_monthly");
  findPromotionCode.mockResolvedValue(null);
});

describe("checkoutLink", () => {
  it("makes a subscription session for the workspace and answers its url", async () => {
    const answer = await checkoutLink(ctx(), { plan: "pro", interval: "monthly" });
    expect(answer).toEqual({ url: "https://checkout.stripe.test/c/cs_1" });
    expect(client.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const arg = firstCall(client.checkout.sessions.create)[0];
    expect(arg.mode).toBe("subscription");
    expect(arg.client_reference_id).toBe("org_1");
    expect(arg.metadata).toEqual({ app: "weft", org_id: "org_1", org_slug: "acme" });
    expect(arg.subscription_data).toEqual({ metadata: { app: "weft", org_id: "org_1", org_slug: "acme" } });
    expect(arg.line_items).toEqual([{ price: "price_pro_monthly", quantity: 1 }]);
  });

  it("sends the customer back to the workspace's billing page", async () => {
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly" });
    const arg = firstCall(client.checkout.sessions.create)[0] as Record<string, string>;
    expect(arg.success_url).toContain("/acme/billing?checkout=done");
    expect(arg.cancel_url).toContain("/acme/billing?checkout=canceled");
  });

  it("audits what it made", async () => {
    const c = ctx();
    await checkoutLink(c, { plan: "pro", interval: "monthly" });
    expect(audit).toHaveBeenCalledWith(c, "checkout_link", { mode: "live", plan: "pro", interval: "monthly", seats: 1, promotionCode: null, session: "cs_1" });
  });

  it("refuses when the deployment has no Stripe key", async () => {
    const c = ctx({ stripe: { modes: () => [], defaultMode: () => null, client: () => null } });
    await expect(checkoutLink(c, { plan: "pro", interval: "monthly" })).rejects.toThrow(AdminBillingError);
    await expect(checkoutLink(c, { plan: "pro", interval: "monthly" })).rejects.toThrow(/STRIPE_SECRET_KEY isn't set/);
  });

  it("refuses a workspace that already has a live subscription", async () => {
    loadRow.mockResolvedValue({ provider_subscription_id: "sub_1", status: "active" });
    await expect(checkoutLink(ctx(), { plan: "pro", interval: "monthly" })).rejects.toThrow(/already has a subscription/);
    expect(client.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("allows a workspace whose subscription was canceled", async () => {
    loadRow.mockResolvedValue({ provider_subscription_id: "sub_1", status: "canceled" });
    await expect(checkoutLink(ctx(), { plan: "pro", interval: "monthly" })).resolves.toEqual({ url: SESSION.url });
  });

  it("refuses a workspace that doesn't exist", async () => {
    const c = ctx({ service: orgService(null) });
    await expect(checkoutLink(c, { plan: "pro", interval: "monthly" })).rejects.toThrow(/No such workspace/);
  });

  it("refuses a plan it doesn't know", async () => {
    await expect(checkoutLink(ctx(), { plan: "platinum", interval: "monthly" })).rejects.toThrow(/Plan must be one of/);
  });

  it("reuses the row's customer when it lives in this mode", async () => {
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: null });
    detectMode.mockResolvedValue({ mode: "live", deleted: false, checked: ["live"], detail: null });
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly" });
    const arg = firstCall(client.checkout.sessions.create)[0];
    expect(arg.customer).toBe("cus_1");
  });

  it("leaves the customer off when the row's customer is another mode", async () => {
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: null });
    detectMode.mockResolvedValue({ mode: "test", deleted: false, checked: ["test"], detail: null });
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly" });
    const arg = firstCall(client.checkout.sessions.create)[0];
    expect(arg.customer).toBeUndefined();
  });

  it("leaves the customer off when the row's customer was deleted", async () => {
    loadRow.mockResolvedValue({ provider_customer_id: "cus_1", provider_subscription_id: null });
    detectMode.mockResolvedValue({ mode: "live", deleted: true, checked: ["live"], detail: null });
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly" });
    const arg = firstCall(client.checkout.sessions.create)[0];
    expect(arg.customer).toBeUndefined();
  });

  it("lets the customer type a code when none was given", async () => {
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly" });
    const arg = firstCall(client.checkout.sessions.create)[0];
    expect(arg.allow_promotion_codes).toBe(true);
    expect(arg.discounts).toBeUndefined();
    expect(findPromotionCode).not.toHaveBeenCalled();
  });

  it("puts a typed code on the session up front", async () => {
    findPromotionCode.mockResolvedValue({ id: "promo_1", code: "SAVE20" });
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly", promotionCode: " SAVE20 " });
    expect(findPromotionCode).toHaveBeenCalledWith(client, "SAVE20");
    const arg = firstCall(client.checkout.sessions.create)[0];
    expect(arg.discounts).toEqual([{ promotion_code: "promo_1" }]);
    expect(arg.allow_promotion_codes).toBeUndefined();
  });

  it("refuses a code that isn't active in this mode", async () => {
    findPromotionCode.mockResolvedValue(null);
    await expect(checkoutLink(ctx(), { plan: "pro", interval: "monthly", promotionCode: "NOPE" })).rejects.toThrow(/No active promotion code NOPE in live mode/);
    expect(client.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("refuses when Stripe doesn't return a checkout page", async () => {
    client.checkout.sessions.create.mockResolvedValue({ id: "cs_2", url: null });
    await expect(checkoutLink(ctx(), { plan: "pro", interval: "monthly" })).rejects.toThrow(/didn't return a checkout page/);
    expect(audit).not.toHaveBeenCalled();
  });

  it("looks the price up in the deployment's own mode", async () => {
    await checkoutLink(ctx(), { plan: "team", interval: "yearly", seats: 3 });
    expect(priceFor).toHaveBeenCalledWith(client, "live", "team", "yearly");
  });

  it("forces one seat on a pro plan", async () => {
    await checkoutLink(ctx(), { plan: "pro", interval: "monthly", seats: 9 });
    const arg = firstCall(client.checkout.sessions.create)[0] as Record<string, { quantity: number }[]>;
    expect(arg.line_items![0]!.quantity).toBe(1);
  });
});
