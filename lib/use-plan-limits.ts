"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import type { PlanLimits } from "./plan-limits";
import { hostFor } from "./project-host";

// The plan limits for the status strip (lib/plan-limits.ts), from /api/limits/plans: each CLI that has
// reported, carrying the PLAN's windows. One copy for
// every strip on screen, read again each minute and whenever a strip's refresh key changes (a card's
// new reading). null until it loads, and where the route isn't there (the web board): the strip then
// falls back on the card's own reading.
//
// The route also sends the models that have hit their own cap (lib/model-limit.ts): the limits are per
// model as well as per plan, so a model can be spent while the plan's 5-hour window still has room. The
// model pickers mark those models (components/ModelSelect.tsx). They read them from here rather than
// importing lib/model-limit.ts, which reads the store off disk and so can't run in the browser.
//
// A Weft Worker's card runs on the worker's own sign-in, so its pickers mark the worker's caps, not this Mac's:
// useLimitedModels(cwd) reads /api/limits/plans?worker=<id> for a project the worker hosts (lib/project-host.ts),
// what the worker published to its row (lib/worker-limits.ts). One copy per host, each polled while it's on screen.

export const PLANS_POLL_MS = 60_000;

// A model that has hit its own cap, and when it frees up (unix ms). The shape the route sends
// (lib/model-limit.ts's ModelLimit); spelled out here so this client module depends on nothing but the
// route's answer, and not on the store's own types.
export interface LimitedModel {
  model: string;
  at: number;
  resetsAt: number;
}

// One host's copy: this Mac's under "", a worker's under its id.
interface HostLimits {
  plans: PlanLimits | null;
  models: LimitedModel[];
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
}

const NO_MODELS: LimitedModel[] = [];
const hosts = new Map<string, HostLimits>();

function hostLimits(worker: string): HostLimits {
  let h = hosts.get(worker);
  if (!h) hosts.set(worker, (h = { plans: null, models: NO_MODELS, listeners: new Set() }));
  return h;
}

export function loadPlans(worker = ""): Promise<void> {
  const h = hostLimits(worker);
  return apiFetch(worker ? `/api/limits/plans?worker=${encodeURIComponent(worker)}` : "/api/limits/plans")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { plans?: PlanLimits; models?: LimitedModel[] } | null) => {
      h.plans = body?.plans ?? null;
      h.models = body?.models ?? NO_MODELS;
      for (const listener of h.listeners) listener();
    })
    .catch(() => {});
}

const subscriber = (worker: string) => (listener: () => void) => {
  const h = hostLimits(worker);
  h.listeners.add(listener);
  if (h.listeners.size === 1) {
    void loadPlans(worker);
    h.timer = setInterval(() => void loadPlans(worker), PLANS_POLL_MS);
  }
  return () => {
    h.listeners.delete(listener);
    if (!h.listeners.size) clearInterval(h.timer);
  };
};
const subscribers = new Map<string, (listener: () => void) => () => void>();
// A stable subscribe per host, so useSyncExternalStore doesn't resubscribe on every render.
function subscribeTo(worker: string) {
  let s = subscribers.get(worker);
  if (!s) subscribers.set(worker, (s = subscriber(worker)));
  return s;
}

function useRefresh(worker: string, refreshKey?: string) {
  useEffect(() => {
    if (refreshKey) void loadPlans(worker);
  }, [worker, refreshKey]);
}

// This Mac's plans, for the status strip.
export function usePlanLimits(refreshKey?: string): PlanLimits | null {
  const value = useSyncExternalStore(subscribeTo(""), () => hostLimits("").plans, () => null);
  useRefresh("", refreshKey);
  return value;
}

// The models that have hit their own cap on the host of `cwd` (this Mac's with none), for the model pickers to mark
// (components/ModelSelect.tsx). Empty until the plans load, and on the web board, where the route isn't there.
export function useLimitedModels(cwd?: string | null, refreshKey?: string): LimitedModel[] {
  const worker = hostFor(cwd).workerId ?? "";
  const value = useSyncExternalStore(subscribeTo(worker), () => hostLimits(worker).models, () => NO_MODELS);
  useRefresh(worker, refreshKey);
  return value;
}

// For tests: forget what was loaded.
export function resetPlans() {
  for (const h of hosts.values()) clearInterval(h.timer);
  hosts.clear();
}
