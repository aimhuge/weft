"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PlanId } from "./billing/plans";
import { api, type BillingClientView } from "./client";

// The signed-in user's plan and current team (/api/account/billing, docs/architecture/billing.md), shared by
// everything that shows it: the avatar menu's plan header (components/AccountPlan.tsx). One answer for the whole
// board, fetched when you sign in so the menu opens loaded, and again whenever the window regains focus, so
// coming back from Checkout shows the new plan. undefined until the first answer; null when signed out.

let current: BillingClientView | undefined;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

// Ask again, unless an answer is already on its way.
export function loadBilling(): Promise<void> {
  inflight ??= api
    .billingStatus()
    .catch((): BillingClientView => ({ error: "Couldn't load your plan." }))
    .then((view) => {
      current = view;
      for (const l of listeners) l();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBillingStatus(): BillingClientView | undefined {
  const view = useSyncExternalStore(subscribe, () => current, () => undefined);
  useEffect(() => {
    const load = () => void loadBilling();
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  return view;
}

// Load it once you're signed in, and again for whoever signs in next.
export function useBillingPrefetch(userId: string | undefined): void {
  useEffect(() => {
    if (userId) void loadBilling();
  }, [userId]);
}

// Free, Open Source and Education have no Puku allowance, so Pro is an upgrade; Pro and Team manage what they pay.
export function planCta(plan: PlanId): { label: string; upgrade: boolean } {
  return plan === "pro" || plan === "team" ? { label: "Manage billing", upgrade: false } : { label: "Upgrade to Pro", upgrade: true };
}

// For tests: forget the last answer.
export function resetBillingStatus(): void {
  current = undefined;
  inflight = null;
}
