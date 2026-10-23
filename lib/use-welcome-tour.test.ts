// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackOnboarding } from "./telemetry-client";
import { useStepVoice, useWelcomeTour } from "./use-welcome-tour";
import { MUTE_KEY } from "./welcome-loop";

// The welcome's later steps speak as they open (lib/use-welcome-tour.ts), unless the tour was muted.
// (useWelcomeTour itself is covered through components/WelcomeLoop.test.tsx.)

vi.mock("./telemetry-client", () => ({ trackOnboarding: vi.fn() }));

const played = vi.hoisted(() => [] as string[]);

beforeEach(() => {
  vi.mocked(trackOnboarding).mockClear();
  played.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: Record<string, unknown>, src: string) {
      Object.assign(this, { src, muted: false, play: () => Promise.resolve(), pause: vi.fn() });
      played.push(src);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useStepVoice", () => {
  it("says each later step's line as it opens, and nothing on the first", () => {
    const { rerender } = renderHook(({ step }) => useStepVoice(step), { initialProps: { step: "ready" } });
    expect(played).toEqual([]);
    rerender({ step: "projects" });
    rerender({ step: "first" });
    expect(played).toEqual(["/welcome/narration-projects.m4a", "/welcome/narration-first.m4a"]);
  });

  it("stays quiet when the tour was muted", () => {
    localStorage.setItem(MUTE_KEY, "1");
    renderHook(() => useStepVoice("projects"));
    expect(played).toEqual([]);
  });
});

describe("useWelcomeTour's tour bar", () => {
  it("counts Back, Next and a jump, with where you came from", () => {
    const { result } = renderHook(() => useWelcomeTour({ current: null }, null));
    act(() => result.current.go("loop", "next"));
    act(() => result.current.go("intro", "back"));
    act(() => result.current.go("cta"));
    expect(vi.mocked(trackOnboarding).mock.calls).toEqual([
      ["onboarding_tour_nav", { action: "next", from: "intro", to: "loop" }],
      ["onboarding_tour_nav", { action: "back", from: "loop", to: "intro" }],
      ["onboarding_tour_nav", { action: "jump", from: "intro", to: "cta" }],
    ]);
  });
});
