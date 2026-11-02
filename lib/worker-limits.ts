// A Weft Worker's plan limits (docs/architecture/project-hosts.md#settings-on-a-worker-wp3): the daemon runs the same
// 15-minute poll the desktop runs (lib/limit-poll.ts), so the worker's history fills between turns and parked cards
// resume on its own resets, and publishes the history to its row (worker_set_limits) whenever it has grown. The board
// draws it in a worker card's burndown chart (lib/worker-limits-read.ts).
import { packLimits, type PackedLimits } from "./limits-wire";
import type { LimitSample } from "./limit-chart";

export interface WorkerLimitsDeps {
  // Starts the poll (lib/limit-poll.ts startLimitPoll); idempotent.
  poll(): void;
  read(): LimitSample[];
  setLimits(limits: PackedLimits): Promise<unknown>;
  log(msg: string): void;
  everyMs?: number;
  firstMs?: number;
}

// The poll's first sample needs a CLI started; the row follows a minute later, then every few minutes.
const FIRST_MS = 60_000;
const EVERY_MS = 5 * 60_000;

export function startWorkerLimits(deps: WorkerLimitsDeps): { publish(): Promise<boolean>; stop(): void } {
  let shown: string | null = null;
  let warned = false;

  // True when it wrote the row. Unchanged history isn't sent again; a failure is logged once and tried next time.
  async function publish(): Promise<boolean> {
    try {
      const samples = deps.read();
      const last = samples.at(-1);
      const key = `${samples.length}:${last?.at ?? 0}:${last?.used ?? ""}`;
      if (!last || key === shown) return false;
      await deps.setLimits(packLimits(samples));
      shown = key;
      return true;
    } catch (err) {
      if (!warned) deps.log(`Weft Worker: publishing its limits: ${(err as Error).message}`);
      warned = true;
      return false;
    }
  }

  deps.poll();
  const first = setTimeout(() => void publish(), deps.firstMs ?? FIRST_MS);
  const timer = setInterval(() => void publish(), deps.everyMs ?? EVERY_MS);
  return {
    publish,
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
