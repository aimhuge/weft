// The abuse cap on a shared mini app's page and file routes (app/api/a/[id]/page, f/, v/; docs/architecture/
// mini-app-hosting.md "Costs and plans"). Views are unlimited on every plan, and a public link's views mostly never
// reach a function (Vercel's CDN answers them, lib/app-share-serve.ts), so this only meets the uncached path: a
// private, email or password link, a CDN miss, a stale URL. It is set for bots, high enough that a real crowd
// (one office behind one address, opening a folder app of a hundred files) never feels it.
//
// In-process fixed one-minute windows (lib/fixed-window.ts), not a database row per request like
// lib/app-fetch-limit.ts: a row per page view would cost more than the view it guards.
import "server-only";
import { clientIpFromHeaders, hashAnonymous } from "./app-fetch-limit";
import { fixedWindow } from "./fixed-window";

export const PAGE_PER_MINUTE_PER_IP = 1200;
export const PAGE_PER_MINUTE_PER_SHARE = 6000;
const windows = fixedWindow(60_000);

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
  const ip = windows.hit(ipKey, now);
  const share = windows.hit(shareKey, now);
  if (ip > PAGE_PER_MINUTE_PER_IP) return { ok: false, bucket: "ip", retryAfter: windows.retryAfter(ipKey, now) };
  if (share > PAGE_PER_MINUTE_PER_SHARE) return { ok: false, bucket: "share", retryAfter: windows.retryAfter(shareKey, now) };
  return { ok: true };
}

// Tests start each case from empty windows.
export function resetPageLimits(): void {
  windows.reset();
}

export function pageLimitKeys(): number {
  return windows.size();
}
