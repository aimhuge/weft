// The server-action tests pin the same mocks: the teams package, the billing module under test, the
// session gate, next/navigation (redirect throws a sentinel) and next/cache. The "ctx" the gate would
// return is shaped directly into a TeamContext for each test so the action under test can be exercised
// without re-running the gate (covered in lib/teams.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({
  roleCan: vi.fn(),
}));
const billingMock = vi.hoisted(() => {
  const provider = {
    id: "stripe",
    label: "Stripe",
    hostedCheckout: true,
    live: true,
    managesPaymentMethodsExternally: true,
    startCheckout: vi.fn(),
    changePlan: vi.fn(),
    cancelSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    attachPaymentMethod: vi.fn(),
    detachPaymentMethod: vi.fn(),
    setDefaultPaymentMethod: vi.fn(),
    billingPortalUrl: vi.fn(),
    reconcile: vi.fn(),
  };
  return {
    provider: vi.fn(() => provider),
    billingConfigured: vi.fn(),
    providerHandle: provider,
  };
});
const teamsModMock = vi.hoisted(() => ({
  requireTeam: vi.fn(),
}));
const navMock = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as Error & { __isRedirect: true }).__isRedirect = true;
    throw err;
  }),
  notFound: vi.fn(),
}));
const cacheMock = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));
const headersMock = vi.hoisted(() => ({
  headers: vi.fn(),
}));
const regionalMock = vi.hoisted(() => ({
  regionalPick: vi.fn(),
}));

vi.mock("@aimhuge/teams", () => teamsMock);
// The real package's `defineCatalog` builds the plan catalog lib/billing/plans.ts reads, so the mock keeps it.
vi.mock("@aimhuge/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aimhuge/billing")>();
  return { ...actual, BillingError: class BillingError extends Error {} };
});
vi.mock("./teams", () => teamsModMock);
vi.mock("./billing/billing", () => ({ billing: billingMock, billingConfigured: billingMock.billingConfigured }));
vi.mock("next/navigation", () => navMock);
vi.mock("next/cache", () => cacheMock);
vi.mock("next/headers", () => headersMock);
vi.mock("./billing/regional-pick", () => ({ IP_COUNTRY_HEADER: "x-vercel-ip-country", ...regionalMock }));
vi.mock("./billing/oss-grant", () => ({ checkOpenSourceFor: vi.fn() }));

import { BillingError } from "@aimhuge/billing";
import {
  cancelForm,
  cancelPro,
  manageBilling,
  manageForm,
  resumeForm,
  resumePro,
  upgradeForm,
  upgradeToPro,
} from "./billing-actions";

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };
const CTX = { user: USER, org: ORG, role: "owner", orgs: [ORG], service: { svc: true } };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue(CTX);
  teamsMock.roleCan.mockImplementation((role: string, perm: string) => role !== "member" && perm === "workspace.manage");
  billingMock.billingConfigured.mockReturnValue(true);
  cacheMock.revalidatePath.mockReturnValue(undefined);
  // No IP country by default: the regional pick finds nothing and Checkout sells the full price.
  headersMock.headers.mockResolvedValue({ get: () => null });
  regionalMock.regionalPick.mockResolvedValue(null);
});

// Captures a thrown redirect without letting it bubble. Returns the URL the action tried to redirect to,
// or null when the action returned normally. Anything else is a real bug and gets rethrown so the test
// fails loudly instead of silently passing.
async function run<T>(call: () => Promise<T>): Promise<{ result: T; redirectTo: null } | { result: null; redirectTo: string }> {
  try {
    const result = await call();
    return { result, redirectTo: null };
  } catch (err) {
    if (err instanceof Error && (err as Error & { __isRedirect?: boolean }).__isRedirect) {
      const m = /^NEXT_REDIRECT: (.+)$/.exec(err.message);
      return { result: null, redirectTo: m?.[1] ?? "<unknown>" };
    }
    throw err;
  }
}

