import { describe, expect, it, vi } from "vitest";

// lib/billing/admin/context.ts: the row every admin billing op works on, the Stripe client for the
// mode that row's ids live in, and the audit trail each change leaves behind.

import { fakeAdminStripe, fakeService, fakeStripeClient, fakeSubscriptionRow } from "./admin.harness";

async function load() {
  vi.resetModules();
  return import("./context");
}

describe("loadRow", () => {
  it("returns the org's row", async () => {
    const { loadRow } = await load();
    const row = fakeSubscriptionRow();
    const { client } = fakeService({ org_subscriptions: [row] });
    expect(await loadRow(client as never, "org_1")).toEqual(row);
  });

  it("is null when the org has never had a row", async () => {
    const { loadRow } = await load();
    const { client } = fakeService({ org_subscriptions: [] });
    expect(await loadRow(client as never, "org_1")).toBeNull();
  });

  it("throws the database's message on an error", async () => {
    const { loadRow } = await load();
    const { client } = fakeService({}, { org_subscriptions: { message: "permission denied" } });
    await expect(loadRow(client as never, "org_1")).rejects.toThrow("permission denied");
  });

  it("throws an AdminBillingError, not a raw database error", async () => {
    const { loadRow } = await load();
    const { AdminBillingError } = await import("./stripe-keys");
    const { client } = fakeService({}, { org_subscriptions: { message: "permission denied" } });
    await expect(loadRow(client as never, "org_1")).rejects.toBeInstanceOf(AdminBillingError);
  });
});

describe("orgStripe", () => {
  it("returns the row, the mode and the client for the mode", async () => {
    const { orgStripe } = await load();
    const row = fakeSubscriptionRow();
    const { client } = fakeService({ org_subscriptions: [row] });
    const stripeClient = fakeStripeClient();
    const stripe = fakeAdminStripe({ live: stripeClient });
    const org = await orgStripe({ service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe });
    expect(org.row).toEqual(row);
    expect(org.mode.mode).toBe("live");
    expect(org.client).toBe(stripeClient as never);
  });

  it("throws when the org has no Stripe customer or subscription", async () => {
    const { orgStripe } = await load();
    const { client } = fakeService({ org_subscriptions: [] });
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    await expect(
      orgStripe({ service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: stripe }),
    ).rejects.toThrow(/no Stripe customer or subscription/);
  });

  it("throws when the row has no customer id but has a subscription id", async () => {
    const { orgStripe } = await load();
    const row = fakeSubscriptionRow({ provider_customer_id: null });
    const { client } = fakeService({ org_subscriptions: [row] });
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    const org = await orgStripe({
      service: client as never,
      orgId: "org_1",
      actorEmail: "a@b.c",
      stripe: stripe,
    });
    expect(org.mode.mode).toBe("live");
    expect(org.client).toBeDefined();
  });
});

describe("audit", () => {
  it("writes an admin event row", async () => {
    const { audit } = await load();
    const { client, calls } = fakeService();
    await audit({ service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: fakeAdminStripe() }, "comp", {
      from: "pro",
      to: "oss",
    });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("org_billing_events");
    expect(insert?.args[0]).toEqual({
      org_id: "org_1",
      kind: "admin.comp",
      actor_email: "a@b.c",
      payload: { from: "pro", to: "oss" },
    });
  });

  it("throws when the audit row doesn't land", async () => {
    const { audit } = await load();
    const { client } = fakeService({}, {}, { org_billing_events: { error: { message: "insert failed" } } });
    await expect(
      audit({ service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: fakeAdminStripe() }, "comp", {}),
    ).rejects.toThrow(/insert failed/);
  });

  it("says the change went through even when the audit row didn't", async () => {
    const { audit } = await load();
    const { client } = fakeService({}, {}, { org_billing_events: { error: { message: "insert failed" } } });
    await expect(
      audit({ service: client as never, orgId: "org_1", actorEmail: "a@b.c", stripe: fakeAdminStripe() }, "comp", {}),
    ).rejects.toThrow(/The change went through/);
  });
});
