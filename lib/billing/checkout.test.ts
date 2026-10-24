// The one door into Stripe Checkout: startUpgrade (the guards, the seat count, the regional price, the provider's
// answer) and upgradeContextFor (the desktop's side: the user's workspace, role and email).
//
// The teams package is real — roleCan is the permission table itself, so a "member is refused" test really asks
// the table. Everything else is mocked: the billing provider, the regional pick, the workspace lookup, and the
// Supabase client (a small fake that answers the two queries the code makes).
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  id: "stripe",
  label: "Stripe",
  hostedCheckout: true,
  live: true,
  managesPaymentMethodsExternally: true,
  startCheckout: vi.fn(),
}));
const billingMock = vi.hoisted(() => ({ provider: vi.fn(() => provider), billingConfigured: vi.fn() }));
const regionalMock = vi.hoisted(() => ({ regionalPick: vi.fn() }));
const orgMock = vi.hoisted(() => ({ orgForUser: vi.fn() }));

vi.mock("./billing", () => ({ billing: billingMock, billingConfigured: billingMock.billingConfigured }));
vi.mock("./regional-pick", () => ({ IP_COUNTRY_HEADER: "x-vercel-ip-country", ...regionalMock }));
vi.mock("./org", () => orgMock);
// BillingError is real (the package's own class), so `err instanceof BillingError` in the code under test
// means the same thing it means in production.
vi.mock("@aimhuge/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aimhuge/billing")>();
  return { ...actual, BillingError: class BillingError extends Error {} };
});

import { BillingError } from "@aimhuge/billing";
import { describeBillingError, startUpgrade, upgradeContextFor, type UpgradeContext } from "./checkout";

const SERVICE = { svc: true } as never;
const CTX: UpgradeContext = {
  service: SERVICE,
  orgId: "o1",
  orgSlug: "acme",
  actorEmail: "jane@example.com",
  role: "owner",
};
const PRO_MONTHLY = { plan: "pro", interval: "monthly", ipCountry: null, returnPath: "/checkout/done" } as const;

// The fake service client. `memberCount` asks org_memberships for an exact head count; `upgradeContextFor` asks it
// for the caller's role and asks auth.admin for the user's email. The two queries are told apart by the columns
// selected, so one `from()` can answer both.
function fakeService(opts: { count?: number | null; member?: { role?: string } | null; email?: string | null } = {}) {
  const count = opts.count === undefined ? 3 : opts.count;
  const member = opts.member === undefined ? { role: "admin" } : opts.member;
  const email = opts.email === undefined ? "jane@example.com" : opts.email;
  // The role query chains two filters (.eq("org_id").eq("user_id")); each filter is chainable and ends in maybeSingle.
  const filter = () => {
    const chain: Record<string, unknown> = {};
    const eq = vi.fn(() => chain);
    chain.eq = eq;
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: member }));
    return chain;
  };
  const from = vi.fn((table: string) => {
    if (table === "org_memberships") {
      return {
        select: vi.fn((_cols: string, args?: { count?: string; head?: boolean }) =>
          args?.head
            ? { eq: vi.fn(() => Promise.resolve({ count })) }
            : filter(),
        ),
      };
    }
    return { select: vi.fn(() => filter()) };
  });
  // The admin API answers { data: { user } }, which is what the code destructures.
  const auth = { admin: { getUserById: vi.fn(() => Promise.resolve({ data: { user: email ? { id: "u1", email } : null } })) } };
  return { client: { from, auth } as never, from, auth };
}

beforeEach(() => {
  vi.clearAllMocks();
  billingMock.billingConfigured.mockReturnValue(true);
  provider.startCheckout.mockResolvedValue({ kind: "redirect", url: "https://stripe.test/c/cs_x" });
  regionalMock.regionalPick.mockResolvedValue(null);
  orgMock.orgForUser.mockResolvedValue({ id: "o1", slug: "acme", name: "Acme" });
});

