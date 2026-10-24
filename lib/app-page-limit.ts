// The abuse cap on a shared mini app's page and file routes (app/api/a/[id]/page, f/, v/; docs/architecture/
// mini-app-hosting.md "Costs and plans"). Views are unlimited on every plan, and a public link's views mostly never
// reach a function (Vercel's CDN answers them, lib/app-share-serve.ts), so this only meets the uncached path: a
// private, email or password link, a CDN miss, a stale URL. It is set for bots, high enough that a real crowd
// (one office behind one address, opening a folder app of a hundred files) never feels it.
//
// In-process fixed one-minute windows, not a database row per request like lib/app-fetch-limit.ts: a row per page
// view would cost more than the view it guards. Each server instance counts on its own, which is enough to stop one
// address hammering an instance; Fluid Compute keeps instances warm, so the counts last.
import "server-only";
import { clientIpFromHeaders, hashAnonymous } from "./app-fetch-limit";

export const PAGE_PER_MINUTE_PER_IP = 1200;
export const PAGE_PER_MINUTE_PER_SHARE = 6000;
const WINDOW_MS = 60_000;
// Past this many keys the map drops every window that has already ended, so a crawl of fresh addresses can't grow it
// without bound.
const SWEEP_AT = 20_000;

interface Window {
  start: number;
  count: number;
}

const windows = new Map<string, Window>();

// Count one hit on key and answer the count inside the current window.
function hit(key: string, now: number): number {
  if (windows.size >= SWEEP_AT) sweep(now);
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    return 1;
  }
  current.count += 1;
  return current.count;
}

function sweep(now: number): void {
  for (const [key, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(key);
}

// Seconds until the window a key is in ends, at least 1. Only asked right after hit(), so the window is there.
function retryAfter(key: string, now: number): number {
  const w = windows.get(key) as Window;
  return Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000));
}

export type PageLimitVerdict = { ok: true } | { ok: false; bucket: "ip" | "share"; retryAfter: number };

// Count this request against its address and its share, and say whether it may go on. The address is hashed with
// WEFT_MINIAPP_KEY (lib/app-fetch-limit.ts hashAnonymous), so no raw IP sits in memory.
export function pageLimitVerdict(
  shareId: string,
  headers: Headers,
  now: number = Date.now(),
  pepper: string = process.env.WEFT_MINIAPP_KEY ?? "",
): PageLimitVerdict {
  const ipKey = `ip|${hashAnonymous(clientIpFromHeaders(headers), pepper)}`;
  const shareKey = `share|${shareId}`;
  const ip = hit(ipKey, now);
  const share = hit(shareKey, now);
  if (ip > PAGE_PER_MINUTE_PER_IP) return { ok: false, bucket: "ip", retryAfter: retryAfter(ipKey, now) };
  if (share > PAGE_PER_MINUTE_PER_SHARE) return { ok: false, bucket: "share", retryAfter: retryAfter(shareKey, now) };
  return { ok: true };
}

// Tests start each case from empty windows.
export function resetPageLimits(): void {
  windows.clear();
}

export function pageLimitKeys(): number {
  return windows.size;
}
