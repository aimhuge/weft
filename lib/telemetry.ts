// Anonymous onboarding stats from the desktop app (docs/architecture/analytics.md). A local Weft never calls home on
// its own; this is the one narrow exception: the welcome's steps, as the allow-listed events in lib/telemetry-events.ts.
// On by default, with a switch in Settings → Security, kept in
// ~/.weft/telemetry.json. The Mac sends them to the deployed Weft (app/api/telemetry/collect, lib/telemetry-send.ts),
// which holds the PostHog keys; the ID is a hash of this Mac's device ID, so it can't be matched to its synced cards.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deviceId } from "./device-id";
import { DATA_DIR } from "./store";

export { cleanProps, isAnonymousId, isOnboardingEvent, ONBOARDING_EVENTS, type EventProps, type OnboardingEvent } from "./telemetry-events";

// The anonymous ID: a one-way hash of the device ID, so analytics and cloud sync can't be joined.
export function anonymousId(device = deviceId()): string {
  return createHash("sha256").update(`weft-telemetry:${device}`).digest("hex").slice(0, 32);
}

export const TELEMETRY_FILE = path.join(DATA_DIR, "telemetry.json");

export function telemetryOn(file = TELEMETRY_FILE): boolean {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { onboarding?: unknown };
    return saved.onboarding !== false;
  } catch {
    return true;
  }
}

export function setTelemetryOn(on: boolean, file = TELEMETRY_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ onboarding: on }, null, 2));
}
