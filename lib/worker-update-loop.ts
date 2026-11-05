// When a Weft Worker looks for a new build (docs/architecture/weft-worker.md#auto-updates). A push to main pings it
// (lib/worker-wake.ts listenForPushes); Update now asks by hand; a slow timer catches a missed ping. An update held by
// a live card goes the moment the worker is idle, not at the next timer. lib/worker-update.ts does the updating.
import { HEALTHY_AFTER_MS, UPDATE_EVERY_MS, type Tick } from "./worker-update";

// The backstop while pings arrive. Without them (no socket), the old pace.
export const PUSHED_UPDATE_EVERY_MS = 60 * 60_000;
// The ping is on a public topic anyone can send on, and all it can cause is a fetch of the real origin. So this is
// the most a stranger can cost a box.
export const MIN_FETCH_MS = 60_000;
// A worker on a new commit is on trial until it has run this long: a second update now would overwrite what it rolls
// back to.
export const FIRST_FETCH_MS = 2 * HEALTHY_AFTER_MS;
// A turn ending emits a burst of events, and the runner's session may not read as idle until they've landed.
const SETTLE_MS = 1_000;
const TITLE_MAX = 60;
const NAMED_MAX = 3;

// A card keeping the worker busy: asking when it's stopped on a permission or a question.
export interface Holder {
  title: string;
  asking: boolean;
}

export interface UpdateLoopDeps {
  update: { tick(hold: () => boolean): Promise<Tick>; restart(): void };
  idle: () => boolean;
  holders: () => Holder[];
  show: (note: string | null) => Promise<void>;
  // The update stayed put, so commands can run again.
  release: () => void;
  log: (msg: string) => void;
  everyMs?: number;
  pushedEveryMs?: number;
  minFetchMs?: number;
  firstFetchMs?: number;
}

const name = ({ title, asking }: Holder) => `“${title.slice(0, TITLE_MAX)}”${asking ? " (needs your answer)" : ""}`;

// The row's line: the cards you can act on first, since an answer is what frees it.
export function holdNote(target: string, holders: Holder[]): string {
  if (!holders.length) return `Update to ${target} is waiting for the worker to go idle.`;
  const sorted = [...holders].sort((a, b) => Number(b.asking) - Number(a.asking));
  const named = sorted.slice(0, NAMED_MAX).map(name).join(", ");
  const more = sorted.length > NAMED_MAX ? ` and ${sorted.length - NAMED_MAX} more` : "";
  return `Update to ${target} is waiting for ${sorted.length === 1 ? "a card" : `${sorted.length} cards`}: ${named}${more}.`;
}

export function createUpdateLoop(deps: UpdateLoopDeps) {
  const { update, idle, holders, show, release, log } = deps;
  const gap = deps.minFetchMs ?? MIN_FETCH_MS;
  const slow = deps.pushedEveryMs ?? PUSHED_UPDATE_EVERY_MS;
  const fast = deps.everyMs ?? UPDATE_EVERY_MS;

  let updating = false;
  let checking = false;
  let again = false;
  // The commit a card is holding back.
  let held: string | null = null;
  let nextFetch = Date.now() + (deps.firstFetchMs ?? FIRST_FETCH_MS);
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let fallback: ReturnType<typeof setInterval> | null = null;
  let every = 0;

  async function check() {
    if (checking) {
      again = true;
      return;
    }
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = null;
    checking = true;
    nextFetch = Date.now() + gap;
    try {
      const tick = await update.tick(() => {
        updating = idle();
        return updating;
      });
      held = tick.held ?? null;
      await show(held ? holdNote(held, holders()) : tick.note);
      // Still updating: nothing may start between here and the exit.
      if (tick.restart) {
        update.restart();
        return;
      }
    } catch (err) {
      held = null;
      // Usually no network. The row keeps what it last said, and the next check tries again.
      log(`Weft Worker: update check: ${(err as Error).message}`);
    } finally {
      checking = false;
    }
    if (updating) {
      updating = false;
      release();
    }
    if (again) {
      again = false;
      ping();
    }
  }

  // A ping inside the limit isn't dropped: a stranger's ping just before a real push mustn't swallow it, so it checks
  // when the limit runs out.
  function ping() {
    const wait = nextFetch - Date.now();
    if (wait <= 0 && !checking) {
      void check();
      return;
    }
    if (checking) again = true;
    else pingTimer ??= setTimeout(() => void check(), wait);
  }

  // The board moved or a pass ended. No network until it's really idle.
  function changed() {
    if (!held || settleTimer) return;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!held || checking) return;
      if (idle()) void check();
      else void show(holdNote(held, holders()));
    }, SETTLE_MS);
  }

  function pace(ms: number) {
    if (ms === every) return;
    every = ms;
    if (fallback) clearInterval(fallback);
    fallback = setInterval(() => void check(), ms);
  }

  return {
    check,
    ping,
    changed,
    updating: () => updating,
    start: () => pace(fast),
    // Pings sent while it was away are gone, so it looks once now.
    up() {
      pace(slow);
      ping();
    },
    down: () => pace(fast),
    stop() {
      for (const timer of [pingTimer, settleTimer]) if (timer) clearTimeout(timer);
      if (fallback) clearInterval(fallback);
    },
  };
}
