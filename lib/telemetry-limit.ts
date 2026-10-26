// The abuse cap on the onboarding-stats collector (app/api/telemetry/collect). Every Mac posts there with no
// login, so without a cap one script could flood PostHog with events. A Mac sends a handful of welcome steps in its
// life, so the per-address limit is set for bots, high enough that an office of Macs behind one address never feels it.
//
// It also turns away browsers: the desktop app posts from Node (lib/telemetry.ts), which sends no Origin header,
// so a request that carries one from anywhere but weft.zip is a web page trying to post on a visitor's behalf.
import "server-only";
import { clientIpFromHeaders, hashAnonymous } from "./app-fetch-limit";
import { fixedWindow } from "./fixed-window";
import { SITE } from "./site";

export const TELEMETRY_PER_MINUTE_PER_IP = 60;
const windows = fixedWindow(60_000);

export type TelemetryVerdict = { ok: true } | { ok: false; status: 403 } | { ok: false; status: 429; retryAfter: number };

export function telemetryVerdict(
  headers: Headers,
  now: number = Date.now(),
  pepper: string = process.env.WEFT_MINIAPP_KEY ?? "",
): TelemetryVerdict {
  const origin = headers.get("origin");
  if (origin && origin !== new URL(SITE).origin) return { ok: false, status: 403 };
  const key = hashAnonymous(clientIpFromHeaders(headers), pepper);
  if (windows.hit(key, now) > TELEMETRY_PER_MINUTE_PER_IP) {
    return { ok: false, status: 429, retryAfter: windows.retryAfter(key, now) };
  }
  return { ok: true };
}

// Tests start each case from empty windows.
export function resetTelemetryLimits(): void {
  windows.reset();
}
