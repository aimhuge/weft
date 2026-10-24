"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { resetFor, threadReset, type PlanSample, type ResetAnswer } from "./limit-reset";
import type { Backend, LimitWindow } from "./types";

// When a new thread on this model and CLI can start, if it can't start now.
//
// The New thread dialog asks before it makes a card: a thread started on a model that has hit its
// limit comes straight back as a rate-limit error, so the dialog offers "Start at 2:30am" instead
// and the card waits for the window (lib/start-gate.ts does the same on the server, where the plan
// log lives).
//
// The numbers come from /api/limits/plans: each CLI's newest window reading and the models that
// have hit their own cap. The client only needs them to label the button — the server decides.

interface PlanReadingPayload {
  fiveHour?: { used: number; resetsAt?: number };
  sevenDay?: { used: number; resetsAt?: number };
  // When this CLI read each window, and last reported either (unix ms).
  fiveHourAt?: number;
  sevenDayAt?: number;
  reportedAt: number;
}

interface PlansPayload {
  plans?: Partial<Record<Backend, PlanReadingPayload>>;
  models?: { model: string; at: number; resetsAt: number }[];
}

let cached: { at: number; samples: PlanSample[]; models: { model: string; at: number; resetsAt: number }[] } | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

export const GATE_POLL_MS = 60_000;

// The plan's own readings, as the flat sample list lib/limit-reset.ts reads.
//
// Each sample is stamped with when that CLI read the window; a payload without it falls back to the
// CLI's last report.
function samplesOf(plans: PlansPayload["plans"]): PlanSample[] {
  const samples: PlanSample[] = [];
  for (const [backend, reading] of Object.entries(plans ?? {}) as [Backend, PlanReadingPayload | undefined][]) {
    if (!reading) continue;
    if (reading.fiveHour) {
      samples.push({ backend, kind: "five_hour", used: reading.fiveHour.used, ...(reading.fiveHour.resetsAt !== undefined && { resetsAt: reading.fiveHour.resetsAt }), at: reading.fiveHourAt ?? reading.reportedAt });
    }
    if (reading.sevenDay) {
      samples.push({ backend, kind: "seven_day", used: reading.sevenDay.used, ...(reading.sevenDay.resetsAt !== undefined && { resetsAt: reading.sevenDay.resetsAt }), at: reading.sevenDayAt ?? reading.reportedAt });
    }
  }
  return samples;
}

export function loadGates(): Promise<void> {
  return apiFetch("/api/limits/plans")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: PlansPayload | null) => {
      cached = {
        at: Date.now(),
        samples: samplesOf(body?.plans),
        models: body?.models ?? [],
      };
      for (const listener of listeners) listener();
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void loadGates();
    timer = setInterval(() => void loadGates(), GATE_POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) clearInterval(timer);
  };
}

// The reset a new thread on this model and CLI has to wait for, if any. Undefined while the numbers
// aren't in yet, and when nothing is known to be spent.
export function useStartGate(backend: Backend, model: string | undefined): ResetAnswer | undefined {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  if (!cached) return undefined;
  // cached.at, not Date.now(): reading the clock during render is impure, and the reading is the
  // moment the numbers arrived, which is what the resets are compared against.
  return resetFor(backend, model, cached.samples, cached.models, cached.at);
}

// The reset a thread that is already running has to wait for.
//
// The reply box knows the thread's own last reading of its CLI's window (card.stats.fiveHour), which
// is the freshest number it has. The shared stores add what that snapshot can't see: the CLI's
// weekly window and the model's own cap. Same answer for the same situation as useStartGate, so a
// thread that started on a spent model and a thread that ran into one behave alike.
export function useThreadGate(
  window: LimitWindow | undefined,
  planReset: number | undefined,
  backend: Backend,
  model: string | undefined,
): ResetAnswer | undefined {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  if (!cached) return undefined;
  return threadReset(window, planReset, backend, model, cached.samples, cached.models, cached.at);
}

// For tests: forget what was loaded, and let go of the readers still subscribed.
export function resetGates() {
  cached = undefined;
  listeners.clear();
  if (timer) clearInterval(timer);
  timer = undefined;
}
