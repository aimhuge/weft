// A sliding-window limit on the worker's LAN port (lib/worker-lan.ts): so many tries per address, and so many in all,
// per window. The per-address list is capped too, so a flood from many spoofed addresses can't grow it without end.
export interface RateLimit {
  perAddress: number;
  total: number;
  windowMs: number;
  maxAddresses: number;
}

export const LAN_RATE: RateLimit = { perAddress: 6, total: 20, windowMs: 60_000, maxAddresses: 256 };

export function rateLimiter(limit: RateLimit = LAN_RATE, now: () => number = Date.now) {
  const byAddress = new Map<string, number[]>();
  let all: number[] = [];
  const fresh = (times: number[], at: number) => times.filter((t) => at - t < limit.windowMs);

  // Whether one more try from this address fits; counts it when it does.
  return function allow(address: string): boolean {
    const at = now();
    all = fresh(all, at);
    if (all.length >= limit.total) return false;
    const mine = fresh(byAddress.get(address) ?? [], at);
    if (mine.length >= limit.perAddress) return false;
    if (!byAddress.has(address) && byAddress.size >= limit.maxAddresses) {
      for (const [a, times] of byAddress) if (!fresh(times, at).length) byAddress.delete(a);
      if (byAddress.size >= limit.maxAddresses) return false;
    }
    mine.push(at);
    all.push(at);
    byAddress.set(address, mine);
    return true;
  };
}
