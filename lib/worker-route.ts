"use client";

// Which way a worker's live view is reaching you, for the worker chip's tooltip (components/ProjectChips.tsx):
// "relay · 600 ms" while the board polls through Supabase, "direct · 4 ms" once the WebRTC line carries it (H6).
// The relay's number is the last poll's or command's round trip, noted by lib/worker-poll.ts and
// lib/worker-acts.ts, per worker. H6 calls `setWorkerRoute(workerId, "direct", ms)` as the line's pings come in; when it
// drops, the next relay poll takes over once the direct note is stale.
import { useSyncExternalStore } from "react";

export interface WorkerRoute {
  via: "relay" | "direct";
  ms: number;
  at: number;
}

// A direct note outranks relay polls for this long, so a line that is up isn't relabelled by a stray relay read.
export const DIRECT_FRESH_MS = 15_000;

// One route per worker, by its id; the map is replaced on every change so a subscriber sees a new snapshot.
let routes: ReadonlyMap<string, WorkerRoute> = new Map();
const listeners = new Set<() => void>();

export function setWorkerRoute(workerId: string, via: WorkerRoute["via"], ms: number, now = Date.now()) {
  routes = new Map(routes).set(workerId, { via, ms: Math.max(0, Math.round(ms)), at: now });
  for (const listener of [...listeners]) listener();
}

// A relay round trip: ignored while that worker's direct note is fresh.
export function noteRelay(workerId: string, ms: number, now = Date.now()) {
  const current = routes.get(workerId);
  if (current?.via === "direct" && now - current.at < DIRECT_FRESH_MS) return;
  setWorkerRoute(workerId, "relay", ms, now);
}

export const getWorkerRoute = (workerId: string) => routes.get(workerId) ?? null;

export const routeLabel = (r: Pick<WorkerRoute, "via" | "ms"> | null | undefined) => (r ? `${r.via} · ${r.ms} ms` : null);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const snapshot = () => routes;

// Every worker's route, for a row that draws several.
export const useWorkerRoutes = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export function resetWorkerRoute() {
  routes = new Map();
}
