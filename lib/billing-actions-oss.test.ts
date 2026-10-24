// checkOpenSourceNow: the billing page's "Check my GitHub now" action. Same mocks as billing-actions.test.ts
// (the gate, next/cache, the OSS check), kept in its own file so each stays under the size cap.
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({ roleCan: vi.fn() }));
const teamsModMock = vi.hoisted(() => ({ requireTeam: vi.fn() }));
const navMock = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as Error & { __isRedirect: true }).__isRedirect = true;
    throw err;
  }),
  notFound: vi.fn(),
}));
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const ossMock = vi.hoisted(() => ({ checkOpenSourceFor: vi.fn() }));

vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("@aimhuge/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aimhuge/billing")>();
  return { ...actual, BillingError: class BillingError extends Error {} };
});
vi.mock("./teams", () => teamsModMock);
vi.mock("./billing/billing", () => ({ billing: {}, billingConfigured: vi.fn(() => true) }));
vi.mock("next/navigation", () => navMock);
vi.mock("next/cache", () => cacheMock);
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("./billing/regional-pick", () => ({ IP_COUNTRY_HEADER: "x-vercel-ip-country", regionalPick: vi.fn() }));
vi.mock("./billing/oss-grant", () => ossMock);

import { BillingError } from "@aimhuge/billing";
import { checkOpenSourceForm, checkOpenSourceNow } from "./billing-actions";

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };
const CTX = { user: USER, org: ORG, role: "owner", orgs: [ORG], service: { svc: true } };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue(CTX);
  teamsMock.roleCan.mockImplementation((role: string, perm: string) => role !== "member" && perm === "workspace.manage");
  cacheMock.revalidatePath.mockReturnValue(undefined);
});

// Captures a thrown redirect without letting it bubble: the URL the action tried to redirect to, or null.
async function run<T>(call: () => Promise<T>): Promise<{ result: T; redirectTo: null } | { result: null; redirectTo: string }> {
  try {
    return { result: await call(), redirectTo: null };
  } catch (err) {
    if (err instanceof Error && (err as Error & { __isRedirect?: boolean }).__isRedirect) {
      return { result: null, redirectTo: /^NEXT_REDIRECT: (.+)$/.exec(err.message)?.[1] ?? "<unknown>" };
    }
    throw err;
  }
}

describe("checkOpenSourceNow", () => {
  it("refuses a member", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "Ask an owner to check open source." });
    expect(ossMock.checkOpenSourceFor).not.toHaveBeenCalled();
  });

  it("grants Open Source and names the repo", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({
      kind: "granted",
      repo: "weft/weft",
      outcome: { granted: true, plan: "oss", periodEnd: "2027-01-01T00:00:00.000Z" },
    });
    const { result, redirectTo } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: true, message: "Open Source granted for weft/weft." });
    expect(redirectTo).toBeNull();
    expect(ossMock.checkOpenSourceFor).toHaveBeenCalledWith({ svc: true }, USER.id);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/billing");
  });

  it("falls through to the last message when the grant is refused because the workspace is paid", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({
      kind: "granted",
      repo: "weft/weft",
      outcome: { granted: false, reason: "paid" },
    });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "No active, OSI-licensed public repo you maintain clears the bar yet." });
  });

  it("reports a paid workspace", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({ kind: "skipped", reason: "paid" });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "This workspace pays for Pro or Team, which already includes everything." });
  });

  it("reports a current grant", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({ kind: "skipped", reason: "not-due" });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: true, message: "Your Open Source grant is current." });
  });

  it("asks a user who didn't sign in with GitHub to", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({ kind: "skipped", reason: "no-login" });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "Sign in with GitHub to check." });
  });

  it("reports a workspace with no open-source repo", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({ kind: "skipped", reason: "no-workspace" });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "No active, OSI-licensed public repo you maintain clears the bar yet." });
  });

  it("reports a user who isn't eligible", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({ kind: "not-eligible" });
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "No active, OSI-licensed public repo you maintain clears the bar yet." });
  });

  it("passes through a BillingError's message", async () => {
    ossMock.checkOpenSourceFor.mockRejectedValueOnce(new BillingError("GitHub is rate limited."));
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "GitHub is rate limited." });
  });

  it("logs and returns a generic message for non-BillingError throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    ossMock.checkOpenSourceFor.mockRejectedValueOnce(new Error("github down"));
    const { result } = await run(() => checkOpenSourceNow("acme"));
    expect(result).toEqual({ ok: false, error: "Something went wrong on our end. Try again in a moment." });
    expect(err).toHaveBeenCalledWith("Billing action: github down");
  });
});

// The page's <form action>: a void wrapper that sends a refusal back as ?error=….
describe("checkOpenSourceForm", () => {
  it("checkOpenSourceForm sends a refusal back to the page as ?error=", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ ...CTX, role: "member" });
    const { redirectTo } = await run(() => checkOpenSourceForm("acme"));
    expect(redirectTo).toBe(`/acme/billing?error=${encodeURIComponent("Ask an owner to check open source.")}`);
  });

  it("checkOpenSourceForm finishes quietly once the grant lands", async () => {
    ossMock.checkOpenSourceFor.mockResolvedValueOnce({
      kind: "granted",
      repo: "weft/weft",
      outcome: { granted: true, plan: "oss", periodEnd: "2027-01-01T00:00:00.000Z" },
    });
    expect(await run(() => checkOpenSourceForm("acme"))).toEqual({ result: undefined, redirectTo: null });
  });
});
