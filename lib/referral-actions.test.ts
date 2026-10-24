// referralCodeForm: the billing page's "Get our referral code". The gate, next/cache and next/navigation are mocked the
// way lib/billing-actions-oss.test.ts mocks them; the code itself is lib/billing/referrals.ts's (mocked here).
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({ roleCan: vi.fn() }));
const teamsModMock = vi.hoisted(() => ({ requireTeam: vi.fn() }));
const navMock = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), { url });
  }),
}));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const referralsMock = vi.hoisted(() => ({ referralCodeFor: vi.fn() }));
const checkoutMock = vi.hoisted(() => ({ describeBillingError: vi.fn(() => "Something went wrong on our end. Try again in a moment.") }));

vi.mock("server-only", () => ({}));
vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("./teams", () => teamsModMock);
vi.mock("next/navigation", () => navMock);
vi.mock("next/cache", () => cacheMock);
vi.mock("./billing/referrals", () => referralsMock);
vi.mock("./billing/checkout", () => checkoutMock);

import { AdminBillingError } from "./billing/admin/stripe-keys";
import { referralCodeForm } from "./referral-actions";

const CTX = { user: { id: "u1", email: "jane@example.com" }, org: { id: "o1", slug: "acme", name: "Acme" }, role: "owner", service: { svc: true } };

async function redirectOf(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url === undefined) throw err;
    return url;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue(CTX);
  teamsMock.roleCan.mockImplementation((role: string) => role !== "member");
  referralsMock.referralCodeFor.mockResolvedValue({ org_id: "o1", code: "WEFT-ACME", promotion_codes: { test: "promo_1" } });
});

describe("referralCodeForm", () => {
  it("makes the code with the gate's service client and re-renders the page", async () => {
    expect(await redirectOf(() => referralCodeForm("acme"))).toBeNull();
    expect(teamsModMock.requireTeam).toHaveBeenCalledWith("acme", "/acme/billing");
    const [service, stripe, orgId] = referralsMock.referralCodeFor.mock.calls[0] as [unknown, { modes: unknown }, string];
    expect(service).toBe(CTX.service);
    expect(typeof stripe.modes).toBe("function");
    expect(orgId).toBe("o1");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/billing");
  });

  it("sends a member back with a refusal and makes nothing", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    expect(await redirectOf(() => referralCodeForm("acme"))).toBe(`/acme/billing?error=${encodeURIComponent("Ask an owner for the referral code.")}`);
    expect(referralsMock.referralCodeFor).not.toHaveBeenCalled();
  });

  it("carries our own refusal back verbatim", async () => {
    referralsMock.referralCodeFor.mockRejectedValue(new AdminBillingError("STRIPE_SECRET_KEY isn't set, so no referral code can be made."));
    expect(await redirectOf(() => referralCodeForm("acme"))).toBe(`/acme/billing?error=${encodeURIComponent("STRIPE_SECRET_KEY isn't set, so no referral code can be made.")}`);
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("says anything else plainly, through describeBillingError", async () => {
    const boom = new Error("stripe exploded");
    referralsMock.referralCodeFor.mockRejectedValue(boom);
    expect(await redirectOf(() => referralCodeForm("acme"))).toBe(`/acme/billing?error=${encodeURIComponent("Something went wrong on our end. Try again in a moment.")}`);
    expect(checkoutMock.describeBillingError).toHaveBeenCalledWith(boom);
  });
});
