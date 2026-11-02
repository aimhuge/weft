// A host's heartbeat (docs/architecture/weft-worker.md#liveness), the one both hosts run. A worker's ticks every 20 s,
// and a Mac's rides its inbox's 30 s check (lib/cloud-inbox.ts, tick only, no presence, no offline on the way out).
// While the presence socket is up (lib/worker-presence.ts) a tick only re-tracks a changed status; the row is written
// every 5 minutes, or at once when the status changes, so last-seen and a board without Realtime stay right. With the
// socket down, or no socket at all, every tick writes the row, as before.
import type { Presence, PresenceHooks } from "../worker-presence";
import type { WorkerStatus } from "../worker-registry";

export const BEAT_MS = 20_000;
export const SLOW_BEAT_MS = 5 * 60_000;

export interface BeatDeps {
  heartbeat(status: WorkerStatus): Promise<unknown>;
  status(): WorkerStatus;
  // After every tick, with whether the last row write landed.
  after(landed: boolean): void;
  // Joins the presence topic; absent on a worker that can't.
  presence?: (hooks: PresenceHooks) => Presence;
  log: (msg: string) => void;
  // Who the log line names (default "Weft Worker").
  label?: string;
  beatMs?: number;
  slowBeatMs?: number;
  now?: () => number;
}

export function createBeat(deps: BeatDeps) {
  const now = deps.now ?? Date.now;
  const slow = deps.slowBeatMs ?? SLOW_BEAT_MS;
  let up = false;
  let tracked: WorkerStatus | null = null;
  let written: WorkerStatus | null = null;
  let writtenAt = 0;
  let landed = false;
  let presence: Presence | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  // Row writes go one after another, so a slow `online` can never land after the `offline` that follows it.
  let writing: Promise<void> = Promise.resolve();

  async function put(s: WorkerStatus) {
    try {
      await deps.heartbeat(s);
      written = s;
      writtenAt = now();
      landed = true;
    } catch (err) {
      landed = false;
      deps.log(`${deps.label ?? "Weft Worker"}: heartbeat: ${(err as Error).message}`);
    }
  }

  // Queues a step behind the write in flight; it decides there, so two ticks at once write the row only once.
  function queue(step: () => Promise<void>): Promise<void> {
    writing = writing.then(step);
    return writing;
  }

  async function tick(s: WorkerStatus = deps.status()) {
    if (stopped) return;
    if (up && s !== tracked) {
      tracked = s;
      // A track the server refused is tried again on the next tick, and the row keeps its pace meanwhile.
      void Promise.resolve(presence?.track(s)).then((ok) => {
        if (ok === false && tracked === s) tracked = null;
      });
    }
    await queue(async () => {
      if (!stopped && (!up || s !== written || now() - writtenAt >= slow)) await put(s);
    });
    deps.after(landed);
  }

  function start() {
    presence =
      deps.presence?.({
        up() {
          up = true;
          tracked = null;
          void tick();
        },
        down() {
          up = false;
        },
      }) ?? null;
    void tick();
    timer = setInterval(() => void tick(), deps.beatMs ?? BEAT_MS);
  }

  // Leaves the topic first, so a board on presence sees it go before the row says so. The `offline` waits for any write
  // still in flight, and nothing ticks after it.
  async function stop() {
    stopped = true;
    clearInterval(timer);
    presence?.leave();
    up = false;
    await queue(() => put("offline"));
  }

  return { start, stop, tick };
}
