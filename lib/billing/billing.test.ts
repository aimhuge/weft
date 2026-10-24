import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUPABASE_URL } from "../account";
import { catalog } from "./plans";

// The shared AimHuge billing binding: provider detection, the service client, and the catalog it ships with.

// vi.hoisted runs before vi.mock so the factory can close over the mock without a temporal-dead-zone error.
const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn<(url: string, key: string, opts: unknown) => { auth: unknown }>(() => ({ auth: {} })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const key of ["SUPABASE_SECRET_KEY", "BILLING_PROVIDER", "STRIPE_SECRET_KEY"]) {
    if (env[key] === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, env[key]);
  }
  return import("./billing");
}

beforeEach(() => {
  createClient.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("billing instance", () => {
  it("binds Weft to the shared AimHuge billing, with our invoice prefix and app", async () => {
    const { billing } = await load();
    expect(billing.runtime.app).toBe("weft");
    expect(billing.runtime.displayName).toBe("Weft");
    expect(billing.runtime.url).toBe("https://weft.zip");
    expect(billing.runtime.invoicePrefix).toBe("WFT");
    expect(catalog.get("pro").monthlyUnitAmountCents).toBe(2000);
  });

  it("brands Stripe Checkout as Weft, not the shared account", async () => {
    const { billing } = await load();
    expect(billing.runtime.checkoutBranding).toEqual({ displayName: "Weft", iconUrl: "https://weft.zip/app-icon.png", buttonColor: "#da7a4c" });
  });
});

describe("billingService", () => {
  it("returns null when SUPABASE_SECRET_KEY is unset", async () => {
    const { billingService } = await load({ SUPABASE_SECRET_KEY: "" });
    expect(billingService()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("builds a service-role Supabase client when the key is set", async () => {
    const { billingService } = await load({ SUPABASE_SECRET_KEY: "sb_secret_test" });
    const client = billingService();
    expect(client).toEqual({ auth: {} });
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }];
    expect(url).toBe(SUPABASE_URL);
    expect(key).toBe("sb_secret_test");
    expect(opts.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });
});

describe("billingConfigured", () => {
  it("is true only when the provider is stripe AND the key is set", async () => {
    const { billingConfigured } = await load();
    expect(billingConfigured()).toBe(false);
    await load({ BILLING_PROVIDER: "stripe" });
    const { billingConfigured: again } = await import("./billing");
    expect(again()).toBe(false);
    await load({ BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test" });
    const { billingConfigured: ready } = await import("./billing");
    expect(ready()).toBe(true);
  });

  it("treats a non-stripe provider as unconfigured even with a key", async () => {
    const { billingConfigured } = await load({ BILLING_PROVIDER: "mock", STRIPE_SECRET_KEY: "sk_test" });
    expect(billingConfigured()).toBe(false);
  });
});