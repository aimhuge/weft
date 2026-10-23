// Where onboarding stats go (lib/telemetry.ts). On the Mac: forward to the deployed Weft's collector, if the switch is
// on. On the deployed Weft: capture in PostHog with posthog-node, if its keys are set (lib/analytics-server.ts).
import { PostHog } from "posthog-node";
import { serverPosthogConfig } from "./analytics-server";
import { SITE } from "./site";
import { anonymousId, cleanProps, isAnonymousId, isOnboardingEvent, telemetryOn } from "./telemetry";

export const COLLECT_URL = `${SITE}/api/telemetry/collect`;

// The Mac's side. Fire and forget: a stat that can't be sent is dropped, never retried or queued.
export async function forwardOnboarding(event: unknown, props: unknown, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!isOnboardingEvent(event) || !telemetryOn()) return false;
  const body = JSON.stringify({ event, props: cleanProps(event, props), distinctId: anonymousId() });
  try {
    const res = await fetcher(COLLECT_URL, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// The deployed Weft's side. Only allow-listed events and props, only an anonymous ID; tagged source=desktop.
export async function captureOnboarding(body: unknown, make = (token: string, host: string) => new PostHog(token, { host, flushAt: 1, flushInterval: 0 })): Promise<number> {
  const { event, props, distinctId } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!isOnboardingEvent(event) || !isAnonymousId(distinctId)) return 400;
  const config = serverPosthogConfig();
  if (!config) return 204;
  const posthog = make(config.token, config.host);
  posthog.capture({ distinctId, event, properties: { ...cleanProps(event, props), source: "desktop", $process_person_profile: false } });
  await posthog.shutdown().catch(() => {});
  return 204;
}
