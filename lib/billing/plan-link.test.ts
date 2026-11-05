import { describe, expect, it } from "vitest";
import { loginForPlan, planLink, wantedPlan, workspaceBillingPath } from "./plan-link";

// lib/billing/plan-link.ts: the pricing cards' way to Checkout, through /billing and the workspace's billing page.

describe("plan links", () => {
  it("links each paid plan to /billing with the plan in the query", () => {
    expect(planLink("pro")).toBe("/billing?plan=pro");
    expect(planLink("team")).toBe("/billing?plan=team");
  });

  it("reads only a plan that is sold", () => {
    expect(wantedPlan("pro")).toBe("pro");
    expect(wantedPlan("team")).toBe("team");
    for (const raw of ["free", "oss", "PRO", "", undefined, ["pro"]]) expect(wantedPlan(raw)).toBeNull();
  });

  it("sends a signed-out visitor to sign in and back with the plan", () => {
    expect(loginForPlan("team")).toBe("/login?next=%2Fbilling%3Fplan%3Dteam");
    expect(loginForPlan(null)).toBe("/login?next=%2Fbilling");
  });

  it("lands on the workspace's billing page, keeping the plan", () => {
    expect(workspaceBillingPath("acme", "pro")).toBe("/acme/billing?plan=pro");
    expect(workspaceBillingPath("acme", null)).toBe("/acme/billing");
  });
});
