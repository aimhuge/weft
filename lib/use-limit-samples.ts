"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { LimitSample } from "./limit-chart";
import type { Backend } from "./types";

// A CLI's plan-limit history for the status strip and its burndown chart (components/LimitBurndown.tsx): this Mac's
// log, or with `worker` that Weft Worker's own, as it published it to its row (lib/worker-limits.ts). One read per CLI
// and worker a minute, shared by every strip and chart on screen.
const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; read: Promise<LimitSample[]> }>();

export function readLimitSamples(backend: Backend, worker?: string, now = Date.now()): Promise<LimitSample[]> {
  const key = `${backend}|${worker ?? ""}`;
  const known = cache.get(key);
  if (known && now - known.at < FRESH_MS) return known.read;
  const query = `backend=${backend}${worker ? `&worker=${encodeURIComponent(worker)}` : ""}`;
  const read = apiFetch(`/api/limits?${query}`)
    .then((res) => (res.ok ? res.json() : { samples: [] }))
    .then((body: { samples?: LimitSample[] }) => body.samples ?? [])
    .catch(() => []);
  cache.set(key, { at: now, read });
  return read;
}

export function forgetLimitSamples() {
  cache.clear();
}

// `skip` reads nothing (a strip that only wants a worker's, on a card that isn't one).
export function useLimitSamples(backend: Backend, worker?: string, skip = false): LimitSample[] {
  const [samples, setSamples] = useState<LimitSample[]>([]);
  useEffect(() => {
    if (skip) return;
    let live = true;
    void readLimitSamples(backend, worker).then((s) => live && setSamples(s));
    return () => {
      live = false;
    };
  }, [backend, worker, skip]);
  return samples;
}
