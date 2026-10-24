import { describe, expect, it, vi } from "vitest";

// lib/billing/admin/stripe-keys.ts: which Stripe account mode (live or test) an org's billing ids
// live in, and a client per mode. The mode whose key finds the object is the one it lives in, so
// the admin console always acts on the account the workspace actually paid through.
// The mode detection itself is in stripe-keys.detect.test.ts.

async function load() {
  vi.resetModules();
  return import("./stripe-keys");
}

describe("keyMode", () => {
  it("reads a live key", async () => {
    const { keyMode } = await load();
    expect(keyMode("sk_live_abc")).toBe("live");
  });

  it("reads a test key", async () => {
    const { keyMode } = await load();
    expect(keyMode("sk_test_abc")).toBe("test");
  });

  it("reads a restricted key too", async () => {
    const { keyMode } = await load();
    expect(keyMode("rk_live_abc")).toBe("live");
    expect(keyMode("rk_test_abc")).toBe("test");
  });

  it("trims the key", async () => {
    const { keyMode } = await load();
    expect(keyMode("  sk_live_abc  ")).toBe("live");
  });

  it("is null for a key with no mode", async () => {
    const { keyMode } = await load();
    expect(keyMode("sk_abc")).toBeNull();
  });

  it("is null for no key at all", async () => {
    const { keyMode } = await load();
    expect(keyMode(undefined)).toBeNull();
    expect(keyMode("")).toBeNull();
    expect(keyMode("   ")).toBeNull();
  });
});

describe("adminStripeKeys", () => {
  it("files each key by its own prefix, so a key under the wrong name lands in its true mode", async () => {
    const { adminStripeKeys } = await load();
    expect(adminStripeKeys({ STRIPE_SECRET_KEY: "sk_test_default" })).toEqual({ test: "sk_test_default" });
  });

  it("takes both modes when both are set", async () => {
    const { adminStripeKeys } = await load();
    expect(
      adminStripeKeys({
        STRIPE_LIVE_SECRET_KEY: "sk_live_l",
        STRIPE_TEST_SECRET_KEY: "sk_test_t",
        STRIPE_SECRET_KEY: "sk_live_default",
      }),
    ).toEqual({ live: "sk_live_l", test: "sk_test_t" });
  });

  it("prefers the explicitly named key over the deployment's own", async () => {
    const { adminStripeKeys } = await load();
    expect(
      adminStripeKeys({ STRIPE_LIVE_SECRET_KEY: "sk_live_named", STRIPE_SECRET_KEY: "sk_live_default" }),
    ).toEqual({ live: "sk_live_named" });
  });

  it("keeps the first key it finds for a mode", async () => {
    const { adminStripeKeys } = await load();
    expect(
      adminStripeKeys({ STRIPE_LIVE_SECRET_KEY: "sk_live_named", STRIPE_SECRET_KEY: "sk_live_default" }),
    ).toEqual({ live: "sk_live_named" });
  });

  it("skips a key with no mode in its prefix", async () => {
    const { adminStripeKeys } = await load();
    expect(adminStripeKeys({ STRIPE_SECRET_KEY: "sk_abc", STRIPE_TEST_SECRET_KEY: "sk_test_t" })).toEqual({
      test: "sk_test_t",
    });
  });

  it("is empty without any key", async () => {
    const { adminStripeKeys } = await load();
    expect(adminStripeKeys({})).toEqual({});
  });
});

describe("adminStripe", () => {
  it("lists the modes there is a key for", async () => {
    const { adminStripe } = await load();
    const stripe = adminStripe({ STRIPE_LIVE_SECRET_KEY: "sk_live_l", STRIPE_TEST_SECRET_KEY: "sk_test_t" });
    expect(stripe.modes()).toEqual(["live", "test"]);
  });

  it("lists only the mode it holds a key for", async () => {
    const { adminStripe } = await load();
    expect(adminStripe({ STRIPE_TEST_SECRET_KEY: "sk_test_t" }).modes()).toEqual(["test"]);
  });

  it("has no client for a mode without a key", async () => {
    const { adminStripe } = await load();
    expect(adminStripe({ STRIPE_TEST_SECRET_KEY: "sk_test_t" }).client("live")).toBeNull();
  });

  it("builds a client from the key for its mode", async () => {
    const { adminStripe } = await load();
    const factory = vi.fn((key: string) => ({ key }) as never);
    const stripe = adminStripe({ STRIPE_LIVE_SECRET_KEY: "sk_live_l" }, factory);
    expect(stripe.client("live")).toEqual({ key: "sk_live_l" });
    expect(factory).toHaveBeenCalledWith("sk_live_l");
  });

  it("memoizes the client per mode", async () => {
    const { adminStripe } = await load();
    const factory = vi.fn((key: string) => ({ key }) as never);
    const stripe = adminStripe({ STRIPE_LIVE_SECRET_KEY: "sk_live_l" }, factory);
    const first = stripe.client("live");
    expect(stripe.client("live")).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("builds a separate client per mode", async () => {
    const { adminStripe } = await load();
    const factory = vi.fn((key: string) => ({ key }) as never);
    const stripe = adminStripe({ STRIPE_LIVE_SECRET_KEY: "sk_live_l", STRIPE_TEST_SECRET_KEY: "sk_test_t" }, factory);
    expect(stripe.client("live")).not.toBe(stripe.client("test"));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("the deployment's own mode is STRIPE_SECRET_KEY's", async () => {
    const { adminStripe } = await load();
    expect(adminStripe({ STRIPE_SECRET_KEY: "sk_test_d" }).defaultMode()).toBe("test");
    expect(adminStripe({ STRIPE_SECRET_KEY: "sk_live_d" }).defaultMode()).toBe("live");
  });

  it("has no default mode without a deployment key", async () => {
    const { adminStripe } = await load();
    expect(adminStripe({ STRIPE_TEST_SECRET_KEY: "sk_test_t" }).defaultMode()).toBeNull();
  });

  it("builds a real Stripe client when no factory is injected", async () => {
    const { adminStripe } = await load();
    const client = adminStripe({ STRIPE_TEST_SECRET_KEY: "sk_test_t" }).client("test");
    expect(client).not.toBeNull();
    expect(typeof client?.prices.list).toBe("function");
  });
});

describe("modeFromStripeError", () => {
  it("reads the mode Stripe names", async () => {
    const { modeFromStripeError } = await load();
    const err = new Error("No such customer: cus_1. A similar object exists in test mode, but a live mode key was used.");
    expect(modeFromStripeError(err)).toBe("test");
  });

  it("reads live too", async () => {
    const { modeFromStripeError } = await load();
    expect(modeFromStripeError(new Error("a similar object exists in live mode"))).toBe("live");
  });

  it("is null for an unrelated error", async () => {
    const { modeFromStripeError } = await load();
    expect(modeFromStripeError(new Error("card declined"))).toBeNull();
  });

  it("is null for something that isn't an error", async () => {
    const { modeFromStripeError } = await load();
    expect(modeFromStripeError("not an error")).toBeNull();
    expect(modeFromStripeError(null)).toBeNull();
  });
});

