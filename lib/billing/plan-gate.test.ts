import { describe, expect, it } from "vitest";
import { canHaveMembers, isPaid, workspaceCanHaveMembers, workspacePlan, TEAM_PLANS } from "./plan-gate";

// lib/billing/plan-gate.ts: which plans may have people, and what a workspace's plan is. The Supabase client is
// a hand-rolled chain stub — only .from().select().eq().maybeSingle() is used, so a fake covers it without a database.

// One .maybeSingle() answer for the org_subscriptions read.
function serviceReturning(row: { plan?: unknown; status?: unknown } | null): never {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => chain } as never;
}

describe("canHaveMembers", () => {
  it("lets Pro and Team workspaces have members, and not Free", () => {
    expect(TEAM_PLANS).toEqual(["pro", "team"]);
    expect(canHaveMembers("pro")).toBe(true);
    expect(canHaveMembers("team")).toBe(true);
    expect(canHaveMembers("free")).toBe(false);
  });

  it("refuses when we don't know the plan", () => {
    // Failing closed: an unreadable plan must not unlock a paid capability.
    expect(canHaveMembers(null)).toBe(false);
    expect(canHaveMembers(undefined)).toBe(false);
    expect(canHaveMembers("")).toBe(false);
    expect(canHaveMembers("enterprise")).toBe(false);
  });
});

describe("workspacePlan", () => {
  it("reads the plan off the workspace's subscription", async () => {
    await expect(workspacePlan(serviceReturning({ plan: "team", status: "active" }), "org-1")).resolves.toBe("team");
    await expect(workspacePlan(serviceReturning({ plan: "pro", status: "active" }), "org-1")).resolves.toBe("pro");
  });

  it("treats a trialing subscription as its plan", async () => {
    await expect(workspacePlan(serviceReturning({ plan: "pro", status: "trialing" }), "org-1")).resolves.toBe("pro");
  });

  it("falls back to free when there is no subscription row", async () => {
    await expect(workspacePlan(serviceReturning(null), "org-1")).resolves.toBe("free");
  });

  it("falls back to free when the plan isn't a string", async () => {
    await expect(workspacePlan(serviceReturning({ plan: 42, status: "active" }), "org-1")).resolves.toBe("free");
    await expect(workspacePlan(serviceReturning({ status: "active" }), "org-1")).resolves.toBe("free");
  });

  it("downgrades to free on a subscription that isn't paying", async () => {
    // A failed renewal stops the Pro tokens (billing.subscription's meteredStatuses) and stops the seats with them.
    for (const status of ["past_due", "canceled", "incomplete"]) {
      await expect(workspacePlan(serviceReturning({ plan: "team", status }), "org-1")).resolves.toBe("free");
    }
  });

  it("reads a plan with no status as the plan itself", async () => {
    await expect(workspacePlan(serviceReturning({ plan: "pro" }), "org-1")).resolves.toBe("pro");
    await expect(workspacePlan(serviceReturning({ plan: "pro", status: 7 }), "org-1")).resolves.toBe("pro");
  });

  it("reads an unknown plan id in the row as free", async () => {
    await expect(workspacePlan(serviceReturning({ plan: "nope", status: "active" }), "org-1")).resolves.toBe("free");
  });

  it("answers free when the read throws, rather than propagating", async () => {
    // A database hiccup must not unlock a paid capability, and must not 500 the invite form either.
    const throwing = {
      from: () => {
        throw new Error("supabase is down");
      },
    } as never;
    await expect(workspacePlan(throwing, "org-1")).resolves.toBe("free");
    await expect(workspaceCanHaveMembers(throwing, "org-1")).resolves.toBe(false);
  });
});

describe("isPaid", () => {
  it("counts Pro and Team as paid and Free as not", () => {
    expect(isPaid("pro")).toBe(true);
    expect(isPaid("team")).toBe(true);
    expect(isPaid("free")).toBe(false);
  });

  it("is false when we don't know the plan", () => {
    expect(isPaid(null)).toBe(false);
    expect(isPaid(undefined)).toBe(false);
    expect(isPaid("enterprise")).toBe(false);
  });

  it("is not the same question as canHaveMembers", () => {
    // Guards the trap this exists to avoid: a paid check written as `plan === "pro"` makes a Team
    // workspace read as a downgrade. The two helpers answer different questions on purpose.
    expect(isPaid("team")).toBe(true);
    expect(canHaveMembers("team")).toBe(true);
    expect(isPaid("free")).toBe(false);
    expect(canHaveMembers("free")).toBe(false);
  });
});

describe("workspaceCanHaveMembers", () => {
  it("is true on a paying Team workspace and false on Free", async () => {
    await expect(workspaceCanHaveMembers(serviceReturning({ plan: "team", status: "active" }), "org-1")).resolves.toBe(true);
    await expect(workspaceCanHaveMembers(serviceReturning({ plan: "free", status: "active" }), "org-1")).resolves.toBe(false);
  });

  it("is false for a Pro workspace whose payment failed", async () => {
    await expect(workspaceCanHaveMembers(serviceReturning({ plan: "pro", status: "past_due" }), "org-1")).resolves.toBe(false);
  });
});