"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import type { PlanLimits } from "./plan-limits";

// Each CLI's plan limits for the status strip (lib/plan-limits.ts), from /api/limits/plans. One copy for
// every strip on screen, read again each minute and whenever a strip's refresh key changes (a card's
// new reading). null until it loads, and where the route isn't there (the web board): the strip then
// falls back on the card's own reading.
//
// The route also sends the models that have hit their own cap (lib/model-limit.ts): the limits are per
// model as well as per CLI, so a model can be spent while its CLI's 5-hour window still has room. The
// model pickers mark those models (components/ModelSelect.tsx). They read them from here rather than
// importing lib/model-limit.ts, which reads the store off disk and so can't run in the browser.

export const PLANS_POLL_MS = 60_000;

// A model that has hit its own cap, and when it frees up (unix ms). The shape the route sends
// (lib/model-limit.ts's ModelLimit); spelled out here so this client module depends on nothing but the
// route's answer, and not on the store's own types.
export interface LimitedModel {
  model: string;
  at: number;
  resetsAt: number;
}

let plans: PlanLimits | null = null;
let limitedModels: LimitedModel[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

export function loadPlans(): Promise<void> {
  return apiFetch("/api/limits/plans")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { plans?: PlanLimits; models?: LimitedModel[] } | null) => {
      plans = body?.plans ?? null;
      limitedModels = body?.models ?? [];
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

// The models that have hit their own cap, for the model pickers to mark (components/ModelSelect.tsx).
// Empty until the plans load, and on the web board, where the route isn't there.
export function useLimitedModels(refreshKey?: string): LimitedModel[] {
  const value = useSyncExternalStore(
    subscribe,
    () => limitedModels,
    () => [] as LimitedModel[],
  );
  useEffect(() => {
    if (refreshKey) void loadPlans();
  }, [refreshKey]);
  return value;
}

// For tests: forget what was loaded.
export function resetPlans() {
  plans = null;
  limitedModels = [];
}