describe("upgradeToPro", () => {
  it("refuses a member", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { result, redirectTo } = await run(() => upgradeToPro("acme", "monthly"));
    expect(result).toEqual({ ok: false, error: "Ask an owner to change the plan." });
    expect(redirectTo).toBeNull();
    expect(billingMock.provider).not.toHaveBeenCalled();
  });

  it("refuses when billing isn't configured", async () => {
    billingMock.billingConfigured.mockReturnValue(false);
    const { result } = await run(() => upgradeToPro("acme", "monthly"));
    expect(result).toEqual({ ok: false, error: "Billing isn't set up on this Weft yet." });
    expect(billingMock.provider).not.toHaveBeenCalled();
  });

  it("redirects to the hosted-checkout URL on a redirect result", async () => {
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://stripe.test/c/cs_x" });
    const { result, redirectTo } = await run(() => upgradeToPro("acme", "yearly"));
    expect(redirectTo).toBe("https://stripe.test/c/cs_x");
    expect(result).toBeNull();
    expect(billingMock.providerHandle.startCheckout).toHaveBeenCalledWith(
      { service: { svc: true }, orgId: ORG.id, orgSlug: ORG.slug, actorEmail: USER.email },
      { plan: "pro", interval: "yearly", seats: 1, returnPath: "/acme/billing" },
    );
  });

  it("revalidates and reports success on an inline-applied result", async () => {
    const sub = { orgId: ORG.id, plan: "pro", status: "active", interval: "monthly" } as const;
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "applied", subscription: sub as never });
    const { result, redirectTo } = await run(() => upgradeToPro("acme", "monthly"));
    expect(result).toEqual({ ok: true, message: "Plan updated." });
    expect(redirectTo).toBeNull();
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/billing");
  });

  it("passes through a BillingError's message", async () => {
    billingMock.providerHandle.startCheckout.mockRejectedValueOnce(new BillingError("Your card was declined."));
    const { result } = await run(() => upgradeToPro("acme", "monthly"));
    expect(result).toEqual({ ok: false, error: "Your card was declined." });
  });

  it("logs and returns a generic message for non-BillingError throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    billingMock.providerHandle.startCheckout.mockRejectedValueOnce(new Error("Stripe 500"));
    const { result } = await run(() => upgradeToPro("acme", "monthly"));
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(err).toHaveBeenCalledWith("Billing action: Stripe 500");
  });

  it("logs 'unknown' when the throw isn't an Error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    billingMock.providerHandle.startCheckout.mockRejectedValueOnce("nope");
    const { result } = await run(() => upgradeToPro("acme", "monthly"));
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(err).toHaveBeenCalledWith("Billing action: unknown");
  });
});

describe("manageBilling", () => {
  it("refuses a member", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { result } = await run(() => manageBilling("acme"));
    expect(result).toEqual({ ok: false, error: "Ask an owner to manage billing." });
    expect(billingMock.provider).not.toHaveBeenCalled();
  });

  it("redirects to the portal URL when one is minted", async () => {
    billingMock.providerHandle.billingPortalUrl.mockResolvedValueOnce("https://billing.stripe.com/x");
    const { redirectTo } = await run(() => manageBilling("acme"));
    expect(redirectTo).toBe("https://billing.stripe.com/x");
    expect(billingMock.providerHandle.billingPortalUrl).toHaveBeenCalledWith(
      { service: { svc: true }, orgId: ORG.id, orgSlug: ORG.slug, actorEmail: USER.email },
      "/acme/billing",
    );
  });

  it("returns an error when the provider has no portal", async () => {
    billingMock.providerHandle.billingPortalUrl.mockResolvedValueOnce(null);
    const { result, redirectTo } = await run(() => manageBilling("acme"));
    expect(result).toEqual({ ok: false, error: "This provider has no billing portal." });
    expect(redirectTo).toBeNull();
  });

  it("logs and returns a generic message when the portal call throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    billingMock.providerHandle.billingPortalUrl.mockRejectedValueOnce(new Error("Stripe down"));
    const { result } = await run(() => manageBilling("acme"));
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(err).toHaveBeenCalledWith("Billing action: Stripe down");
  });
});

