"use client";

import { call } from "./client-api";
import type { EventProps, OnboardingEvent } from "./telemetry-events";

// The board's onboarding stats (lib/telemetry.ts): fire and forget, never in the way of the welcome.
export function trackOnboarding(event: OnboardingEvent, props: EventProps = {}) {
  void call("POST", "/api/telemetry", { event, props }).catch(() => {});
}

export const telemetrySwitch = {
  get: () => call<{ on: boolean }>("GET", "/api/telemetry"),
  set: (on: boolean) => call<{ on: boolean }>("PUT", "/api/telemetry", { on }),
};
