// A worker's plan-limit history on its cloud_workers row (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// the samples lib/limit-history.ts keeps, packed small, so a worker card's burndown chart draws the worker's own week.
// One tuple per sample: [at in minutes, CLI, 5 or 7 (the window), used share, reset in unix seconds or 0].
import type { LimitSample } from "./limit-chart";
import type { Backend } from "./types";

export type PackedSample = [number, string, 5 | 7, number, number];
export interface PackedLimits {
  v: 1;
  s: PackedSample[];
}

// The newest this many go up: a busy week is a few hundred, and the row's cap is 64 KB.
export const MAX_PACKED = 1_000;

const BACKENDS: ReadonlySet<string> = new Set<Backend>(["claude", "puku", "codex", "goose"]);

export function packLimits(samples: LimitSample[], max = MAX_PACKED): PackedLimits {
  const kept = samples.slice(-max);
  return { v: 1, s: kept.map((x) => [Math.round(x.at / 60_000), x.backend, x.kind === "five_hour" ? 5 : 7, x.used, x.resetsAt ?? 0]) };
}

const isTuple = (t: unknown): t is PackedSample =>
  Array.isArray(t) && t.length === 5 && typeof t[0] === "number" && BACKENDS.has(t[1] as string) && (t[2] === 5 || t[2] === 7) && typeof t[3] === "number" && typeof t[4] === "number";

/** The samples a row holds, oldest first; anything that isn't a sample is skipped. */
export function unpackLimits(packed: unknown): LimitSample[] {
  const list = (packed as Partial<PackedLimits> | null)?.s;
  if (!Array.isArray(list)) return [];
  return list
    .filter(isTuple)
    .map(([at, backend, kind, used, resetsAt]) => ({ at: at * 60_000, backend: backend as Backend, kind: kind === 5 ? ("five_hour" as const) : ("seven_day" as const), used, ...(resetsAt ? { resetsAt } : {}) }))
    .sort((a, b) => a.at - b.at);
}

/** The newest 5-hour and weekly reading among samples, for a strip whose card hasn't reported its own. */
export function latestReading(samples: LimitSample[]): { fiveHour?: { used: number; resetsAt?: number }; sevenDay?: { used: number; resetsAt?: number } } {
  const last = (kind: LimitSample["kind"]) => samples.findLast((s) => s.kind === kind);
  const window = (s?: LimitSample) => (s ? { used: s.used, ...(s.resetsAt ? { resetsAt: s.resetsAt } : {}) } : undefined);
  const fiveHour = window(last("five_hour"));
  const sevenDay = window(last("seven_day"));
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) };
}
