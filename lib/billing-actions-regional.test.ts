// upgradeToPro's regional price: a monthly upgrade from a qualifying country passes Checkout a price variant.
// Same mocks as billing-actions.test.ts, kept in their own file so each stays under the size cap.
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({ roleCan: vi.fn() }));
const provider = vi.hoisted(() => ({
  id: "stripe",
  label: "Stripe",
  hostedCheckout: true,
  live: true,
  managesPaymentMethodsExternally: true,
  startCheckout: vi.fn(),
}));
const billingMock = vi.hoisted(() => ({ provider: vi.fn(() => provider), billingConfigured: vi.fn(), providerHandle: provider }));
const teamsModMock = vi.hoisted(() => ({ requireTeam: vi.fn() }));
const navMock = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as Error & { __isRedirect: true }).__isRedirect = true;
    throw err;
  }),
  notFound: vi.fn(),
}));
const headersMock = vi.hoisted(() => ({ headers: vi.fn() }));
const regionalMock = vi.hoisted(() => ({ regionalPick: vi.fn() }));

vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("@aimhuge/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aimhuge/billing")>();
  return { ...actual, BillingError: class BillingError extends Error {} };
});
vi.mock("./teams", () => teamsModMock);
vi.mock("./billing/billing", () => ({ billing: billingMock, billingConfigured: billingMock.billingConfigured }));
vi.mock("next/navigation", () => navMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => headersMock);
vi.mock("./billing/regional-pick", () => ({ IP_COUNTRY_HEADER: "x-vercel-ip-country", ...regionalMock }));
vi.mock("./billing/oss-grant", () => ({ checkOpenSourceFor: vi.fn() }));

import { upgradeToPro } from "./billing-actions";

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };
const CTX = { user: USER, org: ORG, role: "owner", orgs: [ORG], service: { svc: true } };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue(CTX);
  teamsMock.roleCan.mockImplementation((role: string, perm: string) => role !== "member" && perm === "workspace.manage");
  billingMock.billingConfigured.mockReturnValue(true);
  headersMock.headers.mockResolvedValue({ get: () => null });
  regionalMock.regionalPick.mockResolvedValue(null);
});

// Swallows the redirect Checkout ends on; the assertions read the mocks.
async function run<T>(call: () => Promise<T>): Promise<{ redirectTo: string | null }> {
  try {
    await call();
    return { redirectTo: null };
  } catch (err) {
    const m = err instanceof Error ? /^NEXT_REDIRECT: (.+)$/.exec(err.message) : null;
    if (!m) throw err;
    // The capture group always matches here (the pattern requires a character), but the
    // index is still `string | undefined` under noUncheckedIndexedAccess.
    return { redirectTo: m[1] ?? null };
  }
}

describe("upgradeToPro regional price", () => {
  it("sells the regional price on a monthly upgrade", async () => {
    headersMock.headers.mockResolvedValue({ get: () => "IN" });
    regionalMock.regionalPick.mockResolvedValue({ tier: "low", variant: "pro_monthly_low", monthlyCents: 500 });
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://stripe.test/c/cs_r" });
    const { redirectTo } = await run(() => upgradeToPro("acme", "monthly"));
    expect(redirectTo).toBe("https://stripe.test/c/cs_r");
    expect(regionalMock.regionalPick).toHaveBeenCalledWith({ svc: true }, ORG.id, "IN");
    expect(billingMock.providerHandle.startCheckout).toHaveBeenCalledWith(
      { service: { svc: true }, orgId: ORG.id, orgSlug: ORG.slug, actorEmail: USER.email },
      {
        plan: "pro",
        interval: "monthly",
        seats: 1,
        returnPath: "/acme/billing",
        priceVariant: "pro_monthly_low",
      },
    );
  });

  it("leaves priceVariant out when no regional price applies", async () => {
    headersMock.headers.mockResolvedValue({ get: () => "US" });
    regionalMock.regionalPick.mockResolvedValue(null);
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://stripe.test/c/cs_u" });
    await run(() => upgradeToPro("acme", "monthly"));
    expect(regionalMock.regionalPick).toHaveBeenCalledWith({ svc: true }, ORG.id, "US");
    expect(billingMock.providerHandle.startCheckout).toHaveBeenCalledWith(
      { service: { svc: true }, orgId: ORG.id, orgSlug: ORG.slug, actorEmail: USER.email },
      { plan: "pro", interval: "monthly", seats: 1, returnPath: "/acme/billing" },
    );
  });

  it("never picks a regional price on a yearly upgrade", async () => {
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://stripe.test/c/cs_y" });
    await run(() => upgradeToPro("acme", "yearly"));
    expect(regionalMock.regionalPick).not.toHaveBeenCalled();
    expect(billingMock.providerHandle.startCheckout).toHaveBeenCalledWith(
      { service: { svc: true }, orgId: ORG.id, orgSlug: ORG.slug, actorEmail: USER.email },
      { plan: "pro", interval: "yearly", seats: 1, returnPath: "/acme/billing" },
    );
  });
});
