import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/subscription-ops.ts: the admin console's subscription changes — upgrade, change
// seats, cancel, resume, re-read and comp. The billing binding and the grant are mocked, so the
// test pins exactly what the console writes and never touches Supabase or Stripe.

const { saveSubscription, subscription, setPlanByAdmin } = vi.hoisted(() => ({
  saveSubscription: vi.fn(),
  subscription: vi.fn(),
  setPlanByAdmin: vi.fn(),
}));
vi.mock("../billing", () => ({ billing: { saveSubscription, subscription, setPlanByAdmin } }));
const { grantPlan } = vi.hoisted(() => ({ grantPlan: vi.fn() }));
vi.mock("../grants", () => ({ grantPlan }));

import { fakeAdminStripe, fakeService, fakeStripeClient, fakeSubscription, fakeSubscriptionRow } from "./admin.harness";

async function load() {
  vi.resetModules();
  return import("./subscription-ops");
}

beforeEach(() => {
  vi.clearAllMocks();
  saveSubscription.mockResolvedValue({});
});

// An admin context on a live-mode workspace with a Pro subscription.
function ctxWith(row = fakeSubscriptionRow(), stripeClient = fakeStripeClient()) {
  const { client } = fakeService({ org_subscriptions: [row] });
  const stripe = fakeAdminStripe({ live: stripeClient });
  return {
    ctx: { service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe as never },
    stripeClient,
    service: client,
    stripe,
  };
}

describe("priceLookupKey", () => {
  it("names the price the way the price script does", async () => {
    const { priceLookupKey } = await load();
    expect(priceLookupKey("pro", "monthly")).toBe("weft_pro_monthly_2000");
  });

  it("prices a yearly term at ten months", async () => {
    const { priceLookupKey } = await load();
    expect(priceLookupKey("pro", "yearly")).toBe("weft_pro_yearly_20000");
  });

  it("prices a seat", async () => {
    const { priceLookupKey } = await load();
    expect(priceLookupKey("team", "monthly")).toBe("weft_team_monthly_900");
  });
});

describe("priceFor", () => {
  it("returns the price with the lookup key", async () => {
    const { priceFor } = await load();
    const client = fakeStripeClient();
    client.prices.list.mockResolvedValue({ data: [{ id: "price_1" }] });
    expect(await priceFor(client as never, "live", "pro", "monthly")).toBe("price_1");
    expect(client.prices.list).toHaveBeenCalledWith({
      lookup_keys: ["weft_pro_monthly_2000"],
      active: true,
      limit: 1,
    });
  });

  it("throws when the mode has no such price", async () => {
    const { priceFor } = await load();
    const client = fakeStripeClient();
    client.prices.list.mockResolvedValue({ data: [] });
    await expect(priceFor(client as never, "test", "pro", "monthly")).rejects.toThrow(/No active test-mode price/);
  });
});

describe("planOfPrice", () => {
  it("reads the plan and interval from the price's metadata", async () => {
    const { planOfPrice } = await load();
    expect(
      planOfPrice({ metadata: { plan: "team", interval: "yearly" }, lookup_key: "weft_pro_monthly_2000" }),
    ).toEqual({ plan: "team", interval: "yearly" });
  });

  it("falls back to the lookup key", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice({ metadata: {}, lookup_key: "weft_pro_monthly_2000" })).toEqual({
      plan: "pro",
      interval: "monthly",
    });
  });

  it("falls back to the lookup key when the metadata names only one of the two", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice({ metadata: { plan: "team" }, lookup_key: "weft_pro_monthly_2000" })).toEqual({
      plan: "team",
      interval: "monthly",
    });
  });

  it("is null for a price with no lookup key at all", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice({ metadata: {} } as never)).toBeNull();
  });

  it("is null for a price with no plan on it", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice({ metadata: {}, lookup_key: "price_123" })).toBeNull();
  });

  it("is null for a price on a plan Weft doesn't sell", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice({ metadata: { plan: "free", interval: "monthly" }, lookup_key: "" })).toBeNull();
  });

  it("is null for a price on no interval", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice({ metadata: { plan: "pro" }, lookup_key: "" })).toBeNull();
  });

  it("is null for no price at all", async () => {
    const { planOfPrice } = await load();
    expect(planOfPrice(null)).toBeNull();
    expect(planOfPrice(undefined)).toBeNull();
  });
});

describe("mirror", () => {
  // Stripe answers with whatever it has: a price with no metadata, an item with no quantity, a
  // period that is missing. The fixture is built to be mutated that way, so it is typed loosely
  // here — the point of these tests is that Weft survives a half-filled answer.
  interface LooseItem {
    id: string;
    quantity: number | null;
    current_period_start: number | null;
    current_period_end: number | null;
    price: { id: string; unit_amount: number | null; lookup_key: string; metadata: Record<string, string> };
  }

  function looseSub() {
    const sub = fakeSubscription();
    const item = sub.items.data[0] as unknown as LooseItem;
    return { sub: { ...sub, items: { data: [item] } }, item };
  }

  it("writes Stripe's subscription onto the org's row", async () => {
    const { mirror } = await load();
    const { ctx, service } = ctxWith();
    await mirror(ctx, fakeSubscription() as never);
    expect(saveSubscription).toHaveBeenCalledWith(service, "org_1", {
      plan: "pro",
      interval: "monthly",
      seats: 3,
      unitAmountCents: 2000,
      status: "active",
      currentPeriodStart: "2025-10-09T08:53:20.000Z",
      currentPeriodEnd: "2025-12-29T09:20:00.000Z",
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialEnd: null,
      provider: "stripe",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
    });
  });

  it("reads an expanded customer as its id", async () => {
    const { mirror } = await load();
    const { ctx } = ctxWith();
    await mirror(ctx, fakeSubscription({ customer: { id: "cus_expanded" } }) as never);
    expect(saveSubscription).toHaveBeenCalledWith(expect.anything(), "org_1", expect.objectContaining({ providerCustomerId: "cus_expanded" }));
  });

  it("refuses a subscription that isn't on a Weft price", async () => {
    const { mirror } = await load();
    const { ctx } = ctxWith();
    const { sub, item } = looseSub();
    item.price.metadata = {};
    item.price.lookup_key = "price_123";
    await expect(mirror(ctx, sub as never)).rejects.toThrow(/isn't on a Weft price/);
  });

  it("refuses a subscription with no item", async () => {
    const { mirror } = await load();
    const { ctx } = ctxWith();
    const sub = fakeSubscription();
    sub.items.data = [];
    await expect(mirror(ctx, sub as never)).rejects.toThrow(/isn't on a Weft price/);
  });

  it("defaults the seats, the amount and the period when Stripe leaves them off", async () => {
    const { mirror } = await load();
    const { ctx } = ctxWith();
    const { sub, item } = looseSub();
    item.quantity = null;
    item.price.unit_amount = null;
    item.current_period_start = null;
    item.current_period_end = null;
    await mirror(ctx, sub as never);
    const patch = saveSubscription.mock.calls[0]![2] as {
      seats: number;
      unitAmountCents: number;
      currentPeriodStart: string;
      currentPeriodEnd: string;
    };
    expect(patch.seats).toBe(1);
    expect(patch.unitAmountCents).toBe(0);
    expect(typeof patch.currentPeriodStart).toBe("string");
    expect(typeof patch.currentPeriodEnd).toBe("string");
  });
});
