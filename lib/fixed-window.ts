// An in-process fixed-window hit counter, for abuse caps on routes where a database row per request would cost more
// than the request it guards (lib/app-page-limit.ts, lib/telemetry-limit.ts). Each server instance counts on its own,
// which is enough to stop one address hammering an instance; Fluid Compute keeps instances warm, so the counts last.

interface Window {
  start: number;
  count: number;
}

export interface FixedWindow {
  // Count one hit on key and answer the count inside the current window.
  hit(key: string, now: number): number;
  // Seconds until the window a key is in ends, at least 1. Ask right after hit(), so the window is there.
  retryAfter(key: string, now: number): number;
  reset(): void;
  size(): number;
}

// Past sweepAt keys the map drops every window that has already ended, so a crawl of fresh addresses can't grow it
// without bound.
export function fixedWindow(windowMs: number, sweepAt = 20_000): FixedWindow {
  const windows = new Map<string, Window>();
  const sweep = (now: number) => {
    for (const [key, w] of windows) if (now - w.start >= windowMs) windows.delete(key);
  };
  return {
    hit(key, now) {
      if (windows.size >= sweepAt) sweep(now);
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return 1;
      }
      current.count += 1;
      return current.count;
    },
    retryAfter(key, now) {
      const w = windows.get(key) as Window;
      return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
    },
    reset: () => windows.clear(),
    size: () => windows.size,
  };
}