describe("cancelPro", () => {
  it("refuses a member", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { result } = await run(() => cancelPro("acme"));
    expect(result).toEqual({ ok: false, error: "Ask an owner to cancel the plan." });
    expect(billingMock.providerHandle.cancelSubscription).not.toHaveBeenCalled();
  });

  it("schedules cancellation and revalidates on success", async () => {
    billingMock.providerHandle.cancelSubscription.mockResolvedValueOnce({});
    const { result } = await run(() => cancelPro("acme"));
    expect(result).toEqual({ ok: true, message: "Cancellation scheduled. Access continues until the end of your billing period." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/billing");
    expect(billingMock.providerHandle.cancelSubscription).toHaveBeenCalledWith({
      service: { svc: true }, orgId: ORG.id, orgSlug: ORG.slug, actorEmail: USER.email,
    });
  });

  it("passes through a BillingError's message", async () => {
    billingMock.providerHandle.cancelSubscription.mockRejectedValueOnce(new BillingError("No active subscription."));
    const { result } = await run(() => cancelPro("acme"));
    expect(result).toEqual({ ok: false, error: "No active subscription." });
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("logs and returns a generic message for non-BillingError throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    billingMock.providerHandle.cancelSubscription.mockRejectedValueOnce(new Error("network"));
    const { result } = await run(() => cancelPro("acme"));
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(err).toHaveBeenCalledWith("Billing action: network");
  });
});

describe("resumePro", () => {
  it("refuses a member", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { result } = await run(() => resumePro("acme"));
    expect(result).toEqual({ ok: false, error: "Ask an owner to resume the plan." });
    expect(billingMock.providerHandle.resumeSubscription).not.toHaveBeenCalled();
  });

  it("resumes the subscription and revalidates on success", async () => {
    billingMock.providerHandle.resumeSubscription.mockResolvedValueOnce({});
    const { result } = await run(() => resumePro("acme"));
    expect(result).toEqual({ ok: true, message: "Cancellation undone." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/billing");
  });

  it("passes through a BillingError's message", async () => {
    billingMock.providerHandle.resumeSubscription.mockRejectedValueOnce(new BillingError("Nothing to resume."));
    const { result } = await run(() => resumePro("acme"));
    expect(result).toEqual({ ok: false, error: "Nothing to resume." });
  });

  it("logs and returns a generic message for non-BillingError throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    billingMock.providerHandle.resumeSubscription.mockRejectedValueOnce(new Error("boom"));
    const { result } = await run(() => resumePro("acme"));
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(err).toHaveBeenCalledWith("Billing action: boom");
  });
});

describe("form wrappers", () => {
  it("upgradeForm sends a refusal back to the page as ?error=", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { redirectTo } = await run(() => upgradeForm("acme", "yearly"));
    expect(redirectTo).toBe(`/acme/billing?error=${encodeURIComponent("Ask an owner to change the plan.")}`);
  });

  it("upgradeForm follows a successful checkout's redirect", async () => {
    teamsModMock.requireTeam.mockResolvedValue(CTX);
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://stripe.test/c/cs_y" });
    const { redirectTo } = await run(() => upgradeForm("acme", "monthly"));
    expect(redirectTo).toBe("https://stripe.test/c/cs_y");
  });

  it("manageForm, cancelForm and resumeForm pass a refusal back the same way", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    for (const action of [manageForm, cancelForm, resumeForm]) {
      const { redirectTo } = await run(() => action("acme"));
      expect(redirectTo).toMatch(/^\/acme\/billing\?error=Ask%20an%20owner/);
    }
  });

  it("upgradeForm, manageForm and resumeForm finish quietly on success", async () => {
    teamsModMock.requireTeam.mockResolvedValue(CTX);
    billingMock.providerHandle.startCheckout.mockResolvedValueOnce({ kind: "applied", subscription: {} });
    expect(await run(() => upgradeForm("acme", "monthly"))).toEqual({ result: undefined, redirectTo: null });
    billingMock.providerHandle.billingPortalUrl.mockResolvedValueOnce("https://billing.stripe.com/p");
    expect((await run(() => manageForm("acme"))).redirectTo).toBe("https://billing.stripe.com/p");
    expect(await run(() => resumeForm("acme"))).toEqual({ result: undefined, redirectTo: null });
  });

  it("cancelForm returns nothing once the cancellation is scheduled", async () => {
    teamsModMock.requireTeam.mockResolvedValue(CTX);
    const { result, redirectTo } = await run(() => cancelForm("acme"));
    expect(redirectTo).toBeNull();
    expect(result).toBeUndefined();
  });
});
