// When a dev server has gone idle (docs/architecture/dev-servers.md#idle-stop). Pure: lib/dev-idle-loop.ts feeds it once a
// minute. A server is active while its card runs a turn or something other than Weft is connected to it
// (lib/dev-traffic.ts hasVisitor); after IDLE_MS without either, it is idle and gets stopped. It comes back on demand:
// a thread's mcp__devservers__start, the review tour's dev command, Start in the Services drawer.

export const IDLE_MS = 30 * 60_000;
// An untracked server (one Weft didn't start) gets a toast with Undo this long before it is stopped.
export const GRACE_MS = 90_000;
// Footprint over this is flagged in the Services drawer.
export const HEAVY_KB = 3 * 1024 * 1024;

export interface Watch {
  key: string;
  active: boolean;
}

// Each server's last active time, carried over (a server seen for the first time starts its clock now), and the
// ones idle for IDLE_MS. Servers no longer watched drop out.
export function track(prev: ReadonlyMap<string, number>, watches: readonly Watch[], now: number): { activeAt: Map<string, number>; idle: string[] } {
  const activeAt = new Map<string, number>();
  for (const w of watches) activeAt.set(w.key, w.active ? now : (prev.get(w.key) ?? now));
  const idle = watches.filter((w) => now - (activeAt.get(w.key) as number) >= IDLE_MS).map((w) => w.key);
  return { activeAt, idle };
}

export interface Pending {
  stopAt: number;
}

// What to do with idle untracked servers: a newly idle one is announced (stopAt, for the toast), one whose grace ran
// out is stopped, and a pending stop is dropped once its server is busy again, kept, or gone.
export function plan(idle: readonly string[], pending: ReadonlyMap<string, Pending>, kept: ReadonlySet<string>, now: number): { pending: Map<string, Pending>; stop: string[] } {
  const next = new Map<string, Pending>();
  const stop: string[] = [];
  for (const key of idle) {
    if (kept.has(key)) continue;
    const was = pending.get(key);
    if (was && now >= was.stopAt) stop.push(key);
    else next.set(key, was ?? { stopAt: now + GRACE_MS });
  }
  return { pending: next, stop };
}
