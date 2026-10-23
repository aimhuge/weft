"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import type { PlanLimits } from "./plan-limits";

// Each CLI's plan limits for the status strip (lib/plan-limits.ts), from /api/limits/plans. One copy for
// every strip on screen, read again each minute and whenever a strip's refresh key changes (a card's
// new reading). null until it loads, and where the route isn't there (the web board): the strip then
// falls back on the card's own reading.

export const PLANS_POLL_MS = 60_000;

let plans: PlanLimits | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

export function loadPlans(): Promise<void> {
  return apiFetch("/api/limits/plans")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { plans?: PlanLimits } | null) => {
      plans = body?.plans ?? null;
      for (const listener of listeners) listener();
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void loadPlans();
    timer = setInterval(() => void loadPlans(), PLANS_POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) clearInterval(timer);
  };
}

export function usePlanLimits(refreshKey?: string): PlanLimits | null {
  const value = useSyncExternalStore(subscribe, () => plans, () => null);
  useEffect(() => {
    if (refreshKey) void loadPlans();
  }, [refreshKey]);
  return value;
}

// For tests: forget what was loaded.
export function resetPlans() {
  plans = null;
}
