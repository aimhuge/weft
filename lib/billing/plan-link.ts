// The way from the home page's pricing cards to Checkout (docs/architecture/marketing-site.md "Plans"). A card links to
// /billing?plan=pro, which signs the visitor in if need be, finds their workspace and lands on /<slug>/billing with the
// plan still in the query; that page opens the upgrade dialog, whose button starts Stripe Checkout. Client-safe.

import type { UpgradePlan } from "./upgrade";

const PLANS: readonly UpgradePlan[] = ["pro", "team"];

// The pricing card's link for a plan.
export function planLink(plan: UpgradePlan): string {
  return `/billing?plan=${plan}`;
}

// The plan a ?plan= query asks for, or null for anything else (a typo, an array, a plan that isn't sold).
export function wantedPlan(raw: string | string[] | undefined): UpgradePlan | null {
  return typeof raw === "string" && (PLANS as readonly string[]).includes(raw) ? (raw as UpgradePlan) : null;
}

// Where /billing sends the visitor: sign-in first (coming back with the plan), then the workspace's billing page.
export function loginForPlan(plan: UpgradePlan | null): string {
  return `/login?next=${encodeURIComponent(plan ? planLink(plan) : "/billing")}`;
}

export function workspaceBillingPath(slug: string, plan: UpgradePlan | null): string {
  return `/${slug}/billing${plan ? `?plan=${plan}` : ""}`;
}
