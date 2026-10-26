// The one poll clock: a named interval that runs a tick right away and then every so often, once per
// server process. The scheduler (lib/scheduler.ts) and the cron clock (lib/cron-run.ts) both poll the
// board on the same 15-second beat, so they share this instead of each declaring their own interval.

export const CHECK_EVERY_MS = 15_000;

// The clocks this process runs, by name. Each one also hangs off its own global key
// (`__weftCronTimer`, `__weftScheduleTimer`), the way each clock did before it was shared.
const g = globalThis as unknown as {
  __weftClocks?: Record<string, ReturnType<typeof setInterval>>;
  [key: string]: unknown;
};

export interface ClockOptions {
  everyMs?: number;
  // What runs right away, when it differs from the tick (the scheduler's first check sends the due
  // messages but does not bake the briefs).
  first?: () => void;
}

// Starts a clock under a name, once per server process: the first call runs right away, then the
// tick runs every `everyMs`. A second call with the same name does nothing, so a caller can ask for
// the clock without knowing whether it is already running.
export function startClock(name: string, tick: () => void, { everyMs = CHECK_EVERY_MS, first = tick }: ClockOptions = {}) {
  const key = `__weft${name.charAt(0).toUpperCase()}${name.slice(1)}Timer`;
  if (g[key]) return;
  const timer = setInterval(tick, everyMs);
  (g.__weftClocks ??= {})[name] = timer;
  g[key] = timer;
  first();
}
