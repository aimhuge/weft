// A worker's plan-limit history on its cloud_workers row (docs/architecture/project-hosts.md#settings-on-a-worker-wp3):
// the samples lib/limit-history.ts keeps, packed small, so a worker card's burndown chart draws the worker's own week.
// One tuple per sample: [at in minutes, CLI, 5 or 7 (the window), used share, reset in unix seconds or 0].
// `m`, beside them, the models at their own cap (lib/model-limit.ts), so a worker card's model pickers mark the worker's
// spent models, not this Mac's (lib/use-plan-limits.ts): [model, hit at in minutes, reset in unix seconds]. An older
// worker sends no `m`, and reads as none capped.
import type { LimitSample } from "./limit-chart";
import type { ModelLimit } from "./model-limit";
import type { Backend } from "./types";

export type PackedSample = [number, string, 5 | 7, number, number];
export type PackedModel = [string, number, number];
export interface PackedLimits {
  v: 1;
  s: PackedSample[];
  m?: PackedModel[];
}

// The newest this many go up. The row's check caps the jsonb at 64 KB, and a tuple there is up to ~76 bytes once `used`
// is cut to two places and the reset to whole seconds (1,000 measured 72 KB and failed every publish), so 750 is ~57 KB.
export const MAX_PACKED = 750;
// The capped models that go up, each id cut to MODEL_ID_MAX: at most ~2.5 KB beside the samples' ~57 KB.
export const MAX_MODELS = 20;
export const MODEL_ID_MAX = 100;

const twoPlaces = (n: number) => Math.round(n * 100) / 100;

const BACKENDS: ReadonlySet<string> = new Set<Backend>(["claude", "puku", "codex", "goose", "github-copilot"]);

export function packLimits(samples: LimitSample[], max = MAX_PACKED, models: ModelLimit[] = []): PackedLimits {
  const kept = samples.slice(-max);
  const s = kept.map((x): PackedSample => [Math.round(x.at / 60_000), x.backend, x.kind === "five_hour" ? 5 : 7, twoPlaces(x.used), Math.round(x.resetsAt ?? 0)]);
  const m = models.slice(-MAX_MODELS).map((l): PackedModel => [l.model.slice(0, MODEL_ID_MAX), Math.round(l.at / 60_000), Math.round(l.resetsAt / 1000)]);
  return m.length ? { v: 1, s, m } : { v: 1, s };
}

const isModel = (t: unknown): t is PackedModel => Array.isArray(t) && t.length === 3 && typeof t[0] === "string" && typeof t[1] === "number" && typeof t[2] === "number";

/** The models a row says are at their cap and not yet reset at `now`; none from an older worker or anything else. */
export function unpackModels(packed: unknown, now = Date.now()): ModelLimit[] {
  const list = (packed as Partial<PackedLimits> | null)?.m;
  if (!Array.isArray(list)) return [];
  return list.filter(isModel).map(([model, at, resetsAt]) => ({ model, at: at * 60_000, resetsAt: resetsAt * 1000 })).filter((l) => l.resetsAt > now);
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
