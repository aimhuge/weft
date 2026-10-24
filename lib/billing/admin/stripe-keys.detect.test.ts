import { describe, expect, it, vi } from "vitest";

// lib/billing/admin/stripe-keys.ts (part two): detectMode asks each mode's key for the org's
// customer, and clientFor turns the answer into the client to act on.

import { fakeAdminStripe, fakeStripeClient } from "./admin.harness";

async function load() {
  vi.resetModules();
  return import("./stripe-keys");
}

describe("detectMode", () => {
  it("is none when the org has no Stripe ids", async () => {
    const { detectMode } = await load();
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    expect(await detectMode(stripe, { customerId: null, subscriptionId: null })).toEqual({
      mode: "none",
      deleted: false,
      checked: [],
      detail: null,
    });
  });

  it("finds the mode whose key has the customer", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    const test = fakeStripeClient();
    test.customers.retrieve.mockRejectedValue(new Error("No such customer"));
    const stripe = fakeAdminStripe({ live, test });
    expect(await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).toEqual({
      mode: "live",
      deleted: false,
      checked: ["live"],
      detail: null,
    });
  });

  it("finds test mode when only the test key has it", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue(new Error("No such customer"));
    const stripe = fakeAdminStripe({ live, test: fakeStripeClient() });
    expect((await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).mode).toBe("test");
  });

  it("reports a customer deleted in Stripe", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockResolvedValue({ id: "cus_1", deleted: true });
    const stripe = fakeAdminStripe({ live });
    expect(await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).toEqual({
      mode: "live",
      deleted: true,
      checked: ["live"],
      detail: null,
    });
  });

  it("looks the subscription up when there is no customer id", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    const stripe = fakeAdminStripe({ live });
    const answer = await detectMode(stripe, { customerId: null, subscriptionId: "sub_1" });
    expect(answer.mode).toBe("live");
    expect(live.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
  });

  it("names the mode Stripe's own error points at", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue(
      new Error("No such customer: cus_1. A similar object exists in test mode, but a live mode key was used."),
    );
    const stripe = fakeAdminStripe({ live });
    const answer = await detectMode(stripe, { customerId: "cus_1", subscriptionId: null });
    expect(answer.mode).toBe("test");
    expect(answer.detail).toContain("set a test key");
  });

  it("keeps the first hint it finds", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue(new Error("a similar object exists in live mode"));
    const test = fakeStripeClient();
    test.customers.retrieve.mockRejectedValue(new Error("a similar object exists in test mode"));
    const stripe = fakeAdminStripe({ live, test });
    expect((await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).mode).toBe("live");
  });

  it("is unknown with the error's detail when the error says nothing about a mode", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue(new Error("Invalid API key provided"));
    const stripe = fakeAdminStripe({ live });
    expect(await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).toEqual({
      mode: "unknown",
      deleted: false,
      checked: ["live"],
      detail: "Invalid API key provided",
    });
  });

  it("stringifies a thrown value that isn't an error", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue("boom");
    const stripe = fakeAdminStripe({ live });
    expect((await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).detail).toBe("boom");
  });

  it("is unknown with no key set", async () => {
    const { detectMode } = await load();
    const stripe = fakeAdminStripe({});
    expect(await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).toEqual({
      mode: "unknown",
      deleted: false,
      checked: [],
      detail: "No Stripe key is set.",
    });
  });

  it("is unknown when neither key found the ids", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue(Object.assign(new Error("gone"), { code: "resource_missing" }));
    const stripe = fakeAdminStripe({ live });
    expect(await detectMode(stripe, { customerId: "cus_1", subscriptionId: null })).toEqual({
      mode: "unknown",
      deleted: false,
      checked: ["live"],
      detail: "Neither key found these ids.",
    });
  });

  it("asks every mode until one finds the ids", async () => {
    const { detectMode } = await load();
    const live = fakeStripeClient();
    live.customers.retrieve.mockRejectedValue(new Error("No such customer"));
    const stripe = fakeAdminStripe({ live, test: fakeStripeClient() });
    const answer = await detectMode(stripe, { customerId: "cus_1", subscriptionId: null });
    expect(answer.checked).toEqual(["live", "test"]);
    expect(answer.mode).toBe("test");
  });
});

describe("clientFor", () => {
  it("returns the client for a mode", async () => {
    const { clientFor } = await load();
    const client = fakeStripeClient();
    const stripe = fakeAdminStripe({ live: client });
    expect(clientFor(stripe, "live")).toBe(client as never);
  });

  it("refuses an unknown mode", async () => {
    const { clientFor, AdminBillingError } = await load();
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    expect(() => clientFor(stripe, "unknown")).toThrow(AdminBillingError);
  });

  it("refuses none", async () => {
    const { clientFor } = await load();
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    expect(() => clientFor(stripe, "none")).toThrow(/mode isn't known/);
  });

  it("says which key is missing", async () => {
    const { clientFor, AdminBillingError } = await load();
    const stripe = fakeAdminStripe({ live: fakeStripeClient() });
    expect(() => clientFor(stripe, "test")).toThrow(/STRIPE_TEST_SECRET_KEY/);
    expect(() => clientFor(stripe, "test")).toThrow(AdminBillingError);
  });
});
