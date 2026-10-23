import { describe, expect, it } from "vitest";
import { cleanProps, isAnonymousId, isOnboardingEvent } from "./telemetry-events";

describe("isOnboardingEvent", () => {
  it("knows only the allow-listed events", () => {
    expect(isOnboardingEvent("onboarding_step")).toBe(true);
    expect(isOnboardingEvent("onboarding_tour_nav")).toBe(true);
    expect(isOnboardingEvent("thread_started")).toBe(false);
    expect(isOnboardingEvent("toString")).toBe(false);
    expect(isOnboardingEvent(42)).toBe(false);
  });
});

describe("cleanProps", () => {
  it("keeps only the event's own keys and plain values", () => {
    expect(cleanProps("onboarding_step", { step: "projects", seconds_on_last: 12, prompt: "secret", cwd: "/Users/me" })).toEqual({ step: "projects", seconds_on_last: 12 });
    expect(cleanProps("onboarding_projects_answered", { brought: 3, count_history: true, start_empty: false })).toEqual({ brought: 3, count_history: true, start_empty: false });
  });

  it("keeps the tour bar's action and beats, and whether a beat was jumped to", () => {
    expect(cleanProps("onboarding_tour_nav", { action: "next", from: "pane", to: "quality", cwd: "/x" })).toEqual({ action: "next", from: "pane", to: "quality" });
    expect(cleanProps("onboarding_tour_beat", { beat: "blastcp", seconds: 50, jumped: true })).toEqual({ beat: "blastcp", seconds: 50, jumped: true });
  });

  it("keeps whether a skip or a first thread came from a replay", () => {
    expect(cleanProps("onboarding_skipped", { step: "ready", replay: true })).toEqual({ step: "ready", replay: true });
    expect(cleanProps("onboarding_first_thread", { backend: "claude", used_starter: true, replay: false })).toEqual({ backend: "claude", used_starter: true, replay: false });
  });

  it("drops objects, NaN and missing props, and cuts long strings", () => {
    expect(cleanProps("onboarding_step", { step: { nested: 1 }, seconds_on_last: Number.NaN })).toEqual({});
    expect(cleanProps("onboarding_step", null)).toEqual({});
    expect(cleanProps("onboarding_skipped", { step: "x".repeat(100) }).step).toHaveLength(40);
    expect(cleanProps("onboarding_signin_clicked", { anything: 1 })).toEqual({});
  });
});

describe("isAnonymousId", () => {
  it("takes only a 32-hex-character hash", () => {
    expect(isAnonymousId("a".repeat(32))).toBe(true);
    expect(isAnonymousId("someone@example.com")).toBe(false);
    expect(isAnonymousId(undefined)).toBe(false);
  });
});