describe("startUpgrade", () => {
  it("refuses a member", async () => {
    const result = await startUpgrade({ ...CTX, role: "member" }, PRO_MONTHLY);
    expect(result).toEqual({ ok: false, error: "Ask an owner to change the plan." });
    expect(billingMock.provider).not.toHaveBeenCalled();
  });

  it("lets an admin through (owners and admins may spend the workspace's money)", async () => {
    const result = await startUpgrade({ ...CTX, role: "admin" }, PRO_MONTHLY);
    expect(result).toEqual({ ok: true, url: "https://stripe.test/c/cs_x" });
  });

  it("refuses when billing isn't configured", async () => {
    billingMock.billingConfigured.mockReturnValue(false);
    const result = await startUpgrade(CTX, PRO_MONTHLY);
    expect(result).toEqual({ ok: false, error: "Billing isn't set up on this Weft yet." });
    expect(billingMock.provider).not.toHaveBeenCalled();
  });

  it("sells the regional price on a monthly pro upgrade", async () => {
    regionalMock.regionalPick.mockResolvedValue({ tier: "low", variant: "pro_monthly_low", monthlyCents: 500 });
    await startUpgrade(CTX, { ...PRO_MONTHLY, ipCountry: "IN" });
    expect(regionalMock.regionalPick).toHaveBeenCalledWith(SERVICE, "o1", "IN");
    expect(provider.startCheckout).toHaveBeenCalledWith(
      { service: SERVICE, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com" },
      { plan: "pro", interval: "monthly", seats: 1, returnPath: "/checkout/done", priceVariant: "pro_monthly_low" },
    );
  });

  it("leaves priceVariant out when no regional price applies", async () => {
    regionalMock.regionalPick.mockResolvedValue(null);
    await startUpgrade(CTX, { ...PRO_MONTHLY, ipCountry: "US" });
    expect(regionalMock.regionalPick).toHaveBeenCalledWith(SERVICE, "o1", "US");
    expect(provider.startCheckout).toHaveBeenCalledWith(
      { service: SERVICE, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com" },
      { plan: "pro", interval: "monthly", seats: 1, returnPath: "/checkout/done" },
    );
  });

  it("never picks a regional price on a yearly upgrade", async () => {
    await startUpgrade(CTX, { plan: "pro", interval: "yearly", ipCountry: "IN", returnPath: "/checkout/done" });
    expect(regionalMock.regionalPick).not.toHaveBeenCalled();
    expect(provider.startCheckout).toHaveBeenCalledWith(
      { service: SERVICE, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com" },
      { plan: "pro", interval: "yearly", seats: 1, returnPath: "/checkout/done" },
    );
  });

  it("bills a team for its member count, monthly", async () => {
    const { client } = fakeService({ count: 4 });
    await startUpgrade({ ...CTX, service: client }, { plan: "team", interval: "yearly", ipCountry: null, returnPath: "/checkout/done" });
    expect(provider.startCheckout).toHaveBeenCalledWith(
      { service: client, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com" },
      { plan: "team", interval: "monthly", seats: 4, returnPath: "/checkout/done" },
    );
  });

  it("bills a team for at least one seat when the count comes back null", async () => {
    const { client } = fakeService({ count: null });
    await startUpgrade({ ...CTX, service: client }, { plan: "team", interval: "monthly", ipCountry: null, returnPath: "/checkout/done" });
    expect(provider.startCheckout).toHaveBeenCalledWith(
      { service: client, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com" },
      { plan: "team", interval: "monthly", seats: 1, returnPath: "/checkout/done" },
    );
  });

  it("bills a team for one seat when the count is zero", async () => {
    const { client } = fakeService({ count: 0 });
    await startUpgrade({ ...CTX, service: client }, { plan: "team", interval: "monthly", ipCountry: null, returnPath: "/checkout/done" });
    const input = provider.startCheckout.mock.calls[0]![1] as { seats: number };
    expect(input.seats).toBe(1);
  });

  it("answers a redirect with the Checkout URL", async () => {
    provider.startCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://stripe.test/c/cs_y" });
    const result = await startUpgrade(CTX, PRO_MONTHLY);
    expect(result).toEqual({ ok: true, url: "https://stripe.test/c/cs_y" });
  });

  it("answers an applied change with { ok: true, applied: true }", async () => {
    provider.startCheckout.mockResolvedValueOnce({ kind: "applied", subscription: {} });
    const result = await startUpgrade(CTX, PRO_MONTHLY);
    expect(result).toEqual({ ok: true, applied: true });
  });

  it("passes through a BillingError's message", async () => {
    provider.startCheckout.mockRejectedValueOnce(new BillingError("Your card was declined."));
    const result = await startUpgrade(CTX, PRO_MONTHLY);
    expect(result).toEqual({ ok: false, error: "Your card was declined." });
  });

  it("logs and returns a generic message for any other error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    provider.startCheckout.mockRejectedValueOnce(new Error("Stripe 500"));
    const result = await startUpgrade(CTX, PRO_MONTHLY);
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(logged).toHaveBeenCalledWith("Billing action: Stripe 500");
    logged.mockRestore();
  });

  it("reports a failure to count the team's members as a generic error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeService();
    (client as unknown as { from: (t: string) => { select: () => { eq: () => Promise<never> } } }).from = vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => Promise.reject(new Error("count failed"))) })),
    }));
    const result = await startUpgrade({ ...CTX, service: client }, { plan: "team", interval: "monthly", ipCountry: null, returnPath: "/checkout/done" });
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(provider.startCheckout).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("describeBillingError", () => {
  it("passes a BillingError's message through untouched", () => {
    expect(describeBillingError(new BillingError("No active subscription."))).toBe("No active subscription.");
  });

  it("logs and returns a generic message for an Error", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeBillingError(new Error("boom"))).toBe("Something went wrong on our end. Try again in a moment.");
    expect(logged).toHaveBeenCalledWith("Billing action: boom");
    logged.mockRestore();
  });

  it("names a missing-configuration error as unfinished setup, logging the variables", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("BILLING_PROVIDER=stripe but these environment variables are missing: STRIPE_PRICE_TEAM_YEARLY.");
    expect(describeBillingError(err)).toBe("Billing isn't fully set up on this Weft yet.");
    expect(logged).toHaveBeenCalledWith(`Billing setup: ${err.message}`);
    logged.mockRestore();
  });

  it("logs 'unknown' when the throw isn't an Error", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeBillingError("nope")).toBe("Something went wrong on our end. Try again in a moment.");
    expect(logged).toHaveBeenCalledWith("Billing action: unknown");
    logged.mockRestore();
  });
});

describe("upgradeContextFor", () => {
  it("is null when the user has no workspace", async () => {
    orgMock.orgForUser.mockResolvedValueOnce(null);
    const { client } = fakeService();
    expect(await upgradeContextFor(client, "u1")).toBeNull();
  });

  it("reads the role and the email for the user's workspace", async () => {
    const { client } = fakeService({ member: { role: "owner" }, email: "jane@example.com" });
    const ctx = await upgradeContextFor(client, "u1");
    expect(ctx).toEqual({ service: client, orgId: "o1", orgSlug: "acme", actorEmail: "jane@example.com", role: "owner" });
  });

  it("defaults a missing membership to member", async () => {
    const { client } = fakeService({ member: null });
    const ctx = await upgradeContextFor(client, "u1");
    expect(ctx?.role).toBe("member");
  });

  it("defaults a membership without a role to member", async () => {
    const { client } = fakeService({ member: {} });
    const ctx = await upgradeContextFor(client, "u1");
    expect(ctx?.role).toBe("member");
  });

  it("has a null email when the user has none", async () => {
    const { client } = fakeService({ email: null });
    const ctx = await upgradeContextFor(client, "u1");
    expect(ctx?.actorEmail).toBeNull();
  });
});
